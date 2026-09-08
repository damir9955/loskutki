import { BOARD_SIZE, LEATHER_ID, PATCHES, type PatchDef } from './constants';
import type { Placement } from './types';

export interface Orientation {
  /** битовая маска строк: rows[r] имеет бит c, если клетка (r,c) занята */
  rows: number[];
  w: number;
  h: number;
  cells: ReadonlyArray<readonly [number, number]>;
}

type Cell = readonly [number, number];

function normalize(cells: Cell[]): [number, number][] {
  const minR = Math.min(...cells.map((x) => x[0]));
  const minC = Math.min(...cells.map((x) => x[1]));
  return cells.map(([r, c]) => [r - minR, c - minC] as [number, number]);
}

function rotate90(cells: Cell[]): [number, number][] {
  const maxC = Math.max(...cells.map((x) => x[1]));
  return cells.map(([r, c]) => [c, maxC - r] as [number, number]);
}

function mirror(cells: Cell[]): [number, number][] {
  const maxC = Math.max(...cells.map((x) => x[1]));
  return cells.map(([r, c]) => [r, maxC - c] as [number, number]);
}

function signature(cells: Cell[]): string {
  return cells
    .map((x) => `${x[0]},${x[1]}`)
    .sort()
    .join('|');
}

function toOrientation(cells: [number, number][]): Orientation {
  const h = Math.max(...cells.map((x) => x[0])) + 1;
  const w = Math.max(...cells.map((x) => x[1])) + 1;
  const rows = new Array<number>(h).fill(0);
  for (const [r, c] of cells) rows[r] |= 1 << c;
  return { rows, w, h, cells };
}

const orientationCache = new Map<number, Orientation[]>();

/** Все уникальные ориентации лоскутка (повороты × отражения), с кэшем */
export function orientationsFor(patchId: number): Orientation[] {
  const cached = orientationCache.get(patchId);
  if (cached) return cached;
  const patch: PatchDef = patchId === LEATHER_ID
    ? { ...LEATHER_DEF }
    : PATCHES[patchId];
  let cells = patch.cells.map((x) => [x[0], x[1]] as [number, number]);
  const seen = new Map<string, Orientation>();
  for (let variant = 0; variant < 2; variant++) {
    if (variant === 1) cells = mirror(cells);
    for (let rot = 0; rot < 4; rot++) {
      const norm = normalize(cells);
      const sig = signature(norm);
      if (!seen.has(sig)) seen.set(sig, toOrientation(norm));
      cells = rotate90(cells);
    }
  }
  const list = [...seen.values()];
  orientationCache.set(patchId, list);
  return list;
}

import { LEATHER_PATCH as LEATHER_DEF } from './constants';

/** Доска → битовые маски строк */
export function boardRows(board: number[]): number[] {
  const rows = new Array<number>(BOARD_SIZE).fill(0);
  for (let r = 0; r < BOARD_SIZE; r++) {
    let m = 0;
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r * BOARD_SIZE + c] !== -1) m |= 1 << c;
    }
    rows[r] = m;
  }
  return rows;
}

/** Можно ли положить ориентацию с якорем (r, c)? */
export function canPlaceAt(orient: Orientation, r: number, c: number, rows: number[]): boolean {
  if (r < 0 || c < 0) return false;
  if (r + orient.h > BOARD_SIZE || c + orient.w > BOARD_SIZE) return false;
  for (let i = 0; i < orient.h; i++) {
    if (rows[r + i] & (orient.rows[i] << c)) return false;
  }
  return true;
}

/** Клетки, которые займёт размещение */
export function placementCells(
  orientation: Orientation,
  r: number,
  c: number,
): Array<[number, number]> {
  return orientation.cells.map(([pr, pc]) => [r + pr, c + pc] as [number, number]);
}

/** Все допустимые размещения лоскутка на доске */
export function enumeratePlacements(board: number[], patchId: number): Placement[] {
  const rows = boardRows(board);
  const result: Placement[] = [];
  const orients = orientationsFor(patchId);
  for (let o = 0; o < orients.length; o++) {
    const orient = orients[o];
    for (let r = 0; r + orient.h <= BOARD_SIZE; r++) {
      for (let c = 0; c + orient.w <= BOARD_SIZE; c++) {
        if (canPlaceAt(orient, r, c, rows)) result.push({ orientation: o, r, c });
      }
    }
  }
  return result;
}

/** Хотя бы одно размещение возможно? */
export function isPlaceable(board: number[], patchId: number): boolean {
  const rows = boardRows(board);
  const orients = orientationsFor(patchId);
  for (const orient of orients) {
    for (let r = 0; r + orient.h <= BOARD_SIZE; r++) {
      for (let c = 0; c + orient.w <= BOARD_SIZE; c++) {
        if (canPlaceAt(orient, r, c, rows)) return true;
      }
    }
  }
  return false;
}

/** Проверка легальности конкретного размещения */
export function isLegalPlacement(
  board: number[],
  patchId: number,
  placement: Placement,
): boolean {
  const orients = orientationsFor(patchId);
  const orient = orients[placement.orientation];
  if (!orient) return false;
  return canPlaceAt(orient, placement.r, placement.c, boardRows(board));
}

/** Записать лоскуток на доску (мутирует board), возвращает список клеток */
export function stampPiece(
  board: number[],
  patchId: number,
  placement: Placement,
): Array<[number, number]> {
  const orient = orientationsFor(patchId)[placement.orientation];
  const cells = placementCells(orient, placement.r, placement.c);
  for (const [r, c] of cells) board[r * BOARD_SIZE + c] = patchId;
  return cells;
}

/** Полностью ли заполнен какой-нибудь квадрат 7×7 на доске? */
export function findCompleted7x7(board: number[]): { r: number; c: number } | null {
  for (let r = 0; r <= BOARD_SIZE - 7; r++) {
    for (let c = 0; c <= BOARD_SIZE - 7; c++) {
      let full = true;
      for (let i = 0; i < 7 && full; i++) {
        for (let j = 0; j < 7; j++) {
          if (board[(r + i) * BOARD_SIZE + (c + j)] === -1) {
            full = false;
            break;
          }
        }
      }
      if (full) return { r, c };
    }
  }
  return null;
}

/** Максимальная заполненность любого окна 7×7 (0..49) — для ИИ и подсказок */
export function best7x7Progress(board: number[]): number {
  let best = 0;
  for (let r = 0; r <= BOARD_SIZE - 7; r++) {
    for (let c = 0; c <= BOARD_SIZE - 7; c++) {
      let count = 0;
      for (let i = 0; i < 7; i++) {
        for (let j = 0; j < 7; j++) {
          if (board[(r + i) * BOARD_SIZE + (c + j)] !== -1) count++;
        }
      }
      if (count > best) best = count;
    }
  }
  return best;
}

/** Найти все пустые клетки */
export function emptyCells(board: number[]): Array<[number, number]> {
  const res: Array<[number, number]> = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r * BOARD_SIZE + c] === -1) res.push([r, c]);
    }
  }
  return res;
}

// ===== Утилиты поворота/отражения для UI =====

function cellsKey(cells: ReadonlyArray<readonly [number, number]>): string {
  return cells.map((x) => `${x[0]},${x[1]}`).sort().join('|');
}

/** Индекс ориентации, полученной поворотом текущей на 90° по часовой */
export function rotatedOrientation(patchId: number, orientation: number): number {
  const orients = orientationsFor(patchId);
  const cur = orients[orientation].cells;
  const maxC = Math.max(...cur.map((x) => x[1]));
  const rotated = cur.map(([r, c]) => [c, maxC - r] as [number, number]);
  // ВАЖНО: хранимые ориентации нормализованы (min r = min c = 0) —
  // повёрнутые клетки тоже нужно нормализовать, иначе ключи не совпадают
  // и поворот «не работает» для неквадратных лоскутков.
  const minR = Math.min(...rotated.map((x) => x[0]));
  const minC = Math.min(...rotated.map((x) => x[1]));
  const norm = rotated.map(([r, c]) => [r - minR, c - minC] as [number, number]);
  const key = cellsKey(norm);
  const idx = orients.findIndex((o) => cellsKey(o.cells) === key);
  return idx >= 0 ? idx : orientation;
}

/** Индекс зеркальной ориентации (по горизонтали) */
export function mirroredOrientation(patchId: number, orientation: number): number {
  const orients = orientationsFor(patchId);
  const cur = orients[orientation].cells;
  const maxC = Math.max(...cur.map((x) => x[1]));
  const mirrored = cur.map(([r, c]) => [r, maxC - c] as [number, number]);
  const key = cellsKey(mirrored);
  const idx = orients.findIndex((o) => cellsKey(o.cells) === key);
  return idx >= 0 ? idx : orientation;
}

/** Индекс ориентации по фактическим клеткам на доске (для рендера) */
export function orientationIndexFromCells(
  patchId: number,
  cells: ReadonlyArray<readonly [number, number]>,
): number {
  const orients = orientationsFor(patchId);
  const key = cellsKey(cells);
  const idx = orients.findIndex((o) => cellsKey(o.cells) === key);
  return idx >= 0 ? idx : 0;
}

/** Группировка доски в экземпляры лоскутков для отрисовки */
export interface BoardPieceInstance {
  patchId: number;
  r: number;
  c: number;
  orientation: number;
  /** уникальный стабильный ключ экземпляра (для React) */
  key: string;
}

/**
 * Группировка клеток доски в экземпляры лоскутков.
 * ВАЖНО: кожаные лоскутки (LEATHER_ID) встречаются многократно и каждый
 * рисуется ОТДЕЛЬНОЙ клеткой 1×1 — иначе они склеиваются в один «рваный»
 * лоскут и визуально прыгают. Обычные лоскутки уникальны по id,
 * но на всякий случай тоже делим по связным компонентам.
 */
export function boardPieces(board: number[]): BoardPieceInstance[] {
  const seen = new Uint8Array(BOARD_SIZE * BOARD_SIZE);
  const out: BoardPieceInstance[] = [];
  const push = (id: number, cells: Array<[number, number]>) => {
    const minR = Math.min(...cells.map((x) => x[0]));
    const minC = Math.min(...cells.map((x) => x[1]));
    const rel = cells.map(([r, c]) => [r - minR, c - minC] as [number, number]);
    out.push({
      patchId: id,
      r: minR,
      c: minC,
      orientation: orientationIndexFromCells(id, rel),
      key: `${id}@${minR},${minC}`,
    });
  };
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const idx = r * BOARD_SIZE + c;
      const id = board[idx];
      if (id === -1 || seen[idx]) continue;
      // кожаный 1×1 — каждая клетка самостоятельный экземпляр
      if (id === LEATHER_ID) {
        seen[idx] = 1;
        push(id, [[r, c]]);
        continue;
      }
      // связная компонента (4-соседство) одинаковых id
      const cells: Array<[number, number]> = [];
      const stack: Array<[number, number]> = [[r, c]];
      seen[idx] = 1;
      while (stack.length) {
        const [cr, cc] = stack.pop()!;
        cells.push([cr, cc]);
        const nbrs: Array<[number, number]> = [
          [cr - 1, cc],
          [cr + 1, cc],
          [cr, cc - 1],
          [cr, cc + 1],
        ];
        for (const [nr, nc] of nbrs) {
          if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
          const ni = nr * BOARD_SIZE + nc;
          if (!seen[ni] && board[ni] === id) {
            seen[ni] = 1;
            stack.push([nr, nc]);
          }
        }
      }
      push(id, cells);
    }
  }
  return out;
}
