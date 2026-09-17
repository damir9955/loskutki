'use client';

/**
 * Блокировка ориентации экрана в ПОРТРЕТ для телефонов (v3.10.0).
 *
 * ПОЧЕМУ ЭТО НУЖНО: сама веб-страница не может «не перевернуться» —
 * она переворачивается вместе с браузером, когда ОС разворачивает
 * экран. Системный замок автоповорота обычно это останавливает, НО
 * некоторые браузеры в режиме установленного приложения (PWA) и в
 * полноэкранном режиме обходят его — экран крутится по датчику,
 * и партия «переворачивается» при наклоне телефона.
 *
 * РЕШЕНИЕ — Screen Orientation API: приложение само просит ОС держать
 * портрет (тот же механизм, каким нативные игры фиксируют ориентацию;
 * запрос приложения приоритетнее системного автоповорота):
 *  — Android, установленное приложение/полный экран — работает;
 *  — обычная вкладка без полного экрана — браузер откажет (RejectNotAllowedError),
 *    молча игнорируем: там поворотом управляет системный замок;
 *  — iOS Safari — API не поддерживается, молча игнорируем: там системный
 *    замок работает всегда.
 *
 * ТОЛЬКО ДЛЯ ТЕЛЕФОНОВ: у планшетов есть отдельная горизонтальная
 * раскладка (useIsTablet) — им поворот НЕ запираем.
 */

/** Телефон? (по меньшей стороне экрана в CSS-пикселях; планшеты ≥768) */
export function isPhoneLike(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Math.min(window.screen.width, window.screen.height) <= 700;
  } catch {
    return false;
  }
}

let lockHeld = false;

/** диагностический маркер (виден в консоли: window.__loskutkiOrientation) */
function mark(v: string): void {
  try {
    (window as unknown as Record<string, string>).__loskutkiOrientation = v;
  } catch {
    /* ignore */
  }
}

/**
 * Попросить ОС держать портрет. Безопасна при любом раскладе:
 * все отказы молча проглатываются, игра работает как раньше.
 * Возвращает true, если замок удалось взять.
 */
export async function lockPortrait(): Promise<boolean> {
  if (lockHeld) return true;
  if (typeof window === 'undefined') return false;
  // своя типизация: в lib.dom метод lock то отсутствует, то помечен
  // deprecated — в браузерах Android он есть и работает
  const so = window.screen.orientation as (ScreenOrientation & {
    lock?: (o: string) => Promise<void>;
  }) | undefined;
  if (!so || typeof so.lock !== 'function') {
    mark('unsupported'); // iOS Safari и др. — поворотом управляет системный замок
    return false;
  }
  if (!isPhoneLike()) {
    mark('tablet-skip'); // планшет: горизонтальная раскладка разрешена
    return false;
  }
  try {
    // 'portrait' = обе портретные стороны: экран не ляжет набок при
    // наклоне, но останется читаемым, если телефон держат вверх ногами
    await so.lock!('portrait');
    lockHeld = true;
    mark('portrait-held');
    return true;
  } catch {
    // вкладка без fullscreen / браузер не даёт — системой управляет замок ОС
    mark('portrait-denied');
    return false;
  }
}

/**
 * Включить блокировку и ПОДДЕРЖИВАТЬ её: после сворачивания/возврата
 * в приложение некоторые браузеры отпускают замок — перепросим.
 * Вызывается один раз при старте игры (BootGate).
 */
export function keepPortraitLocked(): void {
  if (typeof window === 'undefined') return;
  void lockPortrait();
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void lockPortrait();
    });
  } catch {
    /* ignore */
  }
}
