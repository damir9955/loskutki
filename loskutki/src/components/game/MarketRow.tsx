'use client';

import { PATCHES, BOT_PERSONAS, type BotLevel, LEATHER_ID, LEATHER_PATCH } from '@/lib/game/constants';
import type { AvailablePatch } from '@/lib/game/engine';
import type { AdvancePreview } from '@/lib/game/engine';
import { botAvatarUrl } from '@/lib/avatars';
import { patchName, t, useLang } from '@/lib/i18n';

/** площадь самого большого лоскутка в игре (для пропорциональности фигурок) */
const MAX_PATCH_AREA = Math.max(...PATCHES.map((p) => p.cells.length));

/** Доля зоны (0.62…1), которую занимает фигурка: реальный размер лоскутка —
 *  маленькие лоскутки рисуются заметно мельче больших, а не «на всю карточку».
 *  Показатель 0.35 — по площади: пиксельная площадь фигурки ~ площади лоскутка. */
export function glyphScaleFor(area: number): number {
  return Math.min(1, Math.pow(Math.max(1, area) / MAX_PATCH_AREA, 0.35));
}

/** viewBox с запасом, вписанный в долю glyphScale от зоны (фигурка — по центру) */
export function scaledGlyphViewBox(maxC: number, maxR: number, pad: number, area: number) {
  const inv = 1 / glyphScaleFor(area);
  const vbW = (maxC + pad * 2) * inv;
  const vbH = (maxR + pad * 2) * inv;
  return `${(maxC - vbW) / 2} ${(maxR - vbH) / 2} ${vbW} ${vbH}`;
}

/** Пуговица-иконка (валюта) */
export function CoinIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="10" fill="#F1E6CC" stroke="#A9855A" strokeWidth="1.8" />
      <circle cx="8.6" cy="8.6" r="1.5" fill="#8a6b46" />
      <circle cx="15.4" cy="8.6" r="1.5" fill="#8a6b46" />
      <circle cx="8.6" cy="15.4" r="1.5" fill="#8a6b46" />
      <circle cx="15.4" cy="15.4" r="1.5" fill="#8a6b46" />
      <path d="M 6 12 A 6 6 0 0 1 12 6" stroke="#fff" strokeWidth="1.4" fill="none" opacity="0.7" strokeLinecap="round" />
    </svg>
  );
}

/** Песочные часы (время/ходы) — читаются даже в 12px */
export function ClockIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      {/* стеклянные колбы */}
      <path
        d="M6.8 4.2 C6.8 8.6 10.6 10 11 12 C10.6 14 6.8 15.4 6.8 19.8 L17.2 19.8 C17.2 15.4 13.4 14 13 12 C13.4 10 17.2 8.6 17.2 4.2 Z"
        fill="#F1E6CC"
        stroke="#A9855A"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* деревянная рама */}
      <rect x="4.9" y="1.6" width="14.2" height="3.1" rx="1.55" fill="#8B5E3C" stroke="#5B3B20" strokeWidth="0.7" />
      <rect x="4.9" y="19.3" width="14.2" height="3.1" rx="1.55" fill="#8B5E3C" stroke="#5B3B20" strokeWidth="0.7" />
      {/* песок: горка сверху + струя + горка снизу */}
      <path d="M9.1 6.1 C9.5 8.1 10.7 9.2 11.7 9.9 L12.3 9.9 C13.3 9.2 14.5 8.1 14.9 6.1 Z" fill="#E2B24E" />
      <path d="M12 10.6 V16.2" stroke="#D9A13F" strokeWidth="1.15" strokeLinecap="round" />
      <path d="M8.3 18.6 C8.9 15.9 10.9 14.4 12 13.6 C13.1 14.4 15.1 15.9 15.7 18.6 Z" fill="#D9A13F" />
      {/* блик стекла */}
      <path d="M 8.1 6.2 C 8.3 7.8 9.2 8.8 10 9.5" stroke="#ffffff" strokeWidth="1.1" fill="none" opacity="0.65" strokeLinecap="round" />
    </svg>
  );
}

/** Песочные часы с переворотом — значок «чей ход» */
export function HourglassIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <g>
        <animateTransform
          attributeName="transform"
          type="rotate"
          values="0 12 12; 0 12 12; 180 12 12; 180 12 12"
          keyTimes="0; 0.42; 0.5; 1"
          dur="2.6s"
          repeatCount="indefinite"
        />
        <path
          d="M6.8 4.2 C6.8 8.6 10.6 10 11 12 C10.6 14 6.8 15.4 6.8 19.8 L17.2 19.8 C17.2 15.4 13.4 14 13 12 C13.4 10 17.2 8.6 17.2 4.2 Z"
          fill="#F1E6CC"
          stroke="#A9855A"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <rect x="4.9" y="1.6" width="14.2" height="3.1" rx="1.55" fill="#8B5E3C" stroke="#5B3B20" strokeWidth="0.7" />
        <rect x="4.9" y="19.3" width="14.2" height="3.1" rx="1.55" fill="#8B5E3C" stroke="#5B3B20" strokeWidth="0.7" />
        <path d="M9.1 6.1 C9.5 8.1 10.7 9.2 11.7 9.9 L12.3 9.9 C13.3 9.2 14.5 8.1 14.9 6.1 Z" fill="#E2B24E" />
        <path d="M12 10.6 V16.2" stroke="#D9A13F" strokeWidth="1.15" strokeLinecap="round" />
        <path d="M8.3 18.6 C8.9 15.9 10.9 14.4 12 13.6 C13.1 14.4 15.1 15.9 15.7 18.6 Z" fill="#D9A13F" />
      </g>
    </svg>
  );
}

/** Кожаный лоскуток 1×1 — вместо эмодзи-ботинка */
export function LeatherPatchIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3.2" fill="#7A5230" stroke="#54341C" strokeWidth="1.8" />
      <rect x="6.4" y="6.4" width="11.2" height="11.2" rx="1.8" fill="none" stroke="#C9A96B" strokeWidth="1.2" strokeDasharray="2.6 1.9" />
      <path d="M5.6 12 A 6.4 6.4 0 0 1 12 5.6" stroke="#F2E6CD" strokeWidth="1.1" fill="none" opacity="0.4" strokeLinecap="round" />
    </svg>
  );
}

/** Плюс-доход */
export function IncomeIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9.5" fill="#D9A13F" stroke="#A6721F" strokeWidth="1.8" />
      <path d="M12 7 v10 M7 12 h10" stroke="#6E4E0B" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** Пуговица-доход НЕ используется: на карточках и в шапке доход обозначается
 *  ПЛЮСИКОМ (IncomeIcon) — единый значок дохода, как над полотном */

/** Реалистичный портрет в «стёганой» рамке — общая подложка для ботов и людей */
export function Portrait({
  src,
  size = 56,
  thinking = false,
  className,
  alt = '',
}: {
  src: string;
  size?: number;
  thinking?: boolean;
  className?: string;
  alt?: string;
}) {
  return (
    <span
      className={`relative inline-block shrink-0 rounded-full ${thinking ? 'soft-pulse' : ''} ${className ?? ''}`}
      style={{ width: size, height: size, lineHeight: 0 }}
    >
      <img
        src={src}
        alt={alt}
        width={size}
        height={size}
        draggable={false}
        className="h-full w-full rounded-full object-cover"
        style={{ boxShadow: 'inset 0 0 0 2px rgba(169,133,90,.55), 0 1px 3px rgba(90,60,25,.35)' }}
      />
      {/* стёжка-ободок поверх фото */}
      <svg
        viewBox="0 0 100 100"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden
      >
        <circle
          cx="50"
          cy="50"
          r="46.5"
          fill="none"
          stroke="#A9855A"
          strokeWidth="2.6"
          strokeDasharray="5 3.8"
          opacity="0.75"
        />
      </svg>
    </span>
  );
}

/** Аватары ботов — реалистичные портреты (public/avatars) */
export function BotAvatar({ level, size = 56, thinking = false }: { level: BotLevel; size?: number; thinking?: boolean }) {
  return <Portrait src={botAvatarUrl(level)} size={size} thinking={thinking} alt="bot" />;
}
/** Карточка лоскутка на рынке: размер слева-сверху, фигурка по центру свободной зоны
 *  (выравнивание относительно её размера), справа столбик «цена → время → доход»,
 *  название по центру снизу */
export function MarketCard({
  patchId,
  buttons,
  placeable,
  selected,
  disabled,
  onSelect,
}: {
  patchId: number;
  buttons: number;
  placeable: boolean;
  selected?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  const lang = useLang();
  const patch = PATCHES[patchId];
  const affordable = buttons >= patch.cost;
  const can = affordable && placeable;
  const maxR = Math.max(...patch.cells.map((c) => c[0])) + 1;
  const maxC = Math.max(...patch.cells.map((c) => c[1])) + 1;
  // запас под обводку контура, чтобы фигурку не подрезало по краям svg
  const vbPad = 0.06;
  const name = patchName(lang, patchId);
  const blockedText = !placeable ? t('m_not_fit') : !affordable ? t('m_no_buttons') : null;
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled || !can || !onSelect}
      aria-label={t('m_buy_aria', {
        name,
        w: maxC,
        h: maxR,
        cost: patch.cost,
        time: patch.time,
        inc: patch.income,
      })}
      className={`stitched-card relative flex w-full min-w-0 flex-col items-center gap-0.5 px-1 pb-1 pt-1 transition-all [touch-action:none]
        ${selected ? 'ring-4 ring-primary scale-[1.03] shadow-lg' : ''}
        ${!disabled && can ? 'cursor-pointer hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]' : ''}
        ${!can ? 'opacity-60 grayscale-[.25]' : ''}`}
    >
      {/* размер фигурки — слева сверху, компактная плашка (не перекрывает фигурку) */}
      <span
        className="absolute top-0.5 left-0.5 rounded-md bg-[#7A5230]/14 px-[3px] py-[1px] text-[9px] leading-none font-extrabold text-[#7A5230]"
        title={t('m_size', { w: maxC, h: maxR })}
      >
        {maxC}×{maxR}
      </span>
      {/* фигурка — ПРОПОРЦИОНАЛЬНО реальному размеру лоскутка: большие заполняют
          зону, маленькие — заметно меньше (вписывается и по ширине, и по высоте —
          meet, viewBox раздут ровно настолько, какую долю занимает фигурка);
          сверху отступ под плашку размера, бирки — обычный поток справа */}
      <div className="flex h-[58px] w-full items-center">
        <div className="h-full min-w-0 flex-1 pt-[12px]">
          <svg
            viewBox={scaledGlyphViewBox(maxC, maxR, vbPad, patch.cells.length)}
            className="h-full w-full"
            preserveAspectRatio="xMidYMid meet"
            aria-hidden
          >
            <GlyphDirect patchId={patchId} />
          </svg>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-[2.5px] self-center">
          <CardPill icon={<CoinIcon size={10} />} value={patch.cost} bad={!affordable} title={t('m_cost', { n: patch.cost })} />
          <CardPill icon={<ClockIcon size={10} />} value={patch.time} title={t('m_time', { n: patch.time })} />
          {/* доход — ПОД временем: зелёный если есть, красный с нулём если нет;
              иконка — ПЛЮСИК, тот же значок дохода, что над полотном */}
          <span
            className={`flex items-center gap-0.5 rounded-full border-[1.5px] px-1 py-[1.5px] text-[10px] leading-none font-extrabold text-white shadow-md ${
              patch.income > 0 ? 'border-[#1E6B36] bg-[#2F8F4E]' : 'border-[#7E2D1C] bg-[#B3432B]'
            }`}
            title={patch.income > 0 ? t('m_inc_yes', { n: patch.income }) : t('m_inc_no')}
          >
            <IncomeIcon size={10} />
            {patch.income > 0 ? `+${patch.income}` : '0'}
          </span>
        </div>
      </div>
      {/* нижняя строка: название по центру; длинное или заблокированное — от левого края */}
      <div className="flex w-full items-center">
        {blockedText ? (
          <span
            className="w-full truncate rounded-full bg-destructive/90 px-1 py-[1.5px] text-left text-[9px] leading-none font-bold text-white"
            title={blockedText}
          >
            {blockedText}
          </span>
        ) : (
          <span
            className={`w-full truncate text-[10px] leading-none font-bold text-foreground/90 ${
              name.length > 12 ? 'text-left' : 'text-center'
            }`}
          >
            {name}
          </span>
        )}
      </div>
    </button>
  );
}

/** Компактная бирка для столбика на карточке рынка (цена/время) */
function CardPill({
  icon,
  value,
  bad = false,
  title,
}: {
  icon: React.ReactNode;
  value: number;
  bad?: boolean;
  title: string;
}) {
  return (
    <span
      title={title}
      className={`flex items-center gap-0.5 rounded-full border-[1.5px] bg-card px-1 py-[1.5px] text-[10px] leading-none font-extrabold shadow-sm ${
        bad ? 'border-destructive/60 text-destructive' : 'border-[#A9855A]/60 text-foreground'
      }`}
    >
      {icon}
      {value}
    </span>
  );
}

/** Ярлык-бирка на фигурке (цена/время) */
export function BadgePill({
  icon,
  value,
  bad = false,
  small = false,
}: {
  icon: React.ReactNode;
  value: number;
  bad?: boolean;
  small?: boolean;
}) {
  return (
    <span
      className={`flex items-center gap-0.5 rounded-full border-2 font-extrabold leading-none shadow-sm ${
        small ? 'px-1.5 py-[3px] text-[11px]' : 'px-1.5 py-0.5 text-[13px]'
      } ${
        bad ? 'border-destructive/60 bg-card text-destructive' : 'border-[#A9855A]/60 bg-card text-foreground'
      }`}
    >
      {icon}
      {value}
    </span>
  );
}

/** Значок игрового поля с заполнением (замена «глазу») */
export function BoardFillIcon({ size = 26, covered = 0, className }: { size?: number; covered?: number; className?: string }) {
  const filledCells = Math.min(9, Math.round((covered / 81) * 9));
  const cell = (size - 6) / 3;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className} aria-hidden>
      <rect x={1} y={1} width={size - 2} height={size - 2} rx={2.5} fill="#F4EAD2" stroke="#8B5E3C" strokeWidth={size / 13} />
      {Array.from({ length: 9 }, (_, i) => {
        const r = Math.floor(i / 3);
        const c = i % 3;
        return (
          <rect
            key={i}
            x={3 + c * cell}
            y={3 + r * cell}
            width={cell - 1}
            height={cell - 1}
            rx={1.5}
            fill={i < filledCells ? '#C0603A' : '#E7DBBB'}
          />
        );
      })}
    </svg>
  );
}

/** Крупная плитка показателя (пуговицы/доход/время…) */
export function BigStat({
  icon,
  value,
  label,
  accent = false,
  title,
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  label?: string;
  accent?: boolean;
  title?: string;
}) {
  return (
    <div
      className={`flex items-center gap-1 rounded-xl border-2 px-1.5 py-0.5 ${
        accent ? 'border-primary/50 bg-primary/10' : 'border-border bg-card/85'
      }`}
      title={title ?? label}
    >
      <span className="flex shrink-0 items-center justify-center">{icon}</span>
      <div className="leading-none">
        <div className="text-[15.5px] font-extrabold text-foreground">{value}</div>
        {label && <div className="mt-0.5 text-[8.5px] font-bold tracking-wide text-muted-foreground uppercase">{label}</div>}
      </div>
    </div>
  );
}

/** Прямой рендер лоскутка в единичных координатах (для превью) */
import { orientationsFor } from '@/lib/game/placement';
import { outlineFor, shade } from '@/lib/game/outline';

export function GlyphDirect({ patchId, orientation = 0 }: { patchId: number; orientation?: number }) {
  const def = patchId === LEATHER_ID ? LEATHER_PATCH : PATCHES[patchId];
  const orients = orientationsFor(patchId);
  const orient = orients[Math.min(orientation, orients.length - 1)];
  const outline = outlineFor(orient.cells);
  // пуговицы дохода — рисуются прямо на фигурке всегда и везде
  const incomeCells = def.income > 0 ? orient.cells.slice(0, def.income) : [];
  return (
    <g>
      <path d={outline.d} fill={def.color} stroke={shade(def.color, -46)} strokeWidth="0.06" />
      <path d={outline.d} fill={`url(#fab-${def.pattern})`} />
      <path d={outline.d} fill="none" stroke={shade(def.color, -70)} strokeWidth="0.055" strokeDasharray="0.16 0.11" strokeLinecap="round" />
      {incomeCells.map(([r, c], i) => (
        <g key={`inc${i}`} transform={`translate(${c + 0.5} ${r + 0.5}) scale(0.66)`}>
          <circle r={0.42} fill="#FDF6E3" stroke="#5B3B20" strokeWidth={0.13} />
          <circle r={0.09} cx={-0.14} cy={-0.14} fill="#5B3B20" />
          <circle r={0.09} cx={0.14} cy={-0.14} fill="#5B3B20" />
          <circle r={0.09} cx={-0.14} cy={0.14} fill="#5B3B20" />
          <circle r={0.09} cx={0.14} cy={0.14} fill="#5B3B20" />
        </g>
      ))}
    </g>
  );
}

/** Лента «дальше в пути»: все лоскутки круга после трёх доступных (горизонтальный скролл, тап — детали) */
export function UpcomingRibbon({
  upcoming,
  onSelect,
}: {
  upcoming: number[];
  onSelect?: (patchId: number) => void;
}) {
  const lang = useLang();
  if (upcoming.length === 0) return null;
  return (
    <div className="rounded-xl border-2 border-border bg-card/60 p-1">
      <div className="flex items-baseline justify-between px-1.5 pb-1">
        <span className="text-[9.5px] font-extrabold tracking-wider text-muted-foreground uppercase">{t('g_ribbon')}</span>
        <span className="text-[9px] font-bold text-muted-foreground/80">{t('g_ribbon_n', { n: upcoming.length })}</span>
      </div>
      <div className="hide-scrollbar overscroll-contain overflow-x-auto">
        <div className="flex w-max items-center gap-1.5 px-0.5 py-1">
          {upcoming.map((id, i) => {
            const p = PATCHES[id];
            const maxR = p ? Math.max(...p.cells.map((c) => c[0])) + 1 : 1;
            const maxC = p ? Math.max(...p.cells.map((c) => c[1])) + 1 : 1;
            return (
              <button
                key={i}
                type="button"
                onClick={() => onSelect?.(id)}
                aria-label={t('m_ribbon_aria', {
                  name: patchName(lang, id),
                  w: maxC,
                  h: maxR,
                  cost: p?.cost ?? 0,
                  time: p?.time ?? 0,
                })}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border-2 border-border bg-card/80 p-1 transition-transform active:scale-95"
              >
                <svg
                  viewBox={scaledGlyphViewBox(maxC, maxR, 0.06, p ? p.cells.length : 1)}
                  className="h-full w-full"
                  aria-hidden
                >
                  <GlyphDirect patchId={id} />
                </svg>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Попап с данными лоскутка из ленты «дальше в пути» */
export function PatchDetailPopup({ patchId, onClose }: { patchId: number; onClose: () => void }) {
  const lang = useLang();
  const patch = PATCHES[patchId];
  const maxR = Math.max(...patch.cells.map((c) => c[0])) + 1;
  const maxC = Math.max(...patch.cells.map((c) => c[1])) + 1;
  const maxDim = Math.max(maxR, maxC);
  const name = patchName(lang, patchId);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('m_d_aria', { name })}
    >
      <div
        className="stitched-card pop-in w-full max-w-[300px] p-4 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-[128px] items-center justify-center">
          <svg
            width={Math.round(120 * (maxC / maxDim))}
            height={Math.round(120 * (maxR / maxDim))}
            viewBox={`0 0 ${maxDim} ${maxDim}`}
            aria-hidden
          >
            <g transform={`translate(${(maxDim - maxC) / 2} ${(maxDim - maxR) / 2})`}>
              <GlyphDirect patchId={patchId} />
            </g>
          </svg>
        </div>
        <div className="mt-1 font-display text-[19px] text-foreground">{name}</div>
        <div className="mt-2 grid grid-cols-2 gap-1.5 px-1">
          <DetailStat icon={<CoinIcon size={15} />} label={t('m_d_price')} value={patch.cost} />
          <DetailStat icon={<ClockIcon size={15} />} label={t('m_d_time')} value={patch.time} />
          <DetailStat label={t('m_d_size')} value={`${maxC}×${maxR}`} />
          <DetailStat icon={<CoinIcon size={15} />} label={t('m_d_income')} value={patch.income > 0 ? `+${patch.income}` : '—'} />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="btn-cloth mt-3 w-full rounded-xl py-2 text-[14px] font-extrabold"
        >
          {t('m_d_ok')}
        </button>
      </div>
    </div>
  );
}

function DetailStat({ icon, label, value }: { icon?: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card/80 py-1.5">
      {icon && <span className="flex shrink-0 items-center">{icon}</span>}
      <span className="text-[14px] font-extrabold text-foreground">{value}</span>
      <span className="text-[10px] font-bold text-muted-foreground">{label}</span>
    </div>
  );
}

/** Кнопка продвижения */
export function AdvanceButton({
  preview,
  disabled,
  forced,
  onClick,
}: {
  preview: AdvancePreview;
  disabled?: boolean;
  forced?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`btn-wood flex h-full w-[104px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl px-2 py-2.5 text-center
        ${forced ? 'animate-pulse ring-3 ring-[#FFD98A]' : ''}`}
      aria-label={`Продвинуться на ${preview.distance} шагов и получить ${preview.buttonGain} пуговиц`}
    >
      <CoinIcon size={22} className="mx-auto" />
      <span className="text-[13px] leading-none font-extrabold">+{preview.buttonGain}</span>
      <span className="text-[10.5px] leading-tight font-semibold opacity-90">
        шагнуть{preview.distance > 0 ? ` на ${preview.distance}` : ''}
      </span>
      {preview.leathers > 0 && (
        <span
          className="flex items-center gap-0.5 rounded-full bg-[#7A5230]/70 px-1.5 py-[2px]"
          title={`${preview.leathers > 1 ? `${preview.leathers} кожаных лоскутка` : 'кожаный лоскуток'} на пути`}
        >
          <LeatherPatchIcon size={12} />
          {preview.leathers > 1 && <span className="text-[9px] font-bold text-[#F2E6CD]">×{preview.leathers}</span>}
        </span>
      )}
    </button>
  );
}

/** Маленькая плашка статуса игрока */
export function StatChip({
  icon,
  value,
  label,
  accent = false,
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex min-w-[74px] items-center gap-1.5 rounded-xl border px-2.5 py-1.5 ${
        accent ? 'border-primary/50 bg-primary/10' : 'border-border bg-card/80'
      }`}
      title={label}
    >
      {icon}
      <div className="leading-none">
        <div className="text-[15px] font-extrabold text-foreground">{value}</div>
        <div className="text-[9.5px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</div>
      </div>
    </div>
  );
}

/** Имя бота */
export function botName(level: BotLevel): string {
  return BOT_PERSONAS[level].name;
}
