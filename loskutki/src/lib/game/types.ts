import type { BotLevel } from './constants';

export type Phase = 'action' | 'placing' | 'gameover';

export interface PlayerState {
  /** пуговицы в кошельке */
  buttons: number;
  /** суммарный доход с лоскутков на полотне */
  income: number;
  /** позиция на дорожке времени 0..53 */
  time: number;
  /** 81 клетка: -1 пусто, иначе id лоскутка (99 = кожаный) */
  board: number[];
  /** сколько клеток закрыто */
  covered: number;
  /** получила ли спецплитку 7×7 */
  tile7x7: boolean;
  /** номер хода, когда достигла клетки 53 (для тайбрейка) */
  reachedEndTurn: number | null;
}

export interface PendingPlacement {
  player: number;
  /** id лоскутка или LEATHER_ID */
  pieceId: number;
  isLeather: boolean;
}

export interface LogEntry {
  turn: number;
  player: number;
  kind: 'buy' | 'advance' | 'income' | 'leather' | 'tile' | 'system';
  /** старый формат (сейвы до локализации) — готовый текст, показываем как есть */
  text?: string;
  /** код фразы для локализации: start · income · advance · buy · landAdv · landBuy · tile · leatherSewn · leatherDiscard */
  code?: string;
  /** параметры подстановки в шаблон фразы */
  data?: Record<string, string | number>;
}

export interface GameEvent {
  type:
    | 'buttons'
    | 'timeMove'
    | 'place'
    | 'leather'
    | 'leatherDiscard'
    | 'tile7x7'
    | 'gameover';
  player?: number;
  pieceId?: number;
  from?: number;
  to?: number;
  delta?: number;
  reason?: 'advance' | 'income' | 'buy' | 'start' | 'landing';
  pos?: { r: number; c: number } | null;
}

export interface GameState {
  seed: number;
  mode: 'casual' | 'daily';
  botLevel: BotLevel;
  /** порядок лоскутков в круге (id) */
  circle: number[];
  /** индекс в circle ПЕРЕД первым доступным лоскутком (позиция токена) */
  tokenIndex: number;
  players: [PlayerState, PlayerState];
  /** 0 — человек, 1 — бот */
  activePlayer: number;
  /** чья фишка СВЕРХУ, когда обе на одной клетке (вставшая точно на соперника; null — клетки разные) */
  topToken: number | null;
  /** кто ходил первым */
  firstPlayer: number;
  turn: number;
  phase: Phase;
  /** очередь обязательных размещений (кожаные лоскутки) */
  pendingQueue: PendingPlacement[];
  /** сколько кожаных лоскутков уже разобрано (0..5) */
  leatherClaimed: number;
  /** владелец спецплитки 7×7 (null — никому) */
  tile7x7Owner: number | null;
  log: LogEntry[];
  result: GameResult | null;
}

export interface ScoreBreakdown {
  buttons: number;
  tile: number;
  empty: number;
  emptyCount: number;
  covered: number;
  total: number;
}

export interface GameResult {
  scores: [ScoreBreakdown, ScoreBreakdown];
  winner: number | null;
  humanWon: boolean | null;
}

export interface Placement {
  /** ориентация: индекс в списке ориентаций лоскутка */
  orientation: number;
  /** якорь — верхняя-левая клетка описывающего прямоугольника */
  r: number;
  c: number;
}

export interface BotDecision {
  action: 'advance' | 'buy';
  marketIndex?: 0 | 1 | 2;
  placement?: Placement;
}
