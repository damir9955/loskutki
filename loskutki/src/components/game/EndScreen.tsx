'use client';

import { useEffect, useMemo, useState } from 'react';
import type { GameState } from '@/lib/game/types';
import { personaName, t, useLang } from '@/lib/i18n';
import { MiniQuilt } from './QuiltBoard';
import { BotAvatar, CoinIcon, Portrait } from './MarketRow';
import { sound } from '@/lib/sound';
import { X } from 'lucide-react';

const CONFETTI_COLORS = ['#C0603A', '#3E7C74', '#D9A13F', '#8E5A79', '#8AA06F', '#EFE0BC'];

function Confetti({ n = 70 }: { n?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 1.2,
        dur: 2.2 + Math.random() * 1.6,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        w: 7 + Math.random() * 7,
        h: 10 + Math.random() * 10,
        radius: Math.random() > 0.6 ? '50%' : '3px',
      })),
    [n],
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            width: p.w,
            height: p.h,
            borderRadius: p.radius,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
          }}
        />
      ))}
    </div>
  );
}

export function EndScreen({
  state,
  opponent,
  onRematch,
  onHome,
}: {
  state: GameState;
  /** онлайн: имя/аватар живого соперника (вместо бота) */
  opponent?: { name: string; avatar: string };
  onRematch: () => void;
  onHome: () => void;
}) {
  const lang = useLang();
  const result = state.result;
  const [shown, setShown] = useState(false);
  /** оверлей сравнения: оба полотна крупно, моё сверху, соперника снизу */
  const [compare, setCompare] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 350);
    if (result?.winner === 0) sound.win();
    else if (result?.winner === 1) sound.lose();
    return () => clearTimeout(t);
  }, [result]);

  if (!result) return null;
  const won = result.winner === 0;
  const tie = result.winner === null;
  const botName = opponent?.name ?? personaName(lang, state.botLevel);
  const my = result.scores[0];
  const bot = result.scores[1];
  const diff = my.total - bot.total;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#2B2118]/70 p-4 backdrop-blur-sm">
      {won && <Confetti />}
      <div className="pop-in stitched-card relative z-10 my-auto w-full max-w-md p-5">
        <div className="text-center">
          <div
            className={`font-display text-[42px] leading-tight ${
              won ? 'text-primary' : tie ? 'text-muted-foreground' : 'text-destructive'
            }`}
          >
            {won ? t('e_win') : tie ? t('e_tie') : t('e_lose')}
          </div>
          <div className="mt-1 text-[15px] font-bold text-muted-foreground">
            {won
              ? diff >= 15
                ? t('e_win_big')
                : t('e_win_small')
              : tie
                ? t('e_tie_sub')
                : t('e_lose_sub')}
          </div>
          <div className="stitch-divider my-3" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Игрок — тап по полотну открывает сравнение обоих полотен */}
          <div className="rounded-xl border-2 border-primary/40 bg-primary/8 p-2.5">
            <div className="mb-1.5 text-center text-[12px] font-extrabold tracking-wide text-primary uppercase">{t('e_you')}</div>
            <button
              type="button"
              onClick={() => {
                sound.tap();
                setCompare(true);
              }}
              className="mx-auto w-full transition-transform hover:-translate-y-0.5 active:translate-y-0"
              aria-label={t('e_compare_title')}
            >
              <MiniQuilt board={state.players[0].board} className="mx-auto w-full rounded-lg" />
            </button>
            <ScoreList s={my} mine delay={500} />
          </div>
          {/* Бот */}
          <div className="rounded-xl border-2 border-border bg-card/60 p-2.5">
            <div className="mb-1.5 flex items-center justify-center gap-1.5 text-[12px] font-extrabold tracking-wide text-muted-foreground uppercase">
              {opponent ? <Portrait src={opponent.avatar} size={18} /> : <BotAvatar level={state.botLevel} size={18} />}
              {botName}
            </div>
            <button
              type="button"
              onClick={() => {
                sound.tap();
                setCompare(true);
              }}
              className="mx-auto w-full transition-transform hover:-translate-y-0.5 active:translate-y-0"
              aria-label={t('e_compare_title')}
            >
              <MiniQuilt board={state.players[1].board} className="mx-auto w-full rounded-lg" />
            </button>
            <ScoreList s={bot} delay={700} />
          </div>
        </div>

        <div className="mt-1 text-center text-[10.5px] font-bold text-muted-foreground/80">
          {t('e_compare_hint')}
        </div>

        <div className="mt-2 rounded-xl px-3 py-2.5 text-center">
          <span className="text-[17px] font-extrabold text-foreground">
            {t('e_total')}
            <span className={won ? 'text-primary' : 'text-[#8a5a3a]'}>
              {my.total > 0 ? '+' : ''}{my.total}
            </span>{' '}
            : {bot.total > 0 ? '+' : ''}{bot.total}
          </span>
        </div>

        <div className="mt-4 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onRematch}
            className="btn-wood h-14 rounded-2xl text-[17px] font-extrabold"
          >
            {t('e_rematch')}
          </button>
          <button
            type="button"
            onClick={onHome}
            className="btn-wood h-13 rounded-2xl text-[16px] font-extrabold"
          >
            {t('e_home')}
          </button>
        </div>
      </div>

      {/* ===== СРАВНЕНИЕ ПОЛОТЕН: оба крупно, моё сверху, соперника снизу ===== */}
      {compare && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-[#2B2118]/92 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-label={t('e_compare_title')}
          onClick={() => setCompare(false)}
        >
          <div className="flex shrink-0 items-center justify-between px-4 pb-1.5 pt-[max(env(safe-area-inset-top),16px)]">
            <div className="font-display text-[20px] text-foreground">{t('e_compare_title')}</div>
            <button
              type="button"
              onClick={() => setCompare(false)}
              className="btn-cloth flex h-10 w-10 items-center justify-center rounded-xl"
              aria-label={t('e_close')}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div
            className="nice-scroll flex flex-1 flex-col items-center gap-4 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-2"
            onClick={(e) => e.stopPropagation()}
          >
            {/* моё полотно — сверху */}
            <div className="w-full max-w-[min(92vw,430px)]">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-[14px] font-extrabold text-primary uppercase tracking-wide">{t('e_you')}</span>
                <span className={`text-[15px] font-extrabold ${my.total >= bot.total ? 'text-primary' : 'text-foreground/70'}`}>
                  {my.total > 0 ? '+' : ''}{my.total}
                </span>
              </div>
              <MiniQuilt board={state.players[0].board} className="w-full rounded-xl border-2 border-primary/40 shadow-lg" />
            </div>
            {/* полотно соперника — снизу */}
            <div className="w-full max-w-[min(92vw,430px)]">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-[14px] font-extrabold text-muted-foreground uppercase tracking-wide">
                  {opponent ? <Portrait src={opponent.avatar} size={20} /> : <BotAvatar level={state.botLevel} size={20} />}
                  <span className="truncate">{botName}</span>
                </span>
                <span className={`shrink-0 text-[15px] font-extrabold ${bot.total > my.total ? 'text-[#8a5a3a]' : 'text-foreground/70'}`}>
                  {bot.total > 0 ? '+' : ''}{bot.total}
                </span>
              </div>
              <MiniQuilt board={state.players[1].board} className="w-full rounded-xl border-2 border-border shadow-lg" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Разбивка счёта. ВСЕ три строки выводятся ВСЕГДА (нет награды — прочерк):
 * у обоих игроков строки занимают одинаковое количество строк, поэтому
 * «Итог» оказывается на ОДНОМ УРОВНЕ, сколько бы наград и пустых клеток
 * ни было у каждого (просьба пользователя: «выровни счёт на одном уровне,
 * пусть будет пусто, если нет ничего»).
 */
function ScoreList({
  s,
  mine = false,
  delay,
}: {
  s: import('@/lib/game/types').ScoreBreakdown;
  mine?: boolean;
  delay: number;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return (
    <div className={`mt-2 space-y-1 text-[13.5px] font-semibold transition-opacity duration-500 ${shown ? 'opacity-100' : 'opacity-0'}`}>
      <Row label={t('e_buttons')} value={`+${s.buttons}`} />
      <Row label={t('e_tile')} value={s.tile > 0 ? `+${s.tile}` : '—'} gold={s.tile > 0} dim={s.tile <= 0} />
      <Row
        label={s.emptyCount > 0 ? t('e_empty_cells', { n: s.emptyCount }) : t('e_empty_cells_plain')}
        value={s.emptyCount > 0 ? `${s.empty}` : '—'}
        bad={s.emptyCount > 0}
        dim={s.emptyCount <= 0}
      />
      <div className="stitch-divider !my-1" />
      <div className="flex justify-between text-[15px] font-extrabold">
        <span>{mine ? t('e_my_score') : t('e_score')}</span>
        <span className={s.total >= 0 ? 'text-primary' : 'text-destructive'}>
          {s.total > 0 ? '+' : ''}
          {s.total}
        </span>
      </div>
      <div className="text-[11.5px] text-muted-foreground">{t('e_covered', { n: s.covered })}</div>
    </div>
  );
}

function Row({
  label,
  value,
  gold,
  bad,
  dim,
}: {
  label: string;
  value: string;
  gold?: boolean;
  bad?: boolean;
  /** прочерк-плейсхолдер — приглушён, но строку держит (выравнивание) */
  dim?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <span className={`truncate ${dim ? 'text-muted-foreground/45' : 'text-muted-foreground'}`}>{label}</span>
      <span className={`shrink-0 tabular-nums ${dim ? 'text-muted-foreground/45' : gold ? 'text-[#A6721F]' : bad ? 'text-destructive' : 'text-foreground'}`}>
        {value}
      </span>
    </div>
  );
}
