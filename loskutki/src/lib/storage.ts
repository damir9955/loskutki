'use client';

import type { BotLevel } from './game/constants';
import type { GameState, GameResult } from './game/types';
import { dailySeed, dailyNumber } from './game/rng';

const KEY = 'loskutki.v1';

export interface DailyRecord {
  day: number;
  won: boolean;
  score: number;
  botScore: number;
}

export interface StatsStore {
  settings: {
    sound: boolean;
    vibration: boolean;
    hints: boolean;
  };
  stats: {
    games: number;
    wins: number;
    losses: number;
    byLevel: Record<BotLevel, { games: number; wins: number }>;
    bestScore: number;
    bestCoverage: number;
    totalCoverage: number;
    streak: number;
    bestStreak: number;
    leatherMax: number;
  };
  achievements: Record<string, number>;
  daily: Record<string, DailyRecord>;
  currentGame: GameState | null;
}

export const DEFAULT_STORE: StatsStore = {
  settings: { sound: true, vibration: true, hints: true },
  stats: {
    games: 0,
    wins: 0,
    losses: 0,
    byLevel: {
      glasha: { games: 0, wins: 0 },
      fedor: { games: 0, wins: 0 },
      elza: { games: 0, wins: 0 },
    },
    bestScore: -Infinity,
    bestCoverage: 0,
    totalCoverage: 0,
    streak: 0,
    bestStreak: 0,
    leatherMax: 0,
  },
  achievements: {},
  daily: {},
  currentGame: null,
};

export function loadStore(): StatsStore {
  if (typeof window === 'undefined') return { ...DEFAULT_STORE, stats: { ...DEFAULT_STORE.stats }, daily: {}, achievements: {} };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredCloneSafe(DEFAULT_STORE);
    const parsed = JSON.parse(raw) as Partial<StatsStore>;
    return {
      settings: { ...DEFAULT_STORE.settings, ...parsed.settings },
      stats: {
        ...DEFAULT_STORE.stats,
        ...parsed.stats,
        byLevel: { ...DEFAULT_STORE.stats.byLevel, ...parsed.stats?.byLevel },
      },
      achievements: parsed.achievements ?? {},
      daily: parsed.daily ?? {},
      currentGame: parsed.currentGame ?? null,
    };
  } catch {
    return structuredCloneSafe(DEFAULT_STORE);
  }
}

function structuredCloneSafe(s: StatsStore): StatsStore {
  return JSON.parse(JSON.stringify(s)) as StatsStore;
}

export function saveStore(store: StatsStore) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
    cached = null;
    listeners.forEach((l) => l());
  } catch {
    /* переполнение — не критично */
  }
}

// ===== Реактивная подписка для useSyncExternalStore =====

const listeners = new Set<() => void>();
let cached: StatsStore | null = null;
const SERVER_SNAPSHOT: StatsStore = JSON.parse(JSON.stringify({
  ...DEFAULT_STORE,
  stats: { ...DEFAULT_STORE.stats },
  achievements: {},
  daily: {},
}));

export function subscribeStore(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getStoreSnapshot(): StatsStore {
  if (!cached) cached = loadStore();
  return cached;
}

export function getStoreServerSnapshot(): StatsStore {
  return SERVER_SNAPSHOT;
}

export function notifyStoreChanged() {
  cached = null;
  listeners.forEach((l) => l());
}

// ===== Достижения =====

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string; // emoji-иконка
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-win', title: 'Первая победа', description: 'Выиграть первую партию', icon: '🧵' },
  { id: 'games-5', title: 'Ученица', description: 'Сыграть 5 партий', icon: '🪡' },
  { id: 'games-25', title: 'Мастерица', description: 'Сыграть 25 партий', icon: '🧶' },
  { id: 'tile7x7', title: 'Золотая нашивка', description: 'Получить спецплитку 7×7', icon: '🏅' },
  { id: 'full-quilt', title: 'Полное полотно', description: 'Закрыть 78+ из 81 клетки', icon: '✨' },
  { id: 'big-score', title: 'Идеальный шов', description: 'Выиграть со счётом 30+', icon: '💎' },
  { id: 'rich', title: 'Богиня пуговиц', description: 'Завершить партию с 20+ пуговицами', icon: '🪙' },
  { id: 'beat-elza', title: 'Скорняк', description: 'Победить Кутюрье Эльзу', icon: '👑' },
  { id: 'streak-3', title: 'Хет-трик', description: 'Три победы подряд', icon: '🔥' },
  { id: 'daily-win', title: 'Идеальный день', description: 'Победить в Игре дня', icon: '📅' },
  { id: 'leather-5', title: 'Кожаная классика', description: 'Зашить все 5 кожаных лоскутков за партию', icon: '🥾' },
  { id: 'wins-10', title: 'Дуэлянт', description: 'Выиграть 10 партий', icon: '⚔️' },
];

export interface GameSummary {
  won: boolean;
  score: number;
  botLevel: BotLevel;
  coverage: number;
  leatherPlaced: number;
  tile7x7: boolean;
  finalButtons: number;
  mode: 'casual' | 'daily';
  dailyKey?: string;
}

/** Записать результат партии, вернуть разблокированные достижения */
export function recordGame(store: StatsStore, summary: GameSummary): {
  store: StatsStore;
  unlocked: Achievement[];
} {
  const next = structuredCloneSafe(store);
  const s = next.stats;
  s.games++;
  s.byLevel[summary.botLevel].games++;
  const covered = summary.coverage;
  s.totalCoverage += covered;
  if (covered > s.bestCoverage) s.bestCoverage = covered;
  if (summary.leatherPlaced > s.leatherMax) s.leatherMax = summary.leatherPlaced;
  if (summary.won) {
    s.wins++;
    s.byLevel[summary.botLevel].wins++;
    s.streak++;
    if (s.streak > s.bestStreak) s.bestStreak = s.streak;
    if (summary.score > s.bestScore) s.bestScore = summary.score;
  } else {
    s.losses++;
    s.streak = 0;
  }

  if (summary.mode === 'daily' && summary.dailyKey) {
    next.daily[summary.dailyKey] = {
      day: dailyNumber(new Date()),
      won: summary.won,
      score: summary.score,
      botScore: 0,
    };
  }

  const unlocked: Achievement[] = [];
  const check = (id: string, cond: boolean) => {
    if (cond && !next.achievements[id]) {
      next.achievements[id] = Date.now();
      unlocked.push(ACHIEVEMENTS.find((a) => a.id === id)!);
    }
  };
  check('first-win', summary.won);
  check('games-5', s.games >= 5);
  check('games-25', s.games >= 25);
  check('tile7x7', summary.tile7x7);
  check('full-quilt', covered >= 78);
  check('big-score', summary.won && summary.score >= 30);
  check('rich', summary.finalButtons >= 20);
  check('beat-elza', summary.won && summary.botLevel === 'elza');
  check('streak-3', s.streak >= 3);
  check('daily-win', summary.won && summary.mode === 'daily');
  check('leather-5', summary.leatherPlaced >= 5);
  check('wins-10', s.wins >= 10);

  return { store: next, unlocked };
}

/** Текст результата для «поделиться» */
export function shareText(state: GameState): string {
  const r = state.result;
  if (!r) return '';
  const my = r.scores[0];
  const bot = r.scores[1];
  const lvlNames: Record<string, string> = { glasha: 'Тётя Глаша', fedor: 'Мастер Фёдор', elza: 'Кутюрье Эльза' };
  const head = state.mode === 'daily' ? '🧶 Игра дня — Лоскутки' : '🧶 Лоскутки';
  const res = r.winner === 0 ? 'Победа!' : r.winner === null ? 'Ничья' : 'Поражение';
  return [
    head,
    res,
    `Счёт ${my.total} : ${bot.total} (против ${lvlNames[state.botLevel]})`,
    `Закрыто ${my.covered}/81 клеток`,
    state.seed ? `seed: ${state.seed}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function todaySeedValue(): number {
  return dailySeed(new Date());
}
