'use client';

/**
 * Загрузочный экран «Лоскутков» — полный офлайн-режим.
 *
 * Правила (ровно по требованиям):
 *  — ПЕРВЫЙ запуск: окно с полоской загрузки; скачиваются ВСЕ файлы
 *    игры (страница, чанки, шрифты, иконки, портреты) в Cache Storage;
 *    когда всё скачано — создаётся МАРКЕР (localStorage «loskutki.boot»
 *    с версией игры) и открывается игра.
 *  — ПОВТОРНЫЙ запуск: маркер есть → сразу игра, мгновенно (всё уже
 *    в кэше service-воркера, интернет не нужен). Чтобы не мигать
 *    загрузкой при мгновенном старте, инлайн-скрипт в <head> ставит
 *    html[data-boot=ready] ДО гидрации и вуаль скрывается CSS-ом.
 *  — маркер есть + вышла новая версия: service-воркер сам скачивает
 *    обновление в фоне (незаметно), применяется при следующем запуске.
 *    ПОДСТРАХОВКА: при запуске сверяемся с /version.json на сервере
 *    (всегда из сети); если там версия новее, а на устройстве — старая
 *    (например, воркер не успел обновиться) — чистим кэш и перекачиваем
 *    игру сразу, с полоской загрузки. Замок на 60с страхует от циклов.
 *  — нет интернета при первом запуске: экран «подключитесь к
 *    интернету» с кнопкой повторить.
 */

import { useCallback, useEffect, useState } from 'react';
import { APP_VERSION, BOOT_MARKER_KEY, UPDATE_LOCK_KEY } from '@/lib/version';
import { t } from '@/lib/i18n';
import { WifiOff, RefreshCw } from 'lucide-react';

type BootState =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'loading'; done: number; total: number }
  | { kind: 'updating' }
  | { kind: 'error' };

interface BootMarker {
  v: string;
  at: number;
}

const STATIC_URLS = [
  '/manifest.webmanifest',
  '/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/avatars/ann.jpg', '/avatars/boris.jpg', '/avatars/elza.jpg', '/avatars/fedor.jpg',
  '/avatars/glasha.jpg', '/avatars/grig.jpg', '/avatars/vera.jpg',
  '/fonts/nunito-cyrillic-ext.woff2', '/fonts/nunito-cyrillic.woff2',
  '/fonts/nunito-latin-ext.woff2', '/fonts/nunito-latin.woff2', '/fonts/nunito-vietnamese.woff2',
  '/fonts/yeseva-cyrillic-ext.woff2', '/fonts/yeseva-cyrillic.woff2',
  '/fonts/yeseva-latin-ext.woff2', '/fonts/yeseva-latin.woff2', '/fonts/yeseva-vietnamese.woff2',
];

function readMarker(): BootMarker | null {
  try {
    const raw = localStorage.getItem(BOOT_MARKER_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as BootMarker;
    return m && typeof m.v === 'string' ? m : null;
  } catch {
    return null;
  }
}

function writeMarker() {
  try {
    localStorage.setItem(BOOT_MARKER_KEY, JSON.stringify({ v: APP_VERSION, at: Date.now() } satisfies BootMarker));
  } catch {
    /* приватный режим — игра просто будет качать каждый раз */
  }
}

async function fetchIntoCache(cache: Cache, url: string): Promise<boolean> {
  try {
    const resp = await fetch(new Request(url, { credentials: 'omit' }));
    if (resp && resp.ok) {
      await cache.put(new Request(url, { credentials: 'omit' }), resp);
      return true;
    }
  } catch {
    /* попробуем дальше */
  }
  return false;
}

/** сверка с сервером: там уже другая (новая) версия? — только онлайн,
 *  быстро (≤ 3.5с) и молча; любая ошибка = «не знаем, работаем дальше» */
async function serverHasNewerBuild(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.onLine) return false;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3500);
    try {
      const resp = await fetch('/version.json', {
        credentials: 'omit',
        cache: 'no-store',
        signal: ctl.signal,
      });
      if (!resp.ok) return false;
      const data = (await resp.json()) as { version?: string };
      return typeof data.version === 'string' && data.version !== APP_VERSION;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

/** недавно уже обновлялись этим механизмом? (страховка от цикла) */
function updateLocked(): boolean {
  try {
    const at = Number(localStorage.getItem(UPDATE_LOCK_KEY));
    return Number.isFinite(at) && Date.now() - at < 60_000;
  } catch {
    return false;
  }
}

/** на устройстве устаревшая сборка: сносим все кэши и маркер, просим
 *  воркер обновиться и перезапускаем страницу — игрок сразу получает
 *  свежую версию (с окном загрузки, как при первой установке) */
async function selfUpdate(setState: (s: BootState) => void): Promise<void> {
  setState({ kind: 'updating' });
  try {
    localStorage.setItem(UPDATE_LOCK_KEY, String(Date.now()));
  } catch {
    /* приватный режим — просто продолжаем */
  }
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    /* Cache Storage недоступен — страница перезагрузится всё равно */
  }
  try {
    localStorage.removeItem(BOOT_MARKER_KEY);
  } catch {
    /* ignore */
  }
  try {
    void (await navigator.serviceWorker?.getRegistration())?.update();
  } catch {
    /* ignore */
  }
  location.reload();
}

export function BootGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<BootState>({ kind: 'checking' });

  const registerSw = useCallback(async (): Promise<ServiceWorkerRegistration | null> => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
    if (process.env.NODE_ENV !== 'production') return null; // dev HMR и SW не дружат
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      // проверка обновлений при каждом запуске (незаметно, в фоне)
      void reg.update().catch(() => undefined);
      return reg;
    } catch {
      return null; // SW недоступен — игра всё равно работает онлайн
    }
  }, []);

  const runFirstInstall = useCallback(async () => {
    setState({ kind: 'loading', done: 0, total: 0 });

    // 1) основной путь: service-воркер скачивает всё и шлёт прогресс
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      try {
        await registerSw();
        const ok = await waitSwPrecache(setState);
        if (ok) {
          writeMarker();
          setState({ kind: 'ready' });
          return;
        }
      } catch {
        /* SW не поднялся — качаем сами */
      }
    }

    // 2) fallback: сами, файл за файлом (SW нет / молчит)
    try {
      let cache: Cache | null = null;
      try {
        cache = await caches.open(`loskutki-v${APP_VERSION}`);
      } catch {
        // Cache Storage недоступен → без офлайн, но маркер ставим,
        // чтобы не мучить пользователя экраном каждый запуск
        writeMarker();
        setState({ kind: 'ready' });
        return;
      }

      const pageOk = await fetchIntoCache(cache, '/');
      if (!pageOk && !navigator.onLine) {
        setState({ kind: 'error' });
        return;
      }

      // чанки из HTML
      const urls = new Set<string>(STATIC_URLS);
      let html = '';
      try {
        const resp = await fetch(new Request('/', { credentials: 'omit', cache: 'no-store' }));
        if (resp && resp.ok) html = await resp.clone().text();
      } catch {
        /* офлайн уже проверили */
      }
      const re = /(?:src|href)\s*=\s*["']([^"']+)["']/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) {
        const u = m[1];
        if (u.startsWith('/_next/') || u.startsWith('/fonts/') || u.startsWith('/avatars/')) {
          urls.add(u.split('?')[0]);
        }
      }

      let done = 0;
      const total = urls.size;
      setState({ kind: 'loading', done: 0, total });
      let anyFail = false;
      for (const u of urls) {
        const ok = await fetchIntoCache(cache, u);
        if (!ok) anyFail = true;
        done++;
        setState({ kind: 'loading', done, total });
      }
      if (anyFail && !navigator.onLine) {
        setState({ kind: 'error' });
        return;
      }
      // маркер: игра полностью скачана (с версией)
      writeMarker();
      setState({ kind: 'ready' });
    } catch {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setState({ kind: 'error' });
      } else {
        // сеть есть, но что-то странное — не блокируем игру
        writeMarker();
        setState({ kind: 'ready' });
      }
    }
  }, [registerSw]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (readMarker()) {
      // приложение полностью скачано ранее — открываем сразу;
      // обновление (если задеплоено) service-воркер тянет сам в фоне.
      // setState — через микрозадачу (не синхронно в эффекте)
      void registerSw();
      queueMicrotask(() => setState({ kind: 'ready' }));
      // ПОДСТРАХОВКА: воркер мог не успеть/не суметь обновиться —
      // сверяем версию с сервером и при расхождении перекачиваемся
      void (async () => {
        if (updateLocked()) return;
        if (await serverHasNewerBuild()) await selfUpdate(setState);
      })();
      return;
    }
    queueMicrotask(() => void runFirstInstall());
  }, []);

  // ===== рендер =====
  // checking: SSR и первый кадр — тонкая вуаль (её прячет инлайн-скрипт
  // в <head>, если маркер уже есть: html[data-boot=ready]); приложение
  // под ней уже отрисовано — старт получается по-настоящему мгновенным
  if (state.kind === 'checking') {
    return (
      <>
        <div className="boot-veil linen-bg fixed inset-0 z-50" aria-hidden />
        {children}
      </>
    );
  }
  if (state.kind === 'ready') {
    return <>{children}</>;
  }

  if (state.kind === 'error') {
    return (
      <div className="linen-bg fixed inset-0 z-50 flex min-h-svh items-center justify-center px-6">
        <div className="pop-in stitched-card w-full max-w-[420px] px-6 py-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#C33A2F]/12">
            <WifiOff className="h-8 w-8 text-[#8f2a20]" />
          </div>
          <div className="font-display mt-4 text-[24px] text-foreground">{t('boot_no_net_t')}</div>
          <p className="mt-2 text-[14px] font-semibold text-muted-foreground">{t('boot_no_net_d')}</p>
          <button
            type="button"
            onClick={() => void runFirstInstall()}
            className="btn-wood mt-6 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[16px] font-extrabold"
          >
            <RefreshCw className="h-5 w-5" />
            {t('boot_retry')}
          </button>
        </div>
      </div>
    );
  }

  // updating: на устройстве была устаревшая версия — перекачиваем
  if (state.kind === 'updating') {
    return (
      <div className="linen-bg fixed inset-0 z-50 flex min-h-svh flex-col items-center justify-center px-8">
        <div className="pop-in stitched-card flex w-full max-w-[380px] flex-col items-center px-6 py-8 text-center">
          <RefreshCw className="h-10 w-10 animate-spin text-[#8B5E3C]" aria-hidden />
          <div className="font-display mt-4 text-[22px] text-foreground">{t('boot_update_t')}</div>
          <p className="mt-2 text-[13.5px] font-semibold text-muted-foreground">{t('boot_update_d')}</p>
        </div>
      </div>
    );
  }

  // loading: окно с полоской
  const pct = state.total > 0 ? Math.min(100, Math.round((state.done / state.total) * 100)) : 4;
  return (
    <div className="linen-bg fixed inset-0 z-50 flex min-h-svh flex-col items-center justify-center px-8">
      <div className="flex w-full max-w-[380px] flex-col items-center" role="status" aria-live="polite">
        {/* катушка с ниткой */}
        <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden className="pop-in">
          <rect x="4" y="4" width="76" height="76" rx="16" fill="#FBF4E2" stroke="#8B5E3C" strokeWidth="3" />
          <rect x="10" y="10" width="64" height="64" rx="12" fill="none" stroke="#8B5E3C" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.6" />
          <g transform="translate(22 20)">
            <rect x="6" y="2" width="28" height="12" rx="2" fill="#D9A13F" stroke="#8A5E13" strokeWidth="2" />
            <rect x="6" y="2" width="28" height="4" rx="1" fill="#F2C879" />
            <rect x="10" y="14" width="4" height="18" fill="#B57F27" />
            <rect x="26" y="14" width="4" height="18" fill="#B57F27" />
            <rect x="12" y="14" width="16" height="14" fill="#C0603A" opacity="0.85" />
            <path d="M20 34 q3 6 -2 10" fill="none" stroke="#C0603A" strokeWidth="2.5" strokeLinecap="round" />
          </g>
        </svg>
        <div className="font-display mt-5 text-[28px] leading-none text-foreground">{t('app_title')}</div>
        <div className="mt-1.5 text-[13px] font-bold tracking-wide text-muted-foreground">{t('boot_title')}</div>

        {/* полоска загрузки — заполняется «ниткой» */}
        <div className="mt-6 w-full">
          <div className="stitched-card h-7 overflow-hidden rounded-xl p-0 [&::after]:inset-[3px]">
            <div
              className="from-[#C9744E] to-[#B25A34] h-full rounded-[inherit] bg-gradient-to-r transition-[width] duration-300 ease-out"
              style={{ width: `${Math.max(5, pct)}%` }}
            >
              <div className="h-full w-full opacity-40 [background:repeating-linear-gradient(115deg,transparent_0_7px,rgba(255,255,255,.5)_7px_13px)]" />
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between text-[12px] font-extrabold text-muted-foreground">
            <span>{t('boot_status', { n: pct })}</span>
            <span className="tabular-nums">v{APP_VERSION}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** дождаться от SW сообщений прогресса/готовности (≤75с, потом сами) */
async function waitSwPrecache(setState: (s: BootState) => void): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      resolve(false);
      return;
    }
    const start = Date.now();
    let settled = false;
    let lastDone = 0;
    let lastTotal = 0;
    let lastMsgAt = Date.now();
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      navigator.serviceWorker.removeEventListener('message', onMsg);
      clearInterval(guard);
      resolve(ok);
    };
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as { t?: string; n?: number };
      lastMsgAt = Date.now();
      if (d?.t === 'total') {
        lastTotal = d.n ?? lastTotal;
      } else if (d?.t === 'progress') {
        lastDone = d.n ?? lastDone;
      } else if (d?.t === 'done') {
        finish(true);
        return;
      }
      setState({ kind: 'loading', done: lastDone, total: lastTotal });
    };
    // сторож: тишина 45с или всё заняло >75с — качаем сами
    const guard = setInterval(() => {
      if (Date.now() - lastMsgAt > 45_000 || Date.now() - start > 75_000) finish(false);
    }, 2_000);
    navigator.serviceWorker.addEventListener('message', onMsg);
    // просим воркер скачать всё (устанавливающийся шлёт прогресс сама)
    void navigator.serviceWorker.ready.then((reg) => {
      const sw = reg.active ?? reg.waiting ?? reg.installing;
      if (!sw) {
        finish(false);
        return;
      }
      sw.postMessage({ t: 'precache' });
    });
  });
}
