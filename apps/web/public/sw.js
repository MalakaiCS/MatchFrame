// Scorer shell service worker. Navigations under /score are network-first with a cached fallback;
// hashed static assets are cache-first. API traffic is never cached here (IndexedDB holds scorer data).
const SHELL = 'bs-scorer-shell-v1';
const STATIC = 'bs-static-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/score']).catch(() => undefined)));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => ![SHELL, STATIC].includes(k)).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io')) return;
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/fonts/')) {
    e.respondWith(
      caches.open(STATIC).then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) await c.put(e.request, res.clone());
        return res;
      }),
    );
    return;
  }
  if (e.request.mode === 'navigate' && url.pathname.startsWith('/score')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(e.request)) || (await caches.match('/score')) || new Response('Offline', { status: 503 })),
    );
  }
});
