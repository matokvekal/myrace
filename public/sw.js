/* Commissire service worker — app-shell caching for installability + offline.
 * Bump CACHE_VERSION to force clients onto a fresh cache after a deploy. */
const CACHE_VERSION = 'commissire-v2';
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

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // Don't fail the whole install if one asset 404s.
      Promise.allSettled(APP_SHELL.map((url) => cache.add(url)))
    )
  );
  // NOTE: no skipWaiting() here — a new worker parks in `waiting` so the app
  // can show an "Update now" prompt and reload on the user's terms (never
  // mid-heat). The client triggers activation via the SKIP_WAITING message.
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // don't touch cross-origin

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
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
    )
  );
});
