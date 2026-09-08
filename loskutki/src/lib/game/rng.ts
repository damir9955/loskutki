/** Детерминированный ГПСЧ mulberry32 — одинаковый seed даёт одинаковую партию */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** seed для «игры дня» — по локальной дате (UTC+3 дня считается по Москве? нет — по дате клиента) */
export function dailySeed(date: Date): number {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return (y * 10000 + m * 100 + d) ^ 0x5f3759df;
}

export function dailyNumber(date: Date): number {
  const start = new Date(2024, 0, 1).getTime();
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.floor((today - start) / 86400000);
}

export function formatDailySeed(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
