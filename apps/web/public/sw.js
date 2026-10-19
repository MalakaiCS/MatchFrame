// Scorer shell service worker. Navigations under /score are network-first with a cached fallback;
// hashed static assets are cache-first. API traffic is never cached here (IndexedDB holds scorer data).
const SHELL = 'bs-scorer-shell-v2';
const STATIC = 'bs-static-v2';

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

// The page reports what it already loaded before this worker took control (first visit), so a later
// offline refresh can still boot: the navigation document plus its same-origin chunks, styles and fonts.
self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type !== 'precache' || !Array.isArray(d.urls)) return;
  const own = d.urls.filter((u) => { try { return new URL(u, self.location.origin).origin === self.location.origin; } catch { return false; } });
  e.waitUntil(Promise.all([
    caches.open(STATIC).then((c) => Promise.all(own.filter((u) => /\/_next\/static\/|\/fonts\//.test(u)).map((u) => c.match(u).then((hit) => hit || c.add(u).catch(() => undefined))))),
    caches.open(SHELL).then((c) => Promise.all(own.filter((u) => new URL(u, self.location.origin).pathname.startsWith('/score')).map((u) => c.add(u).catch(() => undefined)))),
  ]));
});
