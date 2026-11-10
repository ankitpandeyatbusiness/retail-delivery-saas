// Service worker of the shop website.
// Keeps ONLY the app's own static files (the build files and icons) so the page opens fast and shows a friendly page offline.
// It never keeps API answers, orders, logins or anything from another address: those always go to the network.
// Change VERSION when this file's rules change; old caches are removed on activation.
const VERSION = 'v1';
const STATIC = `static-${VERSION}`;
const PAGES = `pages-${VERSION}`;

const OFFLINE_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#111;color:#eee;font-family:system-ui,sans-serif;text-align:center;padding:24px}
button{margin-top:16px;padding:12px 22px;border:0;border-radius:10px;background:#e23744;color:#fff;font-size:16px}</style></head>
<body><div><h2>You are offline</h2><p>Check your internet and try again.</p><button onclick="location.reload()">Try again</button></div></body></html>`;

self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keep = new Set([STATIC, PAGES]);
        for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
        await self.clients.claim();
    })());
});

// files that never change once built (their names carry a hash) or never change at all
const isStatic = (url) => url.pathname.startsWith('/_expo/static/') || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/');
// never touch these
const skip = (url) => /\.(map)$/.test(url.pathname) || url.pathname.includes('.bundle') || url.pathname === '/sw.js'
    || url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io') || url.pathname === '/hot' || url.pathname === '/message';

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin || skip(url)) return;   // another address (the API) or not ours: the browser handles it

    // the page itself: network first (so a new version shows at once), the last good copy when offline
    if (req.mode === 'navigate') {
        event.respondWith((async () => {
            try {
                const res = await fetch(req);
                if (res && res.ok) { const c = await caches.open(PAGES); c.put('/', res.clone()); }
                return res;
            } catch (e) {
                const c = await caches.open(PAGES);
                return (await c.match('/')) || new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
            }
        })());
        return;
    }

    // build files and icons: from the cache when there, otherwise fetch once and keep
    if (isStatic(url)) {
        event.respondWith((async () => {
            const c = await caches.open(STATIC);
            const hit = await c.match(req);
            if (hit) return hit;
            const res = await fetch(req);
            if (res && res.ok) c.put(req, res.clone());
            return res;
        })());
    }
});

// Phase 6 adds web push here (push and notificationclick events).
