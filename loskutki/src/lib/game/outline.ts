/**
 * Трассировка контура полимино → SVG-путь со скруглёнными углами.
 * Каждый лоскуток выглядит цельным куском ткани, а не набором квадратов.
 */

export interface Outline {
  d: string;
  w: number;
  h: number;
}

interface Pt {
  x: number;
  y: number;
}

const R = 0.21; // радиус скругления угла (в клетках)

export function polyominoOutline(cells: ReadonlyArray<readonly [number, number]>): Outline {
  const set = new Set<number>();
  let maxR = 0;
  let maxC = 0;
  for (const [r, c] of cells) {
    set.add(r * 100 + c);
    if (r + 1 > maxR) maxR = r + 1;
    if (c + 1 > maxC) maxC = c + 1;
  }
  const has = (r: number, c: number) => set.has(r * 100 + c);

  // направленные рёбра границы: [x1,y1,x2,y2]
  const edges: Array<[number, number, number, number]> = [];
  for (const [r, c] of cells) {
    // верх (сосед сверху пуст)
    if (!has(r - 1, c)) edges.push([c, r, c + 1, r]);
    // право
    if (!has(r, c + 1)) edges.push([c + 1, r, c + 1, r + 1]);
    // низ
    if (!has(r + 1, c)) edges.push([c + 1, r + 1, c, r + 1]);
    // лево
    if (!has(r, c - 1)) edges.push([c, r + 1, c, r]);
  }

  // сшиваем рёбра в замкнутые петли
  const startMap = new Map<string, number[]>();
  edges.forEach((e, i) => {
    const k = `${e[0]},${e[1]}`;
    const arr = startMap.get(k) ?? [];
    arr.push(i);
    startMap.set(k, arr);
  });
  const used = new Array<boolean>(edges.length).fill(false);
  const loops: Pt[][] = [];
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue;
    const loop: Pt[] = [];
    let cur = i;
    while (!used[cur]) {
      used[cur] = true;
      const [x1, y1, x2, y2] = edges[cur];
      loop.push({ x: x1, y: y1 });
      const nextKey = `${x2},${y2}`;
      const candidates = startMap.get(nextKey) ?? [];
      let next = -1;
      for (const cand of candidates) if (!used[cand]) { next = cand; break; }
      if (next === -1) break;
      cur = next;
    }
    if (loop.length >= 4) loops.push(loop);
  }

  // строим path со скруглением
  let d = '';
  for (const loop of loops) {
    // убираем коллинеарные точки и скругляем повороты
    const n = loop.length;
    let prev = loop[n - 1];
    let pathStarted = false;
    for (let i = 0; i < n; i++) {
      const cur = loop[i];
      const next = loop[(i + 1) % n];
      const d1 = norm(sub(cur, prev));
      const d2 = norm(sub(next, cur));
      const cross = d1.x * d2.y - d1.y * d2.x;
      const isTurn = Math.abs(cross) > 1e-9;
      if (!isTurn) {
        // коллинеарно: точка не нужна
        prev = cur;
        continue;
      }
      if (!pathStarted) {
        // стартуем чуть раньше угла (на середине предыдущего ребра)
        const startPt = add(cur, mul(d1, -Math.min(R, 0.5)));
        d += `M ${fmt(startPt.x)} ${fmt(startPt.y)} `;
        pathStarted = true;
      }
      const a = add(cur, mul(d1, -R));
      const b = add(cur, mul(d2, R));
      d += `L ${fmt(a.x)} ${fmt(a.y)} Q ${fmt(cur.x)} ${fmt(cur.y)} ${fmt(b.x)} ${fmt(b.y)} `;
      prev = cur;
    }
    if (pathStarted) d += 'Z ';
  }
  return { d, w: maxC, h: maxR };
}

function sub(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}
function add(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y };
}
function mul(a: Pt, k: number): Pt {
  return { x: a.x * k, y: a.y * k };
}
function norm(a: Pt): Pt {
  const len = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / len, y: a.y / len };
}
function fmt(v: number): string {
  return (Math.round(v * 1000) / 1000).toString();
}

const outlineCache = new Map<string, Outline>();

/** Контур лоскутка по его клеткам (с кэшем) */
export function outlineFor(cells: ReadonlyArray<readonly [number, number]>): Outline {
  const key = cells.map((x) => `${x[0]},${x[1]}`).join('|');
  let o = outlineCache.get(key);
  if (!o) {
    o = polyominoOutline(cells);
    outlineCache.set(key, o);
  }
  return o;
}

/** Контур ориентации лоскутка (клетки ориентации) */
export function outlineForOrientation(cells: ReadonlyArray<readonly [number, number]>): Outline {
  return outlineFor(cells);
}

/** Затемнение hex-цвета (для стежков и краёв) */
export function shade(hex: string, amount: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + amount)));
  return `#${[f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Осветление */
export function tint(hex: string, amount: number): string {
  return shade(hex, amount);
}
