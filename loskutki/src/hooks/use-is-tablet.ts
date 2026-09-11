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
