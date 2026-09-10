/**
 * Серверный стор онлайн-комнат «Лоскутки».
 *
 * Одиночный процесс Next.js → держим комнаты в Map на globalThis
 * (переживает HML в dev) ПЛЮС снапшот в JSON-файл на диске —
 * комнаты переживают и полный рестарт сервера (dev-перезапуск, деплой):
 * игроки не «вылетают» из партии, сессия в localStorage возвращает их назад.
 * Состояние партии — чистый GameState из движка: сервер валидирует и
 * применяет ходы, отдаёт каждому игроку «повёрнутую» копию (зритель
 * всегда сидит на месте 0).
 *
 * Стабильность комнат:
 *  — в поиск открытых комнат попадают ТОЛЬКО живые (хост опрашивал < 20с),
 *    «призраки» закрытых вкладок не висят в списке;
 *  — войти в СВОЮ комнату нельзя (ownroom) — вместо этого «вернуться»;
 *  — ждущая комната без опросов хоста > 5 мин удаляется, партия — 30 мин;
 *  — снапшот пишется СИНХРОННО сразу после каждого изменения комнаты —
 *    рестарт сервера в любой момент не теряет ни одного хода;
 *  — после рестарта хода не «просрочиваются» скопом: каждому играющему
 *    даётся свежий дедлайн (грейс), а не гигантская серия автопассов.
 *
 * Таймер хода и «пропал игрок»:
 *  — дедлайн тикает, только пока владелец хода на связи (опрашивает комнату);
 *  — телефон в кармане / перекинули вкладку → таймер приостанавливается
 *    (до 90 секунд отсутствия), при возврате — 90 секунд на ход;
 *  — если владельца нет дольше 90с — ход просрочивается как обычно.
 *
 * Быстрый матч (автопоиск):
 *  — очередь quick-match: два искавших соединяются в приватную комнату;
 *  — если искателей нет — подключаемся к первой живой открытой комнате.
 *
 * Лимит времени на ход: 3 минуты (MP_TURN_MS). Просроченный ход
 * автоматически заменяется шагом вперёд (advance), кожаный лоскуток
 * ставится на первую свободную клетку. Проверка — при любом обращении
 * к комнате (poll/ход/лист комнат).
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { advanceAction, buyAndPlace, createGame, placeLeather } from '@/lib/game/engine';
import type { GameEvent, GameState, MpRoomView, NetAction } from '@/lib/game/types';
import { BOARD_SIZE } from '@/lib/game/constants';
import { AVATAR_IDS } from '@/lib/avatars';

/** Сколько длится ход (мс). Для тестов переопределяется env MP_TURN_MS. */
export function turnMs(): number {
  const v = Number(process.env.MP_TURN_MS);
  return Number.isFinite(v) && v > 0 ? v : 180_000;
}

const CONNECTED_MS = 12_000; // «на связи» = опрашивал меньше 12с назад
const ROOM_TTL_MS = 30 * 60_000; // брошенные партии чистим через 30 минут
const WAITING_HOST_TTL_MS = 5 * 60_000; // ждущая комната без хоста живёт 5 минут
const LIST_ALIVE_MS = 20_000; // в поиске показываем только живые комнаты
const MAX_AUTO_TICKS = 80; // предохранитель цикла автопассов
const OWNER_ABSENT_CAP_MS = 90_000; // дольше — владелец хода считается ушедшим, автопасс
const RESUME_GRANT_MS = 90_000; // вернулся после паузы — минимум времени на ход
const QUICK_ALIVE_MS = 10_000; // искатель живёт в очереди без опросов 10с

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface MpPlayer {
  id: string;
  name: string;
  avatar: string;
  lastPoll: number;
  leftAt: number | null;
}

export interface MpRoom {
  code: string;
  host: MpPlayer;
  guest: MpPlayer | null;
  isPublic: boolean;
  status: 'waiting' | 'playing' | 'finished' | 'abandoned';
  /** каноническое состояние: место 0 = хост, место 1 = гость */
  state: GameState | null;
  version: number;
  /** номер партии в комнате (реванш = новый gameSeq) */
  gameSeq: number;
  turnDeadline: number | null;
  turnSig: string | null;
  /** таймер хода приостановлен: владелец хода пропал (телефон в кармане) */
  frozen: boolean;
  lastEvents: GameEvent[];
  lastEventsVersion: number;
  timedOutSeat: number | null;
  timedOutVersion: number | null;
  rematchHost: boolean;
  rematchGuest: boolean;
  wins: [number, number];
  createdAt: number;
  updatedAt: number;
}

// ===== глобальный стор (переживает HMR + рестарты через снапшот на диске) =====

const g = globalThis as unknown as {
  __loskutkiRooms?: Map<string, MpRoom>;
  __loskutkiQuick?: Map<string, QuickEntry>;
};
const rooms: Map<string, MpRoom> = g.__loskutkiRooms ?? hydrateFromDisk();
g.__loskutkiRooms = rooms;

/** Очередь быстрого матча (автопоиск): playerId → искатель */
export interface QuickEntry {
  playerId: string;
  name: string;
  avatar: string;
  lastPoll: number;
  /** пары уже составлена: ждём, пока искатель заберёт код комнаты */
  matchedCode: string | null;
}
const quickQueue: Map<string, QuickEntry> = g.__loskutkiQuick ?? new Map();
g.__loskutkiQuick = quickQueue;

function storePath(): string {
  return process.env.LOSKUTKI_MP_STORE ?? path.join(process.cwd(), '.mp-rooms.json');
}

/** Загрузить комнаты из снапшота (после полного рестарта процесса).
 *  Играющим комнатам даём СВЕЖИЙ дедлайн хода — рестарт не должен
 *  просрочить чужие ходы и устроить серию автопассов. */
function hydrateFromDisk(): Map<string, MpRoom> {
  const map = new Map<string, MpRoom>();
  try {
    const raw = readFileSync(storePath(), 'utf8');
    const arr = JSON.parse(raw) as MpRoom[];
    if (Array.isArray(arr)) {
      const now = Date.now();
      for (const r of arr) {
        if (r && typeof r.code === 'string' && typeof r.host?.id === 'string') {
          if (r.status === 'playing' && r.state) {
            r.turnDeadline = now + turnMs();
            r.turnSig = null;
          }
          // оба ушли до рестарта — комнату не оживляем
          if (r.status === 'abandoned' || (r.host.leftAt !== null && r.guest?.leftAt != null)) {
            continue;
          }
          map.set(r.code, r);
        }
      }
    }
  } catch {
    /* нет файла / битый файл — стартуем с пустого стора */
  }
  return map;
}

/** Сохранить снапшот — СИНХРОННО сразу после изменения комнаты:
 *  рестарт процесса в любой момент не теряет ни одного хода.
 *  Файл маленький (несколько комнат), запись — доли миллисекунды. */
function persist(): void {
  try {
    writeFileSync(storePath(), JSON.stringify([...rooms.values()]));
  } catch {
    /* недоступный диск — деградируем до памяти */
  }
}

export function __resetRoomsForTests(): void {
  rooms.clear();
  quickQueue.clear();
}

/** Тесты: прочитать снапшот с диска как новый процесс. */
export function __roomsOnDisk(): MpRoom[] {
  try {
    const arr = JSON.parse(readFileSync(storePath(), 'utf8')) as MpRoom[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// ===== утилиты =====

function genCode(): string {
  for (;;) {
    let s = '';
    for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!rooms.has(s)) return s;
  }
}

function genId(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/-/g, '').slice(0, 24);
}

function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  return s.slice(0, 16);
}

function cleanAvatar(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  return (AVATAR_IDS as readonly string[]).includes(s) ? s : 'ann';
}

function seatOf(room: MpRoom, playerId: string): 0 | 1 | null {
  if (room.host.id === playerId) return 0;
  if (room.guest?.id === playerId) return 1;
  return null;
}

/** чей сейчас ответ (фаза действия → активный; кожаный лоскуток → владелец) */
function turnOwner(state: GameState): number {
  if (state.phase === 'placing') {
    return state.pendingQueue.length > 0 ? state.pendingQueue[0].player : state.activePlayer;
  }
  return state.activePlayer;
}

function turnSigOf(state: GameState): string {
  return `${state.turn}|${state.phase}|${turnOwner(state)}`;
}

function resetDeadline(room: MpRoom) {
  const st = room.state;
  if (!st || st.phase === 'gameover' || room.status !== 'playing') {
    room.turnDeadline = null;
    return;
  }
  const sig = turnSigOf(st);
  if (sig !== room.turnSig || room.turnDeadline === null) {
    room.turnSig = sig;
    room.turnDeadline = Date.now() + turnMs();
  }
}

function bumpVersion(room: MpRoom) {
  room.version++;
  room.updatedAt = Date.now();
}

/** Список ОТКРЫТЫХ комнат + чистка протухших.
 *  Показываем только живые: хост опрашивал комнату < 20с назад —
 *  «призраки» закрытых вкладок не попадают в поиск. */
export function listRooms(): Array<{ code: string; hostName: string; hostAvatar: string; createdAt: number }> {
  sweep();
  const now = Date.now();
  const out: Array<{ code: string; hostName: string; hostAvatar: string; createdAt: number }> = [];
  for (const r of rooms.values()) {
    if (r.isPublic && r.status === 'waiting' && r.guest === null && r.host.leftAt === null) {
      if (now - r.host.lastPoll <= LIST_ALIVE_MS) {
        out.push({ code: r.code, hostName: r.host.name, hostAvatar: r.host.avatar, createdAt: r.createdAt });
      }
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
}

function sweep() {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (r.status === 'waiting') {
      // ждущую комнату без хоста удаляем: 5 минут без опросов — хост ушёл
      if (now - Math.max(r.host.lastPoll, r.createdAt) > WAITING_HOST_TTL_MS) {
        rooms.delete(code);
      }
      continue;
    }
    const stale = now - Math.max(r.updatedAt, r.host.lastPoll, r.guest?.lastPoll ?? 0) > ROOM_TTL_MS;
    if (stale) rooms.delete(code);
  }
}

// ===== создание / вход / выход =====

export function createRoom(input: { name: unknown; avatar: unknown; isPublic: unknown }): {
  code: string;
  playerId: string;
} {
  const name = cleanName(input.name);
  if (name.length < 1) throw 'badname';
  const room: MpRoom = {
    code: genCode(),
    host: { id: genId(), name, avatar: cleanAvatar(input.avatar), lastPoll: Date.now(), leftAt: null },
    guest: null,
    isPublic: input.isPublic === true,
    status: 'waiting',
    state: null,
    version: 0,
    gameSeq: 0,
    turnDeadline: null,
    turnSig: null,
    frozen: false,
    lastEvents: [],
    lastEventsVersion: -1,
    timedOutSeat: null,
    timedOutVersion: null,
    rematchHost: false,
    rematchGuest: false,
    wins: [0, 0],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  rooms.set(room.code, room);
  persist();
  return { code: room.code, playerId: room.host.id };
}

export function joinRoom(input: { code: unknown; name: unknown; avatar: unknown; playerId?: unknown }): {
  code: string;
  playerId: string;
} {
  const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
  const name = cleanName(input.name);
  if (name.length < 1) throw 'badname';
  const room = rooms.get(code);
  if (!room) throw 'notfound';
  // хост не может «войти» в собственную комнату как гость — иначе партия
  // начнётся против самого себя и друзья уже не смогут присоединиться
  if (typeof input.playerId === 'string' && input.playerId === room.host.id) throw 'ownroom';
  if (room.status !== 'waiting' || room.guest !== null) throw 'full';
  if (room.host.leftAt !== null) throw 'gone';
  tick(room);
  if (room.status !== 'waiting' || room.guest !== null) throw 'full';

  const seed = (Math.floor(Math.random() * 1e9) ^ Date.now()) >>> 0;
  const firstPlayer = Math.random() < 0.5 ? 0 : 1;
  room.guest = { id: genId(), name, avatar: cleanAvatar(input.avatar), lastPoll: Date.now(), leftAt: null };
  room.state = createGame({ seed, mode: 'online', botLevel: 'fedor', firstPlayer });
  room.status = 'playing';
  room.gameSeq++;
  room.turnSig = null;
  room.frozen = false;
  room.lastEvents = [];
  room.lastEventsVersion = room.version;
  room.timedOutSeat = null;
  room.timedOutVersion = null;
  room.rematchHost = false;
  room.rematchGuest = false;
  bumpVersion(room);
  resetDeadline(room);
  persist();
  return { code: room.code, playerId: room.guest.id };
}

export function getRoom(code: string): MpRoom | null {
  return rooms.get(code.trim().toUpperCase()) ?? null;
}

/** Отметить «на связи» (вызывается при каждом poll).
 *  Если вернулся владелец хода с замороженным таймером — выдать ему
 *  гарантированные RESUME_GRANT_MS на обдумывание. */
export function touch(room: MpRoom, seat: 0 | 1) {
  const now = Date.now();
  const p = seat === 0 ? room.host : room.guest;
  if (p) p.lastPoll = now;
  if (
    room.frozen &&
    room.status === 'playing' &&
    room.state &&
    room.turnDeadline !== null &&
    turnOwner(room.state) === seat
  ) {
    room.frozen = false;
    if (room.turnDeadline < now + RESUME_GRANT_MS) room.turnDeadline = now + RESUME_GRANT_MS;
  }
}

/** Выход игрока: waiting → комната закрывается; playing → «соперник ушёл» */
export function leaveRoom(room: MpRoom, playerId: string): void {
  const seat = seatOf(room, playerId);
  if (seat === null) throw 'notfound';
  if (room.status === 'waiting') {
    rooms.delete(room.code);
    persist();
    return;
  }
  const p = seat === 0 ? room.host : room.guest;
  if (p) p.leftAt = Date.now();
  if (room.status === 'playing') {
    room.status = 'abandoned';
    bumpVersion(room);
  }
  // оба ушли — комнату прибираем (финишированную держим, пока оба не выйдут)
  const other = seat === 0 ? room.guest : room.host;
  const otherGone = !other || other.leftAt !== null;
  if (otherGone) rooms.delete(room.code);
  persist();
}

/** Хост отменяет ожидающую комнату */
export function cancelRoom(room: MpRoom, playerId: string): void {
  const seat = seatOf(room, playerId);
  if (seat !== 0 || room.status !== 'waiting') throw 'notfound';
  rooms.delete(room.code);
  persist();
}

// ===== ходы и таймауты =====

export function applyAction(room: MpRoom, seat: 0 | 1, action: NetAction): void {
  tick(room);
  const st = room.state;
  if (!st || room.status === 'abandoned') throw 'gone';
  if (room.status === 'finished' || st.phase === 'gameover') throw 'started';
  if (room.status !== 'playing') throw 'gone';
  if (turnOwner(st) !== seat) throw 'notyourturn';

  let res: { state: GameState; events: GameEvent[] };
  try {
    if (action.type === 'advance') {
      res = advanceAction(st);
    } else if (action.type === 'buy') {
      if (action.marketIndex === undefined || action.orientation === undefined
        || action.r === undefined || action.c === undefined) throw 'badpayload';
      res = buyAndPlace(st, action.marketIndex, { orientation: action.orientation, r: action.r, c: action.c });
    } else if (action.type === 'leather') {
      if (action.r === undefined || action.c === undefined) throw 'badpayload';
      res = placeLeather(st, action.r, action.c);
    } else {
      throw 'badpayload';
    }
  } catch (e) {
    // движок бросает Error с текстом — наружу отдаём код
    throw e === 'badpayload' ? 'badpayload' : 'illegal';
  }

  commit(room, res.state, res.events);
}

function commit(room: MpRoom, state: GameState, events: GameEvent[]): void {
  room.state = state;
  room.lastEvents = events;
  bumpVersion(room);
  room.lastEventsVersion = room.version;
  if (state.phase === 'gameover' && room.status === 'playing') {
    room.status = 'finished';
    const w = state.result?.winner;
    if (w === 0) room.wins[0]++;
    else if (w === 1) room.wins[1]++;
  }
  resetDeadline(room);
  persist();
}

/** Просроченные ходы играют сами (advance; кожаный — в первую пустую клетку).
 *  НО: если владелец хода пропал (не опрашивает комнату) — таймер
 *  приостанавливается до OWNER_ABSENT_CAP_MS: телефон в кармане не должен
 *  проигрывать партию за игрока. Дольше 90с отсутствия — автопасс как раньше. */
export function tick(room: MpRoom): void {
  if (room.status !== 'playing' || !room.state) return;
  let guard = 0;
  while (room.turnDeadline !== null && Date.now() > room.turnDeadline && guard++ < MAX_AUTO_TICKS) {
    const st = room.state;
    if (st.phase === 'gameover') break;
    const owner = turnOwner(st);
    const ownerPlayer = owner === 0 ? room.host : room.guest;
    const absent = ownerPlayer ? Date.now() - ownerPlayer.lastPoll : Infinity;
    const explicitLeft = ownerPlayer ? ownerPlayer.leftAt !== null : true;
    // владелец на связи (только что опрашивал) или отсутствует дольше лимита,
    // или ушёл сознательно — просрочка честная: автопасс
    // (законно истекшее время при живом опросе: lastPoll свежий)
    if (!explicitLeft && absent > CONNECTED_MS && absent < OWNER_ABSENT_CAP_MS) {
      // пропал совсем недавно — замораживаем таймер и ждём его
      room.frozen = true;
      room.turnDeadline = Date.now() + 5_000; // перепроверим через 5с
      persist();
      break;
    }
    let res: { state: GameState; events: GameEvent[] };
    if (st.phase === 'placing') {
      const board = st.players[owner].board;
      const idx = board.findIndex((v) => v === -1);
      if (idx === -1) break;
      try {
        res = placeLeather(st, Math.floor(idx / BOARD_SIZE), idx % BOARD_SIZE);
      } catch {
        break;
      }
    } else {
      try {
        res = advanceAction(st);
      } catch {
        break;
      }
    }
    room.frozen = false;
    commit(room, res.state, res.events);
    room.timedOutSeat = owner;
    room.timedOutVersion = room.version;
    if (room.state.phase === 'gameover') break;
  }
  resetDeadline(room);
}

/** Реванш: когда оба согласились — новая партия в той же комнате */
export function requestRematch(room: MpRoom, playerId: string): { started: boolean } {
  const seat = seatOf(room, playerId);
  if (seat === null) throw 'notfound';
  if (room.status !== 'finished') throw 'started';
  if (seat === 0) room.rematchHost = true;
  else room.rematchGuest = true;

  if (room.rematchHost && (room.rematchGuest || room.guest === null)) {
    const seed = (Math.floor(Math.random() * 1e9) ^ Date.now()) >>> 0;
    const firstPlayer = Math.random() < 0.5 ? 0 : 1;
    room.state = createGame({ seed, mode: 'online', botLevel: 'fedor', firstPlayer });
    room.status = 'playing';
    room.gameSeq++;
    room.turnSig = null;
    room.frozen = false;
    room.rematchHost = false;
    room.rematchGuest = false;
    room.lastEvents = [];
    room.lastEventsVersion = room.version;
    room.timedOutSeat = null;
    room.timedOutVersion = null;
    if (room.host.leftAt !== null) room.host.leftAt = null;
    if (room.guest) room.guest.leftAt = null;
    bumpVersion(room);
    resetDeadline(room);
    persist();
    return { started: true };
  }
  bumpVersion(room);
  persist();
  return { started: false };
}

// ===== поворот состояния под зрителя =====

function swap(p: number): number {
  return p === 0 ? 1 : p === 1 ? 0 : p;
}

function rotatePlayer(p: GameState['players'][number]): GameState['players'][number] {
  return { ...p, board: [...p.board] };
}

function rotateEvent(e: GameEvent): GameEvent {
  const out = { ...e };
  if (e.player !== undefined) out.player = swap(e.player);
  return out;
}

/** Глубокая копия «от лица seat»: зритель всегда на месте 0 */
function rotatedState(state: GameState, seat: 0 | 1, room: MpRoom): GameState {
  const s = JSON.parse(JSON.stringify(state)) as GameState;
  if (seat === 1) {
    const [a, b] = s.players;
    s.players = [rotatePlayer(b), rotatePlayer(a)] as GameState['players'];
    s.activePlayer = swap(s.activePlayer);
    s.topToken = s.topToken === null ? null : swap(s.topToken);
    s.firstPlayer = swap(s.firstPlayer);
    s.pendingQueue = s.pendingQueue.map((p) => ({ ...p, player: swap(p.player) }));
    if (s.tile7x7Owner !== null) s.tile7x7Owner = swap(s.tile7x7Owner);
    s.log = s.log.map((l) => {
      const nl = { ...l, player: swap(l.player) };
      if (nl.code === 'start' && nl.data?.first !== undefined) {
        nl.data = { ...nl.data, first: swap(Number(nl.data.first)) };
      }
      return nl;
    });
    if (s.result) {
      const [r0, r1] = s.result.scores;
      const winner = s.result.winner === null ? null : swap(s.result.winner);
      s.result = {
        ...s.result,
        scores: [r1, r0],
        winner,
        humanWon: winner === null ? null : winner === 0,
      };
    }
  }
  const me = seat === 0 ? room.host : room.guest!;
  const foe = seat === 0 ? room.guest : room.host;
  s.online = {
    code: room.code,
    myName: me.name,
    myAvatar: me.avatar,
    foeName: foe?.name ?? '',
    foeAvatar: foe?.avatar ?? 'ann',
  };
  return s;
}

/** Полный вид комнаты для игрока (после тика таймаутов) */
export function viewFor(room: MpRoom, playerId: string): MpRoomView {
  const seat = seatOf(room, playerId);
  if (seat === null) throw 'notfound';
  tick(room);
  touch(room, seat);
  const me = seat === 0 ? room.host : room.guest!;
  const foe = seat === 0 ? room.guest : room.host;
  const now = Date.now();
  const events = room.lastEventsVersion === room.version ? room.lastEvents : null;
  // события поворачиваем ТОЛЬКО для гостя (канонические игроки 0=хост, 1=гость)
  const viewEvents = events && seat === 1 ? events.map(rotateEvent) : events ?? null;
  return {
    code: room.code,
    status: room.status,
    isPublic: room.isPublic,
    mySeat: seat,
    me: { name: me.name, avatar: me.avatar, connected: now - me.lastPoll < CONNECTED_MS },
    foe: foe
      ? {
          name: foe.name,
          avatar: foe.avatar,
          connected: now - foe.lastPoll < CONNECTED_MS,
          left: foe.leftAt !== null,
        }
      : null,
    wins: [room.wins[0], room.wins[1]],
    rematchMe: seat === 0 ? room.rematchHost : room.rematchGuest,
    rematchFoe: seat === 0 ? room.rematchGuest : room.rematchHost,
    version: room.version,
    gameSeq: room.gameSeq,
    turnDeadline: room.status === 'playing' ? room.turnDeadline : null,
    /** таймер хода приостановлен (владелец хода не на связи) */
    turnPaused: room.status === 'playing' && room.frozen,
    serverNow: now,
    state: room.state ? rotatedState(room.state, seat, room) : null,
    events: viewEvents,
    eventsVersion: events ? room.version : -1,
    // сид просрочившегося поворачиваем ТОЛЬКО для гостя (он смотрит с места 1)
    timedOutSeat: room.timedOutSeat === null ? null : seat === 1 ? swap(room.timedOutSeat) : room.timedOutSeat,
    timedOutVersion: room.timedOutVersion,
  };
}

// ===== быстрый матч (автопоиск) =====

/** подчистить протухших искателей (не опрашивали очередь > QUICK_ALIVE_MS) */
function pruneQuick() {
  const now = Date.now();
  for (const [id, e] of quickQueue) {
    if (now - e.lastPoll > QUICK_ALIVE_MS) quickQueue.delete(id);
  }
}

/** первая живая открытая комната (критерии — как в поиске) */
function firstLivePublicRoom(): MpRoom | null {
  const now = Date.now();
  let best: MpRoom | null = null;
  for (const r of rooms.values()) {
    if (r.isPublic && r.status === 'waiting' && r.guest === null && r.host.leftAt === null) {
      if (now - r.host.lastPoll <= LIST_ALIVE_MS && (!best || r.createdAt < best.createdAt)) {
        best = r;
      }
    }
  }
  return best;
}

/** посадить гостя в ждущую комнату и стартовать партию */
function seatGuest(room: MpRoom, pid: string, name: string, avatar: string): void {
  room.guest = { id: pid, name, avatar, lastPoll: Date.now(), leftAt: null };
  room.state = createGame({
    seed: (Math.floor(Math.random() * 1e9) ^ Date.now()) >>> 0,
    mode: 'online',
    botLevel: 'fedor',
    firstPlayer: Math.random() < 0.5 ? 0 : 1,
  });
  room.status = 'playing';
  room.gameSeq++;
  room.turnSig = null;
  room.frozen = false;
  room.lastEvents = [];
  room.lastEventsVersion = room.version;
  room.timedOutSeat = null;
  room.timedOutVersion = null;
  room.rematchHost = false;
  room.rematchGuest = false;
  bumpVersion(room);
  resetDeadline(room);
  persist();
}

/** новая комната с парой (host = искатель из очереди, guest = я) */
function pairRoom(host: QuickEntry, guestId: string, guestName: string, guestAvatar: string): MpRoom {
  const room: MpRoom = {
    code: genCode(),
    host: { id: host.playerId, name: host.name, avatar: host.avatar, lastPoll: Date.now(), leftAt: null },
    guest: null,
    isPublic: false,
    status: 'waiting',
    state: null,
    version: 0,
    gameSeq: 0,
    turnDeadline: null,
    turnSig: null,
    frozen: false,
    lastEvents: [],
    lastEventsVersion: -1,
    timedOutSeat: null,
    timedOutVersion: null,
    rematchHost: false,
    rematchGuest: false,
    wins: [0, 0],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  rooms.set(room.code, room);
  seatGuest(room, guestId, guestName, guestAvatar);
  return room;
}

/**
 * Заявка на быстрый матч. Порядок подбора:
 *  1) пару уже составили → забрать код комнаты (я — хост);
 *  2) другой живой искатель в очереди → составить пару (я — гость);
 *  3) живая открытая комната → войти в неё гостем;
 *  4) никого → встать в очередь и ждать (клиент опрашивает каждые ~2с).
 * Повторный вызов с тем же playerId обновляет присутствие (self-healing
 * после рестарта сервера: очередь в памяти, игрок просто встанет заново).
 */
export function quickMatch(input: { playerId?: unknown; name: unknown; avatar: unknown }): {
  status: 'matched' | 'waiting';
  code?: string;
  playerId: string;
} {
  const name = cleanName(input.name);
  if (name.length < 1) throw 'badname';
  pruneQuick();
  const pid = typeof input.playerId === 'string' && input.playerId.length > 8 ? input.playerId : genId();
  const avatar = cleanAvatar(input.avatar);

  const mine = quickQueue.get(pid);
  if (mine) {
    mine.name = name;
    mine.avatar = avatar;
    mine.lastPoll = Date.now();
    if (mine.matchedCode) {
      const code = mine.matchedCode;
      quickQueue.delete(pid);
      return { status: 'matched', code, playerId: pid };
    }
    // пока ждали — появилась открытая комната? входим в неё
    const open = firstLivePublicRoom();
    if (open) {
      quickQueue.delete(pid);
      seatGuest(open, pid, name, avatar);
      return { status: 'matched', code: open.code, playerId: pid };
    }
    return { status: 'waiting', playerId: pid };
  }

  // другой живой искатель → пара в новой приватной комнате (я — гость)
  for (const e of quickQueue.values()) {
    if (e.matchedCode === null) {
      const room = pairRoom(e, pid, name, avatar);
      e.matchedCode = room.code;
      return { status: 'matched', code: room.code, playerId: pid };
    }
  }

  // живая открытая комната → сразу входим гостем
  const open = firstLivePublicRoom();
  if (open) {
    seatGuest(open, pid, name, avatar);
    return { status: 'matched', code: open.code, playerId: pid };
  }

  // никого — встаём в очередь
  quickQueue.set(pid, { playerId: pid, name, avatar, lastPoll: Date.now(), matchedCode: null });
  return { status: 'waiting', playerId: pid };
}

/** Отменить автопоиск */
export function quickCancel(playerId: unknown): void {
  if (typeof playerId === 'string' && playerId) quickQueue.delete(playerId);
}
