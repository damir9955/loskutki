'use client';

import { useState, useSyncExternalStore } from 'react';
import { BookOpen, BarChart3, Settings2, Play, CalendarDays, Sparkles, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { BOT_PERSONAS, PATCHES, type BotLevel } from '@/lib/game/constants';
import { BotAvatar, GlyphDirect } from './MarketRow';
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
import { sound } from '@/lib/sound';
import { useToast } from '@/hooks/use-toast';
import { MiniQuilt } from './QuiltBoard';
import type { GameState } from '@/lib/game/types';

/** Логотип-нашивка */
function LogoMark({ size = 92 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <path d="M 14 24 h 26 v 26 h -13 v 13 h -13 z" fill="#C0603A" stroke="#8E4224" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M 14 24 h 26 v 26 h -13 v 13 h -13 z" fill="none" stroke="#7A3B1D" strokeWidth="1.6" strokeDasharray="3.4 2.2" />
      <path d="M 56 28 h 10 v 10 h 10 v 10 h -10 v 10 h -10 v -10 h -10 v -10 h 10 z" fill="#3E7C74" stroke="#2C5A54" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M 56 28 h 10 v 10 h 10 v 10 h -10 v 10 h -10 v -10 h -10 v -10 h 10 z" fill="none" stroke="#1F443F" strokeWidth="1.6" strokeDasharray="3.4 2.2" />
      <rect x="56" y="68" width="22" height="22" rx="4" fill="#D9A13F" stroke="#A6721F" strokeWidth="2.4" />
      <circle cx="61" cy="73" r="1.6" fill="#8A5E13" />
      <circle cx="73" cy="73" r="1.6" fill="#8A5E13" />
      <circle cx="61" cy="85" r="1.6" fill="#8A5E13" />
      <circle cx="73" cy="85" r="1.6" fill="#8A5E13" />
      <g transform="translate(24 76)">
        <circle r="11" fill="#F4EAD5" stroke="#A9855A" strokeWidth="2.4" />
        <circle cx="-3.5" cy="-3.5" r="1.8" fill="#8a6b46" />
        <circle cx="3.5" cy="-3.5" r="1.8" fill="#8a6b46" />
        <circle cx="-3.5" cy="3.5" r="1.8" fill="#8a6b46" />
        <circle cx="3.5" cy="3.5" r="1.8" fill="#8a6b46" />
      </g>
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
}

export function HomeScreen({ onStart, onDaily, onResume, onOpenRules }: HomeScreenProps) {
  const { toast } = useToast();
  const [pickOpen, setPickOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const store = useSyncExternalStore(subscribeStore, getStoreSnapshot, getStoreServerSnapshot);

  const s = store.stats;
  const daily = store.daily[todayKey()];
  const resumeGame = store.currentGame ?? null;

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-[520px] flex-col items-center px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-10">
      {/* Логотип */}
      <div className="pop-in relative">
        <LogoMark size={104} />
      </div>
      <h1 className="font-display mt-2 text-[46px] leading-none text-foreground" style={{ letterSpacing: '0.04em' }}>
        Лоскутки
      </h1>
      <p className="mt-1.5 text-[15px] font-bold tracking-wide text-muted-foreground">
        пэчворк-дуэль на скорость иголки
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
            <div className="text-[16px] font-extrabold text-foreground">Продолжить партию</div>
            <div className="text-[12.5px] font-semibold text-muted-foreground">
              против {BOT_PERSONAS[resumeGame.botLevel].name} · ход {resumeGame.turn + 1}
            </div>
          </div>
          <RotateCcw className="h-5 w-5 shrink-0 text-primary" />
        </button>
      )}

      {/* Основные кнопки */}
      <Button
        size="lg"
        className="btn-wood h-14 w-full rounded-2xl text-[17px] font-extrabold"
        onClick={() => {
          sound.ensure();
          sound.tap();
          setPickOpen(true);
        }}
      >
        <Play className="mr-2 h-5 w-5" />
        Играть
      </Button>

      <button
        type="button"
        onClick={() => {
          sound.ensure();
          sound.tap();
          if (daily) {
            toast({
              title: 'Сегодня вы уже шили 🧶',
              description: `Итог: ${daily.won ? 'победа' : 'поражение'} (${daily.score > 0 ? '+' : ''}${daily.score}). Новая игра дня — завтра!`,
            });
            return;
          }
          onDaily();
        }}
        className={`mt-3 flex w-full items-center gap-3 rounded-2xl border-2 p-3.5 text-left transition-all hover:-translate-y-0.5 active:translate-y-0 ${
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
            Игра дня №{dailyNumber(new Date())}
            <Sparkles className="h-3.5 w-3.5 text-[#A6721F]" />
          </div>
          <div className="text-[12.5px] font-semibold text-muted-foreground">
            {daily
              ? `сыграно: ${daily.won ? 'победа' : 'поражение'} (${daily.score > 0 ? '+' : ''}${daily.score})`
              : 'у всех одинаковая раскладка · соперник: Мастер Фёдор'}
          </div>
        </div>
      </button>

      {/* Нижний ряд */}
      <div className="mt-4 grid w-full grid-cols-3 gap-2.5">
        <MenuTile icon={<BookOpen className="h-6 w-6" />} label="Правила" onClick={onOpenRules} />
        <MenuTile
          icon={<BarChart3 className="h-6 w-6" />}
          label="Статистика"
          badge={s ? (s.games > 0 ? `${s.wins}П` : undefined) : undefined}
          onClick={() => {
            sound.tap();
            setStatsOpen(true);
          }}
        />
        <MenuTile
          icon={<Settings2 className="h-6 w-6" />}
          label="Настройки"
          onClick={() => {
            sound.tap();
            setSettingsOpen(true);
          }}
        />
      </div>

      <div className="flex-1" />

      {/* ===== Выбор соперницы ===== */}
      <Dialog open={pickOpen} onOpenChange={setPickOpen}>
        <DialogContent aria-describedby={undefined} className="w-[min(94vw,440px)]">
          <DialogHeader>
            <DialogTitle className="font-display text-[22px]">Выберите соперника</DialogTitle>
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
                    <div className="text-[16.5px] font-extrabold text-foreground">{p.name}</div>
                    <div className="text-[12.5px] font-semibold text-muted-foreground">{p.title}</div>
                    {stat && stat.games > 0 && (
                      <div className="mt-0.5 text-[12px] font-bold text-primary">
                        побед: {stat.wins} из {stat.games} ({Math.round((stat.wins / stat.games) * 100)}%)
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
                    {p.difficulty}
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
  const s = store.stats;
  const winrate = s.games > 0 ? Math.round((s.wins / s.games) * 100) : 0;
  const avgCov = s.games > 0 ? Math.round(s.totalCoverage / s.games) : 0;
  const dailyKeys = Object.keys(store.daily).sort().reverse().slice(0, 14);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-h-[88svh] w-[min(94vw,520px)] overflow-y-auto nice-scroll">
        <DialogHeader>
          <DialogTitle className="font-display text-[22px]">Статистика</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <BigStat value={s.games} label="партий" />
          <BigStat value={`${winrate}%`} label="побед" />
          <BigStat value={s.bestScore > -1000 ? s.bestScore : '—'} label="лучший счёт" />
          <BigStat value={s.bestStreak} label="серия побед" />
          <BigStat value={`${avgCov}/81`} label="ср. покрытие" />
          <BigStat value={s.bestCoverage} label="макс. покрытие" />
          <BigStat value={s.wins} label="всего побед" />
          <BigStat value={s.leatherMax} label="макс. кожаных" />
        </div>
        <div className="stitch-divider my-2" />
        <h3 className="font-display text-[18px]">Достижения</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ACHIEVEMENTS.map((a) => {
            const got = !!store.achievements[a.id];
            return (
              <div
                key={a.id}
                className={`flex items-center gap-2 rounded-xl border p-2 ${
                  got ? 'border-[#D9A13F]/60 bg-[#D9A13F]/10' : 'border-border bg-muted/40 opacity-60'
                }`}
                title={a.description}
              >
                <span className="text-[20px] grayscale-[--tw-grayscale]" style={{ filter: got ? undefined : 'grayscale(1)' }}>
                  {a.icon}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-extrabold">{a.title}</div>
                  <div className="truncate text-[11px] font-semibold text-muted-foreground">{a.description}</div>
                </div>
              </div>
            );
          })}
        </div>
        {dailyKeys.length > 0 && (
          <>
            <div className="stitch-divider my-2" />
            <h3 className="font-display text-[18px]">Игры дня</h3>
            <div className="space-y-1">
              {dailyKeys.map((k) => {
                const d = store.daily[k];
                return (
                  <div key={k} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-1.5 text-[13px] font-bold">
                    <span>{k}</span>
                    <span className={d.won ? 'text-primary' : 'text-destructive'}>
                      {d.won ? 'победа' : 'поражение'} · {d.score > 0 ? '+' : ''}
                      {d.score}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
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
  const [st, setSt] = useState(() => loadStore().settings);
  const save = (patch: Partial<typeof st>) => {
    const next = { ...st, ...patch };
    setSt(next);
    const store = loadStore();
    store.settings = next;
    saveStore(store);
    sound.enabled = next.sound;
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="w-[min(94vw,420px)]">
        <DialogHeader>
          <DialogTitle className="font-display text-[22px]">Настройки</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <SettingRow
            label="Звук"
            hint="стежки, пуговицы, победы"
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
            label="Вибрация"
            hint="отклик на пришивание"
            checked={st.vibration}
            onChange={(v) => save({ vibration: v })}
          />
          <SettingRow
            label="Сетка мест"
            hint="подсветка допустимых позиций при размещении"
            checked={st.hints}
            onChange={(v) => save({ hints: v })}
          />
          <div className="stitch-divider my-1" />
          <button
            type="button"
            className="w-full rounded-xl border-2 border-destructive/40 bg-destructive/8 py-2.5 text-[14.5px] font-extrabold text-destructive"
            onClick={() => {
              if (confirm('Стереть всю статистику, достижения и сохранённую партию?')) {
                localStorage.removeItem('loskutki.v1');
                sound.enabled = true;
                setSt(loadStore().settings);
                toast({ title: 'Прогресс сброшен', description: 'Чистый лист — новая ткань!' });
              }
            }}
          >
            Сбросить прогресс
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
