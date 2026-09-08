import { BOARD_SIZE, LEATHER_ID, PATCHES, INCOME_MARKERS, TIME_END } from './constants';
import {
  advancePreview,
  availablePatches,
  checkBuy,
  cloneState,
  advanceAction,
  buyAndPlace,
  placeLeather,
  currentPending,
} from './engine';
import {
  best7x7Progress,
  boardRows,
  canPlaceAt,
  enumeratePlacements,
  orientationsFor,
  placementCells,
} from './placement';
import type { BotLevel, PatchDef } from './constants';
import type { BotDecision, GameState, Placement } from './types';

interface Weights {
  noise: number;
  area: number;
  income: number;
  cost: number;
  time: number;
  placement: number;
  lookahead: boolean;
  endgameAware: boolean;
  x7race: number;
  advanceThreshold: number;
  /** вес учёта ответа соперницы (deny) */
  deny: number;
  /** вероятность импульсивного продвижения (слабый бот) */
  impulsiveAdvance: number;
  /** множитель веса площади в эндшпиле */
  endgameAreaMult: number;
  /** множитель веса дохода в эндшпиле */
  endgameIncomeMult: number;
}

export const WEIGHTS: Record<BotLevel, Weights> = {
  glasha: {
    noise: 4.2,
    area: 1.7,
    income: 0.7,
    cost: 1.35,
    time: 0.12,
    placement: 0.05,
    lookahead: false,
    endgameAware: false,
    x7race: 0,
    advanceThreshold: -3.5,
    deny: 0,
    impulsiveAdvance: 0.13,
    endgameAreaMult: 1,
    endgameIncomeMult: 1,
  },
  fedor: {
    noise: 1.1,
    area: 2.0,
    income: 1.0,
    cost: 1.15,
    time: 0.35,
    placement: 0.14,
    lookahead: false,
    endgameAware: true,
    x7race: 5,
    advanceThreshold: -0.5,
    deny: 0,
    impulsiveAdvance: 0.04,
    endgameAreaMult: 1.3,
    endgameIncomeMult: 0.4,
  },
  elza: {
    noise: 0.2,
    area: 2.05,
    income: 1.05,
    cost: 1.08,
    time: 0.33,
    placement: 0.2,
    lookahead: true,
    endgameAware: true,
    x7race: 8,
    advanceThreshold: 0.1,
    deny: 0.42,
    impulsiveAdvance: 0,
    endgameAreaMult: 1.6,
    endgameIncomeMult: 0.25,
  },
};

function gauss(): number {
  return (Math.random() + Math.random() + Math.random() - 1.5) * 2;
}

/** Сколько маркеров дохода ещё пройдёт игрок (примерно) */
function remainingCollections(from: number): number {
  let n = 0;
  for (const m of INCOME_MARKERS) if (m > from) n++;
  return n;
}

/**
 * Оценка размещения: компактность, отсутствие дыр, прогресс 7×7.
 * Возвращает «добротность» размещения (выше — лучше).
 */
export function scorePlacement(
  board: number[],
  patchId: number,
  placement: Placement,
  ctx: { x7race: number; tileOwned: boolean; oppProgress: number; endgame: boolean },
): number {
  const rows = boardRows(board);
  const orient = orientationsFor(patchId)[placement.orientation];
  const cells = placementCells(orient, placement.r, placement.c);
  const cellSet = new Set<number>();
  for (const [r, c] of cells) cellSet.add(r * BOARD_SIZE + c);

  // компактность: каждая грань, примыкающая к занятой клетке или краю
  let contact = 0;
  const filled = (r: number, c: number): boolean => {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
    const idx = r * BOARD_SIZE + c;
    if (cellSet.has(idx)) return true;
    return board[idx] !== -1;
  };
  const outside = (r: number, c: number) => r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE;
  for (const [r, c] of cells) {
    if (filled(r - 1, c)) contact++;
    if (filled(r + 1, c)) contact++;
    if (filled(r, c - 1)) contact++;
    if (filled(r, c + 1)) contact++;
    if (outside(r - 1, c)) contact += 0.5;
    if (outside(r + 1, c)) contact += 0.5;
    if (outside(r, c - 1)) contact += 0.5;
    if (outside(r, c + 1)) contact += 0.5;
  }

  // дыры: пустые клетки, окружённые со всех сторон (в окрестности куска)
  let holes = 0;
  const minR = Math.max(0, placement.r - 1);
  const maxR = Math.min(BOARD_SIZE - 1, placement.r + orient.h);
  const minC = Math.max(0, placement.c - 1);
  const maxC = Math.min(BOARD_SIZE - 1, placement.c + orient.w);
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      const idx = r * BOARD_SIZE + c;
      if (board[idx] !== -1 || cellSet.has(idx)) continue;
      const up = r === 0 || board[(r - 1) * BOARD_SIZE + c] !== -1 || cellSet.has((r - 1) * BOARD_SIZE + c);
      const down = r === BOARD_SIZE - 1 || board[(r + 1) * BOARD_SIZE + c] !== -1 || cellSet.has((r + 1) * BOARD_SIZE + c);
      const left = c === 0 || board[r * BOARD_SIZE + c - 1] !== -1 || cellSet.has(r * BOARD_SIZE + c - 1);
      const right = c === BOARD_SIZE - 1 || board[r * BOARD_SIZE + c + 1] !== -1 || cellSet.has(r * BOARD_SIZE + c + 1);
      if (up && down && left && right) holes++;
    }
  }

  // прогресс 7×7: считаем максимум по окнам до/после
  let x7 = 0;
  if (ctx.x7race > 0 && !ctx.tileOwned) {
    const before = best7x7Progress(board);
    const hypothetical = [...board];
    for (const idx of cellSet) hypothetical[idx] = patchId;
    const after = best7x7Progress(hypothetical);
    if (after === 49) x7 += 1000;
    else x7 += (after - before) * ctx.x7race;
    // подгонка: соперница близка к 7×7 — ускоряемся
    if (ctx.oppProgress >= 44) x7 += (after - before) * ctx.x7race * 1.5;
  }

  const holePenalty = holes * (ctx.endgame ? 16 : 12);
  return contact * 1.7 - holePenalty + x7;
}

/** Лучшее размещение лоскутка на доске игрока */
export function bestPlacement(
  board: number[],
  patchId: number,
  ctx: Parameters<typeof scorePlacement>[3],
  noise = 0,
): { placement: Placement; score: number } | null {
  const options = enumeratePlacements(board, patchId);
  if (options.length === 0) return null;
  let best: { placement: Placement; score: number } | null = null;
  for (const p of options) {
    const s = scorePlacement(board, patchId, p, ctx) + (noise > 0 ? gauss() * noise : 0);
    if (!best || s > best.score) best = { placement: p, score: s };
  }
  return best;
}

/** Ценность покупки лоскутка для игрока */
function pieceValue(state: GameState, playerIdx: number, patch: PatchDef, placementScore: number, w: Weights): number {
  const p = state.players[playerIdx];
  const collections = remainingCollections(p.time);
  const endgame = w.endgameAware && p.time > 36;
  const areaW = endgame ? w.area * w.endgameAreaMult : w.area;
  const incW = endgame ? w.income * w.endgameIncomeMult : w.income;
  let v =
    patch.cells.length * areaW +
    patch.income * Math.min(collections, 5) * incW -
    patch.cost * w.cost -
    patch.time * w.time +
    placementScore * w.placement;
  // бесплатный лоскуток — почти всегда хорошо
  if (patch.cost === 0) v += 3;
  return v;
}

/** Ценность продвижения */
function advanceValue(state: GameState, playerIdx: number, w: Weights): number {
  const preview = advancePreview(state, playerIdx);
  let v = preview.buttonGain * 1.0;
  v += preview.leathers * 3.4;
  // продвижение дарит сопернице ходы — небольшой штраф, если у неё есть деньги
  const opp = state.players[1 - playerIdx];
  if (opp.buttons >= 6) v -= 1.2;
  return v;
}

/** Оценка «что получит соперница» в этой позиции (без lookahead-клонирования) */
function opponentBestValue(state: GameState, oppIdx: number, w: Weights): number {
  const av = availablePatches(state);
  const opp = state.players[oppIdx];
  let best = 0;
  const ctx = {
    x7race: w.x7race,
    tileOwned: state.tile7x7Owner !== null,
    oppProgress: best7x7Progress(state.players[1 - oppIdx].board),
    endgame: opp.time > 36,
  };
  for (const item of av) {
    const patch = PATCHES[item.patchId];
    if (opp.buttons < patch.cost) continue;
    const bp = bestPlacement(opp.board, item.patchId, ctx, 0);
    if (!bp) continue;
    best = Math.max(best, pieceValue(state, oppIdx, patch, bp.score, w));
  }
  return best;
}

function x7ctx(state: GameState, playerIdx: number) {
  const w = WEIGHTS[state.botLevel];
  const oppProgress = best7x7Progress(state.players[1 - playerIdx].board);
  return {
    x7race: w.x7race,
    tileOwned: state.tile7x7Owner !== null,
    oppProgress,
    endgame: state.players[playerIdx].time > 36,
  };
}

/** Решение бота в фазе действия */
export function decideBotAction(state: GameState): BotDecision {
  const w = WEIGHTS[state.botLevel];
  const me = state.activePlayer;
  const p = state.players[me];
  const ctx = x7ctx(state, me);

  // импульсивность: иногда.advance «просто так»
  if (w.impulsiveAdvance > 0 && Math.random() < w.impulsiveAdvance) {
    const av = availablePatches(state);
    const anyBuyable = av.some((a) => checkBuy(state, a.marketIndex).allowed);
    if (anyBuyable) return { action: 'advance' };
  }

  let bestBuy: { marketIndex: 0 | 1 | 2; value: number; placement: Placement } | null = null;
  for (const item of availablePatches(state)) {
    const check = checkBuy(state, item.marketIndex);
    if (!check.allowed) continue;
    const patch = PATCHES[item.patchId];
    const bp = bestPlacement(p.board, item.patchId, ctx, w.noise * 0.4);
    if (!bp) continue;
    let v = pieceValue(state, me, patch, bp.score, w) + gauss() * w.noise;
    if (w.lookahead) {
      // реальный 1-ply: применяем покупку и смотрим, что останется сопернице
      try {
        const after = buyAndPlace(cloneState(state), item.marketIndex, bp.placement).state;
        let st = after;
        let guard = 0;
        while (st.phase === 'placing' && guard < 4) {
          const pend = currentPending(st)!;
          const cell = decideLeatherCell(st, pend.player);
          if (!cell) break;
          st = placeLeather(st, cell.r, cell.c).state;
          guard++;
        }
        const oppVal = opponentBestValue(st, 1 - me, w);
        v -= w.deny * oppVal;
        // темп: если после покупки ход остаётся нам — бонус
        if (st.phase !== 'gameover' && st.activePlayer === me) v += 2.1;
      } catch {
        /* пробный ход не удался — не учитываем */
      }
    }
    if (!bestBuy || v > bestBuy.value) bestBuy = { marketIndex: item.marketIndex, value: v, placement: bp.placement };
  }

  let advValue = advanceValue(state, me, w) + gauss() * w.noise * 0.5;
  if (w.deny > 0) {
    // продвижение отдаёт рынок сопернице
    advValue -= w.deny * 0.6 * opponentBestValue(state, 1 - me, w);
  }

  if (bestBuy && bestBuy.value > advValue + w.advanceThreshold) {
    return { action: 'buy', marketIndex: bestBuy.marketIndex, placement: bestBuy.placement };
  }
  return { action: 'advance' };
}

/** Куда бот ставит кожаный лоскуток 1×1 */
export function decideLeatherCell(state: GameState, playerIdx: number): { r: number; c: number } | null {
  const board = state.players[playerIdx].board;
  const options = enumeratePlacements(board, LEATHER_ID);
  if (options.length === 0) return null;
  const ctx = x7ctx(state, playerIdx);
  let best: { pos: { r: number; c: number }; score: number } | null = null;
  for (const o of options) {
    const s = scorePlacement(board, LEATHER_ID, o, { ...ctx, x7race: ctx.x7race + 2 });
    if (!best || s > best.score) best = { pos: { r: o.r, c: o.c }, score: s };
  }
  return best ? best.pos : null;
}

/** Полный ход бота: возвращает результирующее состояние + события */
export function playBotTurn(state: GameState): { state: GameState; events: import('./types').GameEvent[] } {
  if (state.phase === 'action') {
    const d = decideBotAction(state);
    if (d.action === 'advance') return advanceAction(state);
    return buyAndPlace(state, d.marketIndex!, d.placement!);
  }
  throw new Error('playBotTurn: unexpected phase ' + state.phase);
}

/** Подсказка для человека (уровень «Фёдор») */
export function suggestForHuman(state: GameState): BotDecision {
  const fake: GameState = { ...state, botLevel: 'fedor' };
  return decideBotAction(fake);
}

/** Умное дефолтное размещение лоскутка для человека (при выборе карточки) */
export function suggestPlacement(state: GameState, playerIdx: number, patchId: number): Placement | null {
  const ctx = {
    x7race: 6,
    tileOwned: state.tile7x7Owner !== null,
    oppProgress: best7x7Progress(state.players[1 - playerIdx].board),
    endgame: state.players[playerIdx].time > 36,
  };
  const bp = bestPlacement(state.players[playerIdx].board, patchId, ctx, 0);
  return bp ? bp.placement : null;
}

/** Проверка валидности ориентации для UI (экспорт-переиспользование) */
export function canPlaceHere(board: number[], patchId: number, orientation: number, r: number, c: number): boolean {
  const orient = orientationsFor(patchId)[orientation];
  if (!orient) return false;
  return canPlaceAt(orient, r, c, boardRows(board));
}

export function timeLeftRatio(time: number): number {
  return Math.max(0, Math.min(1, (TIME_END - time) / TIME_END));
}
