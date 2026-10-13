require('./helpers/env');
const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const request = require('supertest');
const mongoose = require('mongoose');
const sharp = require('sharp');
const db = require('./helpers/db');
const { makeWorld, makeUser, makeOrder } = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const storage = require('../src/services/adapters/storage');
const media = require('../src/services/mediaService');
const Media = require('../src/models/Media');

const OWNER = '/api/shop/uploads';
const ME = '/api/me/uploads';
const slugs = [];

const jpeg = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 30, b: 30 } } }).jpeg().toBuffer();
const png = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 90, b: 200 } } }).png().toBuffer();

async function upload(headers, base, body, buf, type = 'image/jpeg', extra = {}) {
    const s = await request(app).post(`${base}/sign`).set(headers).send({ ...body, contentType: type, bytes: buf.length });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    await storage.put({ key: s.body.key, buffer: buf, contentType: type });      // the app's PUT to R2
    const c = await request(app).post(`${base}/confirm`).set(headers).send({ ...body, key: s.body.key, ...extra });
    return { sign: s, confirm: c, rawKey: s.body.key };
}

const world = async (slug) => {
    slugs.push(slug);
    const w = await makeWorld(slug);
    const owner = await makeUser(w.tenant, 'admin', '9000000511');
    return { w, owner, slug: w.tenant.slug };
};

describe('H3 photos to WebP', () => {
    before(async () => {
        process.env.STORAGE_MOCK = 'true';
        await db.connect();
        mock.method(storage, 'presignPut', async () => 'https://r2.test/upload');
    });
    after(async () => {
        mock.restoreAll();
        for (const s of slugs) await fs.rm(path.join(process.cwd(), '.mock-storage', 'tenants', s), { recursive: true, force: true });
        await db.disconnect();
    });

    test('a big jpeg becomes a small WebP under the new key, and the raw file is deleted', async () => {
        const { owner, slug } = await world('h3-logo');
        const buf = await jpeg(3000, 2000);
        const r = await upload(owner.headers, OWNER, { kind: 'logo' }, buf);
        assert.equal(r.confirm.status, 201, JSON.stringify(r.confirm.body));
        const m = r.confirm.body;
        assert.match(m.key, new RegExp(`^tenants/${slug}/logo/\\d{8}-[0-9a-f]{8}\\.webp$`));
        assert.equal(m.width, 1600);
        assert.ok(m.height >= 1066 && m.height <= 1067);
        assert.ok(m.bytes < buf.length);
        assert.equal(media.sniff(await storage.peek(m.key, 12)), 'image/webp');
        await assert.rejects(() => storage.head(r.rawKey));                 // raw deleted
        assert.equal(await Media.countDocuments({ key: m.key }), 1);
    });

    test('a small png is not made bigger', async () => {
        const { owner } = await world('h3-small');
        const r = await upload(owner.headers, OWNER, { kind: 'banner' }, await png(300, 200), 'image/png');
        assert.equal(r.confirm.status, 201);
        assert.equal(r.confirm.body.width, 300);
        assert.match(r.confirm.body.key, /\/banners\/\d{8}-[0-9a-f]{8}\.webp$/);
    });

    test('product folder uses the product id, order photos use the month', async () => {
        const { owner, slug } = await world('h3-prod');
        const pid = String(new mongoose.Types.ObjectId());
        const p = await upload(owner.headers, OWNER, { kind: 'product', refId: pid }, await jpeg(800, 600));
        assert.match(p.confirm.body.key, new RegExp(`^tenants/${slug}/products/${pid}(-[a-z0-9-]+)?/\\d{8}-[0-9a-f]{8}\\.webp$`));
        const o = await upload(owner.headers, OWNER, { kind: 'order', refId: 'ord123' }, await jpeg(800, 600));
        assert.match(o.confirm.body.key, new RegExp(`^tenants/${slug}/orders/\\d{4}-\\d{2}/ord123/\\d{8}-[0-9a-f]{8}\\.webp$`));
        assert.equal(media.slugify('Butter Chicken (Full)!'), 'butter-chicken-full');
    });

    test('a rider photo has a fixed name, max 512, and a new photo replaces the old record', async () => {
        const { owner, slug } = await world('h3-rider');
        const rid = String(new mongoose.Types.ObjectId());
        const a = await upload(owner.headers, OWNER, { kind: 'rider', refId: rid }, await jpeg(2000, 1500));
        const b = await upload(owner.headers, OWNER, { kind: 'rider', refId: rid }, await jpeg(1000, 1000));
        assert.equal(a.confirm.body.key, `tenants/${slug}/riders/${rid}/photo.webp`);
        assert.equal(b.confirm.body.key, a.confirm.body.key);
        assert.equal(a.confirm.body.width, 512);
        assert.equal(await Media.countDocuments({ key: a.confirm.body.key }), 1);
    });

    test('replaces deletes the old file and its record', async () => {
        const { owner } = await world('h3-repl');
        const a = await upload(owner.headers, OWNER, { kind: 'logo' }, await jpeg(500, 500));
        const b = await upload(owner.headers, OWNER, { kind: 'logo' }, await jpeg(600, 600), 'image/jpeg', { replaces: a.confirm.body._id });
        assert.equal(b.confirm.status, 201);
        await assert.rejects(() => storage.head(a.confirm.body.key));
        assert.equal(await Media.countDocuments({ _id: a.confirm.body._id }), 0);
    });

    test('a text file pretending to be an image is refused and cleaned up', async () => {
        const { owner } = await world('h3-fake');
        const r = await upload(owner.headers, OWNER, { kind: 'logo' }, Buffer.from('hello, I am not an image at all'));
        assert.equal(r.confirm.status, 400);
        await assert.rejects(() => storage.head(r.rawKey));
        assert.equal(await Media.countDocuments({ kind: 'logo', 'uploadedBy.type': 'owner', key: /h3-fake/ }), 0);
    });

    test('limits: size, type, unknown kind, and the owner cannot use customer kinds', async () => {
        const { owner } = await world('h3-lim');
        const s = (body) => request(app).post(`${OWNER}/sign`).set(owner.headers).send(body);
        assert.equal((await s({ kind: 'logo', contentType: 'image/jpeg', bytes: 6 * 1024 * 1024 })).status, 400);
        assert.equal((await s({ kind: 'logo', contentType: 'image/gif', bytes: 1000 })).status, 400);
        assert.equal((await s({ kind: 'nope', contentType: 'image/jpeg', bytes: 1000 })).status, 400);
        assert.equal((await s({ kind: 'customer', contentType: 'image/jpeg', bytes: 1000 })).status, 400);
        assert.equal((await s({ kind: 'product', contentType: 'image/jpeg', bytes: 1000 })).status, 400);   // refId missing
    });

    test('a customer avatar: own folder, 512, needs a login, cannot use shop kinds', async () => {
        const { w, slug } = await world('h3-cust');
        const id = String(w.customer.user._id);
        const r = await upload(w.customer.headers, ME, { kind: 'customer' }, await jpeg(1800, 1200));
        assert.equal(r.confirm.status, 201, JSON.stringify(r.confirm.body));
        assert.equal(r.confirm.body.key, `tenants/${slug}/customers/${id}/avatar.webp`);
        assert.equal(r.confirm.body.width, 512);
        assert.equal(r.confirm.body.uploadedBy.type, 'customer');

        const { Authorization, ...noLogin } = w.customer.headers;
        const anon = await request(app).post(`${ME}/sign`).set(noLogin).send({ kind: 'customer', contentType: 'image/jpeg', bytes: 1000 });
        assert.equal(anon.status, 401);
        const shop = await request(app).post(`${ME}/sign`).set(w.customer.headers).send({ kind: 'logo', contentType: 'image/jpeg', bytes: 1000 });
        assert.equal(shop.status, 400);
    });

    test('another customer cannot confirm my raw file', async () => {
        const { w } = await world('h3-steal');
        const other = await makeUser(w.tenant, 'customer', '9000000522');
        const s = await request(app).post(`${ME}/sign`).set(w.customer.headers).send({ kind: 'customer', contentType: 'image/jpeg', bytes: 1000 });
        await storage.put({ key: s.body.key, buffer: await jpeg(100, 100) });
        const c = await request(app).post(`${ME}/confirm`).set(other.headers).send({ kind: 'customer', key: s.body.key });
        assert.equal(c.status, 400);
    });

    test('complaint photos: own order only, photo-1..3, a 4th is refused', async () => {
        const { w, slug } = await world('h3-comp');
        const order = await makeOrder(w.tenant, w.customer.user);
        const oid = String(order._id);
        const keys = [];
        for (let i = 1; i <= 3; i += 1) {
            const r = await upload(w.customer.headers, ME, { kind: 'complaint', refId: oid }, await jpeg(900, 700));
            assert.equal(r.confirm.status, 201, JSON.stringify(r.confirm.body));
            keys.push(r.confirm.body.key);
        }
        keys.forEach((k, i) => assert.match(k, new RegExp(`^tenants/${slug}/complaints/\\d{4}-\\d{2}/${oid}/photo-${i + 1}\\.webp$`)));
        const four = await request(app).post(`${ME}/sign`).set(w.customer.headers).send({ kind: 'complaint', refId: oid, contentType: 'image/jpeg', bytes: 1000 });
        assert.equal(four.status, 400);

        const other = await makeUser(w.tenant, 'customer', '9000000533');
        const theirs = await request(app).post(`${ME}/sign`).set(other.headers).send({ kind: 'complaint', refId: oid, contentType: 'image/jpeg', bytes: 1000 });
        assert.equal(theirs.status, 404);
    });

    test('a customer can delete his own file, not the shop logo', async () => {
        const { w, owner } = await world('h3-del');
        const mine = await upload(w.customer.headers, ME, { kind: 'customer' }, await jpeg(200, 200));
        const logo = await upload(owner.headers, OWNER, { kind: 'logo' }, await jpeg(200, 200));
        const bad = await request(app).delete(`${ME}/${logo.confirm.body._id}`).set(w.customer.headers);
        assert.equal(bad.status, 404);
        const ok = await request(app).delete(`${ME}/${mine.confirm.body._id}`).set(w.customer.headers);
        assert.equal(ok.status, 200);
        await assert.rejects(() => storage.head(mine.confirm.body.key));
    });

    test('storage.list finds the objects under a prefix', async () => {
        const { owner, slug } = await world('h3-list');
        const r = await upload(owner.headers, OWNER, { kind: 'logo' }, await jpeg(200, 200));
        const keys = (await storage.list(`tenants/${slug}/`)).map((o) => o.key);
        assert.deepEqual(keys, [r.confirm.body.key]);
    });
});