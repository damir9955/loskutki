'use client';

import { useEffect, useMemo, useState } from 'react';
import type { GameState } from '@/lib/game/types';
import { personaName, t, useLang } from '@/lib/i18n';
import { MiniQuilt } from './QuiltBoard';
import { BotAvatar, CoinIcon } from './MarketRow';
import { sound } from '@/lib/sound';

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

/** Счёт-касса с анимацией */
function CountUp({ to, sign = 1 }: { to: number; sign?: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const dur = 700;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / dur);
      setV(Math.round(to * k * sign));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, sign]);
  return <>{v > 0 ? '+' : ''}{v}</>;
}

export function EndScreen({
  state,
  onRematch,
  onHome,
}: {
  state: GameState;
  onRematch: () => void;
  onHome: () => void;
}) {
  const lang = useLang();
  const result = state.result;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 350);
    if (result?.winner === 0) sound.win();
    else if (result?.winner === 1) sound.lose();
    return () => clearTimeout(t);
  }, [result]);

  if (!result) return null;
  const won = result.winner === 0;
  const tie = result.winner === null;
  const botName = personaName(lang, state.botLevel);
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
          {/* Игрок */}
          <div className="rounded-xl border-2 border-primary/40 bg-primary/8 p-2.5">
            <div className="mb-1.5 text-center text-[12px] font-extrabold tracking-wide text-primary uppercase">{t('e_you')}</div>
            <div className="mx-auto w-full">
              <MiniQuilt board={state.players[0].board} className="mx-auto w-full rounded-lg" />
            </div>
            <ScoreList s={my} mine delay={500} />
          </div>
          {/* Бот */}
          <div className="rounded-xl border-2 border-border bg-card/60 p-2.5">
            <div className="mb-1.5 flex items-center justify-center gap-1.5 text-[12px] font-extrabold tracking-wide text-muted-foreground uppercase">
              <BotAvatar level={state.botLevel} size={18} />
              {botName}
            </div>
            <MiniQuilt board={state.players[1].board} className="mx-auto w-full rounded-lg" />
            <ScoreList s={bot} delay={700} />
          </div>
        </div>

        <div className="mt-3 rounded-xl px-3 py-2.5 text-center">
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
    </div>
  );
}

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
      {s.tile > 0 && <Row label={t('e_tile')} value={`+${s.tile}`} gold />}
      {s.emptyCount > 0 && <Row label={t('e_empty_cells', { n: s.emptyCount })} value={`${s.empty}`} bad />}
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

function Row({ label, value, gold, bad }: { label: string; value: string; gold?: boolean; bad?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={gold ? 'text-[#A6721F]' : bad ? 'text-destructive' : 'text-foreground'}>{value}</span>
    </div>
  );
}
