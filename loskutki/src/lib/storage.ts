'use client';

import type { BotLevel } from './game/constants';
import type { Lang } from './i18n';
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
    /** язык интерфейса — русский по умолчанию */
    lang: Lang;
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
    /** онлайн-партии (с друзьями и по коду) — общий счёт для достижений */
    onlineGames: number;
    onlineWins: number;
  };
  achievements: Record<string, number>;
  daily: Record<string, DailyRecord>;
  currentGame: GameState | null;
  /** статистика онлайн-партий с друзьями (ключ — uid друга) */
  friendStats: Record<string, FriendFoeStat>;
}

export interface FriendFoeStat {
  name: string;
  avatar: string;
  games: number;
  wins: number;
  losses: number;
  lastAt: number;
}

export const DEFAULT_STORE: StatsStore = {
  settings: { sound: true, vibration: true, hints: true, lang: 'ru' },
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
    onlineGames: 0,
    onlineWins: 0,
  },
  achievements: {},
  daily: {},
  currentGame: null,
  friendStats: {},
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
      friendStats: parsed.friendStats ?? {},
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
  icon: string; // emoji-иконка; название и описание — в i18n (achTitle/achDesc)
  /** сложность: 1 — лёгкое, 2 — среднее, 3 — сложное (звёзды в статистике) */
  tier: 1 | 2 | 3;
}

// Порядок = прогрессия: от простых к сложным, ★3 — в конце списка.
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-win', icon: '🧵', tier: 1 },
  { id: 'games-5', icon: '🪡', tier: 1 },
  { id: 'games-25', icon: '🧶', tier: 1 },
  { id: 'daily-win', icon: '📅', tier: 1 },
  { id: 'online-win', icon: '🤝', tier: 1 },
  { id: 'wins-10', icon: '⚔️', tier: 1 },
  { id: 'tile7x7', icon: '🏅', tier: 2 },
  { id: 'full-quilt', icon: '✨', tier: 2 },
  { id: 'big-score', icon: '💎', tier: 2 },
  { id: 'rich', icon: '🪙', tier: 2 },
  { id: 'streak-3', icon: '🔥', tier: 2 },
  { id: 'beat-elza', icon: '👑', tier: 2 },
  { id: 'games-100', icon: '📚', tier: 2 },
  { id: 'wins-25', icon: '🎖️', tier: 2 },
  { id: 'beat-all', icon: '🧩', tier: 2 },
  { id: 'daily-7', icon: '📆', tier: 2 },
  { id: 'leather-5', icon: '🥾', tier: 3 },
  { id: 'wins-50', icon: '🏆', tier: 3 },
  { id: 'streak-5', icon: '💫', tier: 3 },
  { id: 'streak-10', icon: '🚀', tier: 3 },
  { id: 'beat-elza-5', icon: '👗', tier: 3 },
  { id: 'big-score-50', icon: '⚡', tier: 3 },
  { id: 'rich-30', icon: '💰', tier: 3 },
  { id: 'margin-15', icon: '🥊', tier: 3 },
  { id: 'avg-cov-70', icon: '📐', tier: 3 },
  { id: 'online-wins-10', icon: '🌐', tier: 3 },
  { id: 'perfect-quilt', icon: '💠', tier: 3 },
];

export interface GameSummary {
  won: boolean;
  score: number;
  botLevel: BotLevel;
  coverage: number;
  leatherPlaced: number;
  tile7x7: boolean;
  finalButtons: number;
  /** итог соперника — для достижений про перевес («Разгром») */
  foeScore: number;
  mode: 'casual' | 'daily' | 'online';
  dailyKey?: string;
  /** онлайн-партия с другом —uid/имя/аватар соперника для «С друзьями» */
  foe?: { uid: string; name: string; avatar: string };
}

/** Записать результат партии, вернуть разблокированные достижения */
export function recordGame(store: StatsStore, summary: GameSummary): {
  store: StatsStore;
  unlocked: Achievement[];
} {
  const next = structuredCloneSafe(store);
  const s = next.stats;
  s.games++;
  // по уровням ботов — только партии ПРОТИВ БОТОВ: у онлайн-партий
  // botLevel технически 'fedor', но это живой соперник — не считать его
  // победой над Фёдором (иначе врёт «побед: X из Y» и «Полная коллекция»)
  const vsBot = summary.mode !== 'online';
  if (vsBot) s.byLevel[summary.botLevel].games++;
  const covered = summary.coverage;
  s.totalCoverage += covered;
  if (covered > s.bestCoverage) s.bestCoverage = covered;
  if (summary.leatherPlaced > s.leatherMax) s.leatherMax = summary.leatherPlaced;
  if (summary.mode === 'online') {
    s.onlineGames++;
    if (summary.won) s.onlineWins++;
  }
  if (summary.won) {
    s.wins++;
    if (vsBot) s.byLevel[summary.botLevel].wins++;
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

  // онлайн-партия с другом — личный счёт («те, кто в статистике»)
  if (summary.mode === 'online' && summary.foe?.uid) {
    const prev = next.friendStats[summary.foe.uid];
    next.friendStats[summary.foe.uid] = {
      name: summary.foe.name,
      avatar: summary.foe.avatar,
      games: (prev?.games ?? 0) + 1,
      wins: (prev?.wins ?? 0) + (summary.won ? 1 : 0),
      losses: (prev?.losses ?? 0) + (summary.won ? 0 : 1),
      lastAt: Date.now(),
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
  check('beat-elza', summary.won && summary.botLevel === 'elza' && vsBot);
  check('streak-3', s.streak >= 3);
  check('daily-win', summary.won && summary.mode === 'daily');
  check('leather-5', summary.leatherPlaced >= 5);
  check('wins-10', s.wins >= 10);
  // ===== новые (v3.10.0): больше и сложнее =====
  check('games-100', s.games >= 100);
  check('wins-25', s.wins >= 25);
  check('wins-50', s.wins >= 50);
  check('streak-5', s.streak >= 5);
  check('streak-10', s.streak >= 10);
  check('beat-elza-5', s.byLevel.elza.wins >= 5);
  check('beat-all', (Object.keys(s.byLevel) as BotLevel[]).every((l) => s.byLevel[l].wins >= 1));
  check('big-score-50', summary.won && summary.score >= 50);
  check('rich-30', summary.finalButtons >= 30);
  check('margin-15', summary.won && summary.score - summary.foeScore >= 15);
  check('perfect-quilt', covered >= 81);
  check('daily-7', Object.values(next.daily).filter((d) => d.won).length >= 7);
  check('online-win', summary.won && summary.mode === 'online');
  check('online-wins-10', s.onlineWins >= 10);
  check('avg-cov-70', s.games >= 10 && s.totalCoverage / s.games >= 70);

  return { store: next, unlocked };
}

/** Текст результата для «поделиться» (не используется в UI, оставлен для будущего) */
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
