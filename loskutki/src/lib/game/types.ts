import type { BotLevel } from './constants';

export type Phase = 'action' | 'placing' | 'gameover';

export type GameMode = 'casual' | 'daily' | 'online';

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
    | 'gameover'
    | 'landing';
  player?: number;
  pieceId?: number;
  from?: number;
  to?: number;
  delta?: number;
  reason?: 'advance' | 'income' | 'buy' | 'start';
  pos?: { r: number; c: number } | null;
}

/** Онлайн-мета партии: встраивается сервером в состояние при повороте для зрителя */
export interface OnlineMeta {
  code: string;
  myName: string;
  myAvatar: string;
  foeName: string;
  foeAvatar: string;
}

export interface GameState {
  seed: number;
  mode: GameMode;
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
  /** заполнено только в онлайн-партии (со стороны зрителя) */
  online?: OnlineMeta | null;
}

export interface NetAction {
  type: 'advance' | 'buy' | 'leather';
  marketIndex?: 0 | 1 | 2;
  orientation?: number;
  r?: number;
  c?: number;
}

export interface MpRoomView {
  code: string;
  status: 'waiting' | 'playing' | 'finished' | 'abandoned';
  isPublic: boolean;
  mySeat: 0 | 1;
  me: { name: string; avatar: string; connected: boolean };
  foe: { name: string; avatar: string; connected: boolean; left: boolean } | null;
  wins: [number, number];
  rematchMe: boolean;
  rematchFoe: boolean;
  version: number;
  gameSeq: number;
  turnDeadline: number | null;
  /** таймер хода приостановлен: владелец хода не на связи (телефон в кармане) */
  turnPaused: boolean;
  serverNow: number;
  state: GameState | null;
  events: GameEvent[] | null;
  eventsVersion: number;
  timedOutSeat: number | null;
  timedOutVersion: number | null;
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
