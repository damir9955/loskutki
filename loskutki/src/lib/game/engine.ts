import {
  BOARD_SIZE,
  INCOME_MARKERS,
  LEATHER_ID,
  LEATHER_POS,
  PATCHES,
  START_BUTTONS,
  TIME_END,
  TILE_7X7_POINTS,
  EMPTY_PENALTY,
  type BotLevel,
} from './constants';
import {
  findCompleted7x7,
  isLegalPlacement,
  isPlaceable,
  orientationsFor,
  placementCells,
  stampPiece,
} from './placement';
import { mulberry32 } from './rng';
import type {
  GameEvent,
  GameResult,
  GameState,
  LogEntry,
  PendingPlacement,
  Placement,
  ScoreBreakdown,
} from './types';

function emptyPlayer(): import('./types').PlayerState {
  return {
    buttons: START_BUTTONS,
    income: 0,
    time: 0,
    board: new Array<number>(BOARD_SIZE * BOARD_SIZE).fill(-1),
    covered: 0,
    tile7x7: false,
    reachedEndTurn: null,
  };
}

export interface CreateGameOptions {
  seed: number;
  mode: 'casual' | 'daily';
  botLevel: BotLevel;
  /** кто ходит первым: 0 — человек, 1 — бот */
  firstPlayer: number;
}

export function createGame(opts: CreateGameOptions): GameState {
  const rng = mulberry32(opts.seed);
  // перемешиваем 33 лоскутка
  const circle = PATCHES.map((p) => p.id);
  for (let i = circle.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [circle[i], circle[j]] = [circle[j], circle[i]];
  }
  // токен ставится прямо ПЕРЕД уникальным лоскутком 2×1 (id 0):
  // по правилам домино 2×1 — первый из трёх доступных для покупки
  const dominoPos = circle.indexOf(0);
  const tokenIndex = (dominoPos - 1 + circle.length) % circle.length; // доступные начинаются со следующего

  const state: GameState = {
    seed: opts.seed,
    mode: opts.mode,
    botLevel: opts.botLevel,
    circle,
    tokenIndex,
    players: [emptyPlayer(), emptyPlayer()],
    activePlayer: opts.firstPlayer,
    topToken: null,
    firstPlayer: opts.firstPlayer,
    turn: 0,
    phase: 'action',
    pendingQueue: [],
    leatherClaimed: 0,
    tile7x7Owner: null,
    log: [],
    result: null,
  };
  pushLog(state, -1, 'system', 'start', { first: opts.firstPlayer });
  return state;
}

export function cloneState(state: GameState): GameState {
  return {
    ...state,
    circle: [...state.circle],
    players: [
      { ...state.players[0], board: [...state.players[0].board] },
      { ...state.players[1], board: [...state.players[1].board] },
    ],
    pendingQueue: state.pendingQueue.map((p) => ({ ...p })),
    log: state.log.slice(),
    result: state.result ? cloneResult(state.result) : null,
  };
}

function cloneResult(r: GameResult): GameResult {
  return {
    winner: r.winner,
    humanWon: r.humanWon,
    scores: [{ ...r.scores[0] }, { ...r.scores[1] }],
  };
}

function pushLog(
  state: GameState,
  player: number,
  kind: LogEntry['kind'],
  code: string,
  data?: Record<string, string | number>,
) {
  // фраза локализуется при отображении (i18n.logLine); в сейве — только код и данные
  state.log.push({ turn: state.turn, player, kind, code, data });
  if (state.log.length > 80) state.log.splice(0, state.log.length - 80);
}

/** Доступные для покупки лоскутки (до 3 после токена; последний лоскуток не продаётся) */
export interface AvailablePatch {
  marketIndex: 0 | 1 | 2;
  circleIndex: number;
  patchId: number;
}

export function availablePatches(state: GameState): AvailablePatch[] {
  const n = state.circle.length;
  // по правилам: когда в круге остаётся 1 лоскуток — покупать больше нельзя, только шагать
  const count = n > 1 ? Math.min(3, n) : 0;
  const list: AvailablePatch[] = [];
  for (let i = 0; i < count; i++) {
    const circleIndex = (state.tokenIndex + 1 + i) % n;
    list.push({ marketIndex: i as 0 | 1 | 2, circleIndex, patchId: state.circle[circleIndex] });
  }
  return list;
}

export interface BuyCheck {
  affordable: boolean;
  placeable: boolean;
  allowed: boolean;
}

export function checkBuy(state: GameState, marketIndex: number): BuyCheck {
  const av = availablePatches(state);
  const item = av.find((a) => a.marketIndex === marketIndex);
  if (!item) return { affordable: false, placeable: false, allowed: false };
  const patch = PATCHES[item.patchId];
  const player = state.players[state.activePlayer];
  const affordable = player.buttons >= patch.cost;
  const placeable = isPlaceable(player.board, item.patchId);
  return { affordable, placeable, allowed: affordable && placeable };
}

/** Единственный вариант — продвижение? */
export function mustAdvance(state: GameState): boolean {
  if (state.phase !== 'action') return false;
  return availablePatches(state).every((a) => !checkBuy(state, a.marketIndex).allowed);
}

export interface AdvancePreview {
  distance: number;
  buttonGain: number;
  incomeGain: number;
  leathers: number;
}

/** Что даст продвижение прямо сейчас (для кнопки и ИИ) */
export function advancePreview(state: GameState, playerIdx = state.activePlayer): AdvancePreview {
  const p = state.players[playerIdx];
  const other = state.players[1 - playerIdx];
  const target = Math.min(TIME_END, other.time + 1);
  const distance = Math.max(0, target - p.time);
  let incomeGain = 0;
  for (const m of INCOME_MARKERS) if (m > p.time && m <= target) incomeGain += p.income;
  let leathers = 0;
  for (let i = state.leatherClaimed; i < LEATHER_POS.length; i++) {
    const pos = LEATHER_POS[i];
    if (pos <= p.time) continue;
    if (pos <= target) leathers++;
    else break;
  }
  return { distance, buttonGain: distance + incomeGain, incomeGain, leathers };
}

/** Движение фишки времени: доходы, кожаные лоскутки, отметка финиша */
function moveTime(
  state: GameState,
  playerIdx: number,
  target: number,
  gainPerSpace: boolean,
  events: GameEvent[],
): number {
  const p = state.players[playerIdx];
  const from = p.time;
  const to = Math.min(TIME_END, target);
  if (to <= from) return to;
  p.time = to;
  events.push({ type: 'timeMove', player: playerIdx, from, to });
  if (gainPerSpace) {
    const gain = to - from;
    p.buttons += gain;
    events.push({ type: 'buttons', player: playerIdx, delta: gain, reason: 'advance', to });
  }
  for (const m of INCOME_MARKERS) {
    if (m > from && m <= to) {
      const gain = p.income;
      if (gain > 0) {
        p.buttons += gain;
        events.push({ type: 'buttons', player: playerIdx, delta: gain, reason: 'income', to: m });
        pushLog(state, playerIdx, 'income', 'income', { n: gain });
      }
    }
  }
  if (to === TIME_END && p.reachedEndTurn === null) {
    p.reachedEndTurn = state.turn;
  }
  // кожаные лоскутки (за один ход теоретически можно пройти только один незанятый)
  while (state.leatherClaimed < LEATHER_POS.length) {
    const pos = LEATHER_POS[state.leatherClaimed];
    if (pos <= from || pos > to) break;
    state.leatherClaimed++;
    if (p.covered < BOARD_SIZE * BOARD_SIZE) {
      state.pendingQueue.push({ player: playerIdx, pieceId: LEATHER_ID, isLeather: true });
      events.push({ type: 'leather', player: playerIdx });
    } else {
      events.push({ type: 'leatherDiscard', player: playerIdx });
      pushLog(state, playerIdx, 'leather', 'leatherDiscard');
    }
  }
  return to;
}

/** Проверка спецплитки 7×7 после размещения */
function checkTile(state: GameState, playerIdx: number, events: GameEvent[]) {
  if (state.tile7x7Owner !== null) return;
  const win = findCompleted7x7(state.players[playerIdx].board);
  if (win) {
    state.tile7x7Owner = playerIdx;
    state.players[playerIdx].tile7x7 = true;
    events.push({ type: 'tile7x7', player: playerIdx });
    pushLog(state, playerIdx, 'tile', 'tile', { n: TILE_7X7_POINTS });
  }
}

function scoreOf(state: GameState, playerIdx: number): ScoreBreakdown {
  const p = state.players[playerIdx];
  const emptyCount = BOARD_SIZE * BOARD_SIZE - p.covered;
  const tile = p.tile7x7 ? TILE_7X7_POINTS : 0;
  return {
    buttons: p.buttons,
    tile,
    emptyCount,
    empty: -EMPTY_PENALTY * emptyCount,
    covered: p.covered,
    total: p.buttons + tile - EMPTY_PENALTY * emptyCount,
  };
}

function finishGame(state: GameState, events: GameEvent[]) {
  const s0 = scoreOf(state, 0);
  const s1 = scoreOf(state, 1);
  let winner: number | null = null;
  if (s0.total !== s1.total) {
    winner = s0.total > s1.total ? 0 : 1;
  } else {
    const t0 = state.players[0].reachedEndTurn;
    const t1 = state.players[1].reachedEndTurn;
    if (t0 !== null && t1 !== null) winner = t0 <= t1 ? 0 : 1;
    else winner = t0 !== null ? 0 : 1;
  }
  state.result = { scores: [s0, s1], winner, humanWon: winner === null ? null : winner === 0 };
  state.phase = 'gameover';
  events.push({ type: 'gameover' });
}

/** Смена активного игрока + проверка конца игры */
function finishTurn(state: GameState, events: GameEvent[]) {
  const a = state.players[state.activePlayer];
  const b = state.players[1 - state.activePlayer];
  // правило Patchwork: ходит та, чья фишка ПОЗАДИ. Встав точно на клетку
  // соперницы, фишка ходившего ложится СВЕРХУ — она считается «позади»
  // и ХОДИТ ЕЩЁ РАЗ (ход пропускается только если фишка строго обогнала соперницу)
  if (a.time === b.time) {
    state.topToken = state.activePlayer;
  } else {
    state.topToken = null;
    if (a.time > b.time) {
      state.activePlayer = 1 - state.activePlayer;
    }
    // a.time < b.time — ходившая всё ещё позади: ходит снова
  }
  if (state.players[0].time >= TIME_END && state.players[1].time >= TIME_END) {
    finishGame(state, events);
  }
}

export function currentPending(state: GameState): PendingPlacement | null {
  return state.pendingQueue.length > 0 ? state.pendingQueue[0] : null;
}

export interface ActionResult {
  state: GameState;
  events: GameEvent[];
}

/** Действие A: продвижение и получение пуговиц */
export function advanceAction(input: GameState): ActionResult {
  const state = cloneState(input);
  const events: GameEvent[] = [];
  if (state.phase !== 'action') throw new Error('advanceAction: не фаза действия');
  const playerIdx = state.activePlayer;
  const p = state.players[playerIdx];
  const other = state.players[1 - playerIdx];
  const target = Math.min(TIME_END, other.time + 1);
  state.turn++;
  moveTime(state, playerIdx, target, true, events);
  // крайний случай (соперница уже на 53): кламп приводит точно на её клетку —
  // при равенстве на финише игра сразу заканчивается, бонусов за посадку нет
  pushLog(state, playerIdx, 'advance', 'advance');
  if (state.pendingQueue.length > 0) {
    state.phase = 'placing';
    return { state, events };
  }
  finishTurn(state, events);
  return { state, events };
}

/** Действие B: купить лоскуток и сразу положить его */
export function buyAndPlace(
  input: GameState,
  marketIndex: 0 | 1 | 2,
  placement: Placement,
): ActionResult {
  const state = cloneState(input);
  const events: GameEvent[] = [];
  if (state.phase !== 'action') throw new Error('buyAndPlace: не фаза действия');
  const av = availablePatches(state);
  const item = av.find((a) => a.marketIndex === marketIndex);
  if (!item) throw new Error('buyAndPlace: лоскуток недоступен');
  const patch = PATCHES[item.patchId];
  const playerIdx = state.activePlayer;
  const p = state.players[playerIdx];
  if (p.buttons < patch.cost) throw new Error('buyAndPlace: не хватает пуговиц');
  if (!isLegalPlacement(p.board, item.patchId, placement)) {
    throw new Error('buyAndPlace: нелегальное размещение');
  }

  state.turn++;
  // 3. оплата
  p.buttons -= patch.cost;
  if (patch.cost > 0) events.push({ type: 'buttons', player: playerIdx, delta: -patch.cost, reason: 'buy' });
  // доход растёт сразу — лоскуток ложится до движения фишки
  p.income += patch.income;
  // 4. размещение
  const orient = orientationsFor(item.patchId)[placement.orientation];
  const cells = placementCells(orient, placement.r, placement.c);
  stampPiece(p.board, item.patchId, placement);
  p.covered += cells.length;
  events.push({ type: 'place', player: playerIdx, pieceId: item.patchId });
  pushLog(state, playerIdx, 'buy', 'buy', {
    patchId: item.patchId,
    cost: patch.cost,
    time: patch.time,
  });
  // 1-2. изъятие из круга и перенос токена в освободившийся промежуток:
  // напальчник встаёт НА МЕСТО взятого лоскутка, поэтому следующими продаются
  // лоскутки ПОСЛЕ него (оставшиеся два из тройки + новые из круга)
  state.circle.splice(item.circleIndex, 1);
  state.tokenIndex = (item.circleIndex - 1 + state.circle.length) % state.circle.length;
  // 5. движение времени
  moveTime(state, playerIdx, p.time + patch.time, false, events);
  // 5а. встали точно на клетку соперницы — булавка ложится СВЕРХУ и ходившая
  // ХОДИТ ЕЩЁ РАЗ (пуговицы за саму посадку правилами Patchwork не положено)
  const other = state.players[1 - playerIdx];
  if (p.time === other.time && p.time > 0) {
    events.push({ type: 'landing', player: playerIdx, to: p.time });
    pushLog(state, playerIdx, 'buy', 'landBuy');
  }
  checkTile(state, playerIdx, events);
  if (state.pendingQueue.length > 0) {
    state.phase = 'placing';
    return { state, events };
  }
  finishTurn(state, events);
  return { state, events };
}

/** Поставить кожаный лоскуток 1×1 (pos — клетка) */
export function placeLeather(input: GameState, r: number, c: number): ActionResult {
  const state = cloneState(input);
  const events: GameEvent[] = [];
  const pending = currentPending(state);
  if (!pending || !pending.isLeather || state.phase !== 'placing') {
    throw new Error('placeLeather: нет ожидающего кожаного лоскутка');
  }
  const p = state.players[pending.player];
  if (p.board[r * BOARD_SIZE + c] !== -1) throw new Error('placeLeather: клетка занята');
  p.board[r * BOARD_SIZE + c] = LEATHER_ID;
  p.covered++;
  state.pendingQueue.shift();
  events.push({ type: 'place', player: pending.player, pieceId: LEATHER_ID, pos: { r, c } });
  pushLog(state, pending.player, 'leather', 'leatherSewn');
  checkTile(state, pending.player, events);
  if (state.pendingQueue.length > 0) return { state, events };
  state.phase = 'action';
  finishTurn(state, events);
  return { state, events };
}

/** Итоговые очки игрока (для панели) */
export function scoreBreakdown(state: GameState, playerIdx: number): ScoreBreakdown {
  return scoreOf(state, playerIdx);
}

/** Кто сейчас ходит, с учётом «верхней» фишки (для подсветки) */
export function moverLabel(state: GameState): string {
  if (state.phase === 'gameover') return 'Партия завершена';
  return state.activePlayer === 0 ? 'Ваш ход' : 'Ход соперника';
}

/** Быстрая проверка: есть ли у игрока пустые клетки */
export function hasEmptyCell(board: number[]): boolean {
  return board.some((v) => v === -1);
}
