/**
 * Серверный стор онлайн-комнат «Лоскутки».
 *
 * Одиночный процесс Next.js → держим комнаты в Map на globalThis
 * (переживает HMR в dev). Состояние партии — чистый GameState из движка:
 * сервер валидирует и применяет ходы, отдаёт каждому игроку «повёрнутую»
 * копию (зритель всегда сидит на месте 0).
 *
 * Лимит времени на ход: 3 минуты (MP_TURN_MS). Просроченный ход
 * автоматически заменяется шагом вперёд (advance), кожаный лоскуток
 * ставится на первую свободную клетку. Проверка — при любом обращении
 * к комнате (poll/ход/лист комнат).
 */

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
const ROOM_TTL_MS = 30 * 60_000; // брошенные комнаты чистим через 30 минут
const MAX_AUTO_TICKS = 80; // предохранитель цикла автопассов

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

// ===== глобальный стор (переживает HMR) =====

const g = globalThis as unknown as { __loskutkiRooms?: Map<string, MpRoom> };
const rooms: Map<string, MpRoom> = g.__loskutkiRooms ?? new Map();
g.__loskutkiRooms = rooms;

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

/** Список открытых комнат + чистка протухших */
export function listRooms(): Array<{ code: string; hostName: string; hostAvatar: string; createdAt: number }> {
  sweep();
  const out: Array<{ code: string; hostName: string; hostAvatar: string; createdAt: number }> = [];
  for (const r of rooms.values()) {
    if (r.isPublic && r.status === 'waiting' && r.guest === null && r.host.leftAt === null) {
      out.push({ code: r.code, hostName: r.host.name, hostAvatar: r.host.avatar, createdAt: r.createdAt });
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
}

function sweep() {
  const now = Date.now();
  for (const [code, r] of rooms) {
    const stale = now - Math.max(r.updatedAt, r.host.lastPoll, r.guest?.lastPoll ?? 0) > ROOM_TTL_MS;
    const waitingTooOld = r.status === 'waiting' && now - r.createdAt > ROOM_TTL_MS;
    if (stale || waitingTooOld) rooms.delete(code);
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
  return { code: room.code, playerId: room.host.id };
}

export function joinRoom(input: { code: unknown; name: unknown; avatar: unknown }): {
  code: string;
  playerId: string;
} {
  const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
  const name = cleanName(input.name);
  if (name.length < 1) throw 'badname';
  const room = rooms.get(code);
  if (!room) throw 'notfound';
  if (room.status !== 'waiting' || room.guest !== null) throw 'full';
  tick(room);
  if (room.status !== 'waiting' || room.guest !== null) throw 'full';

  const seed = (Math.floor(Math.random() * 1e9) ^ Date.now()) >>> 0;
  const firstPlayer = Math.random() < 0.5 ? 0 : 1;
  room.guest = { id: genId(), name, avatar: cleanAvatar(input.avatar), lastPoll: Date.now(), leftAt: null };
  room.state = createGame({ seed, mode: 'online', botLevel: 'fedor', firstPlayer });
  room.status = 'playing';
  room.gameSeq++;
  room.turnSig = null;
  room.lastEvents = [];
  room.lastEventsVersion = room.version;
  room.timedOutSeat = null;
  room.timedOutVersion = null;
  room.rematchHost = false;
  room.rematchGuest = false;
  bumpVersion(room);
  resetDeadline(room);
  return { code: room.code, playerId: room.guest.id };
}

export function getRoom(code: string): MpRoom | null {
  return rooms.get(code.trim().toUpperCase()) ?? null;
}

/** Отметить «на связи» (вызывается при каждом poll) */
export function touch(room: MpRoom, seat: 0 | 1) {
  const p = seat === 0 ? room.host : room.guest;
  if (p) p.lastPoll = Date.now();
}

/** Выход игрока: waiting → комната закрывается; playing → «соперник ушёл» */
export function leaveRoom(room: MpRoom, playerId: string): void {
  const seat = seatOf(room, playerId);
  if (seat === null) throw 'notfound';
  if (room.status === 'waiting') {
    rooms.delete(room.code);
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
}

/** Хост отменяет ожидающую комнату */
export function cancelRoom(room: MpRoom, playerId: string): void {
  const seat = seatOf(room, playerId);
  if (seat !== 0 || room.status !== 'waiting') throw 'notfound';
  rooms.delete(room.code);
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

function commit(room: MpRoom, state: GameState, events: GameEvent[]) {
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

/** Просроченные ходы играют сами (advance; кожаный — в первую пустую клетку) */
export function tick(room: MpRoom): void {
  if (room.status !== 'playing' || !room.state) return;
  let guard = 0;
  while (room.turnDeadline !== null && Date.now() > room.turnDeadline && guard++ < MAX_AUTO_TICKS) {
    const st = room.state;
    if (st.phase === 'gameover') break;
    const owner = turnOwner(st);
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
    return { started: true };
  }
  bumpVersion(room);
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
    serverNow: now,
    state: room.state ? rotatedState(room.state, seat, room) : null,
    events: viewEvents,
    eventsVersion: events ? room.version : -1,
    // сид просрочившегося поворачиваем ТОЛЬКО для гостя (он смотрит с места 1)
    timedOutSeat: room.timedOutSeat === null ? null : seat === 1 ? swap(room.timedOutSeat) : room.timedOutSeat,
    timedOutVersion: room.timedOutVersion,
  };
}
