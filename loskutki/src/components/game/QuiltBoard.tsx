'use client';

import { useCallback, useMemo, useRef } from 'react';
import { BOARD_SIZE, LEATHER_ID } from '@/lib/game/constants';
import {
  boardPieces,
  boardRows,
  canPlaceAt,
  orientationsFor,
} from '@/lib/game/placement';
import { t } from '@/lib/i18n';
import { PatchGlyph, orientationCells } from './PatchGlyph';

export interface BoardTheme {
  bg: string;
  grid: string;
  frame: string;
}

const CLASSIC: BoardTheme = {
  bg: '#F4EAD2',
  grid: '#D9C9A3',
  frame: '#8B5E3C',
};

/**
 * Полотно 9×9: лён, стёжка-сетка, лоскутки, призрак размещения.
 * В режиме размещения обрабатывает перетаскивание пальцем.
 */
export function QuiltBoard({
  board,
  interactive = false,
  placing = null,
  onPlace = null,
  highlightCells = null,
  showPlacementGrid = false,
  theme = CLASSIC,
  className,
  dim = false,
  flashPiece = null,
  ghostBadges = null,
}: {
  board: number[];
  interactive?: boolean;
  /** текущее размещение-призрак */
  placing?: { patchId: number; orientation: number; r: number; c: number } | null;
  onPlace?: ((r: number, c: number) => void) | null;
  highlightCells?: Set<number> | null;
  showPlacementGrid?: boolean;
  theme?: BoardTheme;
  className?: string;
  dim?: boolean;
  /** какой экземпляр только что лёг (анимация): id + якорь (для кожаных) */
  flashPiece?: { pieceId: number; r?: number; c?: number } | null;
  /** бирки «цена · время» на призраке */
  ghostBadges?: { cost: number; time: number } | null;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pieces = useMemo(() => boardPieces(board), [board]);

  const ghost = useMemo(() => {
    if (!placing) return null;
    const orients = orientationsFor(placing.patchId);
    const orient = orients[Math.min(placing.orientation, orients.length - 1)];
    const legal = canPlaceAt(orient, placing.r, placing.c, boardRows(board));
    return { orient, legal };
  }, [placing, board]);

  const pointToCell = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    // svg может быть неквадратным (letterbox): контент центрируется по preserveAspectRatio
    const side = Math.min(rect.width, rect.height);
    const offX = (rect.width - side) / 2;
    const offY = (rect.height - side) / 2;
    const scale = 900 / side;
    const x = (clientX - rect.left - offX) * scale;
    const y = (clientY - rect.top - offY) * scale;
    const c = Math.floor(x / 100);
    const r = Math.floor(y / 100);
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return null;
    return { r, c };
  }, []);

  const handlePointer = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!interactive || !onPlace) return;
      const cell = pointToCell(e.clientX, e.clientY);
      if (!cell) return;
      // режим кожаного лоскутка: тап напрямую по клетке (родитель валидирует)
      if (!placing || !ghost) {
        onPlace(cell.r, cell.c);
        return;
      }
      const { h, w } = ghost.orient;
      // лоскуток центрируется НА клетке под пальцем: палец указывает место —
      // фигура обязана попадать именно туда (вниз/в самый нижний ряд тоже)
      const r = clamp(cell.r - Math.floor((h - 1) / 2), 0, BOARD_SIZE - h);
      const c = clamp(cell.c - Math.floor((w - 1) / 2), 0, BOARD_SIZE - w);
      if (r !== placing.r || c !== placing.c) onPlace(r, c);
    },
    [interactive, onPlace, placing, ghost, pointToCell],
  );

  const placingCells = useMemo(() => {
    if (!placing || !ghost) return null;
    return orientationCells(placing.patchId, placing.orientation).map(
      ([pr, pc]) => [placing.r + pr, placing.c + pc] as [number, number],
    );
  }, [placing, ghost]);

  const flashMatch = useCallback(
    (p: { patchId: number; r: number; c: number }) => {
      if (!flashPiece) return false;
      if (flashPiece.pieceId !== p.patchId) return false;
      // для кожаных (id 99) сверяем якорь — анимируется только новая клетка
      if (flashPiece.r !== undefined && flashPiece.c !== undefined) {
        return flashPiece.r === p.r && flashPiece.c === p.c;
      }
      return true;
    },
    [flashPiece],
  );

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 900 900"
      className={className}
      style={{
        touchAction: interactive ? 'none' : 'auto',
        display: 'block',
        width: '100%',
        height: '100%',
      }}
      onPointerDown={handlePointer}
      onPointerMove={(e) => {
        if (e.buttons === 1 || e.pointerType === 'touch') handlePointer(e);
      }}
      role="img"
      aria-label={t('g_board_aria')}
    >
      {/* фон-лён */}
      <rect x="0" y="0" width="900" height="900" rx="26" fill={theme.bg} />
      <rect x="0" y="0" width="900" height="900" rx="26" fill="url(#quilt-shade)" />
      {/* стёжка-сетка */}
      <g stroke={theme.grid} strokeWidth="2.4" strokeDasharray="10 8" strokeLinecap="round" opacity={0.75}>
        {Array.from({ length: 8 }, (_, i) => (
          <line key={`v${i}`} x1={(i + 1) * 100} y1="8" x2={(i + 1) * 100} y2="892" />
        ))}
        {Array.from({ length: 8 }, (_, i) => (
          <line key={`h${i}`} x1="8" y1={(i + 1) * 100} x2="892" y2={(i + 1) * 100} />
        ))}
      </g>
      {/* окантовка */}
      <rect
        x="6"
        y="6"
        width="888"
        height="888"
        rx="22"
        fill="none"
        stroke={theme.frame}
        strokeWidth="11"
        opacity={dim ? 0.5 : 1}
      />
      <rect
        x="20"
        y="20"
        width="860"
        height="860"
        rx="14"
        fill="none"
        stroke={theme.frame}
        strokeWidth="3"
        strokeDasharray="14 10"
        opacity={0.65}
      />

      {/* подсветка клеток (подсказка) */}
      {highlightCells && (
        <g>
          {[...highlightCells].map((idx) => (
            <rect
              key={idx}
              x={(idx % BOARD_SIZE) * 100 + 6}
              y={Math.floor(idx / BOARD_SIZE) * 100 + 6}
              width="88"
              height="88"
              rx="12"
              fill="#7bb26b"
              opacity="0.22"
            />
          ))}
        </g>
      )}

      {/* сетка легальности в режиме размещения */}
      {showPlacementGrid && placing && ghost && (
        <g opacity={0.5}>
          {Array.from({ length: (BOARD_SIZE - ghost.orient.h + 1) * (BOARD_SIZE - ghost.orient.w + 1) }, (_, i) => {
            const rr = Math.floor(i / (BOARD_SIZE - ghost.orient.w + 1));
            const cc = i % (BOARD_SIZE - ghost.orient.w + 1);
            const ok = canPlaceAt(ghost.orient, rr, cc, boardRows(board));
            if (!ok) return null;
            return (
              <rect
                key={i}
                x={cc * 100 + 30}
                y={rr * 100 + 30}
                width="40"
                height="40"
                rx="8"
                fill="#7bb26b"
                opacity={placingCells && rr === placing.r && cc === placing.c ? 0.65 : 0.22}
              />
            );
          })}
        </g>
      )}

      {/* лоскутки */}
      {pieces.map((p) => (
        <PatchGlyph
          key={p.key}
          patchId={p.patchId}
          orientation={p.orientation}
          x={p.c * 100}
          y={p.r * 100}
          cell={100}
          className={flashMatch(p) ? 'piece-drop' : undefined}
        />
      ))}

      {/* призрак размещения */}
      {placing && ghost && (
        <g>
          <PatchGlyph
            patchId={placing.patchId}
            orientation={placing.orientation}
            x={placing.c * 100}
            y={placing.r * 100}
            cell={100}
            opacity={0.72}
            ghost={ghost.legal ? 'ok' : 'bad'}
          />
          {!ghost.legal && (
            <g opacity="0.9">
              <circle cx={(placing.c + ghost.orient.w / 2) * 100} cy={(placing.r + ghost.orient.h / 2) * 100} r="46" fill="#c33a2f" />
              <path
                d={`M ${(placing.c + ghost.orient.w / 2) * 100 - 18} ${(placing.r + ghost.orient.h / 2) * 100 - 18} l 36 36 M ${(placing.c + ghost.orient.w / 2) * 100 + 18} ${(placing.r + ghost.orient.h / 2) * 100 - 18} l -36 36`}
                stroke="#fff"
                strokeWidth="9"
                strokeLinecap="round"
              />
            </g>
          )}
          {/* бирки «цена · время» на призраке */}
          {ghostBadges && (
            <GhostBadges x={placing.c + ghost.orient.w} y={placing.r} cost={ghostBadges.cost} time={ghostBadges.time} />
          )}
        </g>
      )}
    </svg>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Бирки «цена · время» у призрака: два стёганых ярлыка у верхнего правого угла фигуры */
function GhostBadges({ x, y, cost, time }: { x: number; y: number; cost: number; time: number }) {
  const bw = 118;
  const bh = 44;
  const px = clamp(x * 100 - bw + 10, 4, 900 - bw - 4);
  const py = clamp(y * 100 - bh - 10, 4, 900 - 2 * bh - 8);
  return (
    <g>
      <g transform={`translate(${px} ${py})`}>
        <rect width={bw} height={bh} rx={14} fill="#FBF4E2" stroke="#A9855A" strokeWidth={3} />
        <circle cx={28} cy={bh / 2} r={13} fill="#F1E6CC" stroke="#A9855A" strokeWidth={2.4} />
        <circle cx={24} cy={bh / 2 - 4} r={2} fill="#8a6b46" />
        <circle cx={32} cy={bh / 2 - 4} r={2} fill="#8a6b46" />
        <circle cx={24} cy={bh / 2 + 4} r={2} fill="#8a6b46" />
        <circle cx={32} cy={bh / 2 + 4} r={2} fill="#8a6b46" />
        <text x={52} y={bh / 2 + 9} fontSize={26} fontWeight={800} fill="#3E2F23">−{cost}</text>
      </g>
      <g transform={`translate(${px} ${py + bh + 4})`}>
        <rect width={bw} height={bh} rx={14} fill="#FBF4E2" stroke="#A9855A" strokeWidth={3} />
        <g transform={`translate(15 8) scale(1.1)`}>
          <path
            d="M0 0 h18 M0 26 h18 M2 0 c 0 7 4 8 5 10 c -1 2 -5 3 -5 10 M16 0 c 0 7 -4 8 -5 10 c 1 2 5 3 5 10"
            fill="#E8CD9A" stroke="#8a6b46" strokeWidth={2.4} strokeLinejoin="round"
          />
        </g>
        <text x={52} y={bh / 2 + 9} fontSize={26} fontWeight={800} fill="#3E2F23">+{time}</text>
      </g>
    </g>
  );
}

/** Мини-превью доски (для панели соперницы) */
export function MiniQuilt({ board, className }: { board: number[]; className?: string }) {
  const pieces = useMemo(() => boardPieces(board), [board]);
  const covered = board.filter((v) => v !== -1).length;
  return (
    <svg viewBox="0 0 900 900" className={className} style={{ display: 'block' }} aria-hidden>
      <rect x="0" y="0" width="900" height="900" rx="40" fill="#F4EAD2" />
      <g stroke="#D9C9A3" strokeWidth="2" opacity="0.5">
        {Array.from({ length: 8 }, (_, i) => (
          <line key={`v${i}`} x1={(i + 1) * 100} y1="0" x2={(i + 1) * 100} y2="900" />
        ))}
        {Array.from({ length: 8 }, (_, i) => (
          <line key={`h${i}`} x1="0" y1={(i + 1) * 100} x2="900" y2={(i + 1) * 100} />
        ))}
      </g>
      {pieces.map((p) => (
        <PatchGlyph
          key={p.key}
          patchId={p.patchId}
          orientation={p.orientation}
          x={p.c * 100}
          y={p.r * 100}
          cell={100}
        />
      ))}
      {covered === 0 && (
        <text x="450" y="470" textAnchor="middle" fontSize="60" fill="#B9A87F" fontWeight="600">
          {t('g_empty')}
        </text>
      )}
    </svg>
  );
}
