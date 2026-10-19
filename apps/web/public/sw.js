/* Kora service worker. Keeps the app shell and the pages used offline so drafts can be made without a connection.
 * It never caches API responses or public invoice links: data comes from the server or from IndexedDB, never from here. */
const STATIC = 'kora-static-v1';
const PAGES = 'kora-pages-v1';
const KEEP = [STATIC, PAGES];
const OFFLINE_PAGES = ['/app/invoices', '/app/invoices/new', '/app/invoices/offline'];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('kora-') && !KEEP.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isHtml = (req) => (req.headers.get('accept') || '').includes('text/html');

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;
  if (p.startsWith('/api/') || p.startsWith('/i/') || p.startsWith('/mock-gateway') || p.includes('webpack-hmr') || p === '/sw.js') return;

  // Hashed build assets never change, so serve them from cache first.
  if (p.startsWith('/_next/static/') || p.startsWith('/icons/')) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // Pages: the network first, so a signed-in person always sees fresh data; the cache only when the network fails.
  if (isHtml(req) && p.startsWith('/app')) {
    event.respondWith((async () => {
      const cache = await caches.open(PAGES);
      try {
        const res = await fetch(req);
        if (res.ok && !res.redirected) cache.put(req, res.clone());
        return res;
      } catch {
        const exact = await cache.match(req);
        if (exact) return exact;
        if (p === '/app/invoices/offline') { const m = await cache.match('/app/invoices/offline', { ignoreSearch: true }); if (m) return m; }
        const shell = (await cache.match('/app/invoices/new')) || (await cache.match('/app/invoices'));
        if (shell && p.startsWith('/app')) return shell;
        return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><body style="font-family:system-ui;max-width:420px;margin:15vh auto;padding:0 16px"><h1>You are offline</h1><p>Open Kora once while connected, and invoices drafted offline will sync when you are back.</p>', { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
    })());
  }
});

// The page asks us to remember the offline screens right after sign-in.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'warm') {
    event.waitUntil((async () => {
      const cache = await caches.open(PAGES);
      const statics = await caches.open(STATIC);
      for (const u of OFFLINE_PAGES) {
        try {
          const r = await fetch(u, { headers: { accept: 'text/html' }, credentials: 'same-origin' });
          if (!r.ok || r.redirected) continue;
          const html = await r.clone().text();
          await cache.put(u, r);
          // The page only works offline if its scripts and styles are here too.
          const assets = new Set(html.match(/\/_next\/static\/[^"'\\\s)<>]+\.(?:js|css)/g) || []);
          await Promise.all([...assets].map(async (a) => { if (!(await statics.match(a))) { try { const ar = await fetch(a); if (ar.ok) await statics.put(a, ar); } catch { /* skip */ } } }));
        } catch { /* offline now */ }
      }
    })());
  }
  if (event.data && event.data.type === 'clear') {
    event.waitUntil((async () => { for (const k of await caches.keys()) if (k.startsWith('kora-')) await caches.delete(k); })());
  }
});
