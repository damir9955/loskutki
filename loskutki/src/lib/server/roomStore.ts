/**
 * Хранилище онлайн-комнат «Лоскутки» — слой хранения, отделённый от правил.
 *
 * Режим memory: Map на globalThis + синхронный снапшот в файл (комнаты
 * переживают рестарт dev-сервера). На Vercel (диск только для чтения)
 * деградирует до чистой памяти — стабильный реалтайм-мультиплеер будет
 * перенесён на отдельный WebSocket-сервер Deno Deploy (см. промпт
 * download/prompt-loskutki-deno.md).
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { GameEvent, GameState } from '@/lib/game/types';

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
  /** комната создана автопоиском: хост ищет пару, пока в неё не войдут */
  quickHost: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface LoadedRoom {
  room: MpRoom;
  /** номер версии в хранилище — для CAS-записи */
  rev: number;
}

export interface RoomStore {
  kind: 'memory';
  /** загрузить комнату по коду (null — нет такой) */
  load(code: string): Promise<LoadedRoom | null>;
  /** создать комнату; false — код уже занят (коллизия) */
  insert(room: MpRoom): Promise<boolean>;
  /** условная запись (CAS): false — комната исчезла или rev устарел */
  save(room: MpRoom, rev: number): Promise<boolean>;
  /** условное удаление (CAS) */
  remove(code: string, rev: number): Promise<boolean>;
  /** публичные ждущие комнаты, старые сверху (гость может быть занят — фильтрует вызывающий) */
  listWaiting(): Promise<LoadedRoom[]>;
  /** моя ждущая комната по playerId хоста */
  findByHost(playerId: string): Promise<LoadedRoom | null>;
  /** протухшие комнаты для чистки (ждущие старше waitingTtl, остальные старнее roomTtl) */
  staleRooms(waitingTtlMs: number, roomTtlMs: number): Promise<Array<{ code: string; rev: number }>>;
}

// ===== хранилище: память + снапшот на диске =====

export function getRoomStore(): RoomStore {
  return memoryStore();
}

const g = globalThis as unknown as {
  __loskutkiRoomsV2?: Map<string, MpRoom>;
  __loskutkiRevs?: Map<string, number>;
};

function storePath(): string {
  return process.env.LOSKUTKI_MP_STORE ?? path.join(process.cwd(), '.mp-rooms.json');
}

/** загрузить снапшот после рестарта процесса (оба ушли — комнату не оживляем) */
function hydrateFromDisk(): Map<string, MpRoom> {
  const map = new Map<string, MpRoom>();
  try {
    const raw = readFileSync(storePath(), 'utf8');
    const arr = JSON.parse(raw) as MpRoom[];
    if (Array.isArray(arr)) {
      for (const r of arr) {
        if (r && typeof r.code === 'string' && typeof r.host?.id === 'string') {
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

const memRooms: Map<string, MpRoom> = g.__loskutkiRoomsV2 ?? hydrateFromDisk();
g.__loskutkiRoomsV2 = memRooms;
const memRevs: Map<string, number> = g.__loskutkiRevs ?? new Map();
g.__loskutkiRevs = memRevs;

function memPersist(): void {
  try {
    writeFileSync(storePath(), JSON.stringify([...memRooms.values()]));
  } catch {
    /* недоступный диск — деградируем до памяти */
  }
}

/** глубокая копия — каждая загрузка = свежий объект:
 *  неудачная CAS-запись не «протекает» в общее состояние */
function cloneRoom(room: MpRoom): MpRoom {
  return JSON.parse(JSON.stringify(room)) as MpRoom;
}

function memStoreSync(): RoomStore {
  return {
    kind: 'memory',
    async load(code) {
      const room = memRooms.get(code.trim().toUpperCase());
      return room ? { room: cloneRoom(room), rev: memRevs.get(room.code) ?? room.version } : null;
    },
    async insert(room) {
      if (memRooms.has(room.code)) return false;
      memRooms.set(room.code, room);
      memRevs.set(room.code, 0);
      memPersist();
      return true;
    },
    async save(room, rev) {
      if (memRooms.get(room.code) !== undefined && memRevs.get(room.code) !== rev) return false;
      memRooms.set(room.code, cloneRoom(room));
      memRevs.set(room.code, rev + 1);
      memPersist();
      return true;
    },
    async remove(code, rev) {
      if (!memRooms.has(code)) return false;
      if ((memRevs.get(code) ?? -1) !== rev) return false;
      memRooms.delete(code);
      memRevs.delete(code);
      memPersist();
      return true;
    },
    async listWaiting() {
      const out = [...memRooms.values()]
        .filter((r) => r.isPublic && r.status === 'waiting')
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((room) => ({ room: cloneRoom(room), rev: memRevs.get(room.code) ?? room.version }));
      return out;
    },
    async findByHost(playerId) {
      for (const room of memRooms.values()) {
        if (
          room.host.id === playerId &&
          room.quickHost === true &&
          (room.status === 'waiting' || room.status === 'playing')
        ) {
          return { room: cloneRoom(room), rev: memRevs.get(room.code) ?? room.version };
        }
      }
      return null;
    },
    async staleRooms(waitingTtlMs, roomTtlMs) {
      const now = Date.now();
      const out: Array<{ code: string; rev: number }> = [];
      for (const room of memRooms.values()) {
        const age = now - Math.max(room.updatedAt, room.host.lastPoll, room.guest?.lastPoll ?? 0);
        if (room.status === 'waiting' && now - Math.max(room.host.lastPoll, room.createdAt) > waitingTtlMs) {
          out.push({ code: room.code, rev: memRevs.get(room.code) ?? room.version });
        } else if (room.status !== 'waiting' && age > roomTtlMs) {
          out.push({ code: room.code, rev: memRevs.get(room.code) ?? room.version });
        }
      }
      return out;
    },
  };
}

function memoryStore(): RoomStore {
  return memStoreSync();
}

/** тесты: полный сброс памяти (и очередей, если появятся) */
export function __resetMemoryStore(): void {
  memRooms.clear();
  memRevs.clear();
  try {
    writeFileSync(storePath(), '[]');
  } catch {
    /* ignore */
  }
}

/** тесты: прочитать снапшот с диска как новый процесс */
export function __roomsOnDisk(): MpRoom[] {
  try {
    const arr = JSON.parse(readFileSync(storePath(), 'utf8')) as MpRoom[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
