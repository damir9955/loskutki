'use client';

import { useEffect, useState } from 'react';

/**
 * Планшетная раскладка — ТОЛЬКО в горизонтальной ориентации (широкий И
 * высокий экран). Вертикальный планшет живёт с обычной телефонной вёрсткой
 * («как на телефоне»), телефон в альбомной ориентации (широкий, но низкий)
 * тоже остаётся в одноколоночном мобильном режиме. Реагирует на поворот.
 */
const QUERY = '(min-width: 768px) and (min-height: 480px) and (orientation: landscape)';

export function useIsTablet(): boolean {
  const [tablet, setTablet] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const update = () => setTablet(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
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

export function useIsBigPortrait(): boolean {
  const [big, setBig] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(QUERY_BIG_PORTRAIT);
    const update = () => setBig(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return big;
}
