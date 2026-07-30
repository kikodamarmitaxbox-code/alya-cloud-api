const CACHE_NAME = 'sofia-private-shell-v8';
const APP_SHELL = [
  '/aly',
  '/styles.css',
  '/aly.js',
  '/code-alya.css',
  '/code-alya.js',
  '/manifest.webmanifest',
  '/images/alya-avatar.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate' && url.pathname !== '/aly') return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => (
        cached ||
        (url.pathname.startsWith('/code-alya') ? caches.match('/code-alya') : caches.match('/aly'))
      )))
  );
});
