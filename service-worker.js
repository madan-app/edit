// =============================================================
// service-worker.js — caches the app shell so the editor launches
// (and keeps working) offline after the first visit. Image editing
// itself never touches the network, so this only needs to cover
// the static app files.
// =============================================================

const CACHE_NAME = 'graphite-editor-v1';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/main.css',
  './css/editor.css',
  './css/panels.css',
  './css/responsive.css',
  './js/app.js',
  './js/editor.js',
  './js/canvas.js',
  './js/image-loader.js',
  './js/adjustments.js',
  './js/filters.js',
  './js/presets.js',
  './js/layers.js',
  './js/masks.js',
  './js/selection.js',
  './js/retouch.js',
  './js/drawing.js',
  './js/text.js',
  './js/shapes.js',
  './js/stickers.js',
  './js/transform.js',
  './js/history.js',
  './js/storage.js',
  './js/export.js',
  './js/shortcuts.js',
  './js/ui.js',
  './js/icons.js',
  './js/worker-client.js',
  './js/workers/image-worker.js',
  './assets/manifest.json',
  './assets/presets/sample-presets.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => { /* individual asset failures shouldn't block install */ })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first for the app shell; network-first fallback for anything else
// (e.g. sticker/preset assets added later), with a cache fallback if offline.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.ok && event.request.url.startsWith(self.location.origin)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
