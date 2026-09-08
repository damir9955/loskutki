'use client';

import { PATCHES, BOT_PERSONAS, type BotLevel, LEATHER_ID, LEATHER_PATCH } from '@/lib/game/constants';
import type { AvailablePatch } from '@/lib/game/engine';
import type { AdvancePreview } from '@/lib/game/engine';

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

/** Часики со стрелками (время) — читаются даже в 12px */
export function ClockIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9.6" fill="#F1E6CC" stroke="#A9855A" strokeWidth="1.8" />
      <path d="M 6.8 12 A 5.2 5.2 0 0 1 12 6.8" stroke="#ffffff" strokeWidth="1.3" fill="none" opacity="0.75" strokeLinecap="round" />
      <path d="M12 7.4 V12 L15.6 14.2" stroke="#6E4E0B" strokeWidth="2.1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="1.15" fill="#6E4E0B" />
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

/** Аватары ботов — «вышитые» портреты: печворк-фон, плечи, реквизит, стёжка-ободок */
export function BotAvatar({ level, size = 56, thinking = false }: { level: BotLevel; size?: number; thinking?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      style={{ flexShrink: 0 }}
      className={thinking ? 'soft-pulse' : undefined}
      aria-hidden
    >
      <defs>
        <radialGradient id={`av-${level}-bg`} cx="50%" cy="34%" r="82%">
          <stop offset="0%" stopColor={AV_BG[level][0]} />
          <stop offset="100%" stopColor={AV_BG[level][1]} />
        </radialGradient>
        <clipPath id={`avc-${level}`}>
          <circle cx="60" cy="60" r="55.5" />
        </clipPath>
      </defs>
      <circle cx="60" cy="60" r="58" fill={`url(#av-${level}-bg)`} stroke={AV_BG[level][2]} strokeWidth="3.5" />
      {/* ромбы-лоскуты по углам — задник-печворк */}
      <g clipPath={`url(#avc-${level})`}>
        <rect x="-18" y="-18" width="44" height="44" transform="rotate(45 4 4)" fill={AV_DECO[level]} opacity="0.45" />
        <rect x="94" y="-18" width="44" height="44" transform="rotate(45 116 4)" fill={AV_DECO[level]} opacity="0.45" />
        <rect x="-18" y="94" width="44" height="44" transform="rotate(45 4 116)" fill={AV_DECO[level]} opacity="0.45" />
        <rect x="94" y="94" width="44" height="44" transform="rotate(45 116 116)" fill={AV_DECO[level]} opacity="0.45" />
      </g>
      {AV_BODY[level]}
      {/* стёжка-ободок поверх */}
      <circle
        cx="60"
        cy="60"
        r="52"
        fill="none"
        stroke={AV_BG[level][2]}
        strokeWidth="1.8"
        strokeDasharray="4.5 3.5"
        opacity="0.65"
      />
    </svg>
  );
}

const AV_BG: Record<BotLevel, [string, string, string]> = {
  glasha: ['#FBF2DE', '#E7CFA6', '#C9A96B'],
  fedor: ['#F0EAD6', '#D3C69C', '#A8945E'],
  elza: ['#F9EDE4', '#E5CBBB', '#C49581'],
};

/** Цвет угловых лоскутов фона */
const AV_DECO: Record<BotLevel, string> = {
  glasha: '#C0788A',
  fedor: '#5B7E9E',
  elza: '#8E5A79',
};

/** Цветочек для платка (5 лепестков) */
function Flower({ x, y, s = 1, petal = '#F2D9E0', core = '#D9889C' }: { x: number; y: number; s?: number; petal?: string; core?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      {[0, 72, 144, 216, 288].map((a) => (
        <circle
          key={a}
          cx={Math.cos((a * Math.PI) / 180) * 3.4}
          cy={Math.sin((a * Math.PI) / 180) * 3.4}
          r="2.5"
          fill={petal}
          opacity="0.95"
        />
      ))}
      <circle r="1.9" fill={core} />
    </g>
  );
}

const AV_BODY: Record<BotLevel, React.ReactNode> = {
  /* ===== ТЁТЯ ГЛАША: платок с цветами, очки с цепочкой, фартук в горошек ===== */
  glasha: (
    <g>
      {/* плечи-фартук в горошек */}
      <path d="M 6 120 Q 10 94 36 88 L 84 88 Q 110 94 114 120 z" fill="#8AA06F" stroke="#617A4E" strokeWidth="2.6" />
      <circle cx="26" cy="102" r="3.1" fill="#DCE8CB" opacity="0.9" />
      <circle cx="42" cy="112" r="3.1" fill="#DCE8CB" opacity="0.9" />
      <circle cx="60" cy="106" r="3.1" fill="#DCE8CB" opacity="0.9" />
      <circle cx="78" cy="112" r="3.1" fill="#DCE8CB" opacity="0.9" />
      <circle cx="94" cy="102" r="3.1" fill="#DCE8CB" opacity="0.9" />
      <circle cx="34" cy="94" r="2.3" fill="#DCE8CB" opacity="0.7" />
      <circle cx="86" cy="94" r="2.3" fill="#DCE8CB" opacity="0.7" />
      {/* платок */}
      <path d="M 12 54 Q 60 -4 108 54 Q 96 70 82 76 Q 60 85 38 76 Q 24 70 12 54 z" fill="#C0788A" stroke="#96566A" strokeWidth="3" />
      <path d="M 16 52 Q 60 2 104 52" fill="none" stroke="#E8B7C2" strokeWidth="2" strokeDasharray="4.5 3" />
      <Flower x={34} y={40} />
      <Flower x={60} y={18} s={1.15} />
      <Flower x={86} y={40} />
      <Flower x={47} y={27} s={0.8} petal="#FBDFE7" />
      <Flower x={73} y={27} s={0.8} petal="#FBDFE7" />
      {/* горошек на платке */}
      <circle cx="26" cy="55" r="1.6" fill="#F2D9E0" opacity="0.8" />
      <circle cx="94" cy="55" r="1.6" fill="#F2D9E0" opacity="0.8" />
      <circle cx="60" cy="38" r="1.6" fill="#F2D9E0" opacity="0.8" />
      {/* седые пряди у висков */}
      <path d="M 38 55 q -4 10 -2 18 M 82 55 q 4 10 2 18" stroke="#DDD6C7" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      {/* лицо */}
      <ellipse cx="60" cy="66" rx="25.5" ry="26" fill="#F6E5CD" stroke="#D9B98F" strokeWidth="2.2" />
      {/* брови */}
      <path d="M 42 54 q 7 -5 14 -1 M 64 53 q 7 -4 14 1" stroke="#B99B72" strokeWidth="2.8" fill="none" strokeLinecap="round" />
      {/* очки */}
      <circle cx="50" cy="62" r="8.6" fill="#FCF8EF" stroke="#8A6B46" strokeWidth="2.6" />
      <circle cx="70" cy="62" r="8.6" fill="#FCF8EF" stroke="#8A6B46" strokeWidth="2.6" />
      <path d="M 58.6 62 h 2.8" stroke="#8A6B46" strokeWidth="2.6" />
      <circle cx="50" cy="62" r="3" fill="#4A3020" />
      <circle cx="70" cy="62" r="3" fill="#4A3020" />
      <circle cx="51" cy="60.8" r="0.9" fill="#fff" />
      <circle cx="71" cy="60.8" r="0.9" fill="#fff" />
      {/* цепочка очков к ушам */}
      <path d="M 41.5 63 q -5 7 -2.5 12 M 78.5 63 q 5 7 2.5 12" stroke="#C9A96B" strokeWidth="1.3" fill="none" opacity="0.9" />
      {/* морщинки-лучики */}
      <path d="M 38 60 q -2 2 -1 4 M 82 60 q 2 2 1 4" stroke="#D9B98F" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      {/* нос */}
      <path d="M 60 64 q -2.5 5 0 7" stroke="#CDA27C" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      {/* румянец */}
      <circle cx="42" cy="73" r="5.6" fill="#E8A98F" opacity="0.5" />
      <circle cx="78" cy="73" r="5.6" fill="#E8A98F" opacity="0.5" />
      {/* улыбка */}
      <path d="M 49 79 Q 60 87 71 79" stroke="#A05A40" strokeWidth="2.8" fill="none" strokeLinecap="round" />
      {/* пуговичные серьги */}
      <circle cx="35.5" cy="81" r="3.4" fill="#F1E6CC" stroke="#A9855A" strokeWidth="1.2" />
      <circle cx="84.5" cy="81" r="3.4" fill="#F1E6CC" stroke="#A9855A" strokeWidth="1.2" />
      <circle cx="34.6" cy="80.1" r="0.5" fill="#8a6b46" />
      <circle cx="36.4" cy="80.1" r="0.5" fill="#8a6b46" />
      <circle cx="34.6" cy="82" r="0.5" fill="#8a6b46" />
      <circle cx="36.4" cy="82" r="0.5" fill="#8a6b46" />
      <circle cx="83.6" cy="80.1" r="0.5" fill="#8a6b46" />
      <circle cx="85.4" cy="80.1" r="0.5" fill="#8a6b46" />
      <circle cx="83.6" cy="82" r="0.5" fill="#8a6b46" />
      <circle cx="85.4" cy="82" r="0.5" fill="#8a6b46" />
      {/* узел платка под подбородком */}
      <path d="M 46 92 Q 60 99 74 92 L 71 103 Q 60 109 49 103 z" fill="#B06A7C" stroke="#96566A" strokeWidth="2.4" />
      <path d="M 52 96 l 8 3 M 68 96 l -8 3" stroke="#E8B7C2" strokeWidth="1.5" />
    </g>
  ),
  /* ===== МАСТЕР ФЁДОР: кепка-восьмиклинка, усы, клетчатая рубашка, ножницы ===== */
  fedor: (
    <g>
      {/* клетчатая рубашка-плечи */}
      <path d="M 4 120 Q 8 96 34 90 L 86 90 Q 112 96 116 120 z" fill="#A9503C" stroke="#7E3226" strokeWidth="2.6" />
      <g stroke="#D9A13F" strokeWidth="1.5" opacity="0.7">
        <path d="M 22 98 h 76 M 16 110 h 88 M 30 92 v 28 M 60 90 v 30 M 90 92 v 28" fill="none" />
      </g>
      <g stroke="#7E3226" strokeWidth="0.8" opacity="0.55">
        <path d="M 34 93 h 52 M 13 114 h 94 M 44 90 v 30 M 76 90 v 30" fill="none" />
      </g>
      {/* воротник рубашки */}
      <path d="M 44 92 L 60 102 L 76 92 L 80 108 Q 60 116 40 108 z" fill="#F4EFDE" stroke="#C5B891" strokeWidth="2.2" />
      <circle cx="60" cy="105" r="2.4" fill="#A9855A" />
      {/* лента-сантиметр на шее */}
      <path d="M 27 104 Q 60 86 93 104" fill="none" stroke="#E5C158" strokeWidth="7.5" strokeLinecap="round" />
      <path d="M 27 104 Q 60 86 93 104" fill="none" stroke="#B98F33" strokeWidth="1.4" strokeDasharray="2.5 4" />
      {/* ножницы в нагрудном кармане */}
      <g transform="translate(85 103) rotate(-16)">
        <rect x="-5" y="-1" width="11" height="13" rx="2" fill="#54341C" opacity="0.9" />
        <path d="M 4 0.5 L 11 -6 M 4 3.5 L 11 10" stroke="#B8C4CC" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="12" cy="-7.2" r="2.4" fill="none" stroke="#8A6B46" strokeWidth="1.3" />
        <circle cx="12" cy="11.2" r="2.4" fill="none" stroke="#8A6B46" strokeWidth="1.3" />
        <circle cx="4.2" cy="2" r="1" fill="#D9A13F" />
      </g>
      {/* уши */}
      <ellipse cx="36" cy="66" rx="5" ry="7" fill="#EEDCC0" stroke="#D2B78E" strokeWidth="1.8" />
      <ellipse cx="84" cy="66" rx="5" ry="7" fill="#EEDCC0" stroke="#D2B78E" strokeWidth="1.8" />
      <path d="M 36 64 q 2 2 0 4 M 84 64 q -2 2 0 4" stroke="#D2B78E" strokeWidth="1.2" fill="none" />
      {/* лицо */}
      <rect x="37" y="44" width="46" height="42" rx="19" fill="#EFDCC0" stroke="#D2B78E" strokeWidth="2.2" />
      {/* морщины на лбу */}
      <path d="M 46 44 q 14 -4 28 0 M 48 40 q 12 -3 24 0" stroke="#D2B78E" strokeWidth="1.5" fill="none" opacity="0.7" strokeLinecap="round" />
      {/* кепка: тулья + клинья + пуговка */}
      <path d="M 29 45 Q 60 6 91 45 Q 60 55 29 45 z" fill="#5B7E9E" stroke="#3E5C78" strokeWidth="3" />
      <path d="M 60 8 L 42 44 M 60 8 L 78 44 M 36 34 Q 60 26 84 34" stroke="#4A6A88" strokeWidth="1.8" fill="none" opacity="0.85" />
      <path d="M 44 16 Q 52 10 60 9" stroke="#7EA2C0" strokeWidth="2" fill="none" opacity="0.7" strokeLinecap="round" />
      <circle cx="60" cy="9.5" r="3.6" fill="#7EA2C0" stroke="#3E5C78" strokeWidth="1.6" />
      {/* козырёк */}
      <path d="M 27 45 Q 60 60 93 45 L 91 52 Q 60 65 29 52 z" fill="#46688B" stroke="#35506E" strokeWidth="2.4" />
      {/* брови */}
      <path d="M 43 57 q 7 -3 13 0 M 64 57 q 7 -3 13 0" stroke="#6E5335" strokeWidth="3.6" fill="none" strokeLinecap="round" />
      {/* глаза */}
      <circle cx="49" cy="62" r="3" fill="#3E2F23" />
      <circle cx="71" cy="62" r="3" fill="#3E2F23" />
      <circle cx="50" cy="60.8" r="1" fill="#fff" />
      <circle cx="72" cy="60.8" r="1" fill="#fff" />
      {/* нос */}
      <path d="M 60 64 q -3 7 0 9" stroke="#CDA27C" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      {/* усы */}
      <path d="M 40 75 Q 60 67 80 75 Q 60 84 40 75 z" fill="#6E5335" stroke="#54401F" strokeWidth="2" />
      <path d="M 50 73.5 Q 60 71 70 73.5" stroke="#54401F" strokeWidth="1.6" fill="none" />
    </g>
  ),
  /* ===== КУТЮРЬЕ ЭЛЬЗА: каре с чёлкой, стрелки, жемчуг, иголка-кулон ===== */
  elza: (
    <g>
      {/* плечи с кружевной отделкой */}
      <path d="M 8 120 Q 12 98 36 92 L 84 92 Q 108 98 112 120 z" fill="#6E4E5E" stroke="#4E3547" strokeWidth="2.6" />
      <g transform="translate(10 106)">
        <path d="M 0 0 q 4 4 8 0 q 4 4 8 0 q 4 4 8 0 q 4 4 8 0 q 4 4 8 0 q 4 4 8 0 q 4 4 8 0 q 4 4 8 0 q 4 4 8 0 q 4 4 8 0" stroke="#D8C9A6" strokeWidth="1.5" fill="none" opacity="0.85" />
      </g>
      {/* волосы-каре (задний слой) */}
      <path d="M 22 74 Q 16 12 60 10 Q 104 12 98 74 L 86 76 Q 90 42 74 36 L 74 82 Q 60 88 46 82 L 46 36 Q 30 42 34 76 z" fill="#3E2C1E" stroke="#241710" strokeWidth="2.6" />
      <path d="M 30 40 Q 40 20 62 16" stroke="#6B4E35" strokeWidth="2.2" fill="none" opacity="0.7" strokeLinecap="round" />
      <path d="M 90 46 Q 92 60 88 72" stroke="#6B4E35" strokeWidth="1.8" fill="none" opacity="0.6" strokeLinecap="round" />
      {/* лицо */}
      <ellipse cx="60" cy="62" rx="22.5" ry="25" fill="#F7E9D6" stroke="#DEC3A0" strokeWidth="2" />
      {/* чёлка */}
      <path d="M 38 46 Q 60 30 82 46 Q 83 53 78 51 Q 60 40 42 51 Q 37 53 38 46 z" fill="#3E2C1E" stroke="#241710" strokeWidth="2" />
      {/* брови-дуги */}
      <path d="M 45 55 q 7 -4 13 -1 M 62 54 q 7 -3 13 1" stroke="#4A3A28" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      {/* глаза со стрелками и ресницами */}
      <path d="M 42 61 Q 49 56.5 56 61 Q 49 65 42 61 z" fill="#F7E9D6" stroke="#2E2015" strokeWidth="2" />
      <path d="M 64 61 Q 71 56.5 78 61 Q 71 65 64 61 z" fill="#F7E9D6" stroke="#2E2015" strokeWidth="2" />
      <circle cx="49" cy="61" r="2.5" fill="#4A3020" />
      <circle cx="71" cy="61" r="2.5" fill="#4A3020" />
      <path d="M 42 61 l -3 -2 M 64 61 l -3 -2" stroke="#2E2015" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M 44 58 q 3 -2 5 -1 M 66 58 q 3 -2 5 -1" stroke="#2E2015" strokeWidth="1.2" fill="none" opacity="0.8" />
      {/* румянец */}
      <circle cx="45" cy="70" r="4.6" fill="#E8A98F" opacity="0.4" />
      <circle cx="75" cy="70" r="4.6" fill="#E8A98F" opacity="0.4" />
      {/* губы сердечком */}
      <path d="M 54 78 Q 60 74 66 78 Q 60 85 54 78 z" fill="#B0475C" stroke="#8E3346" strokeWidth="1.4" />
      {/* серьги с жемчужиной */}
      <circle cx="38" cy="76" r="2.6" fill="#D9A13F" stroke="#A6721F" strokeWidth="1.2" />
      <circle cx="82" cy="76" r="2.6" fill="#D9A13F" stroke="#A6721F" strokeWidth="1.2" />
      <circle cx="38" cy="82" r="2.8" fill="#F2ECDF" stroke="#C9B58C" strokeWidth="1" />
      <circle cx="82" cy="82" r="2.8" fill="#F2ECDF" stroke="#C9B58C" strokeWidth="1" />
      {/* кружевной воротничок */}
      <path d="M 38 90 Q 60 100 82 90 L 86 104 Q 60 114 34 104 z" fill="#F6EFDC" stroke="#C9B58C" strokeWidth="2" />
      <path d="M 38 98 q 4 5 8 0 q 4 5 8 0 q 4 5 8 0 q 4 5 8 0 q 4 5 8 0" stroke="#D8C9A6" strokeWidth="1.6" fill="none" />
      {/* жемчуг */}
      <circle cx="52" cy="95" r="3.2" fill="#F7F3E8" stroke="#C9B58C" strokeWidth="1.2" />
      <circle cx="60" cy="97" r="3.6" fill="#F7F3E8" stroke="#C9B58C" strokeWidth="1.2" />
      <circle cx="68" cy="95" r="3.2" fill="#F7F3E8" stroke="#C9B58C" strokeWidth="1.2" />
      {/* нитяное ожерелье с иголкой-кулоном */}
      <path d="M 46 92 Q 60 102 74 92" fill="none" stroke="#C9A96B" strokeWidth="1.5" />
      <path d="M 60 100 L 60 109" stroke="#B8C4CC" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="60" cy="100.5" r="1.7" fill="#D9A13F" stroke="#A6721F" strokeWidth="0.8" />
    </g>
  ),
};

/** Карточка лоскутка на рынке: бирки цены/времени прямо на фигурке */
export function MarketCard({
  patchId,
  index,
  buttons,
  placeable,
  selected,
  disabled,
  onSelect,
}: {
  patchId: number;
  index: 0 | 1 | 2;
  buttons: number;
  placeable: boolean;
  selected?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  const patch = PATCHES[patchId];
  const affordable = buttons >= patch.cost;
  const can = affordable && placeable;
  const maxR = Math.max(...patch.cells.map((c) => c[0])) + 1;
  const maxC = Math.max(...patch.cells.map((c) => c[1])) + 1;
  const maxDim = Math.max(maxR, maxC);
  const glyph = Math.min(46, 14 + maxDim * 8.5);
  const blockedText = !placeable ? 'не помещается' : !affordable ? 'мало пуговиц' : null;
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled || !can || !onSelect}
      aria-label={`Купить «${patch.name}» (${maxC}×${maxR}): ${patch.cost} пуговиц, ${patch.time} времени`}
      className={`stitched-card relative flex w-full min-w-0 flex-col items-center gap-1 px-1.5 pb-1.5 pt-2 transition-all [touch-action:none]
        ${selected ? 'ring-4 ring-primary scale-[1.03] shadow-lg' : ''}
        ${!disabled && can ? 'cursor-pointer hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]' : ''}
        ${!can ? 'opacity-50 grayscale-[.45]' : ''}`}
    >
      <span className="absolute top-1.5 left-1.5 flex h-5.5 w-5.5 items-center justify-center rounded-full bg-primary text-[11px] font-extrabold text-primary-foreground shadow">
        {index + 1}
      </span>
      {/* фигурка строго по центру карточки — бирки поверх, не сдвигают глиф */}
      <div className="relative flex h-[50px] w-full items-center justify-center">
        <svg width={glyph} height={glyph} viewBox={`0 0 ${maxDim} ${maxDim}`} aria-hidden>
          <g transform={`translate(${(maxDim - maxC) / 2} ${(maxDim - maxR) / 2 - 0.2})`}>
            <GlyphDirect patchId={patchId} />
          </g>
        </svg>
        {/* бирки цены/времени в правом верхнем углу */}
        <div className="absolute top-0 right-0 flex flex-col items-end gap-1">
          <BadgePill small icon={<CoinIcon size={12} />} value={patch.cost} bad={!affordable} />
          <BadgePill small icon={<ClockIcon size={12} />} value={patch.time} />
        </div>
      </div>
      {/* нижняя строка: размер · имя · статус (если нельзя купить) / доход */}
      <div className="flex w-full items-center justify-between gap-1 px-0.5">
        <span
          className="shrink-0 rounded-md bg-[#7A5230]/14 px-1 py-[1.5px] text-[10px] leading-none font-extrabold text-[#7A5230]"
          title={`Размер лоскутка: ${maxC}×${maxR}`}
        >
          {maxC}×{maxR}
        </span>
        {blockedText ? (
          <span className="min-w-0 flex-1 truncate rounded-full bg-destructive/90 px-1.5 py-[2px] text-center text-[9.5px] leading-none font-bold text-white">
            {blockedText}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[10.5px] leading-none font-bold text-foreground/90">{patch.name}</span>
        )}
        {patch.income > 0 && !blockedText && (
          <span className="flex shrink-0 items-center gap-0.5 text-[10px] leading-none font-extrabold text-[#A6721F]">
            <CoinIcon size={10} />+{patch.income}
          </span>
        )}
      </div>
    </button>
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
  return (
    <g>
      <path d={outline.d} fill={def.color} stroke={shade(def.color, -46)} strokeWidth="0.06" />
      <path d={outline.d} fill={`url(#fab-${def.pattern})`} />
      <path d={outline.d} fill="none" stroke={shade(def.color, -70)} strokeWidth="0.055" strokeDasharray="0.16 0.11" strokeLinecap="round" />
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
  if (upcoming.length === 0) return null;
  return (
    <div className="rounded-xl border-2 border-border bg-card/60 p-1">
      <div className="flex items-baseline justify-between px-1.5 pb-1">
        <span className="text-[9.5px] font-extrabold tracking-wider text-muted-foreground uppercase">дальше в пути</span>
        <span className="text-[9px] font-bold text-muted-foreground/80">{upcoming.length} шт</span>
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
                aria-label={`${p?.name ?? ''}, ${maxC}×${maxR}: ${p?.cost ?? 0} пуговиц, ${p?.time ?? 0} времени`}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border-2 border-border bg-card/80 p-1 transition-transform active:scale-95"
              >
                <svg viewBox={`0 0 ${maxC} ${maxR}`} className="h-full w-full" aria-hidden>
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
  const patch = PATCHES[patchId];
  const maxR = Math.max(...patch.cells.map((c) => c[0])) + 1;
  const maxC = Math.max(...patch.cells.map((c) => c[1])) + 1;
  const maxDim = Math.max(maxR, maxC);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Лоскуток «${patch.name}»`}
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
        <div className="mt-1 font-display text-[19px] text-foreground">{patch.name}</div>
        <div className="mt-2 grid grid-cols-2 gap-1.5 px-1">
          <DetailStat icon={<CoinIcon size={15} />} label="цена" value={patch.cost} />
          <DetailStat icon={<ClockIcon size={15} />} label="время" value={patch.time} />
          <DetailStat label="размер" value={`${maxC}×${maxR}`} />
          <DetailStat icon={<CoinIcon size={15} />} label="доход" value={patch.income > 0 ? `+${patch.income}` : '—'} />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="btn-cloth mt-3 w-full rounded-xl py-2 text-[14px] font-extrabold"
        >
          Понятно
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
        <span className="rounded-full bg-[#7A5230]/70 px-1.5 text-[9px] font-bold text-[#F2E6CD]">
          +кожаный
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
