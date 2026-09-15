/* Service Worker «Лоскутков» — офлайн-режим и мгновенный старт.
 *
 * ГЛАВНЫЕ ПРАВИЛА (по требованиям):
 *  1. Первая установка: воркер пре-кэширует ВСЁ приложение (страницу,
 *     все JS/CSS-чанки, шрифты, иконки, портреты) — игра целиком на
 *     телефоне, картинки больше не «не прогружаются». Прогресс
 *     отправляется в загрузочный экран пост-месседжами.
 *  2. Повторный запуск: HTML и все файлы отдаются из кэша — старт
 *     мгновенный, интернет не нужен.
 *  3. Обновление: НОВЫЙ воркер (изменился VERSION) ставится в фоне,
 *     пока игрок играет на старой версии; skipWaiting НЕ вызывается —
 *     новая версия применяется при СЛЕДУЮЩЕМ запуске. Старый кэш
 *     удаляется при активации.
 *
 * Стратегии:
 *  — навигация ('/'): кэш-первично (мгновенный старт, версия строго
 *    из своего кэша — смешивания старого/нового не бывает);
 *  — прочие GET-запросы своего origin: кэш-первично + докачка в кэш;
 *  — /api/*, сам sw.js и /version.json — всегда сеть (version.json —
 *    «честная» версия на сервере, по ней загрузчик узнаёт об обновлении).
 */

const VERSION = 'v3.3.0';
const CACHE = 'loskutki-' + VERSION;

/** файлы, о которых воркер знает без разбора HTML */
const STATIC_ASSETS = [
  '/manifest.webmanifest',
  '/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/avatars/ann.jpg',
  '/avatars/boris.jpg',
  '/avatars/elza.jpg',
  '/avatars/fedor.jpg',
  '/avatars/glasha.jpg',
  '/avatars/grig.jpg',
  '/avatars/vera.jpg',
  '/fonts/nunito-cyrillic-ext.woff2',
  '/fonts/nunito-cyrillic.woff2',
  '/fonts/nunito-latin-ext.woff2',
  '/fonts/nunito-latin.woff2',
  '/fonts/nunito-vietnamese.woff2',
  '/fonts/yeseva-cyrillic-ext.woff2',
  '/fonts/yeseva-cyrillic.woff2',
  '/fonts/yeseva-latin-ext.woff2',
  '/fonts/yeseva-latin.woff2',
  '/fonts/yeseva-vietnamese.woff2',
];

/** уже качали в этом сеансе воркера? (не дублируем работу) */
let precachedSession = false;

/** отправить сообщение всем открытым клиентам (прогресс загрузки) */
async function report(msg) {
  try {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const c of clients) c.postMessage(msg);
  } catch (e) {
    /* клиентов нет — не страшно */
  }
}

/** разобрать HTML: ссылки на чанки/стили Next + статику */
function assetUrlsFromHtml(html) {
  const out = new Set();
  const re = /(?:src|href)\s*=\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const u = m[1];
    if (u.startsWith('/_next/') || u.startsWith('/fonts/') || u.startsWith('/icons/') || u.startsWith('/avatars/')) {
      out.add(u.split('?')[0]);
    }
  }
  return [...out];
}

/** разобрать текст JS/CSS: ссылки на медиа, шрифты, портреты */
function assetUrlsFromText(text) {
  const out = new Set();
  const re = /["']((?:\/)?(?:_next\/static\/media|fonts|avatars|icons)\/[^"'\s)\\]+)["']/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const u = m[1];
    if (u.startsWith('/')) out.add(u.split('?')[0]);
  }
  return [...out];
}

/** положить в кэш по URL ОРИГИНАЛЬНЫЙ ответ; ошибки не всплывают */
async function addUrl(cache, url) {
  try {
    const resp = await fetch(new Request(url, { credentials: 'omit' }));
    if (resp && resp.ok) {
      await cache.put(new Request(url, { credentials: 'omit' }), resp);
    }
    return resp && resp.ok ? resp : null;
  } catch (e) {
    return null;
  }
}

/** полное пре-кэширование приложения с отчётами прогресса */
async function precacheAll(progressCb) {
  const cache = await caches.open(CACHE);
  const urls = new Set(STATIC_ASSETS);

  // 1) страницы (игра + политика конфиденциальности): в кэш + разобрать
  //    на чанки/стили
  let html = '';
  for (const page of ['/', '/privacy']) {
    try {
      const resp = await fetch(new Request(page, { credentials: 'omit', cache: 'no-store' }));
      if (resp && resp.ok) {
        const clone = resp.clone();
        await cache.put(new Request(page, { credentials: 'omit' }), resp);
        html += '\n' + await clone.text();
      }
    } catch (e) {
      /* офлайн прямо при установке — загрузочный экран покажет ошибку */
    }
  }
  for (const u of assetUrlsFromHtml(html)) urls.add(u);

  // сколько всего будем качать (чанки + статики) — для полоски
  const codeUrls = [...urls].filter((u) => u.startsWith('/_next/'));
  const restCount = urls.size - codeUrls.length;
  if (progressCb) progressCb({ total: urls.size });

  // 2) JS/CSS: в кэш + разобрать тексты на вложенные медиа/шрифты
  const nested = new Set();
  let done = 0;
  for (const u of codeUrls) {
    const resp = await addUrl(cache, u);
    if (resp) {
      try {
        const text = await resp.clone().text();
        for (const u2 of assetUrlsFromText(text)) {
          if (!urls.has(u2)) nested.add(u2);
        }
      } catch (e) {
        /* ignore */
      }
    }
    done++;
    if (progressCb) progressCb({ done });
  }

  // 3) вложенное + шрифты, иконки, портреты, манифест
  const rest = [...nested, ...urls].filter((u) => u !== '/' && !codeUrls.includes(u));
  for (const u of rest) {
    await addUrl(cache, u);
    done++;
    if (progressCb) progressCb({ done });
  }
  precachedSession = true;
  return { total: codeUrls.length + rest.length || restCount };
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // качаем всё приложение, прогресс летит в загрузочный экран;
      // при обновлении версии это происходит в ФОНЕ (игрок играет
      // на старом кэше)
      await precacheAll((p) => report({ t: p.total ? 'total' : 'progress', n: p.total ?? p.done }));
      // ВАЖНО: self.skipWaiting() НЕ вызываем — новая версия
      // применяется только при СЛЕДУЮЩЕМ запуске игры
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // снести кэши всех прочих версий (активация = следующий запуск)
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    })(),
  );
});

/** загрузочный экран просит: скачай всё и докладывай прогресс */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.t === 'precache') {
    const src = event.source;
    const send = (msg) => {
      try {
        src && src.postMessage(msg);
      } catch (e) {
        /* источник мог закрыться */
      }
    };
    event.waitUntil(
      (async () => {
        if (precachedSession) {
          // уже качали (установка воркера) — готово сразу
          send({ t: 'done', total: 0 });
          return;
        }
        const total = await precacheAll((p) => send({ t: p.total ? 'total' : 'progress', n: p.total ?? p.done }));
        send({ t: 'done', total: total.total });
      })(),
    );
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.headers.get('upgrade')) return; // websocket-апгрейды (HMR dev, WS)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // API — только сеть
  if (url.pathname === '/sw.js') return; // свой файл всегда мимо кэша
  if (url.pathname === '/version.json') return; // версия сервера — всегда сеть

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(url.pathname, { ignoreSearch: url.pathname === '/' });
      if (cached) return cached; // мгновенно из кэша (версия своя)

      try {
        const resp = await fetch(req);
        if (resp && resp.ok && resp.type === 'basic') {
          try {
            await cache.put(req, resp.clone());
          } catch (e) {
            /* некоторые ответы кэшировать нельзя — не страшно */
          }
        }
        return resp;
      } catch (e) {
        if (req.mode === 'navigate') {
          const shell = await cache.match('/');
          if (shell) return shell; // офлайн: приложение целиком из кэша
        }
        return new Response('offline', { status: 503, statusText: 'offline' });
      }
    })(),
  );
});
