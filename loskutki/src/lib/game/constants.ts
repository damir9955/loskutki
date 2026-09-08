/**
 * Константы игры «Лоскутки» — верифицированы по правилам Patchwork (Uwe Rosenberg)
 * и открытому симулятору PatchworkSim (danzel).
 */

export const BOARD_SIZE = 9;
export const CELLS = BOARD_SIZE * BOARD_SIZE;

/** Последняя клетка дорожки времени */
export const TIME_END = 53;

/** Маркеры дохода: пройдя (или встав) на клетку, игрок получает свой доход */
export const INCOME_MARKERS: readonly number[] = [5, 11, 17, 23, 29, 35, 41, 47, 53];

/** Позиции кожаных лоскутков 1×1 */
export const LEATHER_POS: readonly number[] = [20, 26, 32, 44, 50];

/** Стартовое количество пуговиц */
export const START_BUTTONS = 5;

/** Очки за спецплитку 7×7 */
export const TILE_7X7_POINTS = 7;

/** Штраф за пустую клетку полотна */
export const EMPTY_PENALTY = 2;

/** id кожаного лоскутка на доске */
export const LEATHER_ID = 99;

export type FabricPattern =
  | 'dots' | 'diag' | 'hatch' | 'check' | 'weave' | 'stripe' | 'cross' | 'plain';

export interface PatchDef {
  id: number;
  /** имя лоскутка */
  name: string;
  /** клетки [строка, столбец], нормализованы к (0,0) */
  cells: ReadonlyArray<readonly [number, number]>;
  /** цена в пуговицах */
  cost: number;
  /** стоимость во времени */
  time: number;
  /** доход (кнопки-пуговицы на лоскутке) */
  income: number;
  /** цвет ткани */
  color: string;
  /** текстура ткани */
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

export const PATCHES: readonly PatchDef[] = SPECS.map((s, i) => ({
  id: i,
  name: s.name,
  cells: parseRows(s.rows),
  cost: s.cost,
  time: s.time,
  income: s.income,
  color: s.color,
  pattern: s.pattern,
}));

export const TOTAL_PATCHES = PATCHES.length;

/** Кожаный лоскуток 1×1 — за прохождение спецклеток */
export const LEATHER_PATCH: PatchDef = {
  id: LEATHER_ID,
  name: 'Кожаный',
  cells: [[0, 0]],
  cost: 0,
  time: 0,
  income: 0,
  color: '#7A5230',
  pattern: 'plain',
};

/** Уровни бота */
export type BotLevel = 'glasha' | 'fedor' | 'elza';

export interface BotPersona {
  level: BotLevel;
  name: string;
  title: string;
  difficulty: string;
  quips: string[];
}

export const BOT_PERSONAS: Record<BotLevel, BotPersona> = {
  glasha: {
    level: 'glasha',
    name: 'Тётя Глаша',
    title: 'Рассеянная рукодельница',
    difficulty: 'Легко',
    quips: [
      'Ой, какой милый лоскуточек!',
      'У меня и очков-то нет…',
      'Раньше и ткани были добрее.',
      'Чайку бы сейчас…',
      'А это что за фигурка? Заберу!',
    ],
  },
  fedor: {
    level: 'fedor',
    name: 'Мастер Фёдор',
    title: 'Спокойный портной',
    difficulty: 'Средне',
    quips: [
      'Хм, прикинем на глазок…',
      'Хороший шов не терпит спешки.',
      'Заказ есть заказ.',
      'Мелом прикину — и кроить.',
      'Вот тут стежок не ляжет…',
    ],
  },
  elza: {
    level: 'elza',
    name: 'Кутюрье Эльза',
    title: 'Элегантная и безжалостная',
    difficulty: 'Сложно',
    quips: [
      'Это будет шедевр.',
      'Ткани шепчут мне свои секреты.',
      'Недурно… для любителя.',
      'Каждый стежок — расчёт.',
      'Кутюр не прощает дырок.',
    ],
  },
};

export const QUILT_HINT_EMPTY = -1;
