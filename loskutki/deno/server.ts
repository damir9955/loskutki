/**
 * «ЛОСКУТКИ» — WebSocket-сервер мультиплеера для Deno Deploy.
 * ============================================================
 *
 * КАК РАЗВЕРНУТЬ (5 минут, бесплатно, из РФ без VPN):
 *   1. Открой https://dash.deno.com → «New Playground»
 *      (именно Playground! НЕ «New Project» из GitHub — весь сайт игры
 *      живёт на Vercel, здесь нужен только этот один файл)
 *   2. Удали содержимое main.ts и вставь ВЕСЬ этот файл целиком
 *   3. Нажми «Save & Deploy» — получишь адрес https://<имя>.deno.dev
 *   4. В настройках Vercel игры добавь переменную окружения
 *      NEXT_PUBLIC_WS_URL = wss://<имя>.deno.dev и сделай Redeploy
 *   5. Проверка: открой https://<имя>.deno.dev в браузере —
 *      увидишь страницу «Лоскутки: сервер онлайн»
 * Обновлять сервер потом — просто отредактировать код в Playground
 * и нажать Save & Deploy снова.
 *
 * ЧТО ВНУТРИ:
 *   — комнаты хранятся в Deno KV: ПЕРЕЖИВАЮТ перезапуск и новый деплой
 *     (игрок, вернувшись по коду комнаты, застаёт партию на месте);
 *     в bun-тестах и без KV — режим оперативной памяти;
 *   — валидация ходов на сервере (чередование, деньги, свободные клетки);
 *   — запись ходов по CAS (versionstamp): одновременные ходы из разных
 *     изолятов Deno не теряются и не перетирают друг друга;
 *   — мгновенная рассылка состояния обоим игрокам после каждого события
 *     (между изолятами — через BroadcastChannel);
 *   — ping-pong: сервер пингует каждые 3с, «мёртвый» сокет закрывается
 *     через 10с молчания (комната и прогресс при этом СОХРАНЯЮТСЯ);
 *   — переподключение: клиент шлёт state с кодом комнаты и playerId
 *     (сессия в localStorage) — сервер высылает ПОЛНОЕ состояние;
 *   — быстрый матч (quick match): два искателя сводятся в одну комнату;
 *   — авто-просрочка ходов (3 минуты) с паузой, если владелец не на связи;
 *   — GET / — страница «сервер онлайн» + CORS для браузера.
 *
 * Протокол (JSON по WebSocket):
 *   клиент → сервер: {ref, t:'create'|'join'|'state'|'move'|'control'|
 *     'quick'|'quick_cancel'|'rooms'|'ping', ...} и {t:'pong', id}
 *   сервер → клиент: {ref, ok:true|false, ...} — ответ на запрос,
 *     {t:'view', view} — мгновенный push состояния комнаты,
 *     {t:'rooms', rooms} — push списка открытых комнат лобби,
 *     {t:'ping', id} — проверка связи.
 */

// ============================================================
// 1. ИГРОВЫЕ КОНСТАНТЫ (копия src/lib/game/constants.ts)
// ============================================================

const BOARD_SIZE = 9;
const CELLS = BOARD_SIZE * BOARD_SIZE;

/** Последняя клетка дорожки времени */
const TIME_END = 53;

/** Маркеры дохода */
const INCOME_MARKERS: readonly number[] = [5, 11, 17, 23, 29, 35, 41, 47, 53];

/** Позиции кожаных лоскутков 1×1 */
const LEATHER_POS: readonly number[] = [20, 26, 32, 44, 50];

/** Стартовое количество пуговиц */
const START_BUTTONS = 5;

/** Очки за спецплитку 7×7 */
const TILE_7X7_POINTS = 7;

/** Штраф за пустую клетку полотна */
const EMPTY_PENALTY = 2;

/** id кожаного лоскутка на доске */
const LEATHER_ID = 99;

type FabricPattern =
  | 'dots' | 'diag' | 'hatch' | 'check' | 'weave' | 'stripe' | 'cross' | 'plain';

interface PatchDef {
  id: number;
  name: string;
  cells: ReadonlyArray<readonly [number, number]>;
  cost: number;
  time: number;
  income: number;
  color: string;
  pattern: FabricPattern;
}

type Rows = string[];

function parseRows(rows: Rows): ReadonlyArray<readonly [number, number]> {
  const cells: Array<[number, number]> = [];
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) if (row[c] === '#') cells.push([r, c]);
  });
  return cells;
}

interface PatchSpec {
  name: string;
  cost: number;
  time: number;
  income: number;
  color: string;
  pattern: FabricPattern;
  rows: Rows;
}

const SPECS: PatchSpec[] = [
  { name: 'Полоска', cost: 2, time: 1, income: 0, color: '#C0603A', pattern: 'stripe', rows: ['##'] },
  { name: 'Лента', cost: 2, time: 2, income: 0, color: '#8AA06F', pattern: 'plain', rows: ['###'] },
  { name: 'Кушак', cost: 3, time: 3, income: 1, color: '#D9A13F', pattern: 'diag', rows: ['####'] },
  { name: 'Шаль', cost: 7, time: 1, income: 1, color: '#8E5A79', pattern: 'dots', rows: ['#####'] },
  { name: 'Квадратик', cost: 6, time: 5, income: 2, color: '#3E7C74', pattern: 'weave', rows: ['##', '##'] },
  { name: 'Галочка', cost: 2, time: 2, income: 0, color: '#EFE0BC', pattern: 'cross', rows: ['## ', '###'] },
  { name: 'Сапожок', cost: 10, time: 5, income: 3, color: '#A54628', pattern: 'diag', rows: ['##  ', '####'] },
  { name: 'Крылышки', cost: 7, time: 4, income: 2, color: '#5B7E9E', pattern: 'dots', rows: [' ## ', '####'] },
  { name: 'Молния', cost: 4, time: 2, income: 0, color: '#C08A3E', pattern: 'stripe', rows: ['### ', ' ###'] },
  { name: 'Тапочек', cost: 8, time: 6, income: 3, color: '#C0788A', pattern: 'weave', rows: [' ##', ' ##', '## '] },
  { name: 'Подкова', cost: 1, time: 2, income: 0, color: '#8B5E3C', pattern: 'check', rows: ['# #', '###'] },
  { name: 'Мостик', cost: 1, time: 5, income: 1, color: '#6E7F4F', pattern: 'diag', rows: ['#  #', '####'] },
  { name: 'Рогатка', cost: 3, time: 6, income: 2, color: '#D9A13F', pattern: 'dots', rows: ['# #', '###', ' # '] },
  { name: 'Топорик', cost: 2, time: 2, income: 0, color: '#C0603A', pattern: 'plain', rows: ['###', ' # '] },
  { name: 'Ключик', cost: 5, time: 5, income: 2, color: '#3E7C74', pattern: 'hatch', rows: ['###', ' # ', ' # '] },
  { name: 'Шпилька', cost: 7, time: 2, income: 2, color: '#8E5A79', pattern: 'stripe', rows: ['###', ' # ', ' # ', ' # '] },
  { name: 'Крестище', cost: 0, time: 3, income: 1, color: '#8AA06F', pattern: 'cross', rows: [' # ', '###', ' # ', ' # '] },
  { name: 'Уголок', cost: 4, time: 2, income: 1, color: '#C08A3E', pattern: 'check', rows: ['# ', '# ', '##'] },
  { name: 'Ступенька', cost: 4, time: 6, income: 2, color: '#5B7E9E', pattern: 'diag', rows: ['# ', '# ', '##'] },
  { name: 'Лестница', cost: 10, time: 3, income: 2, color: '#A54628', pattern: 'stripe', rows: ['# ', '# ', '# ', '##'] },
  { name: 'Флажок', cost: 3, time: 4, income: 1, color: '#EFE0BC', pattern: 'dots', rows: ['# ', '# ', '##', '# '] },
  { name: 'Крестик', cost: 5, time: 4, income: 2, color: '#C0788A', pattern: 'cross', rows: [' # ', '###', ' # '] },
  { name: 'Якорь', cost: 1, time: 4, income: 1, color: '#6E7F4F', pattern: 'weave', rows: [' # ', ' # ', '###', ' # ', ' # '] },
  { name: 'Гусеница', cost: 5, time: 3, income: 1, color: '#D9A13F', pattern: 'check', rows: [' ## ', '####', ' ## '] },
  { name: 'Молоточек', cost: 2, time: 3, income: 0, color: '#8B5E3C', pattern: 'hatch', rows: ['# #', '###', '# #'] },
  { name: 'Клаптик', cost: 3, time: 1, income: 0, color: '#C0603A', pattern: 'plain', rows: [' #', '##'] },
  { name: 'Крючок', cost: 1, time: 3, income: 0, color: '#8AA06F', pattern: 'dots', rows: [' #', '##'] },
  { name: 'Волна', cost: 3, time: 2, income: 1, color: '#3E7C74', pattern: 'stripe', rows: [' #', '##', '# '] },
  { name: 'Зигзаг', cost: 7, time: 6, income: 3, color: '#8E5A79', pattern: 'hatch', rows: [' #', '##', '# '] },
  { name: 'Ручеёк', cost: 2, time: 3, income: 1, color: '#5B7E9E', pattern: 'diag', rows: [' #', ' #', '##', '# '] },
  { name: 'Хомуток', cost: 1, time: 2, income: 0, color: '#C08A3E', pattern: 'weave', rows: ['   #', '####', '#   '] },
  { name: 'Стрекоза', cost: 2, time: 1, income: 0, color: '#EFE0BC', pattern: 'plain', rows: ['  # ', '####', ' #  '] },
  { name: 'Косичка', cost: 10, time: 4, income: 3, color: '#A54628', pattern: 'dots', rows: ['  #', ' ##', '## '] },
];

const PATCHES: readonly PatchDef[] = SPECS.map((s, i) => ({
  id: i,
  name: s.name,
  cells: parseRows(s.rows),
  cost: s.cost,
  time: s.time,
  income: s.income,
  color: s.color,
  pattern: s.pattern,
}));

/** Кожаный лоскуток 1×1 — за прохождение спецклеток */
const LEATHER_PATCH: PatchDef = {
  id: LEATHER_ID,
  name: 'Кожаный',
  cells: [[0, 0]],
  cost: 0,
  time: 0,
  income: 0,
  color: '#7A5230',
  pattern: 'plain',
};

/** Портреты онлайн-игроков (валидные значения avatar) */
const AVATAR_IDS = ['ann', 'boris', 'vera', 'grig', 'glasha', 'fedor', 'elza'] as const;

// ============================================================
// 2. ТИПЫ (копия нужных частей src/lib/game/types.ts)
// ============================================================

type Phase = 'action' | 'placing' | 'gameover';
type GameMode = 'casual' | 'daily' | 'online';
type BotLevel = 'glasha' | 'fedor' | 'elza';

interface PlayerState {
  buttons: number;
  income: number;
  time: number;
  /** 81 клетка: -1 пусто, иначе id лоскутка (99 = кожаный) */
  board: number[];
  covered: number;
  tile7x7: boolean;
  reachedEndTurn: number | null;
}

interface PendingPlacement {
  player: number;
  pieceId: number;
  isLeather: boolean;
}

interface LogEntry {
  turn: number;
  player: number;
  kind: 'buy' | 'advance' | 'income' | 'leather' | 'tile' | 'system';
  text?: string;
  code?: string;
  data?: Record<string, string | number>;
}

interface GameEvent {
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

interface OnlineMeta {
  code: string;
  myName: string;
  myAvatar: string;
  foeName: string;
  foeAvatar: string;
}

interface ScoreBreakdown {
  buttons: number;
  tile: number;
  empty: number;
  emptyCount: number;
  covered: number;
  total: number;
}

interface GameResult {
  scores: [ScoreBreakdown, ScoreBreakdown];
  winner: number | null;
  humanWon: boolean | null;
}

interface GameState {
  seed: number;
  mode: GameMode;
  botLevel: BotLevel;
  circle: number[];
  tokenIndex: number;
  players: [PlayerState, PlayerState];
  activePlayer: number;
  topToken: number | null;
  firstPlayer: number;
  turn: number;
  phase: Phase;
  pendingQueue: PendingPlacement[];
  leatherClaimed: number;
  tile7x7Owner: number | null;
  log: LogEntry[];
  result: GameResult | null;
  online?: OnlineMeta | null;
}

interface Placement {
  orientation: number;
  r: number;
  c: number;
}

interface NetAction {
  type: 'advance' | 'buy' | 'leather';
  marketIndex?: 0 | 1 | 2;
  orientation?: number;
  r?: number;
  c?: number;
}

interface MpRoomView {
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
  turnPaused: boolean;
  serverNow: number;
  state: GameState | null;
  events: GameEvent[] | null;
  eventsVersion: number;
  timedOutSeat: number | null;
  timedOutVersion: number | null;
}

// ============================================================
// 3. ГПСЧ (mulberry32 — копия src/lib/game/rng.ts)
// ============================================================

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================
// 4. РАЗМЕЩЕНИЯ ЛОСКУТКОВ (копия src/lib/game/placement.ts)
// ============================================================

interface Orientation {
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

/** Все уникальные ориентации лоскутка (повороты × отражения), с кэшем.
 *  ПОРЯДОК ориентаций обязан быть тот же, что в клиенте — индекс
 *  ориентации приходит в сообщении move. */
export function orientationsFor(patchId: number): Orientation[] {
  const cached = orientationCache.get(patchId);
  if (cached) return cached;
  const patch: PatchDef = patchId === LEATHER_ID
    ? { ...LEATHER_PATCH }
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

/** Доска → битовые маски строк */
function boardRows(board: number[]): number[] {
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
function canPlaceAt(orient: Orientation, r: number, c: number, rows: number[]): boolean {
  if (r < 0 || c < 0) return false;
  if (r + orient.h > BOARD_SIZE || c + orient.w > BOARD_SIZE) return false;
  for (let i = 0; i < orient.h; i++) {
    if (rows[r + i] & (orient.rows[i] << c)) return false;
  }
  return true;
}

/** Клетки, которые займёт размещение */
function placementCells(
  orientation: Orientation,
  r: number,
  c: number,
): Array<[number, number]> {
  return orientation.cells.map(([pr, pc]) => [r + pr, c + pc] as [number, number]);
}

/** Хотя бы одно размещение возможно? */
function isPlaceable(board: number[], patchId: number): boolean {
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
function isLegalPlacement(
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
function stampPiece(
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
function findCompleted7x7(board: number[]): { r: number; c: number } | null {
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

// ============================================================
// 5. ИГРОВОЙ ДВИЖОК (копия src/lib/game/engine.ts — серверная часть)
// ============================================================

function emptyPlayer(): PlayerState {
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
  mode: GameMode;
  botLevel: BotLevel;
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
  // токен ставится прямо ПЕРЕД уникальным лоскутком 2×1 (id 0)
  const dominoPos = circle.indexOf(0);
  const tokenIndex = (dominoPos - 1 + circle.length) % circle.length;

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

function cloneState(state: GameState): GameState {
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
  state.log.push({ turn: state.turn, player, kind, code, data });
  if (state.log.length > 80) state.log.splice(0, state.log.length - 80);
}

/** Доступные для покупки лоскутки (до 3 после токена) */
export interface AvailablePatch {
  marketIndex: 0 | 1 | 2;
  circleIndex: number;
  patchId: number;
}

export function availablePatches(state: GameState): AvailablePatch[] {
  const n = state.circle.length;
  const count = n > 1 ? Math.min(3, n) : 0;
  const list: AvailablePatch[] = [];
  for (let i = 0; i < count; i++) {
    const circleIndex = (state.tokenIndex + 1 + i) % n;
    list.push({ marketIndex: i as 0 | 1 | 2, circleIndex, patchId: state.circle[circleIndex] });
  }
  return list;
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
  // кожаные лоскутки
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
  if (a.time === b.time) {
    state.topToken = state.activePlayer;
  } else {
    state.topToken = null;
    if (a.time > b.time) {
      state.activePlayer = 1 - state.activePlayer;
    }
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
  const other = state.players[1 - playerIdx];
  const target = Math.min(TIME_END, other.time + 1);
  state.turn++;
  moveTime(state, playerIdx, target, true, events);
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
  p.buttons -= patch.cost;
  if (patch.cost > 0) events.push({ type: 'buttons', player: playerIdx, delta: -patch.cost, reason: 'buy' });
  p.income += patch.income;
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
  state.circle.splice(item.circleIndex, 1);
  state.tokenIndex = (item.circleIndex - 1 + state.circle.length) % state.circle.length;
  moveTime(state, playerIdx, p.time + patch.time, false, events);
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

/** Поставить кожаный лоскуток 1×1 (r, c — клетка) */
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

/** Быстрая проверка: есть ли у игрока пустые клетки */
export function hasEmptyCell(board: number[]): boolean {
  return board.some((v) => v === -1);
}

// ============================================================
// 6. КОМНАТЫ В ОПЕРАТИВНОЙ ПАМЯТИ (порт src/lib/server/rooms.ts)
//    Один процесс — один источник истины: CAS-конфликты не нужны.
// ============================================================

interface MpPlayer {
  id: string;
  name: string;
  avatar: string;
  lastPoll: number;
  leftAt: number | null;
}

interface MpRoom {
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
  /** таймер хода приостановлен: владелец хода пропал */
  frozen: boolean;
  lastEvents: GameEvent[];
  lastEventsVersion: number;
  timedOutSeat: number | null;
  timedOutVersion: number | null;
  rematchHost: boolean;
  rematchGuest: boolean;
  wins: [number, number];
  /** комната создана автопоиском */
  quickHost: boolean;
  createdAt: number;
  updatedAt: number;
}

/** ЖИВЫЕ комнаты — единственное состояние сервера (в RAM) */
const rooms = new Map<string, MpRoom>();

const CONNECTED_MS = 12_000; // «на связи» = был активен меньше 12с назад

/** Грайс для хода «в полёте»: сколько секунд после истечения дедлайна мы
 *  ещё ждём настоящий ход подключённого владельца, прежде чем автопассить.
 *  Масштабируется от длины хода (короткие тестовые ходы — грайс крошечный),
 *  максимум 4с — незаметно для соперника, но достаточно, чтобы ход,
 *  отправленный в последнюю секунду, долетел и применился. */
const IN_FLIGHT_GRACE_CAP_MS = 4_000;
function inFlightGraceMs(): number {
  return Math.min(IN_FLIGHT_GRACE_CAP_MS, Math.max(0, Math.round(turnMs() * 0.02)));
}

/** Есть ли у игрока живой прикреплённый сокет в ЭТОМ изоляте (WS-режим:
 *  присутствие видно по сокету, даже если игрок давно не слал запросов). */
function ownerSocketAlive(room: MpRoom, owner: number): boolean {
  const pid = owner === 0 ? room.host?.id : room.guest?.id;
  if (!pid) return false;
  for (const s of sockets.values()) {
    if (s.alive && s.code === room.code && s.playerId === pid) return true;
  }
  return false;
}
const ROOM_TTL_MS = 30 * 60_000; // брошенные партии чистим через 30 минут
const WAITING_HOST_TTL_MS = 5 * 60_000; // ждущая комната без хоста живёт 5 минут
const LIST_ALIVE_MS = 20_000; // в поиске показываем только живые комнаты
const MAX_AUTO_TICKS = 80; // предохранитель цикла автопассов
const OWNER_ABSENT_CAP_MS = 90_000; // дольше — автопасс просрочки
const RESUME_GRANT_MS = 90_000; // вернулся после паузы — минимум времени на ход
const REVIVE_GAP_MS = 60_000; // пауза, после которой дедлайн оживляется

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** env-переменная и в Deno, и в bun/тестах */
function envNum(name: string): number | null {
  try {
    const d = (globalThis as unknown as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno;
    if (d?.env?.get) {
      const v = Number(d.env.get(name));
      return Number.isFinite(v) && v > 0 ? v : null;
    }
  } catch { /* не Deno */ }
  try {
    const p = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process;
    if (p?.env) {
      const v = Number(p.env[name]);
      return Number.isFinite(v) && v > 0 ? v : null;
    }
  } catch { /* нет process */ }
  return null;
}

/** Сколько длится ход (мс). Переопределяется env MP_TURN_MS. */
export function turnMs(): number {
  return envNum('MP_TURN_MS') ?? 180_000;
}

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

/**
 * Оживление дедлайна после паузы: если комнату никто не трогал дольше
 * REVIVE_GAP_MS (изолат Deno «проснулся» после простоя), просроченным
 * ходам выдаём СВЕЖЕЕ время — пауза инфраструктуры не должна проигрывать
 * партию за игрока каскадом автопассов.
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

// ============================================================
// 3.5. ХРАНИЛИЩЕ КОМНАТ: Deno KV (+ канал между изолятами)
// ============================================================
// На Deno Deploy комнаты живут не только в памяти изолята, но и в
// Deno KV — сервер ПЕРЕЖИВАЕТ перезапуск и новый деплой: игрок,
// вернувшись по коду комнаты, застаёт партию на месте.
// KV — источник истины: каждое изменение = прочитать (strong) →
// изменить → записать CAS по versionstamp; одновременные ходы из
// разных изолятов не теряются. Push соседним изолятам — BroadcastChannel.
// В bun-тестах initPersistence не вызывается → режим чистой памяти.

type KvKey = readonly unknown[];
interface KvEntry { key: KvKey; value: unknown; versionstamp: string }
interface KvAtomic {
  check(c: { key: KvKey; versionstamp: string | null }): KvAtomic;
  set(k: KvKey, v: unknown): KvAtomic;
  delete(k: KvKey): KvAtomic;
  commit(): Promise<{ ok: boolean }>;
}
interface KvLike {
  get(key: KvKey, opts?: { consistency?: 'strong' | 'eventual' }): Promise<KvEntry | null>;
  list(scope: { prefix: KvKey }, opts?: { consistency?: 'strong' | 'eventual' }): AsyncIterable<KvEntry>;
  atomic(): KvAtomic;
}
interface ChanLike {
  postMessage(msg: unknown): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

let kv: KvLike | null = null;
let chan: ChanLike | null = null;
let kvOn = false;

/** кап журнала при записи в KV (значение ключа ограничено ~64 КБ,
 *  а длинные партии наращивают журнал; свежие записи важнее старых) */
const KV_LOG_CAP = 140;
/** как часто «ищущий» обновляет присутствие в своей комнате (запись) */
const QUICK_TOUCH_MS = 8_000;
/** KV-проход дворника по комнатам — раз в N тиков */
const SWEEP_ROOMS_EVERY = 2;
/** присутствие подключённого игрока протухает в KV не быстрее, чем так */
const PRESENCE_SAVE_MS = 30_000;

/** подключить хранилище и канал (вызывает ТОЛЬКО Deno-клей; в bun-тестах
 *  не вызывается — ядро работает в режиме оперативной памяти) */
export function initPersistence(k: KvLike | null, c: ChanLike | null): void {
  kv = k;
  kvOn = k !== null;
  chan = c;
  if (c) {
    c.onmessage = (ev) => {
      try {
        void handleChanMessage(ev.data);
      } catch { /* ignore */ }
    };
  }
}

/** соседний изолят изменил комнату: перечитать её и разпушить тем,
 *  чьи сокеты живут у нас (себе сообщение не доставляется) */
async function handleChanMessage(data: unknown): Promise<void> {
  try {
    if (!data || typeof data !== 'object') return;
    const code = typeof (data as { code?: unknown }).code === 'string' ? (data as { code: string }).code : '';
    if (!code) return;
    const gone = (data as { gone?: unknown }).gone === true;
    let hasLocal = false;
    for (const s of sockets.values()) {
      if (s.alive && s.code === code) {
        hasLocal = true;
        break;
      }
    }
    if (!hasLocal) return;
    if (gone) {
      // комнату удалили на другом изоляте — открепляем свои сокеты
      for (const s of [...sockets.values()]) {
        if (s.code === code) detach(s);
      }
      return;
    }
    const entry = await loadRoomEntry(code);
    if (entry) broadcastRoom(entry.room);
  } catch {
    // сбой хранилища — пропускаем (следующее событие повторит)
  }
}

function notifyChan(code: string, gone = false): void {
  try {
    chan?.postMessage({ code, gone });
  } catch { /* ignore */ }
}

/** комнату в KV пишем с капом журнала */
function capForKv(room: MpRoom): MpRoom {
  const st = room.state;
  if (!st || st.log.length <= KV_LOG_CAP) return room;
  return { ...room, state: { ...st, log: st.log.slice(-KV_LOG_CAP) } };
}

/** прочитать комнату (KV: сильная консистентность — только свежее) */
async function loadRoomEntry(code: string): Promise<{ room: MpRoom; versionstamp: string | null } | null> {
  if (kv) {
    for (let i = 0; i < 2; i++) {
      try {
        const e = await kv.get(['room', code], { consistency: 'strong' });
        if (!e || !e.value) return null;
        return { room: e.value as MpRoom, versionstamp: e.versionstamp };
      } catch {
        if (i === 1) throw 'net';
      }
    }
    return null;
  }
  const room = rooms.get(code);
  return room ? { room, versionstamp: null } : null;
}

/** CAS-запись комнаты: versionstamp=null означает «ключа ещё нет»
 *  (создание); несовпадение версии = чья-то более свежая запись */
async function saveRoom(room: MpRoom, versionstamp: string | null): Promise<boolean> {
  if (!kv) {
    rooms.set(room.code, room);
    return true;
  }
  try {
    const res = await kv.atomic()
      .check({ key: ['room', room.code], versionstamp })
      .set(['room', room.code], capForKv(room))
      .commit();
    return res.ok;
  } catch {
    return false;
  }
}

/** CAS-удаление комнаты (только если версия не поменялась) */
async function deleteRoom(code: string, versionstamp: string | null): Promise<boolean> {
  if (!kv) {
    return rooms.delete(code);
  }
  try {
    const res = await kv.atomic()
      .check({ key: ['room', code], versionstamp })
      .delete(['room', code])
      .commit();
    return res.ok;
  } catch {
    return false;
  }
}

interface MutateOut<T> {
  result: T;
  /** true — состояние не менялось, запись не нужна */
  skipSave?: boolean;
}

/** Прочитать → изменить → записать (CAS). При конфликте — перечитать
 *  и применить изменение к СВЕЖЕМУ состоянию (до 5 попыток).
 *  Ошибка валидации внутри fn пробрасывается БЕЗ записи. */
async function mutateRoom<T>(
  code: string,
  fn: (room: MpRoom) => MutateOut<T>,
): Promise<{ room: MpRoom; result: T }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const entry = await loadRoomEntry(code);
    if (!entry) throw 'notfound';
    const out = fn(entry.room);
    if (out.skipSave === true) return { room: entry.room, result: out.result };
    if (await saveRoom(entry.room, entry.versionstamp)) {
      return { room: entry.room, result: out.result };
    }
    // конфликт: кто-то записал раньше — перечитываем и применяем заново
  }
  throw 'conflict';
}

/** сигнатура существенных изменений (без lastPoll/updatedAt —
 *  присутствие обновляется дворником отдельно) */
function dirtySig(room: MpRoom): string {
  return `${room.version}|${room.status}|${room.frozen}|${room.timedOutSeat}|${room.frozen ? 'F' : room.turnDeadline}`;
}

/** все комнаты: KV — итерация по префиксу (strong — для решений,
 *  eventual — для «косметики» вроде лобби); память — values() */
async function allRooms(strong: boolean): Promise<Array<{ room: MpRoom; versionstamp: string | null }>> {
  const out: Array<{ room: MpRoom; versionstamp: string | null }> = [];
  if (!kv) {
    for (const r of rooms.values()) out.push({ room: r, versionstamp: null });
    return out;
  }
  const opts = strong ? { consistency: 'strong' as const } : undefined;
  for await (const e of kv.list({ prefix: ['room'] }, opts)) {
    if (e.value) out.push({ room: e.value as MpRoom, versionstamp: e.versionstamp });
  }
  return out;
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
  if (typeof input.playerId === 'string' && input.playerId === room.host.id) throw 'ownroom';
  if (room.status !== 'waiting' || room.guest !== null) throw 'full';
  if (room.host.leftAt !== null) throw 'gone';
  tick(room);
  if (room.status !== 'waiting' || room.guest !== null) throw 'full';
  const guestId = genId();
  seatGuest(room, guestId, input.name, input.avatar);
  return guestId;
}

/** внутренняя логика выхода; true — комнату нужно удалить */
function leaveInternal(room: MpRoom, playerId: string): boolean {
  const seat = seatOf(room, playerId);
  if (seat === null) throw 'notfound';
  if (room.status === 'waiting') return true;
  const p = seat === 0 ? room.host : room.guest;
  if (p) p.leftAt = Date.now();
  if (room.status === 'playing') {
    room.status = 'abandoned';
    bumpVersion(room);
  }
  // оба ушли — комнату прибираем (финишированную держим, пока оба не выйдут)
  const other = seat === 0 ? room.guest : room.host;
  const otherGone = !other || other.leftAt !== null;
  return otherGone;
}

/** внутренняя логика отмены ждущей комнаты хостом */
function cancelInternal(room: MpRoom, playerId: string): boolean {
  const seat = seatOf(room, playerId);
  if (seat !== 0 || room.status !== 'waiting') throw 'notfound';
  return true;
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
 *  НО: если владелец хода пропал — таймер приостанавливается до
 *  OWNER_ABSENT_CAP_MS: телефон в кармане не должен проигрывать партию
 *  за игрока. Дольше 90с отсутствия — автопасс как раньше.
 *  ПЛЮС ГРАЙС ДЛЯ ХОДА «В ПОЛЁТЕ»: если дедлайн только-только истёк, а
 *  владелец на связи (пусть и не опрашивает — сокет жив), мы пару секунд
 *  ждём его настоящий ход, а не играем просрочку ему в спину. Это убирает
 *  гонку «тапнул в 2:59.9 → сервер тикнул автопасс в 3:00.0 → ход отклонён»:
 *  ход, отправленный до истечения, успевает примениться. */
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
    if (!explicitLeft) {
      // грайс: дедлайн истёк только что, а владелец здесь (опросом или живым
      // сокетом) — его ход, вероятно, уже летит к нам. Секунды не решают игру,
      // а гонку с автопассом решают. Дедлайн ОСТАЁТСЯ просроченным — следующий
      // тик (через ~1с) перепроверит; после грайса автопасс как обычно.
      const expiredBy = Date.now() - (room.turnDeadline ?? 0);
      const grace = inFlightGraceMs();
      const live = absent <= CONNECTED_MS || ownerSocketAlive(room, owner);
      if (live && expiredBy < grace) break;
    }
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

/** применить ход (валидация на движке) */
export function applyAction(room: MpRoom, seat: 0 | 1, action: NetAction): void {
  // ПРИСУТСТВИЕ ДО ТИКА: игрок, приславший ход, явно «здесь». Сначала
  // отмечаем его (и снимаем заморозку, если она была для него), и только
  // потом играем просрочки — иначе тик мог автопасснуть ход в лицо только
  // что вернувшемуся/активному игроку, и его ход получил бы «notyourturn»
  // (та самая гонка «ход не принят — попробуйте ещё раз»).
  touch(room, seat);
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

/** Отметить «на связи». Если вернулся владелец хода с замороженным
 *  таймером — выдать ему гарантированные RESUME_GRANT_MS. */
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
    turnPaused: room.status === 'playing' && room.frozen,
    serverNow: now,
    state: room.state ? rotatedState(room.state, seat, room) : null,
    events: viewEvents,
    eventsVersion: events ? room.version : -1,
    timedOutSeat: room.timedOutSeat === null ? null : seat === 1 ? swap(room.timedOutSeat) : room.timedOutSeat,
    timedOutVersion: room.timedOutVersion,
  };
}

// ===== публичный API комнат (async; вызывается обработчиком WS) =====
// В KV-режиме каждое изменение = CAS-запись: комнаты переживают
// перезапуск, одновременные ходы не теряются. Без KV — та же логика
// в оперативной памяти (bun-тесты, локальный запуск без KV).

/** создать комнату (приватную по коду или открытую для поиска) */
export async function createRoomA(input: { name: unknown; avatar: unknown; isPublic: unknown }): Promise<{
  code: string;
  playerId: string;
}> {
  const name = cleanName(input.name);
  if (name.length < 1) throw 'badname';
  for (let i = 0; i < 6; i++) {
    const code = genCode();
    if (!kv && rooms.has(code)) continue;
    const room = newRoom(code, { id: genId(), name, avatar: cleanAvatar(input.avatar), lastPoll: Date.now(), leftAt: null }, input.isPublic === true);
    // CAS «ключа ещё нет»: коллизия кодов невозможна даже между изолятами
    if (await saveRoom(room, null)) return { code: room.code, playerId: room.host.id };
  }
  throw 'conflict';
}

/** войти в комнату по коду (партия стартуется сразу) */
export async function joinRoomA(input: { code: unknown; name: unknown; avatar: unknown; playerId?: unknown }): Promise<{
  code: string;
  playerId: string;
  room: MpRoom;
}> {
  const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
  const name = cleanName(input.name);
  if (name.length < 1) throw 'badname';
  if (!/^[A-Z2-9]{6}$/.test(code)) throw 'notfound';
  const out = await mutateRoom(code, (room) => {
    revive(room);
    return { result: joinInternal(room, { name, avatar: cleanAvatar(input.avatar), playerId: input.playerId }) };
  });
  return { code, playerId: out.result, room: out.room };
}

/** текущий вид комнаты для игрока (touch присутствия) */
export async function roomStateA(code: string, playerId: string): Promise<{ view: MpRoomView; room: MpRoom }> {
  const out = await mutateRoom(code.trim().toUpperCase(), (room) => {
    revive(room);
    return { result: viewFor(room, playerId) };
  });
  return { view: out.result, room: out.room };
}

/** ход игрока (advance | buy | leather) */
export async function roomMoveA(code: string, playerId: string, action: NetAction): Promise<{ view: MpRoomView; room: MpRoom }> {
  const out = await mutateRoom(code.trim().toUpperCase(), (room) => {
    revive(room);
    const seat = seatOf(room, playerId);
    if (seat === null) throw 'notfound';
    applyAction(room, seat, action);
    return { result: viewFor(room, playerId) };
  });
  return { view: out.result, room: out.room };
}

/** управление комнатой: leave | cancel | rematch */
export async function roomControlA(
  code: string,
  playerId: string,
  op: 'leave' | 'cancel' | 'rematch',
): Promise<{ started?: boolean; delete: boolean; room: MpRoom | null }> {
  const key = code.trim().toUpperCase();
  if (op === 'rematch') {
    const out = await mutateRoom(key, (room) => {
      revive(room);
      return { result: rematchInternal(room, playerId) };
    });
    return { started: out.result, delete: false, room: out.room };
  }
  if (op === 'leave' || op === 'cancel') {
    for (let attempt = 0; attempt < 5; attempt++) {
      const entry = await loadRoomEntry(key);
      if (!entry) throw 'notfound';
      const del = op === 'leave' ? leaveInternal(entry.room, playerId) : cancelInternal(entry.room, playerId);
      if (del) {
        if (await deleteRoom(key, entry.versionstamp)) return { delete: true, room: null };
        continue; // конфликт — перечитать и решить заново
      }
      if (await saveRoom(entry.room, entry.versionstamp)) return { delete: false, room: entry.room };
    }
    throw 'conflict';
  }
  throw 'badpayload';
}

/** Список ОТКРЫТЫХ комнат (только живые: хост был активен < 20с назад).
 *  Лобби — «косметика»: читаем из реплики KV (быстро и дёшево). */
export async function listRoomsA(): Promise<Array<{ code: string; hostName: string; hostAvatar: string; createdAt: number }>> {
  const now = Date.now();
  const out: Array<{ code: string; hostName: string; hostAvatar: string; createdAt: number }> = [];
  for (const { room: r } of await allRooms(false)) {
    if (r.isPublic && r.status === 'waiting' && r.guest === null && r.host.leftAt === null && now - r.host.lastPoll <= LIST_ALIVE_MS) {
      out.push({ code: r.code, hostName: r.host.name, hostAvatar: r.host.avatar, createdAt: r.createdAt });
    }
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out.slice(0, 30);
}

/** найти комнату игрока (для прикрепления сокета после quick) */
export async function findRoomOfPlayerA(pid: string): Promise<string | null> {
  for (const { room } of await allRooms(true)) {
    if (seatOf(room, pid) !== null) return room.code;
  }
  return null;
}

// ===== быстрый матч (автопоиск) =====

/** комната a «старше» b — занять можно только СТАРШУЮ чужую комнату:
 *  направление подбора детерминировано, два искателя не займут комнаты
 *  друг друга одновременно (старший ждёт, младший заходит) */
function isSenior(a: MpRoom, b: MpRoom): boolean {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt;
  return a.code < b.code;
}

/** найти мою комнату автопоиска по playerId хоста */
async function findQuickByHostA(pid: string): Promise<{ room: MpRoom; versionstamp: string | null } | null> {
  for (const { room, versionstamp } of await allRooms(true)) {
    if (
      room.host.id === pid &&
      room.quickHost === true &&
      (room.status === 'waiting' || room.status === 'playing')
    ) {
      return { room, versionstamp };
    }
  }
  return null;
}

/** прибрать свою ждущую комнату, когда пара уже составилась в другой */
async function removeMyWaitingRoomA(code: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const entry = await loadRoomEntry(code);
    if (!entry) return;
    const mine = entry.room;
    if (mine.status === 'waiting' && mine.guest === null) {
      if (await deleteRoom(code, entry.versionstamp)) return;
      continue; // конфликт — перечитать
    }
    // удалить не вышло: комнату успели занять — честно помечаем «хост ушёл»
    if (mine.status === 'playing' && mine.host.leftAt === null) {
      mine.host.leftAt = Date.now();
      mine.status = 'abandoned';
      bumpVersion(mine);
      if (await saveRoom(mine, entry.versionstamp)) {
        notifyChan(code);
        return;
      }
      continue;
    }
    return;
  }
}

/**
 * Заявка на быстрый матч. Порядок подбора:
 *  1) в мою ждущую комнату уже вошли → «matched» (я — хост);
 *  2) живая открытая комната СТАРШЕ моей (или моей нет) → вхожу гостем;
 *     если свою комнату держал — прибираю её;
 *  3) никого → создаю свою публичную ждущую комнату и жду.
 * В KV-режиме рассадка и уборка — CAS-операции: два искателя из
 * разных изолятов не займут одну комнату дважды.
 */
export async function quickMatchA(input: { playerId?: unknown; name: unknown; avatar: unknown }): Promise<{
  status: 'matched' | 'waiting';
  code?: string;
  playerId: string;
  room: MpRoom | null;
}> {
  const name = cleanName(input.name);
  if (name.length < 1) throw 'badname';
  const pid = typeof input.playerId === 'string' && input.playerId.length > 8 ? input.playerId : genId();
  const avatar = cleanAvatar(input.avatar);

  // 1) моя комната автопоиска: обновляем присутствие (не каждый вызов —
  //    записи в KV стоят квоты), проверяем пару
  const mineEntry = await findQuickByHostA(pid);
  if (mineEntry) {
    const out = await mutateRoom(mineEntry.room.code, (mine) => {
      revive(mine);
      const stalePresence = Date.now() - mine.host.lastPoll > QUICK_TOUCH_MS;
      if (stalePresence) touch(mine, 0); // комната остаётся «живой» в поиске
      return { result: mine.guest !== null, skipSave: !stalePresence };
    });
    if (out.result) return { status: 'matched', code: mineEntry.room.code, playerId: pid, room: out.room };
  }

  // 2) живые открытые комнаты (гостя нет, хост на связи)
  const now = Date.now();
  const mine = mineEntry?.room ?? null;
  const candidates: MpRoom[] = [];
  for (const { room: r } of await allRooms(true)) {
    if (
      r.isPublic &&
      r.status === 'waiting' &&
      r.guest === null &&
      r.host.leftAt === null &&
      r.host.id !== pid &&
      now - r.host.lastPoll <= LIST_ALIVE_MS &&
      (!mine || !r.quickHost || isSenior(r, mine))
    ) {
      candidates.push(r);
    }
  }
  candidates.sort((a, b) => (isSenior(a, b) ? -1 : isSenior(b, a) ? 1 : 0));

  for (const cand of candidates) {
    try {
      const out = await mutateRoom(cand.code, (room) => {
        // повторная валидация на СВЕЖЕМ состоянии: между сканом и записью
        // комнату мог занять другой искатель
        if (
          !room.isPublic ||
          room.status !== 'waiting' ||
          room.guest !== null ||
          room.host.leftAt !== null ||
          room.host.id === pid
        ) {
          return { result: false, skipSave: true };
        }
        seatGuest(room, pid, name, avatar);
        return { result: true };
      });
      if (out.result !== true) continue;
      if (mine && mine.code !== cand.code) await removeMyWaitingRoomA(mine.code);
      return { status: 'matched', code: cand.code, playerId: pid, room: out.room };
    } catch {
      continue; // комнату удалили / конфликт — пробуем следующую
    }
  }

  // 3) никого — создаю свою публичную ждущую комнату автопоиска
  if (!mineEntry) {
    for (let i = 0; i < 3; i++) {
      const code = genCode();
      if (!kv && rooms.has(code)) continue;
      const room = newRoom(code, { id: pid, name, avatar, lastPoll: Date.now(), leftAt: null }, true, true);
      if (await saveRoom(room, null)) break;
    }
  }
  return { status: 'waiting', playerId: pid, room: null };
}

/** Отменить автопоиск (удалить свою ждущую комнату автопоиска) */
export async function quickCancelA(playerId: unknown): Promise<void> {
  if (typeof playerId !== 'string' || !playerId) return;
  const mine = await findQuickByHostA(playerId);
  if (!mine) return;
  if (mine.room.status === 'waiting' && mine.room.guest === null) {
    if (await deleteRoom(mine.room.code, mine.versionstamp)) {
      notifyChan(mine.room.code, true);
    }
  }
}

/** чистка протухших комнат — режим памяти (вызывается дворником) */
function sweepStaleRooms(): string[] {
  const now = Date.now();
  const removed: string[] = [];
  for (const room of rooms.values()) {
    const age = now - Math.max(room.updatedAt, room.host.lastPoll, room.guest?.lastPoll ?? 0);
    if (room.status === 'waiting' && now - Math.max(room.host.lastPoll, room.createdAt) > WAITING_HOST_TTL_MS) {
      removed.push(room.code);
      rooms.delete(room.code);
    } else if (room.status !== 'waiting' && age > ROOM_TTL_MS) {
      removed.push(room.code);
      rooms.delete(room.code);
    }
  }
  return removed;
}

/** тесты: полный сброс состояния */
export function __resetForTests(): void {
  rooms.clear();
  sockets.clear();
  lastRoomsPush = 0;
  kvStats = { waiting: 0, playing: 0 };
  sweepCount = 0;
}

// ============================================================
// 7. WEBSOCKET-ТРАНСПОРТ (ядро не зависит от Deno/bun — поэтому
//    тестируется локально в bun с тем же протоколом)
// ============================================================

const PING_EVERY_MS = 3_000; // сервер пингует каждые 3с
const DEAD_AFTER_MS = 10_000; // нет pong 10с — сокет «мёртв»
const ROOMS_PUSH_MS = 3_000; // список открытых комнат — push лобби
const SWEEP_MS = 1_000; // дворник: просрочки, TTL, пинги

/** Контекст сокета — обёртка над транспортным соединением */
export interface SocketCtx {
  readonly id: number;
  send(obj: unknown): void;
  close(): void;
  /** комната, к которой сокет прикреплён (для мгновенных push) */
  code: string | null;
  playerId: string | null;
  /** время последнего сообщения от клиента (любого, вкл. pong) */
  lastSeen: number;
  /** время последнего отправленного пинга */
  lastPing: number;
  pingId: number;
  alive: boolean;
}

let socketSeq = 1;
const sockets = new Map<number, SocketCtx>();
let lastRoomsPush = 0;
let sweeperTimer: ReturnType<typeof setInterval> | null = null;
const startedAt = Date.now();

/** зарегистрировать новое соединение (вызывает транспорт при open) */
export function registerSocket(io: { send(obj: unknown): void; close(): void }): SocketCtx {
  const ctx: SocketCtx = {
    id: socketSeq++,
    send: io.send,
    close: io.close,
    code: null,
    playerId: null,
    lastSeen: Date.now(),
    lastPing: 0,
    pingId: 0,
    alive: true,
  };
  sockets.set(ctx.id, ctx);
  return ctx;
}

export function handleSocketOpen(ctx: SocketCtx): void {
  ctx.lastSeen = Date.now();
}

/** все живые сокеты конкретного игрока комнаты */
function socketsOf(room: MpRoom, playerId: string): SocketCtx[] {
  const out: SocketCtx[] = [];
  for (const s of sockets.values()) {
    if (s.alive && s.code === room.code && s.playerId === playerId) out.push(s);
  }
  return out;
}

function attach(ctx: SocketCtx, code: string, playerId: string): void {
  ctx.code = code;
  ctx.playerId = playerId;
}

function detach(ctx: SocketCtx): void {
  ctx.code = null;
  ctx.playerId = null;
}

/** мгновенно разослать обоим игрокам актуальный вид комнаты
 *  (каждому — свой поворот: зритель всегда на месте 0) */
function broadcastRoom(room: MpRoom): void {
  const ids: string[] = [];
  if (socketsOf(room, room.host.id).length > 0) ids.push(room.host.id);
  if (room.guest && socketsOf(room, room.guest.id).length > 0) ids.push(room.guest.id);
  for (const pid of ids) {
    let view: MpRoomView;
    try {
      view = viewFor(room, pid);
    } catch {
      continue; // игрок уже не в комнате
    }
    for (const s of socketsOf(room, pid)) {
      try {
        s.send({ t: 'view', view });
      } catch { /* сокет умер — уберёт дворник */ }
    }
  }
}

/** разослать список открытых комнат сокетам лобби (не в комнате) */
async function pushRoomsA(): Promise<void> {
  let list: Array<{ code: string; hostName: string; hostAvatar: string; createdAt: number }>;
  try {
    list = await listRoomsA();
  } catch {
    return; // сбой хранилища — молча пропускаем цикл
  }
  for (const s of sockets.values()) {
    if (!s.alive || s.code !== null) continue;
    try {
      s.send({ t: 'rooms', rooms: list });
    } catch { /* ignore */ }
  }
  lastRoomsPush = Date.now();
}

/** игрок потерял соединение: сразу пометить «не на связи» (не удаляя
 *  комнату и прогресс) и оповестить соперника. Таймер хода при этом
 *  замораживается (см. tick): 15с переподключения партию не проигрывают. */
async function markDisconnectedA(code: string, playerId: string): Promise<void> {
  // есть другой живой сокет этого игрока (вторая вкладка) — не трогаем
  for (const s of sockets.values()) {
    if (s.alive && s.code === code && s.playerId === playerId) return;
  }
  try {
    const out = await mutateRoom(code, (room) => {
      const seat = seatOf(room, playerId);
      if (seat === null) return { result: false, skipSave: true };
      const p = seat === 0 ? room.host : room.guest;
      if (p && p.leftAt === null) {
        // искусственно «протухляем» присутствие: connected=false сразу,
        // а для таймера хода это зона заморозки (12–90с отсутствия)
        const now = Date.now();
        p.lastPoll = Math.min(p.lastPoll, now - CONNECTED_MS - 1);
        return { result: true };
      }
      return { result: false, skipSave: true };
    });
    if (out.result) {
      broadcastRoom(out.room);
      notifyChan(code);
    }
  } catch {
    // комнаты уже нет — не критично
  }
}

export function handleSocketClose(ctx: SocketCtx): void {
  ctx.alive = false;
  sockets.delete(ctx.id);
  const { code, playerId } = ctx;
  ctx.code = null;
  ctx.playerId = null;
  if (!code || !playerId) return;
  void markDisconnectedA(code, playerId);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** обработать сообщение клиента (JSON-строка); асинхронно — ходы
 *  пишутся в KV (CAS). Ошибки превращаются в {ok:false,error}. */
export async function handleSocketMessage(ctx: SocketCtx, raw: string): Promise<void> {
  ctx.lastSeen = Date.now();
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw) as Record<string, unknown>;
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw new Error('bad');
  } catch {
    respond(ctx, null, { ok: false, error: 'badpayload' });
    return;
  }
  const ref = typeof msg.ref === 'number' || typeof msg.ref === 'string' ? msg.ref : null;
  const t = typeof msg.t === 'string' ? msg.t : '';
  try {
    switch (t) {
      case 'pong':
        return; // присутствие отмечено (lastSeen)

      case 'create': {
        const res = await createRoomA({ name: msg.name, avatar: msg.avatar, isPublic: msg.isPublic });
        attach(ctx, res.code, res.playerId);
        respond(ctx, ref, { ok: true, code: res.code, playerId: res.playerId });
        void pushRoomsA();
        return;
      }

      case 'join': {
        const res = await joinRoomA({ code: msg.code, name: msg.name, avatar: msg.avatar, playerId: msg.playerId });
        attach(ctx, res.code, res.playerId);
        respond(ctx, ref, { ok: true, code: res.code, playerId: res.playerId });
        broadcastRoom(res.room); // хост мгновенно видит старт партии
        notifyChan(res.code); // и его изолят тоже (если сокет хоста там)
        void pushRoomsA();
        return;
      }

      case 'state': {
        // запрос состояния = точка переподключения: сервер прикрепляет
        // сокет и с этого момента пушит все изменения мгновенно
        const { view, room } = await roomStateA(str(msg.code), str(msg.playerId));
        attach(ctx, view.code, str(msg.playerId));
        respond(ctx, ref, { ok: true, view });
        if (room.status !== 'waiting') {
          broadcastRoom(room); // соперник сразу видит «снова на связи»
          notifyChan(room.code);
        }
        return;
      }

      case 'move': {
        const { view, room } = await roomMoveA(str(msg.code), str(msg.playerId), msg.action as NetAction);
        respond(ctx, ref, { ok: true, view });
        broadcastRoom(room); // мгновенная доставка хода сопернику
        notifyChan(room.code);
        return;
      }

      case 'control': {
        const code = str(msg.code);
        const key = code.trim().toUpperCase();
        const playerId = str(msg.playerId);
        const op = str(msg.op);
        if (op !== 'leave' && op !== 'cancel' && op !== 'rematch') throw 'badpayload';
        const res = await roomControlA(code, playerId, op);
        const payload: Record<string, unknown> = { ok: true };
        if (res.started !== undefined) payload.started = res.started;
        respond(ctx, ref, payload);
        if (res.room) {
          broadcastRoom(res.room); // оба получают актуальный статус (abandoned/новая партия)
          notifyChan(key);
        } else if (res.delete) {
          notifyChan(key, true); // соседние изоляты открепят сокеты комнаты
        }
        if (res.delete) {
          // комнату удалили — открепляем все её сокеты (возврат в лобби)
          for (const s of [...sockets.values()]) {
            if (s.code === key) detach(s);
          }
        } else if (op === 'leave') {
          // ушедший игрок открепляется, комната живёт для оставшегося
          for (const s of [...sockets.values()]) {
            if (s.code === key && s.playerId === playerId) detach(s);
          }
        }
        void pushRoomsA();
        return;
      }

      case 'quick': {
        const res = await quickMatchA({ playerId: msg.playerId, name: msg.name, avatar: msg.avatar });
        if (res.status === 'matched' && res.code) {
          attach(ctx, res.code, res.playerId);
          respond(ctx, ref, { ok: true, status: 'matched', code: res.code, playerId: res.playerId });
          if (res.room) {
            broadcastRoom(res.room); // хост мгновенно узнаёт о сопернике
            notifyChan(res.code);
          }
          void pushRoomsA();
        } else {
          // ждём пару: прикрепим сокет к своей комнате — если в неё войдут,
          // push придёт мгновенно (не дожидаясь следующего цикла опроса)
          const mine = await findRoomOfPlayerA(res.playerId);
          if (mine) attach(ctx, mine, res.playerId);
          respond(ctx, ref, { ok: true, status: 'waiting', playerId: res.playerId });
          void pushRoomsA();
        }
        return;
      }

      case 'quick_cancel': {
        await quickCancelA(msg.playerId);
        respond(ctx, ref, { ok: true });
        void pushRoomsA();
        return;
      }

      case 'rooms': {
        respond(ctx, ref, { ok: true, rooms: await listRoomsA() });
        return;
      }

      case 'ping': {
        respond(ctx, ref, { ok: true, pong: true, now: Date.now() });
        return;
      }

      default:
        respond(ctx, null, { ok: false, error: 'badpayload' });
    }
  } catch (e) {
    const err = typeof e === 'string' ? e : 'illegal';
    respond(ctx, ref, { ok: false, error: err });
  }
}

function respond(ctx: SocketCtx, ref: unknown, payload: Record<string, unknown>): void {
  try {
    ctx.send({ ref, ...payload });
  } catch { /* ignore */ }
}

/** Дворник: пинги/мёртвые сокеты, просрочки ходов, TTL комнат, push лобби.
 *  В KV-режиме полный проход по комнатам — раз в SWEEP_ROOMS_EVERY тиков. */
let sweepCount = 0;
let kvStats = { waiting: 0, playing: 0 };

export function startSweeper(): void {
  if (sweeperTimer !== null) return;
  sweeperTimer = setInterval(() => {
    void sweepTick().catch(() => { /* сбой KV не должен ронять сервер */ });
  }, SWEEP_MS);
}

async function sweepTick(): Promise<void> {
  const now = Date.now();

  // 1) heartbeat: пингуем каждого; молчащий дольше 10с — закрываем
  for (const ctx of [...sockets.values()]) {
    if (!ctx.alive) {
      sockets.delete(ctx.id);
      continue;
    }
    if (now - ctx.lastPing >= PING_EVERY_MS) {
      ctx.lastPing = now;
      ctx.pingId++;
      try {
        ctx.send({ t: 'ping', id: ctx.pingId });
      } catch { /* ignore */ }
    }
    if (now - ctx.lastSeen > DEAD_AFTER_MS) {
      const { code, playerId } = ctx;
      try {
        ctx.close();
      } catch { /* ignore */ }
      ctx.alive = false;
      sockets.delete(ctx.id);
      ctx.code = null;
      ctx.playerId = null;
      if (code && playerId) void markDisconnectedA(code, playerId);
    }
  }

  // 2) комнаты
  sweepCount++;
  if (!kv) {
    // режим памяти: прежнее поведение — тик всех комнат каждую секунду
    for (const room of [...rooms.values()]) {
      const before = `${room.version}:${room.frozen}:${room.turnDeadline}`;
      // присутствие подключённых (живой сокет = игрок здесь, даже если
      // давно не слал state-запросов) — как в KV-проходе ниже: иначе в WS-режиме
      // «на связи» гасло через 12с и rival видел ложное «не на связи»,
      // а заморозка/автопасс решались по протухшему lastPoll
      let presence = false;
      for (const p of [room.host, room.guest]) {
        if (!p || p.leftAt !== null) continue;
        if (ownerSocketAlive(room, seatOf(room, p.id) ?? -1) && Date.now() - p.lastPoll > PRESENCE_SAVE_MS) {
          p.lastPoll = Date.now();
          presence = true;
        }
      }
      revive(room);
      tick(room);
      const after = `${room.version}:${room.frozen}:${room.turnDeadline}`;
      if (before !== after || presence) broadcastRoom(room);
    }
    const removed = sweepStaleRooms();
    if (removed.length > 0 || now - lastRoomsPush >= ROOMS_PUSH_MS) void pushRoomsA();
    return;
  }

  if (sweepCount % SWEEP_ROOMS_EVERY !== 0) {
    // лобби-пуш всё равно не реже ROOMS_PUSH_MS (дешёвое eventual-чтение)
    if (now - lastRoomsPush >= ROOMS_PUSH_MS) void pushRoomsA();
    return;
  }
  await sweepRoomsKv();
  if (now - lastRoomsPush >= ROOMS_PUSH_MS) void pushRoomsA();
}

/** KV-проход дворника: TTL-чистка всех комнат + тик «своих»
 *  (комнат, чьи игроки подключены к этому изоляту) */
async function sweepRoomsKv(): Promise<void> {
  if (!kv) return;
  const stale: Array<{ code: string; versionstamp: string }> = [];
  let waiting = 0;
  let playing = 0;
  for await (const e of kv.list({ prefix: ['room'] })) {
    if (!e.value) continue;
    const room = e.value as MpRoom;
    const now = Date.now();
    if (room.status === 'waiting') waiting++;
    else if (room.status === 'playing' || room.status === 'finished') playing++;

    // TTL: брошенные комнаты убираем (CAS — не снести живую)
    const age = now - Math.max(room.updatedAt, room.host.lastPoll, room.guest?.lastPoll ?? 0);
    if (
      (room.status === 'waiting' && now - Math.max(room.host.lastPoll, room.createdAt) > WAITING_HOST_TTL_MS) ||
      (room.status !== 'waiting' && age > ROOM_TTL_MS)
    ) {
      stale.push({ code: room.code, versionstamp: e.versionstamp });
      continue;
    }

    // тик — только комнатам с локальными сокетами (их игроков обслуживает
    // этот изолят; «чужие» тикает их изолят, полностью брошенные — revive)
    let hasLocal = false;
    for (const s of sockets.values()) {
      if (s.alive && s.code === room.code) {
        hasLocal = true;
        break;
      }
    }
    if (!hasLocal) continue;

    const before = dirtySig(room);
    revive(room);
    tick(room);
    // присутствие подключённых у нас игроков не даём протухнуть в KV
    let presence = false;
    for (const pid of [room.host.id, room.guest?.id]) {
      if (!pid) continue;
      const p = seatOf(room, pid) === 0 ? room.host : room.guest;
      if (!p) continue;
      let local = false;
      for (const s of sockets.values()) {
        if (s.alive && s.code === room.code && s.playerId === pid) local = true;
      }
      if (local && Date.now() - p.lastPoll > PRESENCE_SAVE_MS) {
        p.lastPoll = Date.now();
        presence = true;
      }
    }
    const changed = presence || dirtySig(room) !== before;
    if (!changed) continue;
    if (await saveRoom(room, e.versionstamp)) {
      broadcastRoom(room);
      notifyChan(room.code);
    }
    // CAS не прошёл — состояние успел изменить другой изолят: следующий
    // проход перечитает свежее
  }
  for (const s of stale) {
    try {
      const res = await kv.atomic().check({ key: ['room', s.code], versionstamp: s.versionstamp }).delete(['room', s.code]).commit();
      if (res.ok) notifyChan(s.code, true);
    } catch { /* ignore */ }
  }
  kvStats = { waiting, playing };
}

/** ТЕСТ-ХУК (в рантайме не используется; см. scripts/test-grace.ts):
 *  выставить дедлайн хода комнаты напрямую — гонять гонку «ход в полёте»
 *  без ожидания настоящих 3 минут. */
export function setTestTurnDeadline(code: string, ts: number): boolean {
  const room = rooms.get(code);
  if (!room) return false;
  room.turnDeadline = ts;
  return true;
}

/** ТЕСТ-ХУК: «протухить» присутствие игрока — как будто он давно не опрашивал. */
export function setTestLastPoll(code: string, playerId: string, ts: number): boolean {
  const room = rooms.get(code);
  if (!room) return false;
  if (room.host.id === playerId) room.host.lastPoll = ts;
  else if (room.guest?.id === playerId) room.guest!.lastPoll = ts;
  else return false;
  return true;
}

/** статистика для health-страницы */
export function serverStats(): { waiting: number; playing: number; sockets: number; uptimeSec: number; kv: boolean } {
  let waiting = 0;
  let playing = 0;
  if (kv) {
    waiting = kvStats.waiting;
    playing = kvStats.playing;
  } else {
    for (const r of rooms.values()) {
      if (r.status === 'waiting') waiting++;
      else if (r.status === 'playing' || r.status === 'finished') playing++;
    }
  }
  let live = 0;
  for (const s of sockets.values()) if (s.alive) live++;
  return { waiting, playing, sockets: live, uptimeSec: Math.floor((Date.now() - startedAt) / 1000), kv: kvOn };
}

// ============================================================
// 8. HTTP + ЗАПУСК DENO DEPLOY
// ============================================================

function healthHtml(): string {
  const st = serverStats();
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Лоскутки: сервер онлайн</title>
<style>
  body { font-family: system-ui, sans-serif; background: #2B2118; color: #EFE0BC;
         display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; }
  .card { background: #3A2E21; border-radius: 20px; padding: 40px 48px; text-align: center;
          box-shadow: 0 10px 40px rgba(0,0,0,.35); }
  h1 { font-size: 28px; margin: 0 0 8px; color: #FFD98A; }
  p { margin: 6px 0; color: #C9BCA4; font-size: 15px; }
  .ok { display: inline-block; margin-top: 14px; padding: 8px 18px; border-radius: 999px;
        background: #4C7A3F; color: #fff; font-weight: 700; font-size: 14px; }
</style>
</head>
<body>
  <div class="card">
    <h1>🧵 Лоскутки: сервер онлайн</h1>
    <p>WebSocket-сервер мультиплеера работает.</p>
    <p>Комнат в ожидании: ${st.waiting} · идёт партий: ${st.playing}</p>
    <p>Игроков на связи: ${st.sockets} · без перезапуска: ${st.uptimeSec} с</p>
    <p>Хранение: ${st.kv ? 'Deno KV — комнаты переживают перезапуск' : 'память (перезапуск очистит комнаты)'}</p>
    <span class="ok">Готов к игре</span>
  </div>
</body>
</html>`;
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
}

// Запуск транспорта. import.meta.main = true, когда файл выполнен как
// точка входа (Deno Deploy Playground / deno run server.ts). При импорте
// в тестах (bun) сервер не поднимается — доступно только ядро.
if (import.meta.main) {
  interface DenoWsSocket {
    send(d: string | Uint8Array): void;
    close(): void;
    onopen: (() => void) | null;
    onmessage: ((ev: { data: unknown }) => void) | null;
    onclose: (() => void) | null;
    onerror: (() => void) | null;
  }
  interface DenoApi {
    env?: { get(k: string): string | undefined };
    serve(opts: unknown, handler: (req: Request) => Response): void;
    upgradeWebSocket(req: Request): { socket: DenoWsSocket; response: unknown };
    openKv?: (path?: string) => unknown;
  }
  const D = (globalThis as { Deno?: DenoApi }).Deno;
  if (!D) {
    throw new Error('Этот файл запускается под Deno: deno run server.ts или вставь в Deno Deploy Playground');
  }
  const port = Number(D.env?.get('PORT') ?? 8000);

  // Deno KV: комнаты переживают перезапуск и новый деплой. На Deploy
  // доступен всегда (путь игнорируется платформой); локально требует
  // флага --unstable-kv, иначе — режим памяти. Ошибка открытия НЕ
  // роняет сервер.
  let kvLike: KvLike | null = null;
  try {
    // путь на Deploy игнорируется платформой, локально — файл рядом;
    // openKv асинхронен (возвращает промис) — ждём его
    const raw = D.openKv ? D.openKv('loskutki-kv') : null;
    const resolved = raw && typeof (raw as PromiseLike<unknown>).then === 'function' ? await raw : raw;
    kvLike = (resolved ?? null) as KvLike | null;
  } catch {
    kvLike = null;
  }
  // BroadcastChannel: мгновенные push между изолятами Deno Deploy
  // (игроки в разных регионах). Локально может отсутствовать — не критично.
  let chanLike: ChanLike | null = null;
  try {
    const BC = (globalThis as unknown as { BroadcastChannel?: new (name: string) => ChanLike }).BroadcastChannel;
    chanLike = BC ? new BC('loskutki-rooms-v1') : null;
  } catch {
    chanLike = null;
  }
  initPersistence(kvLike, chanLike);
  console.log(
    `[Лоскутки] KV: ${kvLike ? 'включён — комнаты переживают перезапуск' : 'выключен — режим памяти'}` +
      ` · канал изолятов: ${chanLike ? 'включён' : 'выключен'}`,
  );

  D.serve({ port }, (req: Request): Response => {
    // WebSocket-соединение (любой путь)
    const upgrade = req.headers.get('upgrade')?.toLowerCase() ?? '';
    if (upgrade.includes('websocket')) {
      const { socket, response } = D.upgradeWebSocket(req);
      const ctx = registerSocket({
        send: (obj) => socket.send(JSON.stringify(obj)),
        close: () => {
          try {
            socket.close();
          } catch { /* ignore */ }
        },
      });
      socket.onopen = () => handleSocketOpen(ctx);
      socket.onmessage = (ev) => {
        void handleSocketMessage(ctx, String(ev.data)).catch(() => { /* ошибки обработаны внутри */ });
      };
      socket.onclose = () => handleSocketClose(ctx);
      socket.onerror = () => { /* следом вызовется onclose */ };
      return response as Response;
    }
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(healthHtml(), {
        headers: { 'content-type': 'text/html; charset=utf-8', ...corsHeaders() },
      });
    }
    return new Response('Not Found', { status: 404, headers: corsHeaders() });
  });
  startSweeper();
  console.log(`[Лоскутки] WebSocket-сервер запущен (порт ${port}). Health: GET /`);
}
