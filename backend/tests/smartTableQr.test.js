require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const landing = require('../src/services/tableLanding');
const tableQr = require('../src/services/tableQr');
const Tenant = require('../src/models/Tenant');

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const PLAY = 'https://play.google.com/store/apps/details?id=com.demo.shop';
const STORE = 'https://apps.apple.com/in/app/demo/id1234567890';

let n = 0;
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); });
afterEach(() => { delete process.env.SHOP_WEB_URL_TEMPLATE; });

const shop = (links) => ({ _id: 'x', slug: 'demo-shop', name: 'Demo Shop', androidPackage: 'com.demo.shop', appLinks: links });
const plan = (ua, links) => landing.plan({ t: shop(links), table: '4', k: 'abc123', ua });

describe('smart table QR: what each phone sees', () => {
    test('a computer goes straight to the website', () => {
        const p = plan(DESKTOP, { playStoreUrl: PLAY, appStoreUrl: STORE });
        assert.equal(p.straightToWeb, true);
        assert.equal(p.tryApp, false);
        assert.equal(p.choice, false);
        assert.equal(p.web, 'https://demo-shop.vivyaan.co.in/?table=4&k=abc123');
        const html = landing.html({ t: shop({ playStoreUrl: PLAY }), table: '4', k: 'abc123', ua: DESKTOP });
        assert.match(html, /"direct":true/);
    });

    test('Android with the Play Store link: tries the app, then offers the store or the browser; the store link carries the table', () => {
        const p = plan(ANDROID, { playStoreUrl: PLAY, appStoreUrl: STORE });
        assert.equal(p.platform, 'android');
        assert.equal(p.tryApp, true);
        assert.equal(p.choice, true);
        const u = new URL(p.store);
        assert.equal(u.searchParams.get('id'), 'com.demo.shop');
        assert.equal(u.searchParams.get('referrer'), 'shop=demo-shop&table=4&k=abc123');
        assert.match(p.intent, /^intent:\/\/table\/4\?k=abc123#Intent;scheme=demo-shop;package=com\.demo\.shop;end$/);
        const html = landing.html({ t: shop({ playStoreUrl: PLAY }), table: '4', k: 'abc123', ua: ANDROID });
        assert.match(html, /Open in the store/);
        assert.match(html, /Continue in browser/);
        assert.ok(!html.includes('scan this table'), 'the scan-again line is for iPhones only');
    });

    test('Android without a Play Store link goes straight to the browser (after trying the app)', () => {
        const p = plan(ANDROID, { appStoreUrl: STORE });   // only the OTHER phone type has a link
        assert.equal(p.tryApp, true);
        assert.equal(p.choice, false);
        assert.equal(p.store, '');
        assert.equal(plan(ANDROID, undefined).choice, false);
        assert.equal(plan(ANDROID, {}).choice, false);
    });

    test('iPhone with the App Store link: the choice, with nothing carried, and a line to scan again after installing', () => {
        const p = plan(IPHONE, { playStoreUrl: PLAY, appStoreUrl: STORE });
        assert.equal(p.platform, 'ios');
        assert.equal(p.choice, true);
        assert.equal(p.store, STORE);
        assert.equal(p.deep, 'demo-shop://table/4?k=abc123');
        const html = landing.html({ t: shop({ appStoreUrl: STORE }), table: '4', k: 'abc123', ua: IPHONE });
        assert.match(html, /scan this table/);
    });

    test('iPhone without an App Store link goes straight to the browser, even when the Play Store link is filled', () => {
        const p = plan(IPHONE, { playStoreUrl: PLAY });
        assert.equal(p.choice, false);
        assert.equal(p.store, '');
    });

    test('the website address follows SHOP_WEB_URL_TEMPLATE', () => {
        process.env.SHOP_WEB_URL_TEMPLATE = 'https://{slug}.example.in/';
        assert.equal(plan(DESKTOP, {}).web, 'https://demo-shop.example.in/?table=4&k=abc123');
    });

    test('nothing in the page can break out of its script', () => {
        const evil = { ...shop({ playStoreUrl: PLAY }), name: '</script><script>alert(1)</script>' };
        const html = landing.html({ t: evil, table: '4', k: 'abc123', ua: ANDROID });
        assert.ok(!html.includes('</script><script>alert(1)'));
    });
});

describe('smart table QR: the shop settings and the pages', () => {
    async function dineShop(extra = {}) {
        const t = await f.makeTenant(`smart-${++n}-${Date.now()}`, { androidPackage: 'com.smart.app', ...extra });
        await Tenant.updateOne({ _id: t._id }, { $set: { 'settings.orders.dineIn': { enabled: true, tableCount: 5 } } });
        return t;
    }

    test('the superadmin saves the two store links, and a wrong link is refused', async () => {
        const t = await dineShop();
        const { token } = await f.makeSuperAdmin(`sm${++n}@test.com`);
        const A = { Authorization: `Bearer ${token}` };
        const ok = await request(app).put(`/api/admin/tenants/${t._id}`).set(A).send({ appLinks: { playStoreUrl: PLAY, appStoreUrl: STORE } });
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
        const row = await Tenant.findById(t._id).lean();
        assert.equal(row.appLinks.playStoreUrl, PLAY);
        assert.equal(row.appLinks.appStoreUrl, STORE);
        const bad = await request(app).put(`/api/admin/tenants/${t._id}`).set(A).send({ appLinks: { playStoreUrl: 'http://evil.example.com' } });
        assert.equal(bad.status, 400);
        const clear = await request(app).put(`/api/admin/tenants/${t._id}`).set(A).send({ appLinks: { playStoreUrl: '', appStoreUrl: '' } });
        assert.equal(clear.status, 200);
        assert.ok(!(await Tenant.findById(t._id).lean()).appLinks.playStoreUrl);
    });

    test('scanning a printed code: /q/t -> the signed page -> the right choice for that phone', async () => {
        const t = await dineShop({ appLinks: { playStoreUrl: PLAY } });
        const hop = await request(app).get(`/q/t/${t.slug}/2`).redirects(0);
        assert.equal(hop.status, 302);
        const page = await request(app).get(hop.headers.location.replace(/^https?:\/\/[^/]+/, '')).set('User-Agent', ANDROID);
        assert.equal(page.status, 200);
        assert.match(page.text, /Open in the store/);
        assert.ok(page.text.includes('referrer='), 'the table rides in the store link');
        const desk = await request(app).get(hop.headers.location.replace(/^https?:\/\/[^/]+/, '')).set('User-Agent', DESKTOP);
        assert.match(desk.text, /"direct":true/);
    });

    test('the app can ask for a table by its short address: the server signs it, and a table that does not exist is refused', async () => {
        const t = await dineShop();
        const ok = await request(app).post('/api/dinein/scan').set({ 'x-tenant-slug': t.slug }).send({ table: '3', short: true });
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
        assert.equal(ok.body.table, '3');
        assert.ok(tableQr.check(t._id, 'table:3', ok.body.k));
        assert.equal((await request(app).post('/api/dinein/scan').set({ 'x-tenant-slug': t.slug }).send({ table: '9', short: true })).status, 400);
        assert.equal((await request(app).post('/api/dinein/scan').set({ 'x-tenant-slug': t.slug }).send({ table: '3' })).status, 400, 'without a signature and without short: still refused');
    });

    test('the verification files list only shops that filled the details in', async () => {
        const SHA = Array.from({ length: 32 }, (_, i) => (i * 7 % 256).toString(16).padStart(2, '0').toUpperCase()).join(':');
        await dineShop({ appLinks: { androidSha256: [SHA], iosAppId: 'ABCDE12345.com.smart.app' } });
        await dineShop({ androidPackage: 'com.other.app' });   // nothing filled in: not listed
        const a = await request(app).get('/.well-known/assetlinks.json');
        assert.equal(a.status, 200);
        assert.equal(a.body.length, 1);
        assert.equal(a.body[0].target.package_name, 'com.smart.app');
        assert.deepEqual(a.body[0].target.sha256_cert_fingerprints, [SHA]);
        const i = await request(app).get('/.well-known/apple-app-site-association');
        assert.equal(i.status, 200);
        assert.equal(i.body.applinks.details.length, 1);
        assert.equal(i.body.applinks.details[0].appID, 'ABCDE12345.com.smart.app');
        assert.match(i.body.applinks.details[0].paths[0], /^\/q\/t\/smart-\d+-\d+\/\*$/);
    });
});

describe('smart table QR: the app side', () => {
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');
    const MOBILE = path.join(__dirname, '..', '..', 'mobile');
    const src = fs.readFileSync(path.join(MOBILE, 'src/utils/customers/tableLink.js'), 'utf8');
    const fn = /export function parseTableLink\(url\) \{[\s\S]*?\n\}/.exec(src)[0].replace('export ', '');
    const ctx = vm.createContext({});
    vm.runInContext(fn, ctx);
    const parse = (u) => JSON.parse(JSON.stringify(vm.runInContext(`parseTableLink(${JSON.stringify(u)})`, ctx)));

    test('it reads the old web link, the app link, the website address and the printed short address', () => {
        assert.deepEqual(parse('https://api.x.com/api/dinein/t/savera/7?k=Abc_12-xyz'), { table: '7', k: 'Abc_12-xyz' });
        assert.deepEqual(parse('savera://table/12?k=AAAA1111'), { table: '12', k: 'AAAA1111' });
        assert.deepEqual(parse('https://savera.vivyaan.co.in/?table=4&k=zz99ZZ'), { table: '4', k: 'zz99ZZ' });
        assert.deepEqual(parse('https://vivyaan.co.in/q/t/savera/9'), { table: '9', short: true });
        assert.equal(parse('https://example.com/nothing'), null);
        assert.equal(parse('https://vivyaan.co.in/q/t/savera/abc'), null);
    });

    test('the install referrer is understood, and anything else is ignored', () => {
        const ref = fs.readFileSync(path.join(MOBILE, 'src/utils/customers/installReferrer.js'), 'utf8');
        const body = /export function parseReferrer\(raw\) \{[\s\S]*?\n\}/.exec(ref)[0].replace('export ', '');
        const c2 = vm.createContext({ URLSearchParams, decodeURIComponent });
        vm.runInContext(body, c2);
        const pr = (v) => { const r = vm.runInContext(`parseReferrer(${JSON.stringify(v)})`, c2); return r && JSON.parse(JSON.stringify(r)); };
        assert.deepEqual(pr('shop=savera&table=5&k=Abcdef123456'), { shop: 'savera', table: '5', k: 'Abcdef123456' });
        assert.deepEqual(pr('utm_source=x&referrer=shop%3Dsavera%26table%3D5%26k%3DAbcdef123456'), { shop: 'savera', table: '5', k: 'Abcdef123456' });
        assert.equal(pr('utm_source=google-play&utm_medium=organic'), null);
        assert.equal(pr(null), null);
        assert.equal(pr('shop=savera&table=abc&k=Abcdef123456'), null);
    });
});
