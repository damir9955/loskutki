/**
 * Серверная логика онлайн-комнат «Лоскутки» (stateless).
 *
 * Каждый запрос читает комнату из хранилища (см. roomStore.ts), применяет
 * изменения синхронной игровой логикой и записывает обратно УСЛОВНО
 * (CAS по rev). Стабильный реалтайм-мультиплеер (WebSocket без таймаутов)
 * будет перенесён на отдельный сервер Deno Deploy — см. промпт
 * download/prompt-loskutki-deno.md; серверная логика правил при этом
 * переезжает на новый сервер почти без изменений.
 *
 * Игровая логика НЕ менялась: судья на чистом движке, ротация состояния под
 * зрителя (зритель всегда место 0), 3-мин дедлайн хода с ленивой проверкой
 * (проверка — при любом обращении к комнате, никаких setTimeout), автопасс
 * просрочки, пауза таймера при пропавшем владельце хода, реванш, победы.
 *
 * Стабильность:
 *  — дедлайн хода оживляется после паузы > 60с без обращений (рестарт
 *    сервера/сети не просрочивает чужие ходы каскадом автопассов);
 *  — в поиск открытых комнат попадают ТОЛЬКО живые (хост опрашивал < 20с);
 *  — протухшие комнаты чистятся при листинге (TTL 5 мин / 30 мин);
 *  — быстрый матч: искатель занимает СТАРШУЮ (по времени создания) открытую
 *    комнату — направление подбора детерминировано, гонки «два гостя»
 *    исключены CAS-записью.
 *
 * Пешки протокола те же, что и раньше (JSON API /api/mp/*): клиентский код
 * не менялся.
 */

import { advanceAction, buyAndPlace, createGame, placeLeather } from '@/lib/game/engine';
import type { GameEvent, GameState, MpRoomView, NetAction } from '@/lib/game/types';
import { BOARD_SIZE } from '@/lib/game/constants';
import { AVATAR_IDS } from '@/lib/avatars';
import {
  getRoomStore,
  __resetMemoryStore,
  __roomsOnDisk,
  type LoadedRoom,
  type MpPlayer,
  type MpRoom,
  type RoomStore,
} from './roomStore';

export type { MpPlayer, MpRoom, LoadedRoom, RoomStore };
export { __roomsOnDisk, __resetMemoryStore };

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
const REVIVE_GAP_MS = 60_000; // пауза без обращений, после которой дедлайн оживляется
const CAS_ATTEMPTS = 4; // перечитываний при конфликте записи

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ===== утилиты =====

function genCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
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

function newRoom(code: string, host: MpPlayer, isPublic: boolean, quickHost = false): MpRoom {
  return {
    code,
    host,
    guest: null,
    isPublic,
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
    quickHost,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/** Снимок изменяемых полей — чтобы сохранять комнату ТОЛЬКО при изменении. */
function markOf(room: MpRoom) {
  return {
    v: room.version,
    up: room.updatedAt,
    hp: room.host.lastPoll,
    gp: room.guest?.lastPoll ?? -1,
    dl: room.turnDeadline,
    fz: room.frozen,
    st: room.status,
  };
}

function changed(room: MpRoom, mark: ReturnType<typeof markOf>): boolean {
  const m = markOf(room);
  return (
    m.v !== mark.v || m.up !== mark.up || m.hp !== mark.hp || m.gp !== mark.gp
    || m.dl !== mark.dl || m.fz !== mark.fz || m.st !== mark.st
  );
}

/**
 * Оживление дедлайна после паузы: если комнату никто не трогал дольше
 * REVIVE_GAP_MS (рестарт сервера, обрыв сети у обоих, «засыпание»
 * serverless-инстанса), просроченным ходам выдаём СВЕЖЕЕ время — пауза
 * инфраструктуры не должна проигрывать партию за игрока каскадом автопассов.
 */
function revive(room: MpRoom) {
  if (
    room.status === 'playing' &&
    room.state &&
    room.state.phase !== 'gameover' &&
    Date.now() - room.updatedAt > REVIVE_GAP_MS
  ) {
    room.turnDeadline = Date.now() + turnMs();
    room.frozen = false;
  }
}

/**
 * Загрузить → применить синхронную мутацию → условно записать (CAS).
 * fn обязан быть безопасен к повтору на свежем состоянии (все мутации ниже —
 * идемпотентны). Возвращает комнату ПОСЛЕ записи; null — комнаты нет.
 */
async function mutateRoom(
  code: string,
  fn: (room: MpRoom) => 'delete' | void,
): Promise<{ room: MpRoom | null; deleted: boolean }> {
  const store = getRoomStore();
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const loaded = await store.load(code);
    if (!loaded) return { room: null, deleted: false };
    revive(loaded.room);
    const mark = markOf(loaded.room);
    const verdict = fn(loaded.room);
    if (verdict === 'delete') {
      let removed = false;
      try {
        removed = await store.remove(code, loaded.rev);
      } catch {
        removed = false;
      }
      if (removed) return { room: null, deleted: true };
      continue; // конфликт — перечитываем и пробуем снова
    }
    if (!changed(loaded.room, mark)) {
      return { room: loaded.room, deleted: false };
    }
    let saved = false;
    try {
      saved = await store.save(loaded.room, loaded.rev);
    } catch {
      saved = false;
    }
    if (saved) return { room: loaded.room, deleted: false };
    // конфликт: другой инстанс записал первым — перечитываем и повторяем
  }
  throw 'conflict';
}

// ===== внутренняя (синхронная) логика комнат =====

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
}

/** внутренняя логика join (валидации + старт партии); возвращает id гостя */
function joinInternal(room: MpRoom, input: { name: string; avatar: string; playerId?: unknown }): string {
  // хост не может «войти» в собственную комнату как гость — иначе партия
  // начнётся против самого себя и друзья уже не смогут присоединиться
  if (typeof input.playerId === 'string' && input.playerId === room.host.id) throw 'ownroom';
  if (room.status !== 'waiting' || room.guest !== null) throw 'full';
  if (room.host.leftAt !== null) throw 'gone';
  tick(room);
  if (room.status !== 'waiting' || room.guest !== null) throw 'full';
  const guestId = genId();
  seatGuest(room, guestId, input.name, input.avatar);
  return guestId;
}

/** внутренняя логика выхода; 'delete' — комнату нужно удалить */
function leaveInternal(room: MpRoom, playerId: string): 'delete' | void {
  const seat = seatOf(room, playerId);
  if (seat === null) throw 'notfound';
  if (room.status === 'waiting') return 'delete';
  const p = seat === 0 ? room.host : room.guest;
  if (p) p.leftAt = Date.now();
  if (room.status === 'playing') {
    room.status = 'abandoned';
    bumpVersion(room);
  }
  // оба ушли — комнату прибираем (финишированную держим, пока оба не выйдут)
  const other = seat === 0 ? room.guest : room.host;
  const otherGone = !other || other.leftAt !== null;
  if (otherGone) return 'delete';
}

/** внутренняя логика отмены ждущей комнаты хостом */
function cancelInternal(room: MpRoom, playerId: string): 'delete' | void {
  const seat = seatOf(room, playerId);
  if (seat !== 0 || room.status !== 'waiting') throw 'notfound';
  return 'delete';
}

/** внутренняя логика реванша */
function rematchInternal(room: MpRoom, playerId: string): boolean {
  const seat = seatOf(room, playerId);
  if (seat === null) throw 'notfound';
  if (room.status !== 'finished') throw 'started';
  if (seat === 0) room.rematchHost = true;
  else room.rematchGuest = true;

  if (room.rematchHost && (room.rematchGuest || room.guest === null)) {
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
    return true;
  }
  bumpVersion(room);
  return false;
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
    if (!explicitLeft && absent > CONNECTED_MS && absent < OWNER_ABSENT_CAP_MS) {
      // пропал совсем недавно — замораживаем таймер и ждём его
      room.frozen = true;
      room.turnDeadline = Date.now() + 5_000; // перепроверим через 5с
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

/** применить ход (валидация на движке) — синхронная часть */
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

/** Отметить «на связи» (вызывается при каждом poll).
 *  updatedAt тоже свежий — это сигнал «в комнату заглядывают» для revive и TTL.
 *  Если вернулся владелец хода с замороженным таймером — выдать ему
 *  гарантированные RESUME_GRANT_MS на обдумывание. */
export function touch(room: MpRoom, seat: 0 | 1) {
  const now = Date.now();
  room.updatedAt = now;
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

// ===== публичный async-API (вызывается роутами) =====

/** создать комнату (приватную по коду или открытую для поиска) */
export async function createRoom(input: { name: unknown; avatar: unknown; isPublic: unknown }): Promise<{
  code: string;
  playerId: string;
}> {
  const name = cleanName(input.name);
  if (name.length < 1) throw 'badname';
  const store = getRoomStore();
  for (let i = 0; i < 6; i++) {
    const room = newRoom(genCode(), { id: genId(), name, avatar: cleanAvatar(input.avatar), lastPoll: Date.now(), leftAt: null }, input.isPublic === true);
    let inserted = false;
    try {
      inserted = await store.insert(room);
    } catch {
      throw 'net';
    }
    if (inserted) return { code: room.code, playerId: room.host.id };
    // коллизия кода — генерируем новый
  }
  throw 'conflict';
}

/** войти в комнату по коду (партия стартуется сразу) */
export async function joinRoom(input: { code: unknown; name: unknown; avatar: unknown; playerId?: unknown }): Promise<{
  code: string;
  playerId: string;
}> {
  const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
  const name = cleanName(input.name);
  if (name.length < 1) throw 'badname';
  if (!/^[A-Z2-9]{6}$/.test(code)) throw 'notfound';
  let guestId = '';
  const res = await mutateRoom(code, (room) => {
    guestId = joinInternal(room, { name, avatar: cleanAvatar(input.avatar), playerId: input.playerId });
  });
  if (!res.room && !res.deleted) throw 'notfound';
  if (res.deleted || !guestId) throw 'gone';
  return { code, playerId: guestId };
}

/** текущий вид комнаты для игрока (poll ~1.5с): тик таймаутов + присутствие.
 *  Сохранение — best-effort: конфликт присутствия (оба игрока poll одновременно)
 *  просто теряется — следующий poll через 1.5с повторит. */
export async function roomState(code: string, playerId: string): Promise<MpRoomView> {
  const store = getRoomStore();
  const loaded = await store.load(code);
  if (!loaded) throw 'notfound';
  revive(loaded.room);
  const seat = seatOf(loaded.room, playerId);
  if (seat === null) throw 'notfound';
  const mark = markOf(loaded.room);
  tick(loaded.room);
  touch(loaded.room, seat);
  if (changed(loaded.room, mark)) {
    try {
      await store.save(loaded.room, loaded.rev);
    } catch {
      /* дроп — следующий poll повторит */
    }
  }
  return viewFor(loaded.room, playerId);
}

/** ход игрока (advance | buy | leather) с перечитыванием при конфликте */
export async function roomMove(code: string, playerId: string, action: NetAction): Promise<MpRoomView> {
  const store = getRoomStore();
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const loaded = await store.load(code);
    if (!loaded) throw 'notfound';
    revive(loaded.room);
    const seat = seatOf(loaded.room, playerId);
    if (seat === null) throw 'notfound';
    const mark = markOf(loaded.room);
    try {
      applyAction(loaded.room, seat, action);
    } catch (e) {
      // ход не прошёл валидацию. НО tick мог автопасснуть чужую просрочку —
      // сохраним это изменение, прежде чем отдать ошибку
      if (changed(loaded.room, mark)) {
        try {
          await store.save(loaded.room, loaded.rev);
        } catch {
          /* дроп */
        }
      }
      throw e;
    }
    let saved = false;
    try {
      saved = await store.save(loaded.room, loaded.rev);
    } catch {
      saved = false;
    }
    if (saved) return viewFor(loaded.room, playerId);
    // конфликт: соперник походил первым — перечитываем, применяем ход к свежему
  }
  throw 'conflict';
}

/** управление комнатой: leave | cancel | rematch */
export async function roomControl(
  code: string,
  playerId: string,
  op: 'leave' | 'cancel' | 'rematch',
): Promise<{ started?: boolean }> {
  if (op === 'leave') {
    const res = await mutateRoom(code, (room) => leaveInternal(room, playerId));
    if (!res.room && !res.deleted) throw 'notfound';
    return {};
  }
  if (op === 'cancel') {
    const res = await mutateRoom(code, (room) => cancelInternal(room, playerId));
    if (!res.room && !res.deleted) throw 'notfound';
    return {};
  }
  if (op === 'rematch') {
    let started = false;
    const res = await mutateRoom(code, (room) => {
      started = rematchInternal(room, playerId);
    });
    if (!res.room && !res.deleted) throw 'notfound';
    return { started };
  }
  throw 'badpayload';
}

/** Список ОТКРЫТЫХ комнат + чистка протухших.
 *  Показываем только живые: хост опрашивал комнату < 20с назад —
 *  «призраки» закрытых вкладок не попадают в поиск. */
export async function listRooms(): Promise<Array<{ code: string; hostName: string; hostAvatar: string; createdAt: number }>> {
  const store = getRoomStore();
  try {
    const stale = await store.staleRooms(WAITING_HOST_TTL_MS, ROOM_TTL_MS);
    for (const s of stale) {
      try {
        await store.remove(s.code, s.rev);
      } catch {
        /* параллельно потрогали — не страшно */
      }
    }
  } catch {
    /* чистка не критична */
  }
  const waiting = await store.listWaiting();
  const now = Date.now();
  return waiting
    .filter((w) => w.room.guest === null && w.room.host.leftAt === null && now - w.room.host.lastPoll <= LIST_ALIVE_MS)
    .sort((a, b) => b.room.createdAt - a.room.createdAt)
    .slice(0, 30)
    .map((w) => ({ code: w.room.code, hostName: w.room.host.name, hostAvatar: w.room.host.avatar, createdAt: w.room.createdAt }));
}

// ===== быстрый матч (автопоиск) =====

/** комната a «старше» b — занять можно только СТАРШУЮ чужую комнату:
 *  направление подбора детерминировано, два искателя не займут комнаты
 *  друг друга одновременно (старший ждёт, младший заходит) */
function isSenior(a: MpRoom, b: MpRoom): boolean {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt;
  return a.code < b.code;
}

/** прибрать свою ждущую комнату, когда пара уже составилась в другой */
async function removeMyWaitingRoom(store: RoomStore, mine: LoadedRoom): Promise<void> {
  try {
    const removed = await store.remove(mine.room.code, mine.rev);
    if (removed) return;
  } catch {
    /* сеть — комната умрёт по TTL */
  }
  // удалить не вышло: комнату успели занять — честно помечаем «хост ушёл»,
  // чтобы вошедший сразу увидел «соперник покинул партию», а не висел в ожидании
  try {
    await mutateRoom(mine.room.code, (room) => {
      if (room.status === 'waiting' && room.guest === null) return 'delete';
      if (room.status === 'playing' && room.host.id === mine.room.host.id && room.host.leftAt === null) {
        room.host.leftAt = Date.now();
        room.status = 'abandoned';
        bumpVersion(room);
      }
    });
  } catch {
    /* ignore */
  }
}

/**
 * Заявка на быстрый матч. Порядок подбора:
 *  1) в мою ждущую комнату уже вошли → «matched» (я — хост);
 *  2) живая открытая комната СТАРШЕ моей (или моей нет) → вхожу гостем;
 *     если свою комнату держал — прибираю её;
 *  3) никого → создаю свою публичную ждущую комнату и жду (клиент
 *     опрашивает каждые ~2с).
 * Гостевое место занимается CAS-записью: двое одновременно входящих —
 * войдёт только один, второй получит следующую комнату.
 */
export async function quickMatch(input: { playerId?: unknown; name: unknown; avatar: unknown }): Promise<{
  status: 'matched' | 'waiting';
  code?: string;
  playerId: string;
}> {
  const name = cleanName(input.name);
  if (name.length < 1) throw 'badname';
  const store = getRoomStore();
  const pid = typeof input.playerId === 'string' && input.playerId.length > 8 ? input.playerId : genId();
  const avatar = cleanAvatar(input.avatar);

  // 1) моя комната автопоиска: в неё вошли (статус уже playing) или ещё ждём
  let mine: LoadedRoom | null = null;
  try {
    mine = await store.findByHost(pid);
  } catch {
    throw 'net';
  }
  if (mine) {
    revive(mine.room);
    if (mine.room.guest !== null) {
      // пару составили: гость уже в моей комнате — забираю код (я — хост)
      return { status: 'matched', code: mine.room.code, playerId: pid };
    }
  }

  // 2) живые открытые комнаты (гостя нет, хост на связи):
  //  — обычные комнаты: любые (хост ждёт на экране ожидания, не ищет сам);
  //  — комнаты автопоиска: только СТАРШЕ моей — два искателя не зайдут
  //    в комнаты друг друга одновременно (направление детерминировано).
  const waiting = await store.listWaiting();
  const now = Date.now();
  const candidates = waiting.filter(
    (w) =>
      w.room.guest === null &&
      w.room.host.leftAt === null &&
      w.room.host.id !== pid &&
      now - w.room.host.lastPoll <= LIST_ALIVE_MS &&
      (!mine || !w.room.quickHost || isSenior(w.room, mine.room)),
  );

  for (const cand of candidates) {
    let claimed = false;
    try {
      await mutateRoom(cand.room.code, (room) => {
        if (room.status !== 'waiting' || room.guest !== null || room.host.id === pid) {
          return; // место уже занято/комната не ждёт — пробуем следующую
        }
        claimed = true;
        seatGuest(room, pid, name, avatar);
      });
    } catch {
      continue; // конфликт/сеть — пробуем следующего кандидата
    }
    if (claimed) {
      if (mine) await removeMyWaitingRoom(store, mine);
      return { status: 'matched', code: cand.room.code, playerId: pid };
    }
  }

  // 3) никого — создаю свою публичную ждущую комнату автопоиска
  if (!mine) {
    for (let i = 0; i < 3; i++) {
      const room = newRoom(genCode(), { id: pid, name, avatar, lastPoll: Date.now(), leftAt: null }, true, true);
      let inserted = false;
      try {
        inserted = await store.insert(room);
      } catch {
        return { status: 'waiting', playerId: pid };
      }
      if (inserted) break;
    }
  }
  return { status: 'waiting', playerId: pid };
}

/** Отменить автопоиск (удалить свою ждущую комнату автопоиска) */
export async function quickCancel(playerId: unknown): Promise<void> {
  if (typeof playerId !== 'string' || !playerId) return;
  const store = getRoomStore();
  try {
    const mine = await store.findByHost(playerId);
    if (mine && mine.room.status === 'waiting' && mine.room.guest === null) {
      try {
        await store.remove(mine.room.code, mine.rev);
      } catch {
        /* сеть — комната умрёт по TTL */
      }
    }
  } catch {
    /* сеть */
  }
}

/** Проверка живости хранилища (для /api/mp/ping) */
export async function storePing(): Promise<{ ok: boolean }> {
  const store = getRoomStore();
  try {
    await store.listWaiting();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

// ===== тестовые хелперы =====

export function __resetRoomsForTests(): void {
  __resetMemoryStore();
}

/** Тесты: загрузить каноническую комнату из хранилища (только чтение). */
export async function __loadRoomForTests(code: string): Promise<MpRoom | null> {
  const loaded = await getRoomStore().load(code);
  return loaded ? loaded.room : null;
}

/** Тесты: произвольная мутация комнаты в хранилище (ghost-aging, дедлайны). */
export async function __mutateRoomForTests(code: string, fn: (room: MpRoom) => void): Promise<MpRoom | null> {
  const store = getRoomStore();
  for (let i = 0; i < 3; i++) {
    const loaded = await store.load(code);
    if (!loaded) return null;
    fn(loaded.room);
    try {
      if (await store.save(loaded.room, loaded.rev)) return loaded.room;
    } catch {
      return null;
    }
  }
  return null;
}
