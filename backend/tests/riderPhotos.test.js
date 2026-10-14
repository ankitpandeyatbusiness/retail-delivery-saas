require('./helpers/env');
// A rider's own picture, and the photo of the food handed over (proof of a safe delivery).
const { test, describe, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const request = require('supertest');
const sharp = require('sharp');
const db = require('./helpers/db');
const { makeWorld, makeUser, makeOrder } = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const storage = require('../src/services/adapters/storage');
const Media = require('../src/models/Media');
const Rider = require('../src/models/Rider');
const Order = require('../src/models/Order');

const slugs = [];
let n = 0;
const jpeg = () => sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 30, g: 160, b: 90 } } }).jpeg().toBuffer();

// sign -> the app's PUT to storage -> confirm
async function uploadVia(headers, base, buf) {
    const signUrl = base.endsWith('/sign') ? base : `${base}/sign`;
    const s = await request(app).post(signUrl).set(headers).send({ contentType: 'image/jpeg', bytes: buf.length });
    if (s.status !== 200) { return { sign: s }; }
    await storage.put({ key: s.body.key, buffer: buf, contentType: 'image/jpeg' });
    const c = await request(app).post(base.replace(/\/sign$/, '')).set(headers).send({ key: s.body.key });
    return { sign: s, confirm: c };
}
const proofBase = (id) => `/api/rider/orders/${id}/proof`;

const world = async () => {
    const slug = `rph-${++n}-${Date.now().toString(36)}`;
    slugs.push(slug);
    return makeWorld(slug);
};
const delivery = (w, extra = {}) => makeOrder(w.tenant, w.customer.user, {
    status: 'out_for_delivery',
    delivery: { riderId: w.rider.user._id, status: 'picked_up', pickedUpAt: new Date(), ...extra },
});

describe('rider photos', () => {
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
    beforeEach(() => db.clear());

    test('a rider puts his own picture, it shows in /me, a new one replaces it, and it can be removed', async () => {
        const w = await world();
        const h = w.rider.headers;
        const buf = await jpeg();

        const a = await uploadVia(h, '/api/rider/me/photo', buf);
        assert.equal(a.confirm.status, 201, JSON.stringify(a.confirm?.body));
        assert.match(a.confirm.body.photo, /\/riders\/[a-f0-9]{24}\/photo\.webp/);

        const me = await request(app).get('/api/rider/me').set(h);
        assert.equal(me.body.photo, a.confirm.body.photo);
        assert.equal((await Rider.findOne({ userId: w.rider.user._id })).photo, a.confirm.body.photo);

        // another picture replaces it: still one record
        const b = await uploadVia(h, '/api/rider/me/photo', buf);
        assert.equal(b.confirm.status, 201);
        assert.equal(await Media.countDocuments({ tenantId: w.tenant._id, kind: 'rider' }), 1);

        const del = await request(app).delete('/api/rider/me/photo').set(h);
        assert.equal(del.status, 200);
        assert.equal((await request(app).get('/api/rider/me').set(h)).body.photo, null);
        assert.equal((await request(app).delete('/api/rider/me/photo').set(h)).status, 404);
    });

    test('the owner sees the rider picture in the rider list', async () => {
        const w = await world();
        await uploadVia(w.rider.headers, '/api/rider/me/photo', await jpeg());
        const list = await request(app).get('/api/shop/riders').set(w.owner.headers);
        const mine = list.body.items.find((r) => String(r.userId) === String(w.rider.user._id));
        assert.match(mine.photo, /photo\.webp/);
    });

    test('proof of delivery: refused before pickup, accepted after, shown to rider, owner and customer', async () => {
        const w = await world();
        const buf = await jpeg();

        const early = await makeOrder(w.tenant, w.customer.user, { status: 'preparing', delivery: { riderId: w.rider.user._id, status: 'accepted' } });
        const tooSoon = await request(app).post(`${proofBase(early._id)}/sign`).set(w.rider.headers).send({ contentType: 'image/jpeg', bytes: buf.length });
        assert.equal(tooSoon.status, 409);

        const o = await delivery(w);
        const up = await uploadVia(w.rider.headers, `${proofBase(o._id)}/sign`, buf);
        assert.equal(up.confirm.status, 201, JSON.stringify(up.confirm?.body));
        assert.match(up.confirm.body.proof.url, new RegExp(`/proofs/\\d{4}-\\d{2}/${o._id}/\\d{8}-[0-9a-f]{8}\\.webp`));

        const stored = await Order.findById(o._id).lean();
        assert.equal(stored.delivery.proof.url, up.confirm.body.proof.url);

        // the rider, the owner and the customer all see it
        const rider = await request(app).get(`/api/rider/orders/${o._id}`).set(w.rider.headers);
        assert.equal(rider.body.delivery.proof.url, up.confirm.body.proof.url);
        const owner = await request(app).get(`/api/shop/orders/${o._id}`).set(w.owner.headers);
        assert.equal(owner.body.delivery.proof.url, up.confirm.body.proof.url);
        const customer = await request(app).get(`/api/orders/${o._id}`).set(w.customer.headers);
        assert.equal(customer.status, 200);
        assert.equal(customer.body.delivery.proof.url, up.confirm.body.proof.url);
    });

    test('a second photo replaces the first; the rider can remove it; it also works right after delivery', async () => {
        const w = await world();
        const buf = await jpeg();
        const o = await delivery(w);

        const a = await uploadVia(w.rider.headers, `${proofBase(o._id)}/sign`, buf);
        const b = await uploadVia(w.rider.headers, `${proofBase(o._id)}/sign`, buf);
        assert.equal(b.confirm.status, 201);
        assert.notEqual(a.confirm.body.proof.url, b.confirm.body.proof.url);
        await new Promise((r) => setTimeout(r, 150));   // the old file is removed in the background
        assert.equal(await Media.countDocuments({ tenantId: w.tenant._id, kind: 'proof' }), 1);
        assert.equal((await Order.findById(o._id).lean()).delivery.proof.url, b.confirm.body.proof.url);

        // delivered a minute ago: still allowed
        await Order.updateOne({ _id: o._id }, { $set: { status: 'delivered', deliveredAt: new Date(), 'delivery.status': 'delivered' } });
        const after = await uploadVia(w.rider.headers, `${proofBase(o._id)}/sign`, buf);
        assert.equal(after.confirm.status, 201);

        const del = await request(app).delete(proofBase(o._id)).set(w.rider.headers);
        assert.equal(del.status, 200);
        assert.equal((await Order.findById(o._id).lean()).delivery.proof, undefined);
        assert.equal((await request(app).delete(proofBase(o._id)).set(w.rider.headers)).status, 404);
    });

    test('nobody else can add or read the proof of an order that is not theirs; a day later it is closed', async () => {
        const w = await world();
        const buf = await jpeg();
        const other = await makeUser(w.tenant, 'rider', '9000000099');
        const o = await delivery(w);

        // another rider of the same shop
        const stranger = await request(app).post(`${proofBase(o._id)}/sign`).set(other.headers).send({ contentType: 'image/jpeg', bytes: buf.length });
        assert.equal(stranger.status, 404);
        // a customer has no rider routes at all
        const customer = await request(app).post(`${proofBase(o._id)}/sign`).set(w.customer.headers).send({ contentType: 'image/jpeg', bytes: buf.length });
        assert.equal(customer.status, 403);

        // delivered two days ago: too late
        await Order.updateOne({ _id: o._id }, { $set: { status: 'delivered', deliveredAt: new Date(Date.now() - 2 * 86400000), 'delivery.status': 'delivered' } });
        const late = await request(app).post(`${proofBase(o._id)}/sign`).set(w.rider.headers).send({ contentType: 'image/jpeg', bytes: buf.length });
        assert.equal(late.status, 409);
    });

    test('only images, and not more than 5 MB', async () => {
        const w = await world();
        const o = await delivery(w);
        const pdf = await request(app).post(`${proofBase(o._id)}/sign`).set(w.rider.headers).send({ contentType: 'application/pdf', bytes: 1000 });
        assert.equal(pdf.status, 400);
        const huge = await request(app).post(`${proofBase(o._id)}/sign`).set(w.rider.headers).send({ contentType: 'image/jpeg', bytes: 6 * 1024 * 1024 });
        assert.equal(huge.status, 400);
        const key = await request(app).post(proofBase(o._id)).set(w.rider.headers).send({ key: 'tenants/other/tmp/x/y.jpg' });
        assert.equal(key.status, 400);
    });
});
