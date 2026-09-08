'use client';

import { INCOME_MARKERS, LEATHER_POS, TIME_END } from '@/lib/game/constants';
import { t } from '@/lib/i18n';

const CELL = 34;
const TOP_Y = 36;
const BOT_Y = 108;
const W = 27 * CELL;

/** координаты центра клетки дорожки (0..53) */
export function trackXY(pos: number): { x: number; y: number } {
  const p = Math.max(0, Math.min(TIME_END, pos));
  if (p <= 26) return { x: 17 + p * CELL, y: TOP_Y };
  const k = p - 27;
  return { x: W - 17 - k * CELL, y: BOT_Y };
}

export interface TrackPopup {
  id: number;
  pos: number;
  text: string;
  kind: 'income' | 'leather' | 'buttons';
}

/**
 * Дорожка времени «змейкой»: 0→26 вправо, 27→53 влево по нижнему ряду.
 */
export function TimeTrack({
  positions,
  activePlayer,
  onTop,
  labels = ['В', 'С'],
  leatherClaimed,
  popups = [],
  advanceHint = null,
  playerColors = ['#B54A32', '#3E7C74'],
}: {
  positions: [number, number];
  activePlayer: number;
  /** кто «сверху» при равенстве — вставшая точно на клетку соперника (она и ходит ещё раз) */
  onTop: number;
  /** буковки на булавках: [игрок 0, игрок 1] */
  labels?: [string, string];
  leatherClaimed: number;
  popups?: TrackPopup[];
  advanceHint?: { player: number; from: number; to: number } | null;
  playerColors?: [string, string];
}) {
  // язык читается в t() при каждом ререндере; TimeTrack перерисовывается родителем
  const ribbon = `M 24 ${TOP_Y} H ${W - 34} A 30 30 0 0 1 ${W - 4} ${TOP_Y + 30} A 30 30 0 0 1 ${W - 34} ${BOT_Y} H 24`;

  const sameCell = positions[0] === positions[1];

  const pawn = (player: number, dy: number, big: boolean) => {
    const { x, y } = trackXY(positions[player]);
    const color = playerColors[player];
    const isActive = activePlayer === player;
    return (
      <g
        key={`pawn${player}`}
        style={{
          transform: `translate(${x}px, ${y + dy}px)`,
          transition: 'transform 420ms cubic-bezier(.22,.9,.36,1.2)',
        }}
      >
        {/* игла-булавка */}
        <line x1="0" y1="-6" x2="0" y2="26" stroke="#6b5540" strokeWidth="3" strokeLinecap="round" />
        {/* головка-шляпка с буковкой игрока */}
        <circle cx="0" cy="-12" r={big ? 13 : 11} fill={color} stroke="#fff" strokeWidth={big ? 3 : 2} />
        <text
          x="0"
          y="-12"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={big ? 11.5 : 10}
          fontWeight="800"
          fill="#FFFDF4"
        >
          {labels[player]}
        </text>
        <circle cx="-5.5" cy="-17.5" r="2.4" fill="#ffffff" opacity="0.5" />
        {isActive && (
          <circle cx="0" cy="-12" r="19" fill="none" stroke={color} strokeWidth="2.5" opacity="0.5">
            <animate attributeName="r" values="15;20;15" dur="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.55;0.1;0.55" dur="1.6s" repeatCount="indefinite" />
          </circle>
        )}
      </g>
    );
  };

  return (
    <svg
      viewBox={`-6 -12 ${W + 12} 158`}
      style={{ display: 'block', width: '100%', height: 'auto' }}
      role="img"
      aria-label={t('t_aria')}
    >
      {/* лента */}
      <path d={ribbon} fill="none" stroke="#E7D3B0" strokeWidth="60" strokeLinecap="round" />
      <path d={ribbon} fill="none" stroke="#D9BE92" strokeWidth="64" strokeLinecap="round" strokeDasharray="1.5 14" opacity="0.9" />
      <path d={ribbon} fill="none" stroke="#C7A87C" strokeWidth="2" strokeDasharray="9 7" opacity="0.8" />

      {/* деления между клетками — чтобы считать клетки между отметками */}
      <g stroke="#B69465" strokeWidth="2.6" strokeLinecap="round" opacity="0.55">
        {Array.from({ length: 25 }, (_, i) => (
          <line key={`tick-t${i}`} x1={17 + (i + 0.5) * CELL} y1={TOP_Y - 23} x2={17 + (i + 0.5) * CELL} y2={TOP_Y + 23} />
        ))}
        {Array.from({ length: 25 }, (_, i) => (
          <line key={`tick-b${i}`} x1={W - 17 - (i + 0.5) * CELL} y1={BOT_Y - 23} x2={W - 17 - (i + 0.5) * CELL} y2={BOT_Y + 23} />
        ))}
      </g>

      {/* подсказка продвижения */}
      {advanceHint && advanceHint.to > advanceHint.from && (
        <g>
          {Array.from({ length: advanceHint.to - advanceHint.from }, (_, i) => {
            const pos = advanceHint.from + 1 + i;
            const { x, y } = trackXY(pos);
            return <circle key={pos} cx={x} cy={y} r="14" fill="#B54A32" opacity="0.16" />;
          })}
        </g>
      )}

      {/* маркеры дохода — крупные «пуговицы» с окантовкой и блеском */}
      {INCOME_MARKERS.map((pos) => {
        const { x, y } = trackXY(pos);
        return (
          <g key={`inc${pos}`} transform={`translate(${x} ${y})`}>
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
        return (
          <g key={`lp${pos}`} transform={`translate(${x} ${y})`} opacity={claimed ? 0.25 : 1}>
            <rect x="-13" y="-13" width="26" height="26" rx="5.5" fill="#7A5230" stroke="#5B3B20" strokeWidth="2.4" />
            <rect x="-9" y="-9" width="18" height="18" rx="3" fill="none" stroke="#9C6E45" strokeWidth="1.6" strokeDasharray="3 2.4" />
            <path d="M -5.5 -5.5 L 5.5 5.5 M 5.5 -5.5 L -5.5 5.5" stroke="#4E3018" strokeWidth="2" opacity="0.65" strokeLinecap="round" />
          </g>
        );
      })}

      {/* старт/финиш */}
      <text x="2" y={TOP_Y - 24} fontSize="13" fill="#8a6b46" fontWeight="700" letterSpacing="1">
        {t('t_start')}
      </text>
      <text x="2" y={BOT_Y + 34} fontSize="13" fill="#8a6b46" fontWeight="700" letterSpacing="1">
        {t('t_finish')}
      </text>

      {/* фишки-булавки: при равенстве «верхняя» (вставшая на клетку соперника)
          рисуется ПОЗЖЕ и ВЫШЕ — её буковка оказывается над другой */}
      {sameCell
        ? [1 - onTop, onTop].map((p) => pawn(p, p === onTop ? -11 : 7, p === onTop))
        : [0, 1].map((p) => pawn(p, 0, p === onTop))}

      {/* всплывашки событий */}
      {popups.map((p) => {
        const { x, y } = trackXY(p.pos);
        return (
          <g key={p.id} transform={`translate(${x} ${y - 24})`}>
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
