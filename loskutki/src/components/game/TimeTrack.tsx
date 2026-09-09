'use client';

import { INCOME_MARKERS, LEATHER_POS, TIME_END } from '@/lib/game/constants';
import { t } from '@/lib/i18n';

/**
 * Геометрия «змейки» в три ряда:
 *   ряд 1 (позиции 0–17)  — слева направо, крупные клетки;
 *   ряд 2 (позиции 18–35) — справа налево, крупные клетки;
 *   ряд 3 (позиции 36–53) — слева направо, СУЖЕННАЯ дальняя дорожка
 *     (уже и клетки, и лента — «дальше в пути всё равно редко смотришь»).
 */
const CELL = 36; // ширина клетки ближних рядов (SVG-единицы)
const CELL_FAR = 24; // ширина клетки дальней дорожки
const X0 = 34; // центр клетки 0
const X0_FAR = 33; // центр клетки 36
const Y1 = 30; // ось ряда 1
const Y2 = 92; // ось ряда 2
const Y3 = 145; // ось ряда 3
const RIB = 46; // толщина ленты ближних рядов
const RIB_FAR = 34; // толщина ленты дальней дорожки
const TURN_R = 30; // радиус правого разворота
const LAST_NEAR = X0 + 17 * CELL; // центр клеток 17 и 18 (общая вертикаль разворота)
const FAR_END = X0_FAR + 17 * CELL_FAR; // центр клетки 53 (финиш)

const isFar = (p: number) => p >= 36;

/** координаты центра клетки дорожки (0..53) */
export function trackXY(pos: number): { x: number; y: number } {
  const p = Math.max(0, Math.min(TIME_END, pos));
  if (p <= 17) return { x: X0 + p * CELL, y: Y1 };
  if (p <= 35) return { x: LAST_NEAR - (p - 18) * CELL, y: Y2 };
  return { x: X0_FAR + (p - 36) * CELL_FAR, y: Y3 };
}

// лента: ближние ряды с правым разворотом (толстая)…
const PATH_NEAR = `M ${X0} ${Y1} H ${LAST_NEAR - 17} A ${TURN_R} ${TURN_R} 0 0 1 ${LAST_NEAR + 13} ${(Y1 + Y2) / 2} A ${TURN_R} ${TURN_R} 0 0 1 ${LAST_NEAR - 17} ${Y2} H ${X0 + 5}`;
// …и суженная дальняя дорожка с левым разворотом
const PATH_FAR = `M ${X0 + 5} ${Y2} A 24 24 0 0 0 ${X0 - 25} ${(Y2 + Y3) / 2} A 24 24 0 0 0 ${X0_FAR - 4} ${Y3} H ${FAR_END}`;

export interface TrackPopup {
  id: number;
  pos: number;
  text: string;
  kind: 'income' | 'leather' | 'buttons';
}

/** радиус пуговицы-фишки игрока */
const PIN_R = 19;

/**
 * Дорожка времени «змейкой» в три ряда; дальняя треть — сужена.
 * Фишки — крупные круглые пуговки БЕЗ ножки: поодиночке стоят в центре
 * своей клетки, вдвоём на одной клетке — сверху/снизу (кто ходит — сверху).
 */
export function TimeTrack({
  positions,
  activePlayer,
  onTop,
  labels = ['Я', 'Ф'],
  leatherClaimed,
  popups = [],
  advanceHint = null,
  playerColors = ['#B54A32', '#3E7C74'],
}: {
  positions: [number, number];
  activePlayer: number;
  /** кто «сверху» при равенстве — вставшая точно на клетку соперника (она и ходит ещё раз) */
  onTop: number;
  /** буковки на пуговках: [игрок 0, игрок 1] */
  labels?: [string, string];
  leatherClaimed: number;
  popups?: TrackPopup[];
  advanceHint?: { player: number; from: number; to: number } | null;
  playerColors?: [string, string];
}) {
  // язык читается в t() при каждом ререндере; TimeTrack перерисовывается родителем
  const sameCell = positions[0] === positions[1];

  const pawn = (player: number, dy: number) => {
    const { x, y } = trackXY(positions[player]);
    const color = playerColors[player];
    const isActive = activePlayer === player;
    const label = labels[player] ?? '';
    const fs = label.length > 1 ? 13 : 15.5;
    return (
      <g
        key={`pawn${player}`}
        style={{
          transform: `translate(${x}px, ${y + dy}px)`,
          transition: 'transform 420ms cubic-bezier(.22,.9,.36,1.2)',
        }}
      >
        {/* пульс у того, чей ход */}
        {isActive && (
          <circle cx="0" cy="0" r={PIN_R} fill="none" stroke={color} strokeWidth="2.5" opacity="0.5">
            <animate attributeName="r" values="20;27;20" dur="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.55;0.1;0.55" dur="1.6s" repeatCount="indefinite" />
          </circle>
        )}
        {/* пуговка-фишка (без ножки) */}
        <circle cx="0" cy="0" r={PIN_R} fill={color} stroke="#fff" strokeWidth="3" />
        <circle cx="0" cy="0" r={PIN_R - 4.5} fill="none" stroke="#fff" opacity="0.35" strokeWidth="1.3" />
        <text
          x="0"
          y="0"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={fs}
          fontWeight="800"
          fill="#FFFDF4"
        >
          {label}
        </text>
        <path
          d="M -10 -9 A 13 13 0 0 1 -2.5 -14.5"
          stroke="#FFFDF4"
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
          opacity="0.7"
        />
      </g>
    );
  };

  return (
    <svg
      viewBox="-14 -16 706 186"
      style={{ display: 'block', width: '100%', height: 'auto' }}
      role="img"
      aria-label={t('t_aria')}
    >
      {/* лента */}
      <path d={PATH_NEAR} fill="none" stroke="#E7D3B0" strokeWidth={RIB} strokeLinecap="round" />
      <path d={PATH_FAR} fill="none" stroke="#E7D3B0" strokeWidth={RIB_FAR} strokeLinecap="round" />
      <path d={PATH_NEAR} fill="none" stroke="#D9BE92" strokeWidth={RIB + 4} strokeLinecap="round" strokeDasharray="1.5 14" opacity="0.9" />
      <path d={PATH_FAR} fill="none" stroke="#D9BE92" strokeWidth={RIB_FAR + 4} strokeLinecap="round" strokeDasharray="1.5 14" opacity="0.9" />
      <path d={PATH_NEAR} fill="none" stroke="#C7A87C" strokeWidth="2" strokeDasharray="9 7" opacity="0.8" />
      <path d={PATH_FAR} fill="none" stroke="#C7A87C" strokeWidth="2" strokeDasharray="9 7" opacity="0.8" />

      {/* деления между клетками — чтобы считать клетки между отметками */}
      <g stroke="#B69465" strokeWidth="2.6" strokeLinecap="round" opacity="0.55">
        {Array.from({ length: 17 }, (_, i) => (
          <line key={`tick-t${i}`} x1={X0 + (i + 0.5) * CELL} y1={Y1 - 20} x2={X0 + (i + 0.5) * CELL} y2={Y1 + 20} />
        ))}
        {Array.from({ length: 17 }, (_, i) => (
          <line key={`tick-m${i}`} x1={LAST_NEAR - (i + 0.5) * CELL} y1={Y2 - 20} x2={LAST_NEAR - (i + 0.5) * CELL} y2={Y2 + 20} />
        ))}
        {Array.from({ length: 17 }, (_, i) => (
          <line key={`tick-b${i}`} x1={X0_FAR + (i + 0.5) * CELL_FAR} y1={Y3 - 14} x2={X0_FAR + (i + 0.5) * CELL_FAR} y2={Y3 + 14} />
        ))}
      </g>

      {/* подсказка продвижения */}
      {advanceHint && advanceHint.to > advanceHint.from && (
        <g>
          {Array.from({ length: advanceHint.to - advanceHint.from }, (_, i) => {
            const pos = advanceHint.from + 1 + i;
            const { x, y } = trackXY(pos);
            return <circle key={pos} cx={x} cy={y} r={isFar(pos) ? 9 : 15.5} fill="#B54A32" opacity="0.16" />;
          })}
        </g>
      )}

      {/* маркеры дохода — крупные «пуговицы» с окантовкой и блеском
          (на дальней дорожке — чуть меньше) */}
      {INCOME_MARKERS.map((pos) => {
        const { x, y } = trackXY(pos);
        const far = isFar(pos);
        return (
          <g key={`inc${pos}`} transform={`translate(${x} ${y})${far ? ' scale(0.84)' : ''}`}>
            <circle r="15.5" fill="#F6EBCD" stroke="#B08A54" strokeWidth="2.4" />
            <circle r="12.5" fill="none" stroke="#D9C28E" strokeWidth="1.4" />
            <circle cx="-4.2" cy="-4.2" r="2.1" fill="#8a6b46" />
            <circle cx="4.2" cy="-4.2" r="2.1" fill="#8a6b46" />
            <circle cx="-4.2" cy="4.2" r="2.1" fill="#8a6b46" />
            <circle cx="4.2" cy="4.2" r="2.1" fill="#8a6b46" />
            <path d="M -9.5 -7 A 11 11 0 0 1 -2 -11.5" stroke="#FFFDF4" strokeWidth="2.2" fill="none" strokeLinecap="round" opacity="0.85" />
          </g>
        );
      })}

      {/* кожаные лоскутки — крупнее, со стёжкой по краю */}
      {LEATHER_POS.map((pos, i) => {
        const { x, y } = trackXY(pos);
        const claimed = i < leatherClaimed;
        const far = isFar(pos);
        return (
          <g key={`lp${pos}`} transform={`translate(${x} ${y})${far ? ' scale(0.85)' : ''}`} opacity={claimed ? 0.25 : 1}>
            <rect x="-13" y="-13" width="26" height="26" rx="5.5" fill="#7A5230" stroke="#5B3B20" strokeWidth="2.4" />
            <rect x="-9" y="-9" width="18" height="18" rx="3" fill="none" stroke="#9C6E45" strokeWidth="1.6" strokeDasharray="3 2.4" />
            <path d="M -5.5 -5.5 L 5.5 5.5 M 5.5 -5.5 L -5.5 5.5" stroke="#4E3018" strokeWidth="2" opacity="0.65" strokeLinecap="round" />
          </g>
        );
      })}

      {/* старт/финиш */}
      <text x="-8" y={Y1 - 24} fontSize="13" fill="#8a6b46" fontWeight="700" letterSpacing="1">
        {t('t_start')}
      </text>
      <text x={FAR_END + 22} y={Y3 + 4.5} fontSize="13.5" fill="#8a6b46" fontWeight="700" letterSpacing="1">
        {t('t_finish')}
      </text>

      {/* пуговки-фишки: поодиночке — в центре клетки; вдвоём — сверху/снизу,
          ходящий (по правилам — «верхняя» фишка) рисуется последним и выше */}
      {sameCell
        ? [1 - onTop, onTop].map((p) => pawn(p, p === onTop ? -13 : 13))
        : [0, 1].map((p) => pawn(p, 0))}

      {/* всплывашки событий */}
      {popups.map((p) => {
        const { x, y } = trackXY(p.pos);
        return (
          <g key={p.id} transform={`translate(${x} ${y - 26})`}>
            <g className="track-popup">
              <text
                textAnchor="middle"
                fontSize="20"
                fontWeight="800"
                fill={p.kind === 'income' ? '#7d5a1e' : '#B54A32'}
                stroke="#FBF3E0"
                strokeWidth="4"
                paintOrder="stroke"
              >
                {p.text}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
