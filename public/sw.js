/* Commissire service worker — app-shell caching for installability + offline.
 * Bump CACHE_VERSION to force clients onto a fresh cache after a deploy.
 *
 * SECURITY: account data is NEVER cached here. The API (/api/*) and Socket.IO
 * (/socket.io/*) are same-origin in production; caching them served one account's
 * /me, race list and snapshots to the next account on the same device (v2 bug,
 * fixed in v3). Only static, non-personal files are cached. */
const CACHE_VERSION = 'commissire-v3';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/logo.png',
  '/pwa-192.png',
  '/pwa-512.png',
  // Offline OCR (Scan Start List) — vendored by `npm run ocr-assets`.
  // The two SIMD cores cover all current browsers; the plain-lstm fallback
  // for legacy devices is served same-origin and cached on first use.
  '/ocr/worker.min.js',
  '/ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js',
  '/ocr/core/tesseract-core-simd-lstm.wasm.js',
  '/ocr/lang/heb.traineddata',
  '/ocr/lang/eng.traineddata',
];

/** Never cached, never answered from a cache: account data and live traffic. */
const isPrivate = (url) => /\/(api|socket\.io)\//.test(url.pathname);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // Don't fail the whole install if one asset 404s.
      Promise.allSettled(APP_SHELL.map((url) => cache.add(url)))
    )
  );
  // v3 activates at once (security fix): the v2 worker answered /api/* from its
  // cache, so it must stop controlling pages now, not after an "Update now" tap.
  // The page is NOT reloaded (the app reloads only from applyUpdate), and static
  // files of the running version are carried over into v3 on activate.
  self.skipWaiting();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const current = await caches.open(CACHE_VERSION);
      for (const key of await caches.keys()) {
        if (key === CACHE_VERSION) continue;
        const old = await caches.open(key);
        // Keep the running version's static files (offline), drop every API response.
        for (const req of await old.keys()) {
          if (isPrivate(new URL(req.url))) continue;
          if (await current.match(req)) continue;
          const res = await old.match(req);
          if (res) await current.put(req, res);
        }
        await caches.delete(key);
      }
      // Belt and braces: nothing private in the current cache either.
      for (const req of await current.keys()) {
        if (isPrivate(new URL(req.url))) await current.delete(req);
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // don't touch cross-origin
  if (isPrivate(url)) return; // straight to the network, never cached

  // Navigations: network-first so the app stays up to date, fall back to
  // cached shell when offline so the installed app still opens.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then((r) => r || caches.match('/index.html'))
      )
    );
    return;
  }

  // Static assets: cache-first, then network (and cache the result).
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          const noStore = /no-store|private/i.test(response.headers.get('cache-control') || '');
          if (response.ok && response.type === 'basic' && !noStore) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
    )
  );
});
