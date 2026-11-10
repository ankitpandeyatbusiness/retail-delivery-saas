require('./helpers/env');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const Tenant = require('../src/models/Tenant');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const { makeTenant } = require('./helpers/factory');

const get = (slug) => request(app).get('/api/tenants/manifest').set('x-tenant-slug', slug);

describe('the shop manifest (Add to Home Screen) and the website switch', () => {
    before(() => db.connect());
    after(() => db.disconnect());

    test('the manifest carries the shop\'s own name, colour and icon', async () => {
        const old = process.env.MEDIA_CDN_URL;
        process.env.MEDIA_CDN_URL = 'https://cdn.example.com';
        try {
            const t = await makeTenant('manifest-shop');
            await Tenant.updateOne({ _id: t._id }, { $set: { name: 'Savera Shudh Vaishnav Hotel', tagline: 'Pure veg, home style' } });
            tenantRecognizer.invalidateTenant(t.slug);
            const r = await get(t.slug);
            assert.equal(r.status, 200);
            assert.match(r.headers['content-type'], /application\/manifest\+json/);
            assert.match(r.headers['cache-control'], /max-age=300/);
            const m = JSON.parse(r.text);
            assert.equal(m.name, 'Savera Shudh Vaishnav Hotel');
            assert.equal(m.short_name, 'Savera Shudh', 'a short name that fits under the icon');
            assert.equal(m.description, 'Pure veg, home style');
            assert.equal(m.display, 'standalone'); assert.equal(m.start_url, '/'); assert.equal(m.scope, '/');
            assert.match(m.theme_color, /^#[0-9a-f]{6}$/i);
            assert.equal(m.icons[0].src, 'https://cdn.example.com/tenants/manifest-shop/branding/icon.png');
            assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
        } finally { if (old === undefined) delete process.env.MEDIA_CDN_URL; else process.env.MEDIA_CDN_URL = old; }
    });

    test('a shop with no icon on the media storage falls back to the platform icon on the website', async () => {
        const old = { a: process.env.MEDIA_CDN_URL, b: process.env.R2_PUBLIC_URL };
        delete process.env.MEDIA_CDN_URL; delete process.env.R2_PUBLIC_URL;
        try {
            const t = await makeTenant('manifest-noicon');
            const m = JSON.parse((await get(t.slug)).text);
            assert.equal(m.icons[0].src, '/icons/icon-1024.png');
            assert.ok(m.name.length > 0);
        } finally {
            if (old.a !== undefined) process.env.MEDIA_CDN_URL = old.a;
            if (old.b !== undefined) process.env.R2_PUBLIC_URL = old.b;
        }
    });

    test('an unknown shop has no manifest', async () => {
        assert.equal((await get('no-such-shop-xyz')).status, 404);
    });

    test('the website is recognised by x-client: web, so a shop with its APP switched off still works on the website', async () => {
        const t = await makeTenant('switch-shop');
        await Tenant.updateOne({ _id: t._id }, { $set: { androidPackage: 'com.example.shop', 'plan.nativeEnabled': false } });
        tenantRecognizer.invalidateTenant(t.slug);
        const web = await request(app).get('/api/tenants/config').set('x-tenant-slug', t.slug).set('x-client', 'web');
        assert.equal(web.status, 200);
        assert.equal(web.body.channel.off, false, 'the website works');
        assert.equal(web.body.channel.getAppUrl, undefined, 'no Get the app banner: the app is switched off');
        const phone = await request(app).get('/api/tenants/config').set('x-tenant-slug', t.slug);
        assert.equal(phone.body.channel.off, true);
        assert.equal(phone.body.channel.kind, 'web_only');
        assert.match(phone.body.channel.webUrl, /^https:\/\/switch-shop\.vivyaan\.co\.in$/);
    });

    test('both on: the website gets the Get the app address; website off: it gets the app-only message and the Play Store link', async () => {
        const t = await makeTenant('banner-shop');
        await Tenant.updateOne({ _id: t._id }, { $set: { androidPackage: 'com.example.banner' } });
        tenantRecognizer.invalidateTenant(t.slug);
        const on = await request(app).get('/api/tenants/config').set('x-tenant-slug', t.slug).set('x-client', 'web');
        assert.equal(on.body.channel.getAppUrl, 'https://play.google.com/store/apps/details?id=com.example.banner');

        await Tenant.updateOne({ _id: t._id }, { $set: { 'plan.webEnabled': false } });
        tenantRecognizer.invalidateTenant(t.slug);
        const off = await request(app).get('/api/tenants/config').set('x-tenant-slug', t.slug).set('x-client', 'web');
        assert.equal(off.body.channel.off, true);
        assert.equal(off.body.channel.kind, 'app_only');
        assert.equal(off.body.channel.playStoreUrl, 'https://play.google.com/store/apps/details?id=com.example.banner');
    });
});
