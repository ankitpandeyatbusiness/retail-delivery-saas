// One Cloudflare Worker serves the website of EVERY shop: <shop>.vivyaan.co.in (the domain is the PLATFORM_WEB_DOMAIN variable).
//   - the files of the website (the Expo web build, deploy/cloudflare/wrangler.toml > [assets]) are the same for every shop; the app reads the shop from the address
//   - /manifest.webmanifest is made per shop: the Worker asks the API (GET /tenants/manifest) with the shop's name from the address
//   - security and cache headers are added here
// The API stays where it is (Render). The Worker never touches orders, logins or payments.

const RESERVED = new Set(['www', 'api', 'admin', 'app', 'mail', 'cdn', 'static', 'assets', 'status']);   // addresses that are never a shop
const SLUG = /^[a-z0-9-]{3,40}$/;

// "savera.vivyaan.co.in" -> "savera"; anything else (the bare domain, www, a reserved name, another domain) -> null
export function shopFrom(hostname, baseDomain) {
    const host = String(hostname || '').toLowerCase().split(':')[0];
    const base = String(baseDomain || 'vivyaan.co.in').toLowerCase();
    if (!host.endsWith('.' + base)) return null;
    const sub = host.slice(0, -(base.length + 1));
    return SLUG.test(sub) && !RESERVED.has(sub) ? sub : null;
}

const SECURITY = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=31536000',
    'X-Frame-Options': 'SAMEORIGIN',
    'Permissions-Policy': 'geolocation=(self), camera=(self), microphone=(self), payment=(self)',
};

// files with a hash in their name never change: keep them a year. The page itself, the service worker and the manifest must always be fresh,
// or a new version of the website would not reach people.
function cacheFor(pathname) {
    if (pathname.startsWith('/_expo/static/') || pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
    if (pathname.startsWith('/icons/')) return 'public, max-age=86400';
    if (pathname === '/manifest.webmanifest') return 'public, max-age=300';
    return 'no-cache';   // /, /index.html, /sw.js and every page address
}

function withHeaders(res, pathname) {
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY)) out.headers.set(k, v);
    if (res.ok || res.status === 304) out.headers.set('Cache-Control', cacheFor(pathname));
    return out;
}

const text = (status, body) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' } });

async function manifest(shop, env) {
    let r;
    try {
        r = await fetch(`${String(env.API_BASE).replace(/\/+$/, '')}/tenants/manifest`, {
            headers: { 'x-tenant-slug': shop, 'x-client': 'web' },
            cf: { cacheTtl: 300, cacheEverything: true },
        });
    } catch (e) { return text(502, 'Could not reach the shop'); }
    if (r.status === 404) return text(404, 'No such shop');
    if (!r.ok) return text(502, 'Could not load the shop');
    return new Response(r.body, { status: 200, headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' } });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Method not allowed');
        const shop = shopFrom(url.hostname, env.PLATFORM_WEB_DOMAIN);
        if (!shop) return text(404, 'Not found');

        if (url.pathname === '/manifest.webmanifest') return withHeaders(await manifest(shop, env), url.pathname);
        // every other address: a file of the website, or (for a page address such as /orders) the app itself (assets > not_found_handling = single-page-application)
        return withHeaders(await env.ASSETS.fetch(request), url.pathname);
    },
};
