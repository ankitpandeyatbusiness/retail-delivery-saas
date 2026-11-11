// node --test deploy/cloudflare/worker.test.mjs   (no network: the website files and the API are stand-ins)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { shopFrom } from './worker.js';

const calls = [];
const env = {
    PLATFORM_WEB_DOMAIN: 'vivyaan.co.in',
    API_BASE: 'https://api.example.com/api/',
    ASSETS: { fetch: async (req) => { calls.push(['asset', new URL(req.url).pathname]); return new Response('<html>app</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }); } },
};
const ask = (url, init) => worker.fetch(new Request(url, init), env);

test('the shop is the first part of the address; nothing else is a shop', () => {
    assert.equal(shopFrom('savera.vivyaan.co.in', 'vivyaan.co.in'), 'savera');
    assert.equal(shopFrom('Burger-King.VIVYAAN.co.in:443', 'vivyaan.co.in'), 'burger-king');
    for (const h of ['vivyaan.co.in', 'www.vivyaan.co.in', 'api.vivyaan.co.in', 'ab.vivyaan.co.in', 'a.b.vivyaan.co.in', 'savera.vivyaan.com', 'evil.com', 'savera.vivyaan.co.in.evil.com', 'under_score.vivyaan.co.in']) {
        assert.equal(shopFrom(h, 'vivyaan.co.in'), null, h);
    }
});

test('a page or file of the website comes from the assets, with security headers and the right caching', async () => {
    calls.length = 0;
    const page = await ask('https://savera.vivyaan.co.in/orders');
    assert.equal(page.status, 200);
    assert.deepEqual(calls[0], ['asset', '/orders']);
    assert.equal(page.headers.get('cache-control'), 'no-cache', 'a page is always fresh');
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    assert.match(page.headers.get('strict-transport-security'), /max-age=31536000/);
    assert.match(page.headers.get('permissions-policy'), /geolocation=\(self\)/);

    assert.equal((await ask('https://savera.vivyaan.co.in/_expo/static/js/web/index-abc.js')).headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal((await ask('https://savera.vivyaan.co.in/sw.js')).headers.get('cache-control'), 'no-cache', 'the service worker must never be stuck');
    assert.equal((await ask('https://savera.vivyaan.co.in/icons/icon-1024.png')).headers.get('cache-control'), 'public, max-age=86400');
});

test('the manifest is the shop\'s own, fetched from the API with the shop name from the address', async () => {
    const seen = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => { seen.push([String(url), init.headers]); return new Response('{"name":"Savera"}', { status: 200 }); };
    try {
        const r = await ask('https://savera.vivyaan.co.in/manifest.webmanifest');
        assert.equal(r.status, 200);
        assert.equal(await r.text(), '{"name":"Savera"}');
        assert.match(r.headers.get('content-type'), /application\/manifest\+json/);
        assert.equal(r.headers.get('cache-control'), 'public, max-age=300');
        assert.equal(seen[0][0], 'https://api.example.com/api/tenants/manifest', 'no double slash');
        assert.equal(seen[0][1]['x-tenant-slug'], 'savera');
        assert.equal(seen[0][1]['x-client'], 'web');

        globalThis.fetch = async () => new Response('{}', { status: 404 });
        assert.equal((await ask('https://nosuch.vivyaan.co.in/manifest.webmanifest')).status, 404);
        globalThis.fetch = async () => new Response('x', { status: 500 });
        assert.equal((await ask('https://savera.vivyaan.co.in/manifest.webmanifest')).status, 502);
        globalThis.fetch = async () => { throw new Error('down'); };
        assert.equal((await ask('https://savera.vivyaan.co.in/manifest.webmanifest')).status, 502);
    } finally { globalThis.fetch = realFetch; }
});

test('Terms and Privacy are public pages on every shop address, with that shop\'s name, no login', async () => {
    const seen = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => { seen.push(String(url)); return new Response('<html>terms</html>', { status: 200 }); };
    try {
        calls.length = 0;
        for (const [path, page] of [['/terms', 'terms'], ['/privacy/', 'privacy'], ['/about', 'about'], ['/legal/rider-terms', 'rider-terms']]) {
            const r = await ask(`https://savera.vivyaan.co.in${path}`);
            assert.equal(r.status, 200, path);
            assert.match(r.headers.get('content-type'), /text\/html/);
            assert.equal(r.headers.get('cache-control'), 'public, max-age=60');
            assert.equal(seen.at(-1), `https://api.example.com/legal/${page}?shop=savera`, 'the API root, not /api; the shop from the address');
        }
        await ask('https://burger-king.vivyaan.co.in/terms');
        assert.equal(seen.at(-1), 'https://api.example.com/legal/terms?shop=burger-king', 'another shop gets its own name');
        assert.equal(calls.length, 0, 'the app files are not served for these');

        // not a legal page: the app (or its files) as before
        await ask('https://savera.vivyaan.co.in/orders');
        assert.deepEqual(calls[0], ['asset', '/orders']);
        await ask('https://savera.vivyaan.co.in/legal/secret');
        assert.deepEqual(calls[1], ['asset', '/legal/secret']);

        globalThis.fetch = async () => { throw new Error('down'); };
        assert.equal((await ask('https://savera.vivyaan.co.in/terms')).status, 502);
        globalThis.fetch = async () => new Response('x', { status: 404 });
        assert.equal((await ask('https://savera.vivyaan.co.in/terms')).status, 404);
    } finally { globalThis.fetch = realFetch; }
});

test('the bare domain, www and other domains are not shops, and only reads are served', async () => {
    calls.length = 0;
    for (const u of ['https://vivyaan.co.in/', 'https://www.vivyaan.co.in/', 'https://other.example.com/']) assert.equal((await ask(u)).status, 404, u);
    assert.equal(calls.length, 0, 'the website files are never served for them');
    assert.equal((await ask('https://savera.vivyaan.co.in/', { method: 'POST' })).status, 405);
});
