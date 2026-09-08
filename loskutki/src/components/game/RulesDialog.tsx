'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PATCHES, INCOME_MARKERS, LEATHER_POS, START_BUTTONS, TIME_END } from '@/lib/game/constants';
import { ClockIcon, CoinIcon, IncomeIcon } from './MarketRow';

/** Мини-иллюстрация лоскутка в правилах */
function PatchFigure({ id, size = 54 }: { id: number; size?: number }) {
  const patch = PATCHES[id];
  const maxR = Math.max(...patch.cells.map((c) => c[0])) + 1;
  const maxC = Math.max(...patch.cells.map((c) => c[1])) + 1;
  const w = Math.max(maxR, maxC);
  return (
    <svg width={size} height={size} viewBox={`-0.15 -0.15 ${w + 0.3} ${w + 0.3}`} className="shrink-0" aria-hidden>
      <GlyphMini id={id} />
    </svg>
  );
}

import { outlineFor, shade } from '@/lib/game/outline';

function GlyphMini({ id }: { id: number }) {
  const p = PATCHES[id];
  const o = outlineFor(p.cells);
  return (
    <g>
      <path d={o.d} fill={p.color} stroke={shade(p.color, -46)} strokeWidth="0.07" />
      <path d={o.d} fill={`url(#fab-${p.pattern})`} />
      <path d={o.d} fill="none" stroke={shade(p.color, -70)} strokeWidth="0.06" strokeDasharray="0.16 0.11" />
    </g>
  );
}

function RulesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-h-[88svh] w-[min(94vw,560px)] overflow-y-auto nice-scroll">
        <DialogHeader>
          <DialogTitle className="font-display text-[24px]">Как играть</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-[14.5px] leading-relaxed font-semibold text-foreground/90">
          <Section title="Цель">
            <p>
              Сшейте из лоскутков полотно 9×9 и наберите больше очков, чем соперница. В конце
              каждая <b>пуговица = +1 очко</b>, каждая <b>пустая клетка = −2 очка</b>, а спецплитка
              7×7 даёт <b>+7</b>. Побеждает лучший «швейный бюджет» и плотная укладка!
            </p>
          </Section>

          <Section title="Кто ходит">
            <p>
              Ходит та швея, чья булавка <b>ниже всех на дорожке времени</b> — иногда по несколько
              ходов подряд. Если булавки на одной клетке, ходит та, что «сверху». В свой ход выберите
              одно из двух действий:
            </p>
          </Section>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="stitched-card p-3">
              <div className="mb-1 flex items-center gap-1.5 text-[15px] font-extrabold text-primary">
                <CoinIcon size={17} /> Действие А
              </div>
              <p className="text-[13.5px]">
                <b>Шагнуть за пуговицами.</b> Булавка прыгает на клетку сразу за булавкой соперницы —
                вы получаете <b>по 1 пуговице за каждый пройденный шаг</b> и, если пересекли значки
                дохода, свой доход ещё раз. Просто, но время уходит.
              </p>
            </div>
            <div className="stitched-card p-3">
              <div className="mb-1 flex items-center gap-1.5 text-[15px] font-extrabold text-primary">
                <ClockIcon size={17} /> Действие Б
              </div>
              <p className="text-[13.5px]">
                <b>Купить и пришить лоскуток</b> из трёх доступных у токена. Платите пуговицы, булавка
                едет вперёд на «часики» лоскутка. Лоскуток можно <b>поворачивать и отразить</b>.
              </p>
            </div>
          </div>

          <Section title="Рынок лоскутков">
            <div className="flex items-start gap-3">
              <div className="flex gap-1.5">
                <PatchFigure id={20} />
                <PatchFigure id={9} />
              </div>
              <p>
                Лоскутки лежат кругом, между ними — нейтральный токен. Продаются только <b>три</b>
                впереди него (карточки 1–2–3). Купили — токен встаёт на место лоскутка. У каждой
                ткани своя цена <CoinIcon size={13} className="inline" /> и время <ClockIcon size={13} className="inline" />.
              </p>
            </div>
          </Section>

          <Section title="Доход">
            <div className="flex items-start gap-3">
              <IncomeIcon size={30} />
              <p>
                Лоскутки со значками-пуговицами дают <b>доход</b>: пересекая клетки дохода на дорожке
                (значки на клетках {INCOME_MARKERS.slice(0, 4).join('·')}…), вы получаете столько
                пуговиц, сколько значков на вашем полотне. Покупайте «доходные» ткани заранее!
              </p>
            </div>
          </Section>

          <Section title="Кожаные лоскутки">
            <div className="flex items-start gap-3">
              <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md bg-[#7A5230] text-[14px]">
                🥾
              </div>
              <p>
                На клетках {LEATHER_POS.join('·')} лежат кожаные лоскутки 1×1. Первый прошедший
                забирает такой лоскуток и <b>сразу пришивает</b> его — это единственный способ
                закрыть одиночные дырки. Не успели — лоскуток достанется сопернице.
              </p>
            </div>
          </Section>

          <Section title="Спецплитка 7×7">
            <div className="flex items-start gap-3">
              <div className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-lg border-2 border-[#A6721F] bg-[#D9A13F]/25 text-[20px]">
                🏅
              </div>
              <p>
                Первая швея, полностью закрывшая <b>любой квадрат 7×7</b> без дырок, получает плитку
                (+7 очков). Спор за неё часто решает партию — следите за полотном соперницы!
              </p>
            </div>
          </Section>

          <Section title="Партия и счёт">
            <p>
              У каждой по <b>{START_BUTTONS} пуговиц</b> на старте. Партия кончается, когда обе булавки
              доходят до <b>{TIME_END}</b>. Счёт = пуговицы + плитка − 2×пустые клетки. При ничьей
              выигрывает та, что раньше пришла к финишу.
            </p>
          </Section>

          <Section title="Управление">
            <p>
              Нажмите на карточку лоскутка — он «приподнимется» над полотном. <b>Тяните пальцем</b>,
              чтобы выбрать место, кнопками поверните и отразите, затем «Пришить». Не хватает пуговиц?
              Жмите «Шагнуть» и берите доход. Подсказка-лампочка подсветит разумный ход.
            </p>
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-display mb-1 text-[18px] text-foreground">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

export default RulesDialog;
