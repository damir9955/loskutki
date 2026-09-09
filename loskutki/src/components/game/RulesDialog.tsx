'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PATCHES, INCOME_MARKERS, LEATHER_POS, START_BUTTONS, TIME_END } from '@/lib/game/constants';
import { ClockIcon, CoinIcon, IncomeIcon, LeatherPatchIcon } from './MarketRow';
import { t, useLang, type Lang } from '@/lib/i18n';

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
  const lang = useLang();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-h-[88svh] w-[min(94vw,560px)] overflow-y-auto nice-scroll">
        <DialogHeader>
          <DialogTitle className="font-display text-[24px]">
            {lang === 'en' ? 'How to play' : 'Как играть'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-[14.5px] leading-relaxed font-semibold text-foreground/90">
          {lang === 'en' ? <RulesEn /> : <RulesRu />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Русские правила (род — нейтрально/мужской: «соперник») */
function RulesRu() {
  return (
    <>
      <Section title="Цель">
        <p>
          Сшейте из лоскутков полотно 9×9 и наберите больше очков, чем соперник. В конце
          каждая <b>пуговица = +1 очко</b>, каждая <b>пустая клетка = −2 очка</b>, а спецплитка
          7×7 даёт <b>+7</b>. Побеждает лучший «швейный бюджет» и плотная укладка!
        </p>
      </Section>

      <Section title="Кто ходит">
        <p>
          Ходит тот, чья булавка <b>ниже всех на дорожке времени</b> — иногда по несколько
          ходов подряд. Если вы встали <b>точно на клетку соперника</b>, ваша булавка ложится
          <b>сверху</b> — и вы <b>ходите ещё раз</b>. В свой ход выберите одно из двух действий:
        </p>
      </Section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="stitched-card p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[15px] font-extrabold text-primary">
            <CoinIcon size={17} /> Действие А
          </div>
          <p className="text-[13.5px]">
            <b>Шагнуть за пуговицами.</b> Булавка прыгает на клетку сразу за булавкой соперника —
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
            Лоскутки лежат по кругу, между ними — напальчник-токен. Продаются только <b>три</b>
            карточки впереди него. Купили — токен встаёт <b>на освободившееся место</b>,
            и в продажу выходят <b>следующие три</b>: оставшиеся два из прошлой тройки + новый
            из круга. Ближе к концу партии выбор сужается, а самый последний лоскуток так и
            остаётся непроданным. У каждой ткани своя цена{' '}
            <CoinIcon size={13} className="inline" /> и время <ClockIcon size={13} className="inline" />.
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
          <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md bg-[#7A5230]/20">
            <LeatherPatchIcon size={27} />
          </div>
          <p>
            На клетках {LEATHER_POS.join('·')} лежат кожаные лоскутки 1×1. Первый прошедший
            забирает такой лоскуток и <b>сразу пришивает</b> его — это единственный способ
            закрыть одиночные дырки. Не успели — лоскуток достанется сопернику.
          </p>
        </div>
      </Section>

      <Section title="Спецплитка 7×7">
        <div className="flex items-start gap-3">
          <div className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-lg border-2 border-[#A6721F] bg-[#D9A13F]/25 text-[20px]">
            🏅
          </div>
          <p>
            Первый, кто полностью закроет <b>любой квадрат 7×7</b> без дырок, получает плитку
            (+7 очков). Спор за неё часто решает партию — следите за полотном соперника!
          </p>
        </div>
      </Section>

      <Section title="Партия и счёт">
        <p>
          У каждого по <b>{START_BUTTONS} пуговиц</b> на старте. Партия кончается, когда обе булавки
          доходят до <b>{TIME_END}</b>. Счёт = пуговицы + плитка − 2×пустые клетки. При ничьей
          выигрывает тот, кто раньше пришёл к финишу.
        </p>
      </Section>

      <Section title="Управление">
        <p>
          Нажмите на карточку лоскутка — он «приподнимется» над полотном. <b>Тяните пальцем</b>,
          чтобы выбрать место, кнопками поверните и отразите, затем «Пришить». Не хватает пуговиц?
          Жмите «Шагнуть» и берите доход. Подсказка-лампочка подскажет разумный
          ход — один совет за нажатие, нажимайте сколько нужно.
        </p>
      </Section>
    </>
  );
}

/** English rules */
function RulesEn() {
  return (
    <>
      <Section title="Goal">
        <p>
          Sew a 9×9 quilt from patches and outscore your rival. At the end <b>each button = +1
          point</b>, <b>each empty cell = −2 points</b>, and the 7×7 special tile gives <b>+7</b>.
          The best “sewing budget” and tight packing wins!
        </p>
      </Section>

      <Section title="Turn order">
        <p>
          The player whose pin is <b>furthest behind on the time track</b> moves — sometimes
          several turns in a row. If you land <b>exactly on the rival’s cell</b>, your pin goes
          <b> on top</b> — and you <b>move again</b>. On your turn, choose one of two actions:
        </p>
      </Section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="stitched-card p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[15px] font-extrabold text-primary">
            <CoinIcon size={17} /> Action A
          </div>
          <p className="text-[13.5px]">
            <b>Step forward for buttons.</b> The pin jumps to the cell right behind the rival’s
            pin — you gain <b>1 button for every space passed</b> and, if you crossed income
            markers, your income once more. Simple, but time slips away.
          </p>
        </div>
        <div className="stitched-card p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[15px] font-extrabold text-primary">
            <ClockIcon size={17} /> Action B
          </div>
          <p className="text-[13.5px]">
            <b>Buy and sew a patch</b> from the three offered at the token. Pay buttons; the pin
            travels forward by the patch’s “clocks”. A patch can be <b>rotated and mirrored</b>.
          </p>
        </div>
      </div>

      <Section title="Patch market">
        <div className="flex items-start gap-3">
          <div className="flex gap-1.5">
            <PatchFigure id={20} />
            <PatchFigure id={9} />
          </div>
          <p>
            Patches lie in a circle with a thimble token among them. Only the <b>three</b> cards
            ahead of it are for sale. Buy one — the token takes the <b>freed spot</b>, and the
            <b> next three</b> go on sale: the two remaining from the previous trio plus a new one
            from the circle. Near the end the choice narrows, and the very last patch never sells.
            Each fabric has its own price <CoinIcon size={13} className="inline" /> and time{' '}
            <ClockIcon size={13} className="inline" />.
          </p>
        </div>
      </Section>

      <Section title="Income">
        <div className="flex items-start gap-3">
          <IncomeIcon size={30} />
          <p>
            Patches with button symbols yield <b>income</b>: crossing income cells on the track
            (markers on cells {INCOME_MARKERS.slice(0, 4).join('·')}…) gains you as many buttons
            as you have symbols on your quilt. Buy “income” fabrics early!
          </p>
        </div>
      </Section>

      <Section title="Leather patches">
        <div className="flex items-start gap-3">
          <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md bg-[#7A5230]/20">
            <LeatherPatchIcon size={27} />
          </div>
          <p>
            Leather 1×1 patches lie on cells {LEATHER_POS.join('·')}. The first player to pass
            takes one and <b>sews it immediately</b> — the only way to close single holes. Too
            slow — the rival takes it.
          </p>
        </div>
      </Section>

      <Section title="7×7 special tile">
        <div className="flex items-start gap-3">
          <div className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-lg border-2 border-[#A6721F] bg-[#D9A13F]/25 text-[20px]">
            🏅
          </div>
          <p>
            The first player to fully cover <b>any 7×7 square</b> without holes earns the tile
            (+7 points). The race for it often decides the game — watch the rival’s quilt!
          </p>
        </div>
      </Section>

      <Section title="Game and scoring">
        <p>
          Everyone starts with <b>{START_BUTTONS} buttons</b>. The game ends when both pins reach
          <b> {TIME_END}</b>. Score = buttons + tile − 2×empty cells. On a tie, whoever reached
          the finish earlier wins.
        </p>
      </Section>

      <Section title="Controls">
        <p>
          Tap a patch card — it “lifts” over the board. <b>Drag with your finger</b> to choose a
          spot, rotate and mirror with the buttons, then “Sew”. Short on buttons? Press “Step
          forward” and collect income. The lightbulb gives one tip per press —
          press it as often as you like.
        </p>
      </Section>
    </>
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
