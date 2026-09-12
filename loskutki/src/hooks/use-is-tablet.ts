'use client';

import { useEffect, useState } from 'react';

/**
 * Планшетная раскладка — ТОЛЬКО в горизонтальной ориентации (широкий И
 * высокий экран). Вертикальный планшет живёт с обычной телефонной вёрсткой
 * («как на телефоне»), телефон в альбомной ориентации (широкий, но низкий)
 * тоже остаётся в одноколоночном мобильном режиме. Реагирует на поворот.
 *
 * СТАРТ БЕЗ «МИГАНИЯ» НЕ ТЕМ ЛЕЙАУТОМ: первый рендер уже знает ответ
 * (ленивая инициализация по matchMedia, а не false + эффект), поэтому при
 * включении планшета сразу рисуется правильная (горизонтальная) вёрстка.
 * Поворот/включение устройства некоторые планшетные браузеры сообщают
 * с задержкой или вовсе не шлют 'change' у MediaQueryList — поэтому кроме
 * стандартного слушателя дублируем orientationchange/resize и перепроверяем
 * матч ещё пару раз с паузой (размеры окна обновляются асинхронно).
 */
const QUERY = '(min-width: 768px) and (min-height: 480px) and (orientation: landscape)';

function matchesTablet(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia(QUERY).matches;
  } catch {
    return false;
  }
}

export function useIsTablet(): boolean {
  const [tablet, setTablet] = useState(matchesTablet);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const update = () => setTablet(mq.matches);
    update();
    mq.addEventListener('change', update);
    // страховка: ориентация сменилась, а viewport/matchMedia ещё «едут» —
    // перепроверяем ещё пару раз (устройства сообщают размеры асинхронно)
    let timers: ReturnType<typeof setTimeout>[] = [];
    const recheck = () => {
      update();
      timers.forEach(clearTimeout);
      timers = [setTimeout(update, 250), setTimeout(update, 900)];
    };
    window.addEventListener('orientationchange', recheck);
    window.addEventListener('resize', update);
    return () => {
      mq.removeEventListener('change', update);
      window.removeEventListener('orientationchange', recheck);
      window.removeEventListener('resize', update);
      timers.forEach(clearTimeout);
    };
  }, []);
  return tablet;
}

/**
 * «Большой портрет» — планшет вертикально (CSS-ширина ≥700, портрет,
 * высота ≥600): остаётся одноколоночная телефонная вёрстка, НО колонка
 * расширяется почти на весь экран, а элементы (карточки рынка, лента,
 * кнопки, шапка) пропорционально крупнеют — экран используется целиком,
 * без узкой полоски по центру с пустотой по бокам. Телефоны (≤430px
 * CSS-ширины) сюда не попадают.
 */
const QUERY_BIG_PORTRAIT = '(min-width: 700px) and (min-height: 600px) and (orientation: portrait)';

function matchesBigPortrait(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia(QUERY_BIG_PORTRAIT).matches;
  } catch {
    return false;
  }
}

export function useIsBigPortrait(): boolean {
  const [big, setBig] = useState(matchesBigPortrait);
  useEffect(() => {
    const mq = window.matchMedia(QUERY_BIG_PORTRAIT);
    const update = () => setBig(mq.matches);
    update();
    mq.addEventListener('change', update);
    let timers: ReturnType<typeof setTimeout>[] = [];
    const recheck = () => {
      update();
      timers.forEach(clearTimeout);
      timers = [setTimeout(update, 250), setTimeout(update, 900)];
    };
    window.addEventListener('orientationchange', recheck);
    window.addEventListener('resize', update);
    return () => {
      mq.removeEventListener('change', update);
      window.removeEventListener('orientationchange', recheck);
      window.removeEventListener('resize', update);
      timers.forEach(clearTimeout);
    };
  }, []);
  return big;
}
