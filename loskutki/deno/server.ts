/**
 * «ЛОСКУТКИ» — WebSocket-сервер мультиплеера (v3.5.0).
 * ============================================================
 *
 * v3.5.0 — ХРАНИЛИЩЕ БЕЗ DENO KV: Cloudflare D1 (бесплатно, без карты):
 *   — если KV-база Deno Deploy занята (бесплатный план даёт всего
 *     ОДНУ базу на аккаунт), сервер теперь умеет хранить комнаты,
 *     друзей, переписку и ID игроков в БЕСПЛАТНОЙ базе Cloudflare D1;
 *   — включается ТРЕМЯ переменными окружения (инструкция ниже),
 *     данные переживают перезапуск и новый деплой точно так же;
 *   — приоритет хранилища: Cloudflare D1 (если заданы D1_*) →
 *     Deno KV (если база подключена) → оперативная память;
 *   — CAS-семантика сохранена полностью: одновременные ходы из
 *     разных изолятов не теряются (WHERE ver = N вместо versionstamp);
 *   — для внешнего REST-хранилища растянуты интервалы «присутствия»
 *     (записей меньше, индикаторы «на связи» не пострадали);
 *   — индикатор «на связи» учитывает живые сокеты, а не только
 *     свежесть записи в базе.
 *
 * v3.4.0 — ЧАТ ПАРТИИ + ЗАЩИТА «САМ К СЕБЕ» + hostUid В ЛОББИ:
 *   — новая команда 'chat' {code, playerId, text}: переписка с соперником
 *     прямо в партии (без дружбы; живёт, пока жива комната, до 60
 *     сообщений); вид комнаты теперь содержит chat[] с флагом «моё»;
 *   — create/join пробрасывают uid игрока (добавление в друзья из матча
 *     теперь работает: foe.uid больше не null);
 *   — join в СОБСТВЕННУЮ комнату по uid отклоняется ('ownroom') — баг
 *     «создал комнату после обновления страницы и попал сам к себе»;
 *   — список открытых комнат содержит hostUid (клиент прячет свою);
 *   — hello/fr_sync отвечают persist (подключена ли база Deno KV):
 *     без базы игра честно предупреждает в разделе «Друзья»;
 *   — health-страница без базы показывает красное предупреждение.
 *
 * v3.3.1 — ПОЧИНЕН ДЕПЛОЙ на console.deno.com: раньше этапы сборки
 * «Warm up» и «Register crons» падали, потому что HTTP-сервер
 * поднимался только при import.meta.main — а платформа выполняет
 * входную точку через свою обёртку (main=false). Теперь сервер
 * поднимается под ЛЮБЫМ Deno всегда (кроме bun-тестов), а реджект
 * openKv без подключённой базы больше не убивает изолят.
 *
 * КАК РАЗВЕРНУТЬ на НОВОЙ консоли (console.deno.com, бесплатно):
 *   1. Открой https://console.deno.com → своя организация → Applications
 *      → «New Playground» (весь сайт игры живёт на Vercel, здесь нужен
 *      только этот один файл)
 *   2. Удали содержимое main.ts и вставь ВЕСЬ этот файл целиком
 *   3. ЧТОБЫ КОМНАТЫ, ДРУЗЬЯ И ЧАТЫ ПЕРЕЖИВАЛИ ПЕРЕЗАПУСК — подключи
 *      бесплатную базу (деплой проходит и без неё, но данные будут
 *      сбрасываться при простое). ДВА варианта на выбор:
 *
 *      ВАРИАНТ А — Cloudflare D1 (бесплатно, БЕЗ карты; для случая,
 *      когда единственная KV-база Deno уже занята другим проектом):
 *        а) https://dash.cloudflare.com → Sign up (нужен только e-mail)
 *        б) Storage & Databases → D1 SQL Database → Create database →
 *           имя loskutki → регион Western Europe → Create
 *        в) вкладка Console → вставь и Run:
 *             create table if not exists loskutki_kv (
 *               k text primary key,
 *               v text not null,
 *               ver integer not null
 *             );
 *        г) на странице базы скопируй Database ID (UUID); на главной
 *           панели Cloudflare (справа) — Account ID
 *        д) My Profile → API Tokens → Create Token → Custom token →
 *           Permissions: Account | D1 | Edit → Continue → Create →
 *           скопируй токен (показывается один раз)
 *        е) в Playground: Settings → Environment Variables → добавь три:
 *             D1_ACCOUNT_ID  = <Account ID>
 *             D1_DATABASE_ID = <Database ID>
 *             D1_API_TOKEN   = <токен>
 *        ж) Deploy → в логах: «Хранилище: Cloudflare D1»
 *
 *      ВАРИАНТ Б — Deno KV (если база свободна): Settings приложения →
 *        Databases → Attach Database → Provision Database (Deno KV).
 *
 *   4. Адрес из шапки редактора (https://<имя>...) впиши в игре:
 *      Настройки → «Сервер онлайн-игры» → Сохранить. Либо задай
 *      переменную NEXT_PUBLIC_WS_URL = https://<имя>... на Vercel.
 *   5. Проверка: открой адрес сервера в браузере — увидишь страницу
 *      «Лоскутки: сервер онлайн» (строка «Хранение» покажет, подключена
 *      ли база и какая именно).
 *   6. Запасной хостинг (если Deno Deploy недоступен): этот же файл
 *      работает в Docker — в архиве игры есть Dockerfile.server и
 *      render.yaml (Render.com, бесплатный план; подойдёт и Koyeb).
 *
 * ЧТО ВНУТРИ:
 *   — Deno.serve() поднимается МОМЕНТАЛЬНО (требование новой платформы:
 *     этап «Warm up» ждёт HTTP-сервер), хранилище подключается следом
 *     и не может заблокировать запуск;
 *   — приоритет хранилища: Cloudflare D1 (D1_* в окружении) → Deno KV
 *     → оперативная память; комнаты ПЕРЕЖИВАЮТ перезапуск и новый
 *     деплой (игрок, вернувшись по коду комнаты, застаёт партию
 *     на месте); в bun-тестах и без базы — режим оперативной памяти;
 *   — валидация ходов на сервере (чередование, деньги, свободные клетки);
 *   — запись ходов по CAS (versionstamp в KV / WHERE ver = N в D1):
 *     одновременные ходы из разных изолятов не теряются и не
 *     перетирают друг друга;
 *   — мгновенная рассылка состояния обоим игрокам после каждого события
 *     (между изолятами — через BroadcastChannel);
 *   — ping-pong: сервер пингует каждые 3с, «мёртвый» сокет закрывается
 *     через 10с молчания (комната и прогресс при этом СОХРАНЯЮТСЯ);
 *   — переподключение: клиент шлёт state с кодом комнаты и playerId
 *     (сессия в localStorage) — сервер высылает ПОЛНОЕ состояние;
 *   — быстрый матч (quick match): два искателя сводятся в одну комнату;
 *   — друзья: заявки по ID, чат, приглашения (хранение в D1/KV);
 *   — авто-просрочка ходов (3 минуты) с паузой, если владелец не на связи;
 *   — GET / — страница «сервер онлайн» + CORS для браузера.
 *
 * Протокол (JSON по WebSocket):
 *   клиент → сервер: {ref, t:'create'|'join'|'state'|'move'|'control'|
 *     'chat'|'quick'|'quick_cancel'|'rooms'|'ping'|'hello'|'fr_sync'|
 *     'fr_add'|'fr_accept'|'fr_decline'|'fr_remove'|'fr_msg'|'fr_read'|
 *     'fr_chat'|'fr_invite'|'fr_invite_accept'|'fr_invite_decline', ...}
 *     и {t:'pong', id}
 *   сервер → клиент: {ref, ok:true|false, ...} — ответ на запрос,
 *     {t:'view', view} — мгновенный push состояния комнаты,
 *     {t:'rooms', rooms} — push списка открытых комнат лобби,
 *     {t:'fr_*', ...} — события друзей (заявка/сообщение/приглашение),
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

/** сообщение чата партии в «повёрнутом» виде (mine — писал ли его я) */
interface RoomChatView {
  id: string;
  name: string;
  text: string;
  at: number;
  mine: boolean;
}

interface MpRoomView {
  code: string;
  status: 'waiting' | 'playing' | 'finished' | 'abandoned';
  isPublic: boolean;
  mySeat: 0 | 1;
  me: { name: string; avatar: string; connected: boolean };
  /** чат партии (моё/чужое уже посчитано под зрителя) */
  chat: RoomChatView[];
  foe: { name: string; avatar: string; connected: boolean; left: boolean; uid: string | null } | null;
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
  /** постоянный ID игрока (код друга) — для «добавить в друзья» в матче */
  uid: string | null;
}

/** сообщение чата партии (живёт, пока жива комната) */
interface RoomChatMsg {
  id: string;
  /** место отправителя: 0 = хост, 1 = гость */
  seat: 0 | 1;
  name: string;
  text: string;
  at: number;
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
  /** чат партии (до ROOM_CHAT_CAP сообщений) */
  chat: RoomChatMsg[];
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

/** есть ли у игрока (по uid) живой сокет в ЭТОМ изоляте — индикатор
 *  «в сети» в списке друзей: сокет надёжнее свежести записи в базе
 *  (внешнее хранилище обновляется реже — см. effFrOnlineMs) */
function uidOnLiveSocket(uid: string): boolean {
  for (const s of sockets.values()) {
    if (s.alive && s.uid === uid) return true;
  }
  return false;
}
const ROOM_TTL_MS = 30 * 60_000; // брошенные партии чистим через 30 минут
const WAITING_HOST_TTL_MS = 5 * 60_000; // ждущая комната без хоста живёт 5 минут
const ROOM_CHAT_CAP = 60; // сообщений в чате партии (лимит значения KV ~64КБ)
const ROOM_CHAT_TEXT_MAX = 300; // символов в сообщении чата партии
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

/** постоянный ID игрока (код друга): 8 знаков из алфавита кодов комнат.
 *  Он же — публичный «ID для друзей»: вводится с дефисами/без, сервер
 *  нормализует. null — игрок без постоянного ID. */
function cleanUid(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  return /^[A-Z0-9]{8}$/.test(s) ? s : null;
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
    chat: [],
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
/** хранилище — внешний по HTTP (Cloudflare D1): интервалы присутствия
 *  растягиваем, чтобы не жечь дневную квоту записей (см. eff*-функции) */
let remoteStore = false;

/** каким хранилищем пользуемся — для health-страницы и логов */
export function storageKind(): 'd1' | 'denokv' | 'memory' {
  if (!kv) return 'memory';
  return (kv as { kind?: string }).kind === 'd1' ? 'd1' : 'denokv';
}

// ---------- эффективные интервалы (растянутые для REST-хранилища) ----------
// Д1 — это SQL по HTTPS: каждая запись = HTTP-запрос. Присутствие
// («на связи»/«в сети») обновляем реже, а пороги проверок — шире,
// чтобы индикаторы оставались честными при меньшем числе записей.

/** как часто сокет с uid освежает профиль друга (15с → 45с) */
function effFrTouchMs(): number {
  return remoteStore ? 45_000 : FR_TOUCH_MS;
}
/** минимальный интервал записи профиля друга (10с → 40с) */
function effFrUserWriteMs(): number {
  return remoteStore ? 40_000 : FR_USER_WRITE_MS;
}
/** «в сети» в списке друзей (50с → 120с) */
function effFrOnlineMs(): number {
  return remoteStore ? 120_000 : FR_ONLINE_MS;
}
/** запись присутствия в комнате дворником (30с → 60с) */
function effPresenceSaveMs(): number {
  return remoteStore ? 60_000 : PRESENCE_SAVE_MS;
}
/** «живая» комната в лобби (20с → 75с) */
function effListAliveMs(): number {
  return remoteStore ? 75_000 : LIST_ALIVE_MS;
}

/** «Ворот готовности KV»: при старте сервера KV подключается асинхронно
 *  ПОСЛЕ Deno.serve (иначе этап Warm up новой платформы Deno Deploy
 *  падает). Команды сокета ждут этот промис (максимум KV_GATE_MS), чтобы комнаты
 *  не создавались в памяти, когда KV вот-вот подключится. В тестах
 *  (модуль импортирован, initPersistence вызывается напрямую) — открыт. */
const KV_GATE_MS = 3_000;
let kvGate: Promise<void> = Promise.resolve();
let kvGateOpen: () => void = () => { /* по умолчанию уже открыт */ };

/** заблокировать ворот до готовности KV (вызывается ровно один раз
 *  из блока запуска перед Deno.serve) */
export function armKvGate(): void {
  kvGate = new Promise<void>((r) => {
    kvGateOpen = r;
  });
  // страховка: даже если openKv завис навсегда, через KV_GATE_MS ворот
  // открывается — сервер остаётся работоспособным в режиме памяти
  setTimeout(kvGateOpen, KV_GATE_MS);
}

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
  remoteStore = k !== null && (k as { remote?: boolean }).remote === true;
  chan = c;
  if (c) {
    c.onmessage = (ev) => {
      try {
        void handleChanMessage(ev.data);
      } catch { /* ignore */ }
    };
  }
}

// ============================================================
// 3.6. ВНЕШНЕЕ ХРАНИЛИЩЕ БЕЗ DENO KV: Cloudflare D1 (SQL по HTTPS)
// ============================================================
// Бесплатный план Deno Deploy даёт всего ОДНУ KV-базу на аккаунт —
// если она занята другим проектом, включается этот адаптер: те же
// ключи ['room', код] / ['fr_*', ...] ложатся в таблицу Cloudflare D1
// (бесплатно, без карты; лимиты: 5 млн чтений и 100 000 записей строк
// в день — с огромным запасом для игры). Семантика KvLike соблюдена:
//   • get(strong)  — живой SELECT (кэша нет: ходы и друзья — только
//     свежее, как consistency:'strong' в Deno KV);
//   • list(prefix) — SELECT по диапазону ключей; eventual-чтения лобби
//     кэшируются на 4с (пуши лобби идут каждые 3с, дворник — каждые 2с:
//     без кэша это сотни тысяч чтений в день), strong — всегда мимо кэша;
//   • atomic().check(ver).set/delete() — CAS: UPDATE/DELETE … WHERE
//     ver = N (роль versionstamp играет счётчик версий строки);
//   • atomic().check(null).set() — «создать только если нет»:
//     INSERT … ON CONFLICT DO NOTHING (0 изменений = конфликт);
//   • atomic() без check — мульти-UPSERT / DELETE WHERE k IN (…)
//     одним оператором (атомарно, как в Deno KV).
// Таблица создаётся один раз в консоли D1 (см. шапку файла):
//   create table if not exists loskutki_kv (
//     k text primary key, v text not null, ver integer not null);

/** базовый URL API Cloudflare (в тестах подменяется на локальный мок) */
const D1_API_BASE_DEFAULT = 'https://api.cloudflare.com/client/v4';
/** окно кэша eventual-списков (лобби + дворник делят один SELECT) */
const D1_LIST_CACHE_MS = 4_000;

interface D1Config {
  accountId: string;
  databaseId: string;
  apiToken: string;
  apiBase?: string;
}

/** собрать конфиг D1 из переменных окружения (D1_ACCOUNT_ID,
 *  D1_DATABASE_ID, D1_API_TOKEN; D1_API_BASE — только для тестов).
 *  Нет хотя бы одной из трёх обязательных → null (хранилище выключено). */
export function d1ConfigFromEnv(env: { get(k: string): string | undefined }): D1Config | null {
  const accountId = (env.get('D1_ACCOUNT_ID') ?? '').trim();
  const databaseId = (env.get('D1_DATABASE_ID') ?? '').trim();
  const apiToken = (env.get('D1_API_TOKEN') ?? '').trim();
  if (!accountId || !databaseId || !apiToken) return null;
  return { accountId, databaseId, apiToken, apiBase: env.get('D1_API_BASE') || undefined };
}

/** ключ KvLike → строка таблицы: части склеены '~' (разделитель не
 *  встречается в кодах комнат, uid и префиксах — проверяем на всякий) */
function d1KeyId(key: KvKey): string {
  const parts = key.map((p) => String(p));
  for (const p of parts) {
    if (p.includes('~')) throw new Error(`D1: символ '~' в ключе: ${JSON.stringify(key)}`);
  }
  return parts.join('~');
}

/** экранирование для LIKE … ESCAPE '\' */
function d1EscapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

/** билдер атомарной операции (цепочка check/set/delete → commit) */
class D1Atomic implements KvAtomic {
  private ops: Array<{ t: 'set'; k: KvKey; v: unknown } | { t: 'del'; k: KvKey }> = [];
  private checkOp: { key: KvKey; versionstamp: string | null } | null = null;
  constructor(private store: D1Kv) {}
  check(c: { key: KvKey; versionstamp: string | null }): KvAtomic {
    this.checkOp = c;
    return this;
  }
  set(k: KvKey, v: unknown): KvAtomic {
    this.ops.push({ t: 'set', k, v });
    return this;
  }
  delete(k: KvKey): KvAtomic {
    this.ops.push({ t: 'del', k });
    return this;
  }
  async commit(): Promise<{ ok: boolean }> {
    return this.store.commitOps(this.checkOp, this.ops);
  }
}

/** KvLike поверх Cloudflare D1 (SQL по REST). Никаких Deno-API —
 *  работает и под bun (тесты подключают его в реплику). */
export class D1Kv implements KvLike {
  readonly kind = 'd1';
  /** признак «внешнего по HTTP» хранилища — включает eff*-интервалы */
  readonly remote = true;
  private lastChanges = 0;
  /** кэш eventual-списков по префиксу (лобби/дворник) */
  private listCache = new Map<string, { at: number; rows: Array<{ key: KvKey; value: unknown; versionstamp: string }> }>();

  constructor(private cfg: D1Config) {}

  /** единственный HTTP-выход: POST /query {sql, params} */
  private async run(sql: string, params: unknown[]): Promise<Array<Record<string, unknown>>> {
    const base = this.cfg.apiBase ?? D1_API_BASE_DEFAULT;
    const res = await fetch(`${base}/accounts/${this.cfg.accountId}/d1/database/${this.cfg.databaseId}/query`, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${this.cfg.apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    });
    if (!res.ok) throw new Error(`D1 HTTP ${res.status}`);
    const body = (await res.json().catch(() => null)) as {
      success?: boolean;
      errors?: unknown;
      result?: Array<{ results?: Array<Record<string, unknown>>; meta?: { changes?: number } }>;
    } | null;
    if (!body || body.success !== true) {
      throw new Error(`D1 error: ${JSON.stringify(body?.errors ?? body).slice(0, 300)}`);
    }
    const first = body.result?.[0];
    this.lastChanges = first?.meta?.changes ?? 0;
    return first?.results ?? [];
  }

  /** живая проверка доступности (SELECT 1) — используется на старте */
  async healthCheck(): Promise<boolean> {
    try {
      await this.run('SELECT 1 AS ok', []);
      return true;
    } catch {
      return false;
    }
  }

  async get(key: KvKey, _opts?: { consistency?: 'strong' | 'eventual' }): Promise<KvEntry | null> {
    // без кэша: get у нас всегда в «сильных» путях (ходы, друзья)
    const rows = (await this.run('SELECT v, ver FROM loskutki_kv WHERE k = ?', [d1KeyId(key)])) as Array<{ v: string; ver: number }>;
    if (!rows.length) return null;
    return { key, value: JSON.parse(rows[0].v), versionstamp: String(rows[0].ver) };
  }

  async *list(
    scope: { prefix: KvKey },
    opts?: { consistency?: 'strong' | 'eventual' },
  ): AsyncIterable<KvEntry> {
    const p = d1KeyId(scope.prefix);
    const strong = opts?.consistency === 'strong';
    // eventual (лобби/дворник-косметика) — короткий кэш: пуши лобби
    // каждые 3с + проходы дворника каждые 2с делят один и тот же SELECT
    if (!strong) {
      const hit = this.listCache.get(p);
      if (hit && Date.now() - hit.at < D1_LIST_CACHE_MS) {
        for (const e of hit.rows) yield { key: e.key, value: e.value, versionstamp: e.versionstamp };
        return;
      }
    }
    const like = d1EscapeLike(p) + '~%';
    const rows = (await this.run(
      "SELECT k, v, ver FROM loskutki_kv WHERE k = ? OR k LIKE ? ESCAPE '\\' ORDER BY k",
      [p, like],
    )) as Array<{ k: string; v: string; ver: number }>;
    const entries = rows.map((r) => ({
      key: r.k.split('~') as KvKey,
      value: JSON.parse(r.v) as unknown,
      versionstamp: String(r.ver),
    }));
    this.listCache.set(p, { at: Date.now(), rows: entries });
    for (const e of entries) {
      yield { key: e.key, value: e.value, versionstamp: e.versionstamp };
    }
  }

  atomic(): KvAtomic {
    return new D1Atomic(this);
  }

  /** сбросить кэш списков, которых касается ключ — после СОБСТВЕННОЙ
   *  записи (иначе лобби/снапшот до 4с показывали бы докомнатную старьё;
   *  свежесть относительно СОСЕДНИХ изолятов остаётся eventual, как в KV) */
  private purgeListCacheFor(keyId: string): void {
    if (this.listCache.size === 0) return;
    for (const p of [...this.listCache.keys()]) {
      if (keyId === p || keyId.startsWith(p + '~')) this.listCache.delete(p);
    }
  }

  /** выполнить цепочку атомарных операций (см. раздел 3.6) */
  async commitOps(
    check: { key: KvKey; versionstamp: string | null } | null,
    ops: Array<{ t: 'set'; k: KvKey; v: unknown } | { t: 'del'; k: KvKey }>,
  ): Promise<{ ok: boolean }> {
    try {
      if (ops.length === 0) return { ok: true }; // пустой коммит = ok (как в KV)
      const sets = ops.filter((o) => o.t === 'set');
      const dels = ops.filter((o) => o.t === 'del');

      if (check) {
        // наши шаблоны CAS: ровно одна операция (проверено по всем
        // вызовам в ядре); что-то иное — честно отказ, а не тихий баг
        if (ops.length !== 1) return { ok: false };
        if (check.versionstamp === null) {
          // создать только если ключа нет
          if (ops[0].t !== 'set') return { ok: false };
          await this.run(
            'INSERT INTO loskutki_kv (k, v, ver) VALUES (?, ?, 1) ON CONFLICT(k) DO NOTHING',
            [d1KeyId(check.key), JSON.stringify(ops[0].v)],
          );
          const inserted = this.lastChanges === 1;
          if (inserted) this.purgeListCacheFor(d1KeyId(check.key));
          return { ok: inserted };
        }
        const ver = Number(check.versionstamp);
        if (!Number.isFinite(ver)) return { ok: false };
        if (ops[0].t === 'set') {
          // CAS-обновление: версия должна совпасть
          await this.run(
            'UPDATE loskutki_kv SET v = ?, ver = ver + 1 WHERE k = ? AND ver = ?',
            [JSON.stringify(ops[0].v), d1KeyId(check.key), ver],
          );
          const updated = this.lastChanges === 1;
          if (updated) this.purgeListCacheFor(d1KeyId(check.key));
          return { ok: updated };
        }
        // CAS-удаление
        await this.run('DELETE FROM loskutki_kv WHERE k = ? AND ver = ?', [d1KeyId(check.key), ver]);
        const deleted = this.lastChanges === 1;
        if (deleted) this.purgeListCacheFor(d1KeyId(check.key));
        return { ok: deleted };
      }

      // без проверки: все удаления — одним оператором (атомарно)
      if (dels.length > 0 && sets.length === 0) {
        const ph = dels.map(() => '?').join(', ');
        await this.run(`DELETE FROM loskutki_kv WHERE k IN (${ph})`, dels.map((o) => d1KeyId(o.k)));
        for (const o of dels) this.purgeListCacheFor(d1KeyId(o.k));
        return { ok: true }; // удаление отсутствующего ключа = ok (как в KV)
      }
      // без проверки: все записи — мульти-UPSERT одним оператором
      if (sets.length > 0 && dels.length === 0) {
        const values = sets.map(() => '(?, ?, 1)').join(', ');
        await this.run(
          `INSERT INTO loskutki_kv (k, v, ver) VALUES ${values} ON CONFLICT(k) DO UPDATE SET v = excluded.v, ver = loskutki_kv.ver + 1`,
          sets.flatMap((o) => [d1KeyId(o.k), JSON.stringify(o.v)]),
        );
        for (const o of sets) this.purgeListCacheFor(d1KeyId(o.k));
        return { ok: true };
      }
      // смешанные цепочки в ядре не используются; на всякий случай —
      // последовательно (атомарность между операциями не гарантируется)
      for (const o of sets) {
        await this.run(
          'INSERT INTO loskutki_kv (k, v, ver) VALUES (?, ?, 1) ON CONFLICT(k) DO UPDATE SET v = excluded.v, ver = loskutki_kv.ver + 1',
          [d1KeyId(o.k), JSON.stringify(o.v)],
        );
        this.purgeListCacheFor(d1KeyId(o.k));
      }
      for (const o of dels) {
        await this.run('DELETE FROM loskutki_kv WHERE k = ?', [d1KeyId(o.k)]);
        this.purgeListCacheFor(d1KeyId(o.k));
      }
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }
}

/** соседний изолят изменил комнату или прислал событие друга: перечитать
 *  и разпушить тем, чьи сокеты живут у нас (себе сообщение не доставляется) */
async function handleChanMessage(data: unknown): Promise<void> {
  try {
    if (!data || typeof data !== 'object') return;
    // событие друга: доставить локальным сокетам этого uid
    const frData = (data as { fr?: { target?: unknown; payload?: unknown } }).fr;
    if (frData && typeof frData.target === 'string' && frData.payload && typeof frData.payload === 'object') {
      frSendLocal(frData.target, frData.payload as Record<string, unknown>);
      return;
    }
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
function seatGuest(room: MpRoom, pid: string, name: string, avatar: string, uid: string | null = null): void {
  room.guest = { id: pid, name, avatar, lastPoll: Date.now(), leftAt: null, uid };
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
function joinInternal(room: MpRoom, input: { name: string; avatar: string; playerId?: unknown; uid?: string | null }): string {
  if (typeof input.playerId === 'string' && input.playerId === room.host.id) throw 'ownroom';
  // тот же игрок по постоянному ID (сессия потеряна при перезагрузке,
  // сессия стёрта, вход из другого браузера) — «сам к себе» не допускаем
  if (input.uid && room.host.uid && input.uid === room.host.uid) throw 'ownroom';
  if (room.status !== 'waiting' || room.guest !== null) throw 'full';
  if (room.host.leftAt !== null) throw 'gone';
  tick(room);
  if (room.status !== 'waiting' || room.guest !== null) throw 'full';
  const guestId = genId();
  seatGuest(room, guestId, input.name, input.avatar, input.uid ?? null);
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
    // заморозка — только для ПО-НАСТОЯЩЕМУ пропавших (сокета нет, давно
    // не опрашивал). Владелец с ЖИВЫМ сокетом подключён — его просрочку
    // играем сразу после грайса: раньше lastPoll протухал между освежениями
    // дворника (30с) и подключённый, но пассивный игрок «висел» на паузе
    // до получаса — соперник ждал автопасс, который не наступал
    const ownerLive = ownerSocketAlive(room, owner) || absent <= CONNECTED_MS;
    if (!explicitLeft && !ownerLive && absent < OWNER_ABSENT_CAP_MS) {
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

/** Полный вид комнаты для игрока. ФУНКЦИЯ ЧИСТАЯ: не тикает и не
 *  обновляет присутствие — тик/тач меняют комнату, а viewFor зовётся
 *  и из broadcastRoom, где результат мутаций НЕ сохранялся бы в KV.
 *  РАНЬШЕ так «пропадали фигуры»: тик внутри broadcast автопаассил
 *  просроченный ход, вид с версией N+1 (автопасс применён) уходил обоим,
 *  но в KV оставалась версия N без автопаасса; следующий настоящий ход
 *  читал KV, применялся к ДОавтопассному состоянию и получал ту же
 *  версию N+1 — клиент считал ответ «не новым» и откатывал автопаасс
 *  (кожаный лоскуток исчезал с доски, начисленные пуговки «забирались»).
 *  Теперь все изменения комнаты идут ТОЛЬКО через mutateRoom (CAS-запись):
 *  тик — в roomStateA/applyAction (внутри CAS) и у дворника (свой CAS),
 *  broadcast шлёт уже сохранённое состояние. */
export function viewFor(room: MpRoom, playerId: string): MpRoomView {
  const seat = seatOf(room, playerId);
  if (seat === null) throw 'notfound';
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
    me: { name: me.name, avatar: me.avatar, connected: now - me.lastPoll < CONNECTED_MS || ownerSocketAlive(room, seat) },
    // чат партии: каждому — с флагом «моё/чужое» (зритель всегда место 0)
    chat: (room.chat ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      text: m.text,
      at: m.at,
      mine: m.seat === seat,
    })),
    foe: foe
      ? {
          name: foe.name,
          avatar: foe.avatar,
          connected: now - foe.lastPoll < CONNECTED_MS || ownerSocketAlive(room, seat === 0 ? 1 : 0),
          left: foe.leftAt !== null,
          uid: foe.uid,
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
export async function createRoomA(input: { name: unknown; avatar: unknown; isPublic: unknown; uid?: unknown }): Promise<{
  code: string;
  playerId: string;
}> {
  const name = cleanName(input.name);
  if (name.length < 1) throw 'badname';
  for (let i = 0; i < 6; i++) {
    const code = genCode();
    if (!kv && rooms.has(code)) continue;
    const room = newRoom(
      code,
      { id: genId(), name, avatar: cleanAvatar(input.avatar), lastPoll: Date.now(), leftAt: null, uid: cleanUid(input.uid) },
      input.isPublic === true,
    );
    // CAS «ключа ещё нет»: коллизия кодов невозможна даже между изолятами
    if (await saveRoom(room, null)) return { code: room.code, playerId: room.host.id };
  }
  throw 'conflict';
}

/** войти в комнату по коду (партия стартуется сразу) */
export async function joinRoomA(input: { code: unknown; name: unknown; avatar: unknown; playerId?: unknown; uid?: unknown }): Promise<{
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
    return { result: joinInternal(room, { name, avatar: cleanAvatar(input.avatar), playerId: input.playerId, uid: cleanUid(input.uid) }) };
  });
  return { code, playerId: out.result, room: out.room };
}

/** текущий вид комнаты для игрока (touch присутствия + тик просрочек —
 *  изменения сохраняются CAS-записью, поэтому тик здесь БЕЗОПАСЕН) */
export async function roomStateA(code: string, playerId: string): Promise<{ view: MpRoomView; room: MpRoom }> {
  const out = await mutateRoom(code.trim().toUpperCase(), (room) => {
    revive(room);
    const seat = seatOf(room, playerId);
    if (seat === null) throw 'notfound';
    // ПРИСУТСТВИЕ ДО ТИКА (как в applyAction): вернувшийся игрок не должен
    // получить автопаасс в спину — сначала отмечаем его и снимаем заморозку
    touch(room, seat);
    tick(room);
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

/** сообщение в чат партии (живёт, пока жива комната; для играющих) */
export async function roomChatA(code: string, playerId: string, text: string): Promise<{ view: MpRoomView; room: MpRoom }> {
  const clean = text.trim().slice(0, ROOM_CHAT_TEXT_MAX);
  if (clean.length < 1) throw 'badpayload';
  const out = await mutateRoom(code.trim().toUpperCase(), (room) => {
    const seat = seatOf(room, playerId);
    if (seat === null) throw 'notfound';
    const p = seat === 0 ? room.host : room.guest!;
    const msg: RoomChatMsg = { id: genId(), seat, name: p.name, text: clean, at: Date.now() };
    room.chat = [...(room.chat ?? []), msg].slice(-ROOM_CHAT_CAP);
    // версия растёт: клиенты считают вид «новым» и подтягивают чат;
    // состояние партии при этом не меняется (events не подмешиваются)
    bumpVersion(room);
    return { result: viewFor(room, playerId) };
  });
  return { view: out.result, room: out.room };
}

/** Список ОТКРЫТЫХ комнат (только живые: хост был активен < 20с назад).
 *  Лобби — «косметика»: читаем из реплики KV (быстро и дёшево). */
export async function listRoomsA(): Promise<Array<{ code: string; hostName: string; hostAvatar: string; hostUid: string | null; createdAt: number; quick: boolean }>> {
  const now = Date.now();
  const out: Array<{ code: string; hostName: string; hostAvatar: string; hostUid: string | null; createdAt: number; quick: boolean }> = [];
  for (const { room: r } of await allRooms(false)) {
    if (r.isPublic && r.status === 'waiting' && r.guest === null && r.host.leftAt === null && now - r.host.lastPoll <= effListAliveMs()) {
      out.push({ code: r.code, hostName: r.host.name, hostAvatar: r.host.avatar, hostUid: r.host.uid, createdAt: r.createdAt, quick: r.quickHost === true });
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
export async function quickMatchA(input: { playerId?: unknown; name: unknown; avatar: unknown; uid?: unknown }): Promise<{
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
        seatGuest(room, pid, name, avatar, cleanUid(input.uid));
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
      const room = newRoom(code, { id: pid, name, avatar, lastPoll: Date.now(), leftAt: null, uid: cleanUid(input.uid) }, true, true);
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

// ============================================================
// 6.5. ДРУЗЬЯ: постоянные ID, заявки, чат 1-на-1, приглашения в игру
// ============================================================
// Хранение — те же принципы, что у комнат: Deno KV на Deploy (данные
// переживают перезапуск), в bun-тестах/без KV — оперативная память.
// uid = 8-значный код (генерирует клиент один раз, хранит в профиле);
// он же — публичный «ID для друзей». Протокол: hello регистрирует uid
// (сокет с этого момента получает push-события fr_*), fr_* — действия,
// {t:'fr_req'|'fr_ok'|'fr_gone'|'fr_msg'|'fr_invite'|'fr_invite_gone'}
// — события другу (между изолятами — через BroadcastChannel).

interface FrUser {
  uid: string;
  name: string;
  avatar: string;
  lastSeen: number;
  createdAt: number;
}
interface FrRec {
  uid: string;
  since: number;
}
interface FrCard {
  uid: string;
  name: string;
  avatar: string;
}
interface FrReqInfo {
  from: FrCard;
  at: number;
}
interface FrInviteInfo {
  from: FrCard;
  code: string;
  at: number;
}
interface ChatMsg {
  id: string;
  from: string;
  text: string;
  at: number;
}
interface FrOutInfo {
  at: number;
}

interface FrSnapshot {
  code: string;
  friends: Array<{ uid: string; name: string; avatar: string; online: boolean; unread: number }>;
  requests: FrReqInfo[];
  outgoing: Array<{ uid: string; at: number }>;
  invites: FrInviteInfo[];
}

const FR_ONLINE_MS = 50_000; // «в сети» = был активен меньше 50с назад
const FR_TOUCH_MS = 15_000; // как часто изолят освежает lastSeen в KV
const FR_USER_WRITE_MS = 10_000; // чаще этого профиль в KV не переписываем
const INVITE_TTL_MS = 60_000; // приглашение в игру живёт 60 секунд
const REQ_TTL_MS = 14 * 24 * 3600_000; // заявка в друзья живёт 2 недели
const MAX_FRIENDS = 50;
const MAX_REQS = 20;
const CHAT_CAP = 80; // сообщений в истории пары (лимит значения KV ~64КБ)
const CHAT_TEXT_MAX = 300;
const FR_SNAP_CACHE_MS = 4_000; // кэш снапшота в изоляте (экономия KV)

/** память (режим без KV): пользователи/друзья/заявки/чаты */
const memUsers = new Map<string, FrUser>();
const memFriends = new Map<string, FrRec[]>();
const memReq = new Map<string, FrReqInfo>(); // `${to}:${from}` — входящая заявка
const memOut = new Map<string, FrOutInfo>(); // `${from}:${to}` — моя исходящая
const memInvite = new Map<string, FrInviteInfo>(); // `${to}:${from}` — входящее приглашение
const memChat = new Map<string, ChatMsg[]>(); // `${lo}:${hi}` — диалог пары
const memRead = new Map<string, number>(); // `${me}:${peer}` — прочитано до
const frSnapCache = new Map<string, { at: number; snap: FrSnapshot }>();

function frSnapInvalidate(uid: string): void {
  frSnapCache.delete(uid);
}

async function frUserGet(uid: string): Promise<FrUser | null> {
  if (kv) {
    try {
      const e = await kv.get(['fr_user', uid], { consistency: 'strong' });
      return e && e.value ? (e.value as FrUser) : null;
    } catch {
      return null;
    }
  }
  return memUsers.get(uid) ?? null;
}

async function frUserSet(u: FrUser): Promise<void> {
  if (kv) {
    try {
      await kv.atomic().set(['fr_user', u.uid], u).commit();
    } catch { /* квота/сбой — присутствие обновится позже */ }
    return;
  }
  memUsers.set(u.uid, u);
}

/** upsert профиля игрока: имя/аватар/присутствие (частые записи гасим) */
async function touchUserA(uid: string, name: string, avatar: string): Promise<FrUser> {
  const now = Date.now();
  const prev = await frUserGet(uid);
  const next: FrUser = {
    uid,
    name: name || prev?.name || 'Игрок',
    avatar: avatar || prev?.avatar || 'ann',
    lastSeen: now,
    createdAt: prev?.createdAt ?? now,
  };
  if (!prev || prev.name !== next.name || prev.avatar !== next.avatar || now - prev.lastSeen > effFrUserWriteMs()) {
    await frUserSet(next);
  }
  return next;
}

async function frListGet(uid: string): Promise<FrRec[]> {
  if (kv) {
    try {
      const e = await kv.get(['fr_list', uid], { consistency: 'strong' });
      const v = e && e.value ? (e.value as { list?: FrRec[] }) : null;
      return Array.isArray(v?.list) ? v!.list : [];
    } catch {
      return [];
    }
  }
  return memFriends.get(uid) ?? [];
}

async function frListSet(uid: string, list: FrRec[]): Promise<void> {
  if (kv) {
    try {
      await kv.atomic().set(['fr_list', uid], { list }).commit();
    } catch { /* ignore */ }
    return;
  }
  memFriends.set(uid, list);
}

async function frReqGet(to: string, from: string): Promise<FrReqInfo | null> {
  if (kv) {
    try {
      const e = await kv.get(['fr_req', to, from], { consistency: 'strong' });
      return e && e.value ? (e.value as FrReqInfo) : null;
    } catch {
      return null;
    }
  }
  return memReq.get(`${to}:${from}`) ?? null;
}

async function frReqSet(to: string, from: string, req: FrReqInfo): Promise<void> {
  if (kv) {
    try {
      await kv.atomic().set(['fr_req', to, from], req).commit();
    } catch { /* ignore */ }
    return;
  }
  memReq.set(`${to}:${from}`, req);
}

async function frReqDel(to: string, from: string): Promise<void> {
  if (kv) {
    try {
      await kv.atomic().delete(['fr_req', to, from]).commit();
    } catch { /* ignore */ }
    return;
  }
  memReq.delete(`${to}:${from}`);
}

async function frOutSet(from: string, to: string, at: number): Promise<void> {
  if (kv) {
    try {
      await kv.atomic().set(['fr_out', from, to], { at }).commit();
    } catch { /* ignore */ }
    return;
  }
  memOut.set(`${from}:${to}`, { at });
}

async function frOutDel(from: string, to: string): Promise<void> {
  if (kv) {
    try {
      await kv.atomic().delete(['fr_out', from, to]).commit();
    } catch { /* ignore */ }
    return;
  }
  memOut.delete(`${from}:${to}`);
}

async function inviteGet(to: string, from: string): Promise<FrInviteInfo | null> {
  if (kv) {
    try {
      const e = await kv.get(['fr_invite', to, from], { consistency: 'strong' });
      return e && e.value ? (e.value as FrInviteInfo) : null;
    } catch {
      return null;
    }
  }
  return memInvite.get(`${to}:${from}`) ?? null;
}

async function inviteSet(to: string, from: string, inv: FrInviteInfo): Promise<void> {
  if (kv) {
    try {
      await kv.atomic().set(['fr_invite', to, from], inv).commit();
    } catch { /* ignore */ }
    return;
  }
  memInvite.set(`${to}:${from}`, inv);
}

async function inviteDel(to: string, from: string): Promise<void> {
  if (kv) {
    try {
      await kv.atomic().delete(['fr_invite', to, from]).commit();
    } catch { /* ignore */ }
    return;
  }
  memInvite.delete(`${to}:${from}`);
}

function chatPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function chatGet(a: string, b: string): Promise<ChatMsg[]> {
  const [lo, hi] = chatPair(a, b);
  if (kv) {
    try {
      const e = await kv.get(['fr_chat', lo, hi], { consistency: 'strong' });
      const v = e && e.value ? (e.value as { msgs?: ChatMsg[] }) : null;
      return Array.isArray(v?.msgs) ? v!.msgs : [];
    } catch {
      return [];
    }
  }
  return memChat.get(`${lo}:${hi}`) ?? [];
}

async function chatAppend(a: string, b: string, msg: ChatMsg): Promise<void> {
  const [lo, hi] = chatPair(a, b);
  const msgs = [...(await chatGet(a, b)), msg].slice(-CHAT_CAP);
  if (kv) {
    try {
      await kv.atomic().set(['fr_chat', lo, hi], { msgs }).commit();
    } catch { /* ignore */ }
    return;
  }
  memChat.set(`${lo}:${hi}`, msgs);
}

/** стереть переписку пары (вызывается при удалении из друзей —
 *  политика конфиденциальности: чат живёт, пока жива дружба) */
async function chatDel(a: string, b: string): Promise<void> {
  const [lo, hi] = chatPair(a, b);
  if (kv) {
    try {
      await kv.atomic()
        .delete(['fr_chat', lo, hi])
        .delete(['fr_read', lo, hi])
        .delete(['fr_read', hi, lo])
        .commit();
    } catch { /* ignore */ }
    return;
  }
  memChat.delete(`${lo}:${hi}`);
  memRead.delete(`${lo}:${hi}`);
  memRead.delete(`${hi}:${lo}`);
}

async function readGet(me: string, peer: string): Promise<number> {
  if (kv) {
    try {
      const e = await kv.get(['fr_read', me, peer]);
      const v = e && e.value ? (e.value as { at?: number }) : null;
      return typeof v?.at === 'number' ? v.at : 0;
    } catch {
      return 0;
    }
  }
  return memRead.get(`${me}:${peer}`) ?? 0;
}

async function readSet(me: string, peer: string, at: number): Promise<void> {
  if (kv) {
    try {
      await kv.atomic().set(['fr_read', me, peer], { at }).commit();
    } catch { /* ignore */ }
    return;
  }
  memRead.set(`${me}:${peer}`, at);
}

/** снапшот друга «как его видит uid» (для списка) */
async function friendEntryFor(uid: string, f: FrRec, now: number): Promise<FrSnapshot['friends'][number]> {
  const u = await frUserGet(f.uid);
  const readTs = await readGet(uid, f.uid);
  let unread = 0;
  if (readTs > 0) {
    const msgs = await chatGet(uid, f.uid);
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].at <= readTs) break;
      if (msgs[i].from === f.uid) unread++;
    }
  } else {
    const msgs = await chatGet(uid, f.uid);
    for (const m of msgs) if (m.from === f.uid) unread++;
  }
  return {
    uid: f.uid,
    name: u?.name ?? 'Игрок',
    avatar: u?.avatar ?? 'ann',
    online: u ? now - u.lastSeen < effFrOnlineMs() || uidOnLiveSocket(f.uid) : false,
    unread,
  };
}

/** полный снапшот раздела друзей (с коротким кэшем — экономия KV) */
async function friendsSnapshotA(uid: string): Promise<FrSnapshot> {
  const hit = frSnapCache.get(uid);
  if (hit && Date.now() - hit.at < FR_SNAP_CACHE_MS) return hit.snap;
  const now = Date.now();
  const list = (await frListGet(uid)).slice(0, MAX_FRIENDS);
  const friends: FrSnapshot['friends'] = [];
  for (const f of list) {
    friends.push(await friendEntryFor(uid, f, now));
  }

  // входящие заявки (просроченные прибираем на месте)
  const requests: FrReqInfo[] = [];
  if (kv) {
    try {
      const stale: string[] = [];
      for await (const e of kv.list({ prefix: ['fr_req', uid] })) {
        const req = e.value as FrReqInfo;
        if (now - req.at > REQ_TTL_MS) {
          stale.push(String((e.key as unknown[])[2] ?? ''));
          continue;
        }
        requests.push(req);
      }
      for (const from of stale) {
        if (from) await frReqDel(uid, from);
      }
    } catch { /* ignore */ }
  } else {
    for (const [k, req] of [...memReq.entries()]) {
      if (!k.startsWith(`${uid}:`)) continue;
      if (now - req.at > REQ_TTL_MS) {
        memReq.delete(k);
        continue;
      }
      requests.push(req);
    }
  }
  requests.sort((a, b) => b.at - a.at);

  // мои исходящие заявки
  const outgoing: Array<{ uid: string; at: number }> = [];
  if (kv) {
    try {
      for await (const e of kv.list({ prefix: ['fr_out', uid] })) {
        const v = e.value as FrOutInfo;
        if (now - v.at <= REQ_TTL_MS) outgoing.push({ uid: String((e.key as unknown[])[2] ?? ''), at: v.at });
      }
    } catch { /* ignore */ }
  } else {
    for (const [k, v] of [...memOut.entries()]) {
      if (!k.startsWith(`${uid}:`)) continue;
      if (now - v.at <= REQ_TTL_MS) outgoing.push({ uid: k.slice(uid.length + 1), at: v.at });
    }
  }

  // приглашения в игру (живые, просроченные прибираем)
  const invites: FrInviteInfo[] = [];
  if (kv) {
    try {
      const stale: string[] = [];
      for await (const e of kv.list({ prefix: ['fr_invite', uid] })) {
        const inv = e.value as FrInviteInfo;
        if (now - inv.at > INVITE_TTL_MS) {
          stale.push(String((e.key as unknown[])[2] ?? ''));
          continue;
        }
        invites.push(inv);
      }
      for (const from of stale) {
        if (from) await inviteDel(uid, from);
      }
    } catch { /* ignore */ }
  } else {
    for (const [k, inv] of [...memInvite.entries()]) {
      if (!k.startsWith(`${uid}:`)) continue;
      if (now - inv.at > INVITE_TTL_MS) {
        memInvite.delete(k);
        continue;
      }
      invites.push(inv);
    }
  }
  invites.sort((a, b) => b.at - a.at);

  const snap: FrSnapshot = { code: uid, friends, requests: requests.slice(0, MAX_REQS), outgoing, invites };
  frSnapCache.set(uid, { at: Date.now(), snap });
  return snap;
}

/** принимать дружбу в обе стороны (заявку гасим) */
async function acceptFriendA(me: string, other: string): Promise<void> {
  const since = Date.now();
  const mine = await frListGet(me);
  if (!mine.find((f) => f.uid === other) && mine.length < MAX_FRIENDS) {
    mine.push({ uid: other, since });
    await frListSet(me, mine);
  }
  const theirs = await frListGet(other);
  if (!theirs.find((f) => f.uid === me) && theirs.length < MAX_FRIENDS) {
    theirs.push({ uid: me, since });
    await frListSet(other, theirs);
  }
  await frReqDel(me, other); // моя входящая
  await frOutDel(other, me); // их исходящая
}

/** отправить событие другу: локальные сокеты + соседние изоляты */
function frSendLocal(target: string, payload: Record<string, unknown>): void {
  for (const s of sockets.values()) {
    if (s.alive && s.uid === target) {
      try {
        s.send(payload);
      } catch { /* сокет умер — дворник приберёт */ }
    }
  }
}

function pushFrA(target: string, payload: Record<string, unknown>): void {
  frSendLocal(target, payload);
  try {
    chan?.postMessage({ fr: { target, payload } });
  } catch { /* ignore */ }
}

/** моя ждущая комната по uid (для приглашения — переиспользуем код) */
async function findWaitingRoomOfUidA(uid: string): Promise<MpRoom | null> {
  for (const { room } of await allRooms(true)) {
    if (room.host.uid === uid && room.status === 'waiting' && room.guest === null) return room;
  }
  return null;
}

/** я сейчас играю (по uid)? — приглашать из партии нельзя */
async function isPlayingUidA(uid: string): Promise<boolean> {
  for (const { room } of await allRooms(true)) {
    if (room.status !== 'playing') continue;
    if (room.host.uid === uid || room.guest?.uid === uid) return true;
  }
  return false;
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
  memUsers.clear();
  memFriends.clear();
  memReq.clear();
  memOut.clear();
  memInvite.clear();
  memChat.clear();
  memRead.clear();
  frSnapCache.clear();
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
  /** постоянный ID игрока (раздел «Друзья») — после hello */
  uid: string | null;
  /** профиль из hello — для присутствия и приглашений */
  frName: string;
  frAvatar: string;
  /** когда последний раз писали профиль игрока в KV */
  frTouch: number;
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
    uid: null,
    frName: '',
    frAvatar: 'ann',
    frTouch: 0,
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
  let list: Array<{ code: string; hostName: string; hostAvatar: string; hostUid: string | null; createdAt: number; quick: boolean }>;
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
  ctx.uid = null;
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

      default:
        // все команды, кроме пустых (создание/вход/ходы/друзья), ждут
        // готовности KV (максимум KV_GATE_MS после старта): комнаты не
        // должны создаваться в памяти, когда KV вот-вот подключится.
        // При загруженном модуле без запуска сервера ворот всегда открыт.
        await kvGate;
    }

    switch (t) {
      case 'create': {
        // uid ОБЯЗАН пробрасываться: без него «добавить в друзья» из матча
        // не работает (foe.uid === null) и нельзя поймать вход «сам к себе»
        const res = await createRoomA({ name: msg.name, avatar: msg.avatar, isPublic: msg.isPublic, uid: msg.uid });
        attach(ctx, res.code, res.playerId);
        respond(ctx, ref, { ok: true, code: res.code, playerId: res.playerId });
        void pushRoomsA();
        return;
      }

      case 'join': {
        const res = await joinRoomA({ code: msg.code, name: msg.name, avatar: msg.avatar, playerId: msg.playerId, uid: msg.uid });
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

      case 'chat': {
        // сообщение в чат партии (переписка с соперником прямо в игре,
        // без обязательной дружбы — живёт, пока жива комната)
        const { view, room } = await roomChatA(str(msg.code), str(msg.playerId), typeof msg.text === 'string' ? msg.text : '');
        respond(ctx, ref, { ok: true, view });
        broadcastRoom(room); // соперник получает сообщение мгновенно
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
        const res = await quickMatchA({ playerId: msg.playerId, name: msg.name, avatar: msg.avatar, uid: msg.uid });
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

      // ===== ДРУЗЬЯ =====

      case 'hello': {
        // регистрация постоянного ID: с этого момента сокет получает
        // push-события друзей (заявки/сообщения/приглашения) где бы ни был
        const uid = cleanUid(msg.uid);
        const name = cleanName(msg.name);
        if (!uid) throw 'badpayload';
        ctx.uid = uid;
        ctx.frName = name;
        ctx.frAvatar = cleanAvatar(msg.avatar);
        await touchUserA(uid, name, ctx.frAvatar);
        // persist: подключена ли база (Deno KV). Без неё друзья живут
        // только до перезапуска изолята — клиент показывает предупреждение
        respond(ctx, ref, { ok: true, persist: kv !== null, snapshot: await friendsSnapshotA(uid) });
        return;
      }

      case 'fr_sync': {
        if (!ctx.uid) throw 'badpayload';
        await touchUserA(ctx.uid, ctx.frName, ctx.frAvatar);
        respond(ctx, ref, { ok: true, persist: kv !== null, snapshot: await friendsSnapshotA(ctx.uid) });
        return;
      }

      case 'fr_add': {
        if (!ctx.uid) throw 'badpayload';
        const me = ctx.uid;
        const target = cleanUid(msg.code ?? msg.uid);
        if (!target) throw 'badcode';
        if (target === me) throw 'self';
        const tu = await frUserGet(target);
        if (!tu) throw 'badcode';
        const mine = await frListGet(me);
        if (mine.find((f) => f.uid === target)) throw 'already';
        if (mine.length >= MAX_FRIENDS) throw 'toomany';
        const meCard = await touchUserA(me, ctx.frName, ctx.frAvatar);
        // встречная заявка — мгновенное принятие
        if (await frReqGet(me, target)) {
          await acceptFriendA(me, target);
          frSnapInvalidate(me);
          frSnapInvalidate(target);
          pushFrA(target, { t: 'fr_ok', user: { uid: me, name: meCard.name, avatar: meCard.avatar } });
          respond(ctx, ref, { ok: true, accepted: true, snapshot: await friendsSnapshotA(me) });
          return;
        }
        const at = Date.now();
        await frReqSet(target, me, { from: { uid: me, name: meCard.name, avatar: meCard.avatar }, at });
        await frOutSet(me, target, at);
        frSnapInvalidate(me);
        frSnapInvalidate(target);
        pushFrA(target, { t: 'fr_req', req: { from: { uid: me, name: meCard.name, avatar: meCard.avatar }, at } });
        respond(ctx, ref, { ok: true, snapshot: await friendsSnapshotA(me) });
        return;
      }

      case 'fr_accept': {
        const from = cleanUid(msg.uid);
        if (!ctx.uid || !from) throw 'badpayload';
        if (!(await frReqGet(ctx.uid, from))) throw 'gone';
        const meCard = await touchUserA(ctx.uid, ctx.frName, ctx.frAvatar);
        await acceptFriendA(ctx.uid, from);
        frSnapInvalidate(ctx.uid);
        frSnapInvalidate(from);
        pushFrA(from, { t: 'fr_ok', user: { uid: ctx.uid, name: meCard.name, avatar: meCard.avatar } });
        respond(ctx, ref, { ok: true, snapshot: await friendsSnapshotA(ctx.uid) });
        return;
      }

      case 'fr_decline': {
        const from = cleanUid(msg.uid);
        if (!ctx.uid || !from) throw 'badpayload';
        await frReqDel(ctx.uid, from);
        await frOutDel(from, ctx.uid);
        frSnapInvalidate(ctx.uid);
        frSnapInvalidate(from);
        respond(ctx, ref, { ok: true, snapshot: await friendsSnapshotA(ctx.uid) });
        return;
      }

      case 'fr_remove': {
        const other = cleanUid(msg.uid);
        if (!ctx.uid || !other) throw 'badpayload';
        await frListSet(ctx.uid, (await frListGet(ctx.uid)).filter((f) => f.uid !== other));
        await frListSet(other, (await frListGet(other)).filter((f) => f.uid !== ctx.uid));
        // дружба закончилась — стираем переписку пары (политика
        // конфиденциальности: чат хранится, пока стороны — друзья)
        await chatDel(ctx.uid, other);
        frSnapInvalidate(ctx.uid);
        frSnapInvalidate(other);
        pushFrA(other, { t: 'fr_gone', uid: ctx.uid });
        respond(ctx, ref, { ok: true, snapshot: await friendsSnapshotA(ctx.uid) });
        return;
      }

      case 'fr_msg': {
        const to = cleanUid(msg.to);
        const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, CHAT_TEXT_MAX) : '';
        if (!ctx.uid || !to || text.length < 1) throw 'badpayload';
        if (!(await frListGet(ctx.uid)).find((f) => f.uid === to)) throw 'notfriends';
        const m: ChatMsg = { id: genId(), from: ctx.uid, text, at: Date.now() };
        await chatAppend(ctx.uid, to, m);
        frSnapInvalidate(ctx.uid);
        frSnapInvalidate(to);
        pushFrA(to, { t: 'fr_msg', from: ctx.uid, msg: m });
        respond(ctx, ref, { ok: true, msg: m });
        return;
      }

      case 'fr_read': {
        const peer = cleanUid(msg.uid);
        if (!ctx.uid || !peer) throw 'badpayload';
        await readSet(ctx.uid, peer, Date.now());
        frSnapInvalidate(ctx.uid);
        respond(ctx, ref, { ok: true });
        return;
      }

      case 'fr_chat': {
        const peer = cleanUid(msg.uid);
        if (!ctx.uid || !peer) throw 'badpayload';
        if (!(await frListGet(ctx.uid)).find((f) => f.uid === peer)) throw 'notfriends';
        const msgs = await chatGet(ctx.uid, peer);
        await readSet(ctx.uid, peer, Date.now());
        frSnapInvalidate(ctx.uid);
        respond(ctx, ref, { ok: true, msgs });
        return;
      }

      case 'fr_invite': {
        const to = cleanUid(msg.to);
        if (!ctx.uid || !to) throw 'badpayload';
        const me = ctx.uid;
        if (!(await frListGet(me)).find((f) => f.uid === to)) throw 'notfriends';
        if (await isPlayingUidA(me)) throw 'inroom';
        // своя ждущая комната — переиспользуем; иначе новая приватная
        let code: string;
        let playerId: string;
        const existing = await findWaitingRoomOfUidA(me);
        if (existing) {
          code = existing.code;
          playerId = existing.host.id;
        } else {
          const res = await createRoomA({ name: ctx.frName, avatar: ctx.frAvatar, isPublic: false, uid: me });
          code = res.code;
          playerId = res.playerId;
        }
        const meCard = await touchUserA(me, ctx.frName, ctx.frAvatar);
        const inv: FrInviteInfo = { from: { uid: me, name: meCard.name, avatar: meCard.avatar }, code, at: Date.now() };
        await inviteSet(to, me, inv);
        frSnapInvalidate(to);
        pushFrA(to, { t: 'fr_invite', invite: inv });
        // зовущий сразу привязан к своей комнате (как после 'create'):
        // момент принятия другом = мгновенный push «партия стартовала»
        attach(ctx, code, playerId);
        respond(ctx, ref, { ok: true, code, playerId });
        return;
      }

      case 'fr_invite_accept': {
        const from = cleanUid(msg.uid);
        if (!ctx.uid || !from) throw 'badpayload';
        const me = ctx.uid;
        const inv = await inviteGet(me, from);
        if (!inv || Date.now() - inv.at > INVITE_TTL_MS) {
          await inviteDel(me, from);
          throw 'gone';
        }
        const name = cleanName(msg.name) || ctx.frName;
        const res = await joinRoomA({ code: inv.code, name, avatar: msg.avatar, uid: me });
        await inviteDel(me, from);
        frSnapInvalidate(me);
        frSnapInvalidate(from);
        attach(ctx, res.code, res.playerId);
        respond(ctx, ref, { ok: true, code: res.code, playerId: res.playerId });
        broadcastRoom(res.room); // приглашённый в партии — хост видит мгновенно
        notifyChan(res.code);
        void pushRoomsA();
        pushFrA(from, { t: 'fr_invite_gone', from: me });
        return;
      }

      case 'fr_invite_decline': {
        const from = cleanUid(msg.uid);
        if (!ctx.uid || !from) throw 'badpayload';
        await inviteDel(ctx.uid, from);
        frSnapInvalidate(ctx.uid);
        frSnapInvalidate(from);
        pushFrA(from, { t: 'fr_invite_gone', from: ctx.uid });
        respond(ctx, ref, { ok: true });
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

  // 1.5) присутствие друзей: сокеты с uid освежают профиль в KV
  //      (иначе «в сети» гаснет, когда игрок просто сидит в меню)
  for (const ctx of [...sockets.values()]) {
    if (!ctx.alive || !ctx.uid) continue;
    if (now - ctx.frTouch >= effFrTouchMs()) {
      ctx.frTouch = now;
      void touchUserA(ctx.uid, ctx.frName, ctx.frAvatar);
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
        if (ownerSocketAlive(room, seatOf(room, p.id) ?? -1) && Date.now() - p.lastPoll > effPresenceSaveMs()) {
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
      if (local && Date.now() - p.lastPoll > effPresenceSaveMs()) {
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

/** статистика для health-страницы (синхронная — для bun-реплики, режим памяти) */
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

/** Статистика health-страницы Deno Deploy: СВЕЖИЙ проход по KV (общее
 *  хранилище ВСЕХ изолятов), а не сокеты этого узла. HTTP-запрос к /
 *  может прилететь на «чужой» изолят — не тот, где живут WebSocket-игроки,
 *  и раньше из-за этого «Игроков на связи» показывал 0, хотя шла партия.
 *  Присутствие игрока = lastPoll свежее 45с (изолят-владелец сокетов
 *  освежает его в KV не реже раза в 30с) и он не вышел осознанно. */
export async function serverStatsA(): Promise<{
  waiting: number;
  playing: number;
  players: number;
  sockets: number;
  uptimeSec: number;
  kv: boolean;
  storage: 'd1' | 'denokv' | 'memory';
}> {
  const now = Date.now();
  let waiting = 0;
  let playing = 0;
  let players = 0;
  const countRoom = (room: MpRoom): void => {
    if (room.status === 'waiting') waiting++;
    else if (room.status === 'playing' || room.status === 'finished') playing++;
    for (const p of [room.host, room.guest]) {
      if (p && p.leftAt === null && now - p.lastPoll < 45_000) players++;
    }
  };
  if (kv) {
    try {
      for await (const e of kv.list({ prefix: ['room'] })) {
        if (e.value) countRoom(e.value as MpRoom);
      }
    } catch { /* KV мигнул — статистика не критична */ }
  } else {
    for (const r of rooms.values()) countRoom(r);
  }
  let live = 0;
  for (const s of sockets.values()) if (s.alive) live++;
  return { waiting, playing, players, sockets: live, uptimeSec: Math.floor((now - startedAt) / 1000), kv: kvOn, storage: storageKind() };
}

// ============================================================
// 8. HTTP + ЗАПУСК DENO DEPLOY
// ============================================================

/** health-страница: st=null — статистика не успела посчитаться (гонка с
 *  таймаутом), показываем базовую версию — главное, что сервер ответил. */
function healthHtml(st: Awaited<ReturnType<typeof serverStatsA>> | null): string {
  const storageOf = st?.storage;
  const storageLine = storageOf === 'd1'
    ? 'Cloudflare D1 — комнаты и друзья переживают перезапуск'
    : storageOf === 'denokv'
      ? 'Deno KV — комнаты и друзья переживают перезапуск'
      : 'память (данные пропадут при перезапуске)';
  const line = st
    ? `<p>Комнат в ожидании: ${st.waiting} · идёт партий: ${st.playing}</p>
    <p>Игроков в комнатах: ${st.players} · без перезапуска: ${st.uptimeSec} с</p>
    <p>Хранение: ${storageLine}</p>
    ${st.kv ? '' : `<div class="warn">⚠️ База данных не подключена: друзья, переписка и комнаты
    будут теряться при каждом перезапуске сервера. Подключите бесплатную базу
    (инструкция — в шапке файла сервера, раздел «ВАРИАНТ А/Б»):
    Cloudflare D1 — три переменные D1_ACCOUNT_ID / D1_DATABASE_ID /
    D1_API_TOKEN, либо Deno KV: Settings → Databases → Provision.</div>`}`
    : `<p>Сервер только что запустился — статистика появится через минуту.</p>`;
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
          box-shadow: 0 10px 40px rgba(0,0,0,.35); max-width: 480px; }
  h1 { font-size: 28px; margin: 0 0 8px; color: #FFD98A; }
  p { margin: 6px 0; color: #C9BCA4; font-size: 15px; }
  .ok { display: inline-block; margin-top: 14px; padding: 8px 18px; border-radius: 999px;
        background: #4C7A3F; color: #fff; font-weight: 700; font-size: 14px; }
  .warn { margin-top: 12px; padding: 10px 14px; border-radius: 12px; text-align: left;
          background: #5A2A1E; border: 1px solid #B5432F; color: #FFD9CF; font-size: 13px; }
</style>
</head>
<body>
  <div class="card">
    <h1>🧵 Лоскутки: сервер онлайн</h1>
    <p>WebSocket-сервер мультиплеера работает.</p>
    ${line}
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

// Запуск транспорта. Под ЛЮБЫМ Deno (deno run server.ts, Deno Deploy
// console.deno.com — как main и как импортированный модуль-обёртку)
// сервер поднимается ВСЕГДА. Исключение — bun: bun-реплика импортирует
// ядро файла для локальных E2E-тестов, и транспорт ей не нужен.
//
// Почему «всегда», а не import.meta.main: новая платформа Deno Deploy
// может выполнять входную точку через собственную обёртку (main=false),
// а этапы сборки «Warm up» (запуск + HTTP-запрос к preview URL) и
// «Register crons» (оценка топ-левел кода для извлечения Deno.cron)
// обязаны увидеть поднявшийся HTTP-сервер — иначе деплой ПАДАЕТ.
//
// ВАЖНО (новая платформа Deno Deploy, 2026): сборщик «прогревает»
// приложение — запускает изолят и ЖДЁТ, пока поднимется HTTP-сервер
// (этап «Warm up»). Поэтому Deno.serve() вызывается ПЕРВЫМ, а Deno KV
// подключается асинхронно ПОСЛЕ: на новой платформе KV требует
// подключённой базы данных (Databases → Provision Database → Deno KV),
// и без неё openKv может не завершиться — сервер обязан подняться всё
// равно (режим памяти), иначе деплой падает на Warm up.

/** bun-реплика (scripts/run-server-bun.ts) импортирует ядро этого файла
 *  и поднимает СВОЙ транспорт — наш Deno-клей ей не нужен. В рантайме
 *  bun глобально доступен объект Bun (в Deno его нет). */
function isBunRuntime(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
}
if (!isBunRuntime()) {
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
    serve(opts: unknown, handler: (req: Request) => Response | Promise<Response>): void;
    upgradeWebSocket(req: Request): { socket: DenoWsSocket; response: unknown };
    openKv?: (path?: string) => unknown;
  }
  const D = (globalThis as { Deno?: DenoApi }).Deno;
  if (!D) {
    throw new Error('Этот файл запускается под Deno: deno run server.ts или вставь в Deno Deploy Playground');
  }

  // 0а) СТРАХОВКА ИЗОЛЯТА: незахваченный реджект промиса (например,
  //     зависший/отказавший openKv без подключённой базы) не должен
  //     УБИВАТЬ процесс — иначе новая платформа Deno Deploy падает на
  //     этапах «Warm up» / «Register crons». Логируем и живём дальше.
  try {
    addEventListener('unhandledrejection', (ev) => {
      ev.preventDefault();
      try {
        console.error('[Лоскутки] незахваченный rejection (не фатален):', ev.reason);
      } catch { /* ignore */ }
    });
  } catch { /* среда без событий — ок */ }

  const port = Number(D.env?.get('PORT') ?? 8000);

  // 0) запереть «ворот KV»: команды сокетов подождут подключения KV
  //    (максимум KV_GATE_MS), но сам boot это не тормозит
  armKvGate();

  // 1) HTTP-сервер — НЕМЕДЛЕННО: платформа ждёт его на этапе «Warm up».
  //    Всё, что может ждать/падать (KV), подключается ниже асинхронно.
  D.serve({ port }, async (req: Request): Promise<Response> => {
    // WebSocket-соединение (любой путь) — без await до апгрейда
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
      try {
        // статистика не должна подвесить ответ: гонка с таймаутом
        const st = await Promise.race([
          serverStatsA(),
          new Promise<null>((r) => setTimeout(() => r(null), 1500)),
        ]);
        return new Response(healthHtml(st), {
          headers: { 'content-type': 'text/html; charset=utf-8', ...corsHeaders() },
        });
      } catch {
        return new Response('ok', { status: 200, headers: corsHeaders() });
      }
    }
    return new Response('Not Found', { status: 404, headers: corsHeaders() });
  });
  startSweeper();
  console.log(`[Лоскутки] WebSocket-сервер запущен (порт ${port}). Health: GET /`);

  // 2) Канал изолятов — синхронный, до первого запроса.
  let chanLike: ChanLike | null = null;
  try {
    const BC = (globalThis as unknown as { BroadcastChannel?: new (name: string) => ChanLike }).BroadcastChannel;
    chanLike = BC ? new BC('loskutki-rooms-v1') : null;
  } catch {
    chanLike = null;
  }

  // 3) ХРАНИЛИЩЕ — асинхронно ПОСЛЕ serve (Warm up не ждёт базу).
  //    Приоритет: Cloudflare D1 (если заданы D1_*) → Deno KV → память.
  //    D1 — бесплатная внешняя база для случая, когда единственная
  //    KV-база Deno Deploy занята другим проектом (см. раздел 3.6).
  const attachKv = async (): Promise<void> => {
    // 3а) Cloudflare D1: проверяем живость (SELECT 1) с тем же бюджетом
    //     таймаута, что и у KV-ворот — недоступная база не подвешивает
    //     сервер, просто идём дальше по списку.
    const d1cfg = d1ConfigFromEnv({ get: (k) => D.env?.get(k) });
    if (d1cfg) {
      try {
        const store = new D1Kv(d1cfg);
        const healthy = await Promise.race([
          store.healthCheck(),
          new Promise<boolean>((r) => setTimeout(() => r(false), KV_GATE_MS)),
        ]);
        if (healthy) {
          initPersistence(store, chanLike);
          kvGateOpen(); // хранилище готово — команды идут дальше
          console.log('[Лоскутки] Хранилище: Cloudflare D1 — комнаты и друзья переживают перезапуск');
          return;
        }
        console.error(
          '[Лоскутки] D1 задан (D1_*), но не отвечает — проверьте D1_ACCOUNT_ID / D1_DATABASE_ID / D1_API_TOKEN ' +
            'и что в базе создана таблица loskutki_kv. Пробуем Deno KV…',
        );
      } catch (e) {
        console.error('[Лоскутки] Ошибка подключения D1 — пробуем Deno KV:', e);
      }
    }

    // 3б) Deno KV — прежнее поведение. На новой платформе Deno Deploy
    //     базе нужен вызов БЕЗ аргументов (платформа сама подставляет базу
    //     таймлайна; путь-аргумент там не поддерживается). Локально путь
    //     «loskutki-kv» создаёт файл рядом со скриптом. Гонка с таймаутом:
    //     неответившее openKv (нет подключённой базы) не подвешивает
    //     сервер — остаёмся в режиме памяти.
    if (!D.openKv) {
      kvGateOpen();
      return;
    }
    const deploy = onDeployHint();
    let kvLike: KvLike | null = null;
    try {
      const raw = D.openKv(deploy ? undefined : 'loskutki-kv');
      // ГЛАВНОЕ: у промиса openKv ВСЕГДА есть свой catch — если база не
      // подключена и openKv отказывает ПОЗЖЕ победившего таймаута гонки,
      // реджект не должен стать незахваченным (это убивало изолят на
      // этапах Warm up / Register crons новой платформы).
      const rawP =
        raw && typeof (raw as PromiseLike<unknown>).then === 'function'
          ? Promise.resolve(raw).catch(() => null)
          : Promise.resolve(raw);
      const resolved = await Promise.race([
        rawP,
        new Promise<null>((r) => setTimeout(() => r(null), KV_GATE_MS)),
      ]);
      kvLike = (resolved ?? null) as KvLike | null;
    } catch {
      kvLike = null;
    }
    initPersistence(kvLike, chanLike);
    kvGateOpen(); // KV готов (или не будет) — команды идут дальше
    if (kvLike) {
      console.log('[Лоскутки] KV подключён — комнаты переживают перезапуск');
    } else {
      console.log(
        '[Лоскутки] KV НЕ подключён — режим памяти. ' +
          (deploy
            ? 'Подключи базу: Cloudflare D1 (переменные D1_*, инструкция в шапке файла) или Settings → Databases → Attach Database → Provision Database (Deno KV).'
            : 'Локально: запусти с флагом --unstable-kv или задай D1_ACCOUNT_ID/D1_DATABASE_ID/D1_API_TOKEN.'),
      );
    }
  };
  void attachKv().catch(() => kvGateOpen());
}

/** Признак «мы на Deno Deploy»: платформа отмечает изолят переменными
 *  окружения. На новой консоли сборщик может выполнить модуль НЕ как
 *  main (обёртка входной точки) — тогда import.meta.main ложен, а
 *  сервер всё равно обязан подняться. */
function onDeployHint(): boolean {
  try {
    const env = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno?.env;
    if (!env) return false;
    return Boolean(
      env.get('DENO_DEPLOYMENT_ID') ||
        env.get('DENO_TIMELINE') ||
        env.get('DENO_DEPLOY_SUBHOST') ||
        env.get('DENO_REGION'),
    );
  } catch {
    return false;
  }
}
