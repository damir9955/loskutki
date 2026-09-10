'use client';

import { useState, useSyncExternalStore } from 'react';
import { BookOpen, BarChart3, Settings2, Play, CalendarDays, Sparkles, RotateCcw, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { BOT_PERSONAS, PATCHES, type BotLevel } from '@/lib/game/constants';
import { orientationCells } from './PatchGlyph';
import { orientationsFor } from '@/lib/game/placement';
import { BotAvatar, GlyphDirect } from './MarketRow';
import { PatchGlyph } from './PatchGlyph';
import {
  ACHIEVEMENTS,
  loadStore,
  saveStore,
  subscribeStore,
  getStoreSnapshot,
  getStoreServerSnapshot,
  todayKey,
  type StatsStore,
} from '@/lib/storage';
import { dailyNumber } from '@/lib/game/rng';
import {
  achDesc,
  achTitle,
  personaDifficulty,
  personaName,
  personaTitle,
  t,
  useDocumentTitle,
  useLang,
  type Lang,
} from '@/lib/i18n';
import { sound } from '@/lib/sound';
import { useToast } from '@/hooks/use-toast';
import { MiniQuilt } from './QuiltBoard';
import type { GameState } from '@/lib/game/types';

/** Раскладка лого — как на иконке игры: реальные фигурки, упакованные
 *  без дыр в полотно 6×6 (сгенерирована scripts/make_icon.ts) */
const LOGO_PACK: ReadonlyArray<{ id: number; o: number; r: number; c: number }> = [
  { id: 14, o: 0, r: 0, c: 0 },
  { id: 28, o: 0, r: 0, c: 2 },
  { id: 20, o: 0, r: 0, c: 4 },
  { id: 0, o: 1, r: 0, c: 5 },
  { id: 19, o: 0, r: 1, c: 0 },
  { id: 17, o: 0, r: 2, c: 3 },
  { id: 26, o: 3, r: 3, c: 1 },
  { id: 18, o: 4, r: 3, c: 4 },
  { id: 2, o: 0, r: 5, c: 0 },
];
const LOGO_BUTTON_INDEX = 4;

/** Логотип-нашивка: то же лоскутное полотно, что на иконке игры —
 *  тетромино-фигурки игры без дыр + пуговица, как на обложке Patchwork */
function LogoMark({ size = 92 }: { size?: number }) {
  const INSET = 0.06;
  const sc = 1 - INSET * 2;
  return (
    <svg width={size} height={size} viewBox="-0.26 -0.26 6.52 6.52" aria-hidden>
      {/* фон-лён + рама */}
      <rect x="-0.26" y="-0.26" width="6.52" height="6.52" rx="0.72" fill="#F3E9D2" />
      <rect x="-0.14" y="-0.14" width="6.28" height="6.28" rx="0.6" fill="none" stroke="#8B5E3C" strokeWidth="0.17" />
      <rect
        x="-0.03"
        y="-0.03"
        width="6.06"
        height="6.06"
        rx="0.3"
        fill="none"
        stroke="#8B5E3C"
        strokeWidth="0.07"
        strokeDasharray="0.3 0.2"
        opacity="0.6"
      />
      {LOGO_PACK.map((p, i) => {
        const o = orientationsFor(p.id)[p.o];
        const tr = `translate(${o.w / 2} ${o.h / 2}) scale(${sc}) translate(${-o.w / 2} ${-o.h / 2})`;
        const btnCell = i === LOGO_BUTTON_INDEX ? orientationCells(p.id, p.o)[1] : null;
        return (
          <g key={i} transform={`translate(${p.c} ${p.r})`}>
            <g transform={tr}>
              <PatchGlyph patchId={p.id} orientation={p.o} cell={1} income={false} />
            </g>
            {btnCell && (
              <g transform={`translate(${btnCell[1] + 0.5} ${btnCell[0] + 0.5}) scale(0.62)`}>
                <circle r={0.46} cy={0.06} fill="#2E1D0E" opacity="0.25" />
                <circle r={0.42} fill="#F8F0DD" stroke="#5B3B20" strokeWidth={0.1} />
                <circle r={0.29} fill="none" stroke="#C9B583" strokeWidth={0.055} />
                <circle r={0.095} cx={-0.125} cy={-0.125} fill="#5B3B20" />
                <circle r={0.095} cx={0.125} cy={-0.125} fill="#5B3B20" />
                <circle r={0.095} cx={-0.125} cy={0.125} fill="#5B3B20" />
                <circle r={0.095} cx={0.125} cy={0.125} fill="#5B3B20" />
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Декоративная полоска лоскутков */
function FabricSwatchRow() {
  return (
    <div className="relative mt-5 flex items-end justify-center gap-1.5 overflow-hidden py-2" aria-hidden>
      <Swatch id={21} w={3} rotate={-7} delay="0ms" />
      <Swatch id={9} w={2} rotate={5} delay="70ms" />
      <Swatch id={31} w={3} rotate={-3} delay="140ms" />
      <Swatch id={24} w={2} rotate={7} delay="210ms" />
      <Swatch id={32} w={2} rotate={-5} delay="280ms" />
    </div>
  );
}

function Swatch({ id, w, rotate, delay }: { id: number; w: number; rotate: number; delay: string }) {
  const patch = PATCHES[id];
  const maxR = Math.max(...patch.cells.map((c) => c[0])) + 1;
  const maxC = Math.max(...patch.cells.map((c) => c[1])) + 1;
  const dim = Math.max(maxR, maxC);
  const px = w * 22;
  return (
    <svg
      width={px}
      height={px}
      viewBox={`-0.15 -0.15 ${dim + 0.3} ${dim + 0.3}`}
      style={{ transform: `rotate(${rotate}deg)`, animationDelay: delay }}
      className="pop-in drop-shadow-[0_3px_4px_rgba(90,60,25,0.25)]"
    >
      <GlyphDirect patchId={id} />
    </svg>
  );
}

export interface HomeScreenProps {
  onStart: (level: BotLevel) => void;
  onDaily: () => void;
  onResume: (state: GameState) => void;
  onOpenRules: () => void;
  onOnline: () => void;
}

export function HomeScreen({ onStart, onDaily, onResume, onOpenRules, onOnline }: HomeScreenProps) {
  const { toast } = useToast();
  const lang = useLang();
  // заголовок вкладки — на языке интерфейса («Лоскутки» / «Patchwork»)
  useDocumentTitle();
  const [pickOpen, setPickOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const store = useSyncExternalStore(subscribeStore, getStoreSnapshot, getStoreServerSnapshot);

  const s = store.stats;
  const daily = store.daily[todayKey()];
  const resumeGame = store.currentGame ?? null;

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-[520px] flex-col items-center px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-10 md:max-w-[880px] md:px-8">
      {/* Логотип */}
      <div className="pop-in relative">
        <LogoMark size={104} />
      </div>
      <h1 className="font-display mt-2 text-[46px] leading-none text-foreground" style={{ letterSpacing: '0.04em' }}>
        {t('app_title')}
      </h1>
      <p className="mt-1.5 text-[15px] font-bold tracking-wide text-muted-foreground">
        {t('app_subtitle')}
      </p>

      <FabricSwatchRow />

      <div className="stitch-divider my-4 w-full max-w-[300px]" />

      {/* Продолжить партию */}
      {resumeGame && resumeGame.phase !== 'gameover' && (
        <button
          type="button"
          onClick={() => {
            sound.ensure();
            sound.tap();
            onResume(resumeGame);
          }}
          className="stitched-card mb-3 flex w-full items-center gap-3 p-3 text-left transition-transform hover:-translate-y-0.5 active:translate-y-0"
        >
          <div className="w-[54px] shrink-0">
            <MiniQuilt board={resumeGame.players[0].board} className="w-full rounded-md border border-border" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-extrabold text-foreground">{t('home_resume')}</div>
            <div className="text-[12.5px] font-semibold text-muted-foreground">
              {t('home_resume_vs', { name: personaName(lang, resumeGame.botLevel), n: resumeGame.turn + 1 })}
            </div>
          </div>
          <RotateCcw className="h-5 w-5 shrink-0 text-primary" />
        </button>
      )}

      {/* Основные кнопки: на планшете — три в ряд */}
      <div className="w-full space-y-3 md:grid md:grid-cols-3 md:items-stretch md:gap-3 md:space-y-0">
        <Button
          size="lg"
          className="btn-wood h-14 w-full rounded-2xl text-[17px] font-extrabold md:h-auto md:min-h-[78px] md:text-[18px]"
          onClick={() => {
            sound.ensure();
            sound.tap();
            setPickOpen(true);
          }}
        >
          <Play className="mr-2 h-5 w-5" />
          {t('home_play')}
        </Button>

        {/* С другом — онлайн по коду или через открытую комнату */}
        <button
          type="button"
          onClick={onOnline}
          className="flex w-full items-center gap-3 rounded-2xl border-2 border-[#5B7E9E]/55 bg-[#5B7E9E]/12 p-3.5 text-left shadow-[inset_0_2px_0_rgba(255,255,255,.6),0_6px_14px_-8px_rgba(50,70,100,.45)] transition-all hover:-translate-y-0.5 active:translate-y-0"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#5B7E9E]/25">
            <Users className="h-6 w-6 text-[#3D5A77]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-extrabold text-foreground">{t('mp_title')}</div>
            <div className="text-[12.5px] font-semibold text-muted-foreground">{t('mp_desc')}</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            sound.ensure();
            sound.tap();
            if (daily) {
              toast({
                title: t('home_daily_done_t'),
                description: t('home_daily_done_d', {
                  res: daily.won ? t('win') : t('loss'),
                  score: `${daily.score > 0 ? '+' : ''}${daily.score}`,
                }),
              });
              return;
            }
            onDaily();
          }}
          className={`flex w-full items-center gap-3 rounded-2xl border-2 p-3.5 text-left transition-all hover:-translate-y-0.5 active:translate-y-0 ${
            daily
              ? 'border-border bg-muted/60 opacity-80'
              : 'border-[#D9A13F]/60 bg-[#D9A13F]/12 shadow-[inset_0_2px_0_rgba(255,255,255,.6),0_6px_14px_-8px_rgba(120,80,20,.45)]'
          }`}
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#D9A13F]/25">
            <CalendarDays className="h-6 w-6 text-[#A6721F]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[16px] font-extrabold text-foreground">
              {t('home_daily', { n: dailyNumber(new Date()) })}
              <Sparkles className="h-3.5 w-3.5 text-[#A6721F]" />
            </div>
            <div className="text-[12.5px] font-semibold text-muted-foreground">
              {daily
                ? t('home_daily_played', {
                    res: daily.won ? t('win') : t('loss'),
                    score: `${daily.score > 0 ? '+' : ''}${daily.score}`,
                  })
                : t('home_daily_desc', { name: personaName(lang, 'fedor') })}
            </div>
          </div>
        </button>
      </div>

      {/* Нижний ряд */}
      <div className="mt-4 grid w-full grid-cols-3 gap-2.5">
        <MenuTile icon={<BookOpen className="h-6 w-6" />} label={t('home_rules')} onClick={onOpenRules} />
        <MenuTile
          icon={<BarChart3 className="h-6 w-6" />}
          label={t('home_stats')}
          badge={s ? (s.games > 0 ? `${s.wins}${t('win')[0].toUpperCase()}` : undefined) : undefined}
          onClick={() => {
            sound.tap();
            setStatsOpen(true);
          }}
        />
        <MenuTile
          icon={<Settings2 className="h-6 w-6" />}
          label={t('home_settings')}
          onClick={() => {
            sound.tap();
            setSettingsOpen(true);
          }}
        />
      </div>

      <div className="flex-1" />

      {/* ===== Выбор соперника ===== */}
      <Dialog open={pickOpen} onOpenChange={setPickOpen}>
        <DialogContent aria-describedby={undefined} className="w-[min(94vw,440px)]">
          <DialogHeader>
            <DialogTitle className="font-display text-[22px]">{t('pick_title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2.5">
            {(Object.keys(BOT_PERSONAS) as BotLevel[]).map((lvl) => {
              const p = BOT_PERSONAS[lvl];
              const stat = s?.byLevel[lvl];
              return (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => {
                    sound.tap();
                    setPickOpen(false);
                    onStart(lvl);
                  }}
                  className="stitched-card flex w-full items-center gap-3 p-3 text-left transition-transform hover:-translate-y-0.5 active:translate-y-0"
                >
                  <BotAvatar level={lvl} size={62} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[16.5px] font-extrabold text-foreground">{personaName(lang, lvl)}</div>
                    <div className="text-[12.5px] font-semibold text-muted-foreground">{personaTitle(lang, lvl)}</div>
                    {stat && stat.games > 0 && (
                      <div className="mt-0.5 text-[12px] font-bold text-primary">
                        {t('pick_wins', {
                          w: stat.wins,
                          g: stat.games,
                          p: Math.round((stat.wins / stat.games) * 100),
                        })}
                      </div>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-extrabold ${
                      lvl === 'glasha'
                        ? 'bg-[#8AA06F]/25 text-[#4e6437]'
                        : lvl === 'fedor'
                          ? 'bg-[#D9A13F]/25 text-[#8A5E13]'
                          : 'bg-[#8E5A79]/25 text-[#6E3B5E]'
                    }`}
                  >
                    {personaDifficulty(lang, lvl)}
                  </span>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* ===== Статистика ===== */}
      <StatsDialog open={statsOpen} onOpenChange={setStatsOpen} store={store} />

      {/* ===== Настройки ===== */}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

function MenuTile({
  icon,
  label,
  onClick,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="stitched-card flex flex-col items-center gap-1.5 px-2 py-4 transition-transform hover:-translate-y-0.5 active:translate-y-0"
    >
      <div className="relative text-primary">
        {icon}
        {badge && (
          <span className="absolute -top-2 -right-6 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-extrabold text-primary-foreground">
            {badge}
          </span>
        )}
      </div>
      <span className="text-[12.5px] font-extrabold text-foreground">{label}</span>
    </button>
  );
}

function StatsDialog({
  open,
  onOpenChange,
  store,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  store: StatsStore;
}) {
  const lang = useLang();
  const [achOpen, setAchOpen] = useState<string | null>(null);
  const s = store.stats;
  const winrate = s.games > 0 ? Math.round((s.wins / s.games) * 100) : 0;
  const avgCov = s.games > 0 ? Math.round(s.totalCoverage / s.games) : 0;
  const dailyKeys = Object.keys(store.daily).sort().reverse().slice(0, 14);
  const locale = lang === 'en' ? 'en-US' : 'ru-RU';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-h-[88svh] w-[min(94vw,520px)] overflow-y-auto nice-scroll">
        <DialogHeader>
          <DialogTitle className="font-display text-[22px]">{t('stats_title')}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <BigStat value={s.games} label={t('stats_games')} />
          <BigStat value={`${winrate}%`} label={t('stats_wr')} />
          <BigStat value={s.bestScore > -1000 ? s.bestScore : '—'} label={t('stats_best')} />
          <BigStat value={s.bestStreak} label={t('stats_streak')} />
          <BigStat value={`${avgCov}/81`} label={t('stats_avg_cov')} />
          <BigStat value={s.bestCoverage} label={t('stats_max_cov')} />
          <BigStat value={s.wins} label={t('stats_wins_total')} />
          <BigStat value={s.leatherMax} label={t('stats_leather')} />
        </div>
        <div className="stitch-divider my-2" />
        <h3 className="font-display text-[18px]">{t('stats_ach')}</h3>
        <div className="grid grid-cols-2 gap-2">
          {ACHIEVEMENTS.map((a) => {
            const got = !!store.achievements[a.id];
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setAchOpen(a.id)}
                className={`flex items-center gap-2 rounded-xl border p-2.5 text-left transition-transform active:scale-[0.98] ${
                  got ? 'border-[#D9A13F]/60 bg-[#D9A13F]/10' : 'border-border bg-muted/40'
                }`}
              >
                <span className="text-[22px] leading-none" style={{ filter: got ? undefined : 'grayscale(1) opacity(0.55)' }}>
                  {a.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-extrabold text-foreground">
                    {achTitle(lang, a.id)}
                  </span>
                  <span className="block text-[11px] font-semibold text-muted-foreground">
                    {got ? '✓' : '🔒'}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {dailyKeys.length > 0 && (
          <>
            <div className="stitch-divider my-2" />
            <h3 className="font-display text-[18px]">{t('stats_daily')}</h3>
            <div className="space-y-1">
              {dailyKeys.map((k) => {
                const d = store.daily[k];
                return (
                  <div key={k} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-1.5 text-[13px] font-bold">
                    <span>{k}</span>
                    <span className={d.won ? 'text-primary' : 'text-destructive'}>
                      {d.won ? t('win') : t('loss')} · {d.score > 0 ? '+' : ''}
                      {d.score}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {/* полное описание достижения по тапу */}
        <Dialog open={achOpen !== null} onOpenChange={(v) => { if (!v) setAchOpen(null); }}>
          {achOpen !== null && (
            <DialogContent aria-describedby={undefined} className="w-[min(88vw,380px)]">
              <DialogHeader>
                <DialogTitle className="font-display text-center text-[21px]">
                  {achTitle(lang, achOpen)}
                </DialogTitle>
              </DialogHeader>
              <div className="flex flex-col items-center gap-3 px-2 pb-1">
                <span
                  className="text-[46px] leading-none"
                  style={{
                    filter: store.achievements[achOpen] ? undefined : 'grayscale(1) opacity(0.5)',
                  }}
                >
                  {ACHIEVEMENTS.find((a) => a.id === achOpen)?.icon}
                </span>
                <p className="text-center text-[14px] font-semibold text-foreground">
                  {achDesc(lang, achOpen)}
                </p>
                {store.achievements[achOpen] ? (
                  <span className="rounded-full bg-[#D9A13F]/15 px-3 py-1.5 text-[12px] font-extrabold text-[#8A5E13]">
                    {t('ach_unlocked_at', {
                      d: new Date(store.achievements[achOpen]).toLocaleDateString(locale, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      }),
                    })}
                  </span>
                ) : (
                  <span className="rounded-full bg-muted px-3 py-1.5 text-[12px] font-extrabold text-muted-foreground">
                    {t('ach_locked')}
                  </span>
                )}
              </div>
            </DialogContent>
          )}
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function BigStat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="stitched-card flex flex-col items-center px-2 py-2.5">
      <span className="text-[20px] font-extrabold text-foreground">{value}</span>
      <span className="text-[10.5px] font-bold tracking-wide text-muted-foreground uppercase">{label}</span>
    </div>
  );
}

function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const lang = useLang();
  const [st, setSt] = useState(() => loadStore().settings);
  const save = (patch: Partial<typeof st>) => {
    const next = { ...st, ...patch };
    setSt(next);
    const store = loadStore();
    store.settings = next;
    saveStore(store);
    sound.enabled = next.sound;
  };
  const setLang = (l: Lang) => {
    if (l === lang) return;
    sound.ensure();
    sound.tap();
    save({ lang: l });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="w-[min(94vw,420px)]">
        <DialogHeader>
          <DialogTitle className="font-display text-[22px]">{t('set_title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <SettingRow
            label={t('set_sound')}
            hint={t('set_sound_h')}
            checked={st.sound}
            onChange={(v) => {
              save({ sound: v });
              if (v) {
                sound.ensure();
                sound.income();
              }
            }}
          />
          <SettingRow
            label={t('set_vibro')}
            hint={t('set_vibro_h')}
            checked={st.vibration}
            onChange={(v) => save({ vibration: v })}
          />
          <SettingRow
            label={t('set_grid')}
            hint={t('set_grid_h')}
            checked={st.hints}
            onChange={(v) => save({ hints: v })}
          />
          {/* Язык: русский (по умолчанию) / английский */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[15.5px] font-extrabold">{t('set_lang')}</div>
              <div className="text-[12.5px] font-semibold text-muted-foreground">{t('set_lang_h')}</div>
            </div>
            <div className="flex overflow-hidden rounded-xl border-2 border-border shadow-sm">
              <button
                type="button"
                onClick={() => setLang('ru')}
                aria-pressed={lang === 'ru'}
                className={`px-3 py-2 text-[13px] font-extrabold transition-colors ${
                  lang === 'ru' ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground/70 hover:bg-muted'
                }`}
              >
                Русский
              </button>
              <button
                type="button"
                onClick={() => setLang('en')}
                aria-pressed={lang === 'en'}
                className={`px-3 py-2 text-[13px] font-extrabold transition-colors ${
                  lang === 'en' ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground/70 hover:bg-muted'
                }`}
              >
                English
              </button>
            </div>
          </div>
          <div className="stitch-divider my-1" />
          <button
            type="button"
            className="w-full rounded-xl border-2 border-destructive/40 bg-destructive/8 py-2.5 text-[14.5px] font-extrabold text-destructive"
            onClick={() => {
              if (confirm(t('set_reset_confirm'))) {
                localStorage.removeItem('loskutki.v1');
                sound.enabled = true;
                setSt(loadStore().settings);
                toast({ title: t('set_reset_done'), description: t('set_reset_done_h') });
              }
            }}
          >
            {t('set_reset')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-[15.5px] font-extrabold">{label}</div>
        <div className="text-[12.5px] font-semibold text-muted-foreground">{hint}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
