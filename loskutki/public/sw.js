/* Service Worker «Лоскутков» — офлайн-режим и мгновенный старт.
 *
 * ГЛАВНЫЕ ПРАВИЛА (по требованиям):
 *  1. Первая установка: воркер пре-кэширует ВСЁ приложение (страницу,
 *     все JS/CSS-чанки, шрифты, иконки, портреты) — игра целиком на
 *     телефоне, картинки больше не «не прогружаются». Прогресс
 *     отправляется в загрузочный экран пост-месседжами.
 *  2. Повторный запуск: HTML и все файлы отдаются из кэша — старт
 *     мгновенный, интернет не нужен.
 *  3. ФОНОВОЕ ОБНОВЛЕНИЕ: новый воркер (изменился VERSION) ставится и
 *     скачивает всё, ПОКА ИГРОК ИГРАЕТ на старой версии; skipWaiting
 *     НЕ вызывается — новая версия применяется при СЛЕДУЮЩЕМ запуске.
 *     Игру ничем не блокируем: если файл «завис», у него таймаут и
 *     повтор; если что-то не скачалось — старый кэш НЕ удаляется и
 *     остаётся запасным, недостающее докачается при следующей игре.
 *
 * Стратегии:
 *  — навигация ('/'): кэш-первично (мгновенный старт, версия строго
 *    из своего кэша — смешивания старого/нового не бывает);
 *  — прочие GET-запросы своего origin: кэш-первично + докачка в кэш
 *    + (офлайн/сбой сети) запасной поиск в кэше прошлой версии;
 *  — /api/*, сам sw.js и /version.json — всегда сеть (version.json —
 *    «честная» версия на сервере, по ней загрузчик узнаёт об обновлении).
 */

const VERSION = 'v3.9.0';
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

/** установка прошла не полностью? (тогда старый кэш держим запасом) */
let installIncomplete = false;

/** таймаут одного запроса — зависший файл не замораживает установку */
function fetchWithTimeout(url, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return fetch(new Request(url, { credentials: 'omit' }), { signal: ctl.signal }).finally(() => clearTimeout(timer));
}

/** сравнение версий в именах кэшей: 'loskutki-v3.10.0' > 'loskutki-v3.9.0'
 *  (лексикографическая сортировка тут врёт — потому сравниваем числа) */
function cacheVerCmp(a, b) {
  const va = (a.match(/(\d+)\.(\d+)\.(\d+)/) || [0, 0, 0, 0]).slice(1).map(Number);
  const vb = (b.match(/(\d+)\.(\d+)\.(\d+)/) || [0, 0, 0, 0]).slice(1).map(Number);
  for (let i = 0; i < 3; i++) {
    if (va[i] !== vb[i]) return va[i] - vb[i];
  }
  return 0;
}

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

/** скачать страницу с таймаутом и одним повтором; null = не вышло */
async function fetchPage(page) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetchWithTimeout(page, 25000);
      if (resp && resp.ok) return resp;
    } catch (e) {
      /* таймаут или сеть — повтор */
    }
  }
  return null;
}

/** положить в кэш по URL; 2 попытки с таймаутом по 25с; null = не удалось */
async function addUrl(cache, url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetchWithTimeout(url, 25000);
      if (resp && resp.ok) {
        await cache.put(new Request(url, { credentials: 'omit' }), resp);
        return resp;
      }
    } catch (e) {
      /* таймаут или сеть — повторим */
    }
  }
  return null;
}

/** скачать, если ещё нет в кэше (прерванная установка быстро
 *  продолжается с места остановки, без повторной перекачки) */
async function addUrlSmart(cache, url) {
  try {
    const have = await cache.match(url);
    if (have) return have;
  } catch (e) {
    /* кэш не читается — просто качаем */
  }
  return addUrl(cache, url);
}

/** полное пре-кэширование приложения с отчётами прогресса */
async function precacheAll(progressCb) {
  const cache = await caches.open(CACHE);
  const urls = new Set(STATIC_ASSETS);
  let failed = 0;

  // 1) страницы (игра + политика конфиденциальности): в кэш + разобрать
  //    на чанки/стили
  let html = '';
  for (const page of ['/', '/privacy']) {
    try {
      const resp = await fetchPage(page);
      if (resp) {
        const clone = resp.clone();
        await cache.put(new Request(page, { credentials: 'omit' }), resp);
        html += '\n' + await clone.text();
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
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
    const resp = await addUrlSmart(cache, u);
    if (resp) {
      try {
        const text = await resp.clone().text();
        for (const u2 of assetUrlsFromText(text)) {
          if (!urls.has(u2)) nested.add(u2);
        }
      } catch (e) {
        /* ignore */
      }
    } else {
      failed++;
    }
    done++;
    if (progressCb) progressCb({ done });
  }

  // 3) вложенное + шрифты, иконки, портреты, манифест
  const rest = [...nested, ...urls].filter((u) => u !== '/' && !codeUrls.includes(u));
  for (const u of rest) {
    const resp = await addUrlSmart(cache, u);
    if (!resp) failed++;
    done++;
    if (progressCb) progressCb({ done });
  }
  precachedSession = true;
  return { total: codeUrls.length + rest.length || restCount, failed };
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // качаем всё приложение, прогресс летит в загрузочный экран;
      // при обновлении версии это происходит В ФОНЕ — игрок играет
      // на старом кэше и ничего не ждёт
      const r = await precacheAll((p) => report({ t: p.total ? 'total' : 'progress', n: p.total ?? p.done }));
      // что-то не докачалось (плохая сеть)? — не беда: установка
      // завершается, но при активации старый кэш НЕ удалим, а в fetch
      // устроим запасной поиск в нём; докачаем при следующей возможности
      installIncomplete = r.failed > 0;
      // ВАЖНО: self.skipWaiting() НЕ вызываем — новая версия
      // применяется только при СЛЕДУЮЩЕМ запуске игры
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // новая версия скачалась целиком? — сносим кэши всех прочих
      // версий. Если нет (installIncomplete) — старый кэш оставляем
      // запасным: офлайн-запросы возьмут недостающее из него.
      if (!installIncomplete) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      } else if (precachedSession) {
        // «подлечим» новую установку при первой возможности: следующий
        // заход online перекачает недостающее (addUrlSmart), и тогда-то
        // старый кэш и уберётся — при активации после нового обновления
        const keys = await caches.keys();
        const others = keys.filter((k) => k !== CACHE && k.startsWith('loskutki-'));
        if (others.length > 1) {
          // старых кэшей накопилось больше одного — оставляем только
          // самый свежий из них, прочие подчищаем (не копим мусор)
          others.sort(cacheVerCmp);
          for (const k of others.slice(0, -1)) await caches.delete(k);
        }
      }
    })(),
  );
});

/** поиск в кэшах ПРОШЛЫХ версий — запасной офлайн-источник
 *  (ищем от самой свежей версии к старым) */
async function matchAnyOther(pathname) {
  try {
    const keys = await caches.keys();
    const others = keys.filter((k) => k !== CACHE && k.startsWith('loskutki-')).sort(cacheVerCmp);
    for (let i = others.length - 1; i >= 0; i--) {
      const cache = await caches.open(others[i]);
      const hit = await cache.match(pathname, { ignoreSearch: pathname === '/' });
      if (hit) return hit;
    }
  } catch (e) {
    /* нет запасного — вернём null */
  }
  return null;
}

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
        // сети нет: ищем в кэше прошлой версии (запасной офлайн-источник)
        const fallback = await matchAnyOther(url.pathname);
        if (fallback) return fallback;
        if (req.mode === 'navigate') {
          const shell = (await cache.match('/')) || (await matchAnyOther('/'));
          if (shell) return shell; // офлайн: приложение целиком из кэша
        }
        return new Response('offline', { status: 503, statusText: 'offline' });
      }
    })(),
  );
});
