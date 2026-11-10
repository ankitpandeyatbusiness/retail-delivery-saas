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

// ---- Browser push ("Also notify me on this browser") ----
// The server sends { title, body, data, tag, icon, silent }. When the website is open and in front, the live alert inside the page already
// says it, so nothing is shown (and the browser does not add its own "site updated" notice for a visible page). Otherwise a notification appears.
self.addEventListener('push', (event) => {
    let d = {};
    try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'New message', body: event.data ? event.data.text() : '' }; }
    event.waitUntil((async () => {
        const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        if (open.some((c) => c.visibilityState === 'visible')) return;
        const icon = d.icon || '/icons/icon-1024.png';
        await self.registration.showNotification(d.title || 'New message', {
            body: d.body || '',
            icon,
            badge: icon,
            tag: d.tag || undefined,
            renotify: !!d.tag,   // a later push with the same tag replaces the earlier one and alerts again
            silent: !!d.silent,
            data: d.data || {},
        });
    })());
});

// A tap: bring the website forward and tell it what was tapped (it opens the same screen the phone app would). If it is closed, open it with the tap in the address.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const data = event.notification.data || {};
    event.waitUntil((async () => {
        const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const win = open.find((c) => 'focus' in c);
        if (win) { await win.focus(); win.postMessage({ type: 'push-click', data }); return; }
        let q = '';
        try { if (Object.keys(data).length) q = encodeURIComponent(JSON.stringify(data)).slice(0, 1800); } catch (e) { q = ''; }
        if (self.clients.openWindow) await self.clients.openWindow(q ? '/?pushtap=' + q : '/');
    })());
});
