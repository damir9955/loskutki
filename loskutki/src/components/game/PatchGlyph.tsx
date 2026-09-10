'use client';

import { PATCHES, type PatchDef, LEATHER_ID, LEATHER_PATCH } from '@/lib/game/constants';
import { orientationsFor } from '@/lib/game/placement';
import { outlineFor, shade } from '@/lib/game/outline';

/**
 * Рисует лоскуток как цельный кусок ткани:
 * заливка + фактура + стёжка по краю + пуговицы дохода.
 * Внутренних швов НЕТ — как в оригинальном Patchwork: фигурка —
 * единый лоскут, а не сшитые из квадратов клетки.
 */
export function PatchGlyph({
  patchId,
  orientation = 0,
  cell = 100,
  x = 0,
  y = 0,
  income = true,
  className,
  opacity = 1,
  ghost,
}: {
  patchId: number;
  orientation?: number;
  cell?: number;
  x?: number;
  y?: number;
  income?: boolean;
  className?: string;
  opacity?: number;
  ghost?: 'ok' | 'bad' | undefined;
}) {
  const def: PatchDef = patchId === LEATHER_ID ? LEATHER_PATCH : PATCHES[patchId];
  const orients = orientationsFor(patchId);
  const orient = orients[Math.min(orientation, orients.length - 1)];
  const outline = outlineFor(orient.cells);
  const dark = shade(def.color, -46);
  const stitch = shade(def.color, -70);

  const cells = orient.cells;
  // якорные клетки для пуговиц дохода: первые по порядку клетки лоскутка
  const incomeCells = income ? cells.slice(0, Math.max(0, def.income)) : [];

  return (
    <g transform={`translate(${x} ${y}) scale(${cell})`}>
      <g
        className={className}
        opacity={opacity}
        style={{ overflow: 'visible', transformBox: 'fill-box', transformOrigin: 'center' }}
      >
      {/* тень ткани */}
      <path d={outline.d} fill={shade(def.color, -30)} transform="translate(0.035 0.045)" opacity={0.35} />
      {/* основная ткань */}
      <path d={outline.d} fill={def.color} />
      {/* фактура */}
      <path d={outline.d} fill={`url(#fab-${def.pattern})`} />
      {/* блик сверху */}
      <path d={outline.d} fill="url(#fab-sheen)" />
      {/* обводка */}
      <path d={outline.d} fill="none" stroke={dark} strokeWidth={0.045} />
      {/* стёжка по краю (внутренних швов нет — фигурка единая, как в оригинале) */}
      <path
        d={outline.d}
        fill="none"
        stroke={stitch}
        strokeWidth={0.055}
        strokeDasharray="0.16 0.11"
        strokeLinecap="round"
        transform="translate(0 0)"
      />
      {/* призрак: зелёный/красный оверлей */}
      {ghost && (
        <path
          d={outline.d}
          fill={ghost === 'ok' ? '#3f9c46' : '#c33a2f'}
          opacity={0.55}
        />
      )}
      {/* пуговицы дохода: костяная пуговица с фаской и бликом */}
      {incomeCells.map(([r, c], i) => (
        <g key={`btn-${i}`} transform={`translate(${c + 0.5} ${r + 0.5}) scale(0.6)`}>
          <circle r={0.46} cy={0.07} fill="#2E1D0E" opacity={0.22} />
          <circle r={0.42} fill="#F8F0DD" stroke="#5B3B20" strokeWidth={0.11} />
          <circle r={0.29} fill="none" stroke="#C9B583" strokeWidth={0.06} />
          <circle r={0.1} cx={-0.13} cy={-0.13} fill="#5B3B20" />
          <circle r={0.1} cx={0.13} cy={-0.13} fill="#5B3B20" />
          <circle r={0.1} cx={-0.13} cy={0.13} fill="#5B3B20" />
          <circle r={0.1} cx={0.13} cy={0.13} fill="#5B3B20" />
          <path
            d="M -0.3 -0.14 A 0.33 0.33 0 0 1 -0.06 -0.3"
            stroke="#ffffff"
            strokeWidth={0.06}
            opacity={0.55}
            fill="none"
            strokeLinecap="round"
          />
        </g>
      ))}
      </g>
    </g>
  );
}

/** Клетки определённой ориентации лоскутка */
export function orientationCells(patchId: number, orientation: number) {
  const orients = orientationsFor(patchId);
  return orients[Math.min(orientation, orients.length - 1)].cells;
}

export function orientationCount(patchId: number): number {
  return orientationsFor(patchId).length;
}

export function orientationSize(patchId: number, orientation: number): { w: number; h: number } {
  const o = orientationsFor(patchId)[Math.min(orientation, orientationsFor(patchId).length - 1)];
  return { w: o.w, h: o.h };
}
