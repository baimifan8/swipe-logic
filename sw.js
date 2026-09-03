// Service worker: installability + an offline shell.
//
// Update policy: app files are fetched network-first, so deploying a new
// version reaches an already-installed app on the next load instead of being
// pinned behind a stale cache. The cache only ever holds copies of files that
// were served — it never holds wallet data, which lives in localStorage and is
// untouched by anything here, including the old-cache cleanup on activate.
const VERSION = 'v13';
const CACHE = `swipe-logic-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './base.css',
  './style.css',
  `./cards.js?v=${VERSION.slice(1)}`,
  `./catalog-generated.js?v=${VERSION.slice(1)}`,
  `./credits.js?v=${VERSION.slice(1)}`,
  `./credit-usage.js?v=${VERSION.slice(1)}`,
  `./matcher.js?v=${VERSION.slice(1)}`,
  `./app.js?v=${VERSION.slice(1)}`,
  `./presence.js?v=${VERSION.slice(1)}`,
  './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // live session counts must never be cached

  // Navigations go straight past the browser's HTTP cache. Everything else can
  // revalidate normally, but the page shell decides which script versions get
  // loaded, so a stale copy of it pins the whole app to an old build.
  const request = e.request.mode === 'navigate' ? new Request(e.request, { cache: 'reload' }) : e.request;

  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((cached) => cached || caches.match('./index.html')))
  );
});
