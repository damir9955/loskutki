'use client';

import { useEffect, useState } from 'react';

/**
 * Автоопределение планшетного режима: широкий экран (≥768px) И достаточно
 * высокий (≥600px). Телефон в альбомной ориентации (широкий, но низкий)
 * остаётся в одноколоночном мобильном режиме. Реагирует на поворот экрана.
 */
const QUERY = '(min-width: 768px) and (min-height: 600px)';

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
