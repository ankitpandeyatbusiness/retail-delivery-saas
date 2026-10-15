require('./helpers/env');
// A shop with no delivery PIN: the photo of the food handed over is compulsory to finish a delivery.
// A shop with the PIN: the PIN is the proof, and the photo stays optional.
const { test, describe, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const request = require('supertest');
const sharp = require('sharp');
const db = require('./helpers/db');
const { makeWorld, makeOrder } = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const storage = require('../src/services/adapters/storage');
const Order = require('../src/models/Order');
const pins = require('../src/services/deliveryPinService');

const slugs = [];
let n = 0;
const jpeg = () => sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 30, g: 160, b: 90 } } }).jpeg().toBuffer();

const world = async () => {
    const slug = `nopin-${++n}-${Date.now().toString(36)}`;
    slugs.push(slug);
    return makeWorld(slug);
};
const picked = (w, pinRequired) => makeOrder(w.tenant, w.customer.user, {
    status: 'out_for_delivery',
    delivery: { riderId: w.rider.user._id, status: 'picked_up', pickedUpAt: new Date(), pinRequired },
});
const deliver = (w, o, body = {}) => request(app).post(`/api/rider/orders/${o._id}/deliver`).set(w.rider.headers).send(body);

async function addProof(w, o) {
    const buf = await jpeg();
    const s = await request(app).post(`/api/rider/orders/${o._id}/proof/sign`).set(w.rider.headers).send({ contentType: 'image/jpeg', bytes: buf.length });
    assert.equal(s.status, 200);
    await storage.put({ key: s.body.key, buffer: buf, contentType: 'image/jpeg' });
    const c = await request(app).post(`/api/rider/orders/${o._id}/proof`).set(w.rider.headers).send({ key: s.body.key });
    assert.equal(c.status, 201);
}

describe('delivery photo is compulsory without a PIN', () => {
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

    test('no PIN and no photo: refused, and the order is not delivered', async () => {
        const w = await world();
        const o = await picked(w, false);
        const r = await deliver(w, o);
        assert.equal(r.status, 409);
        assert.match(r.body.error, /photo/i);
        assert.equal((await Order.findById(o._id)).status, 'out_for_delivery');
    });

    test('no PIN, with the photo: delivered', async () => {
        const w = await world();
        const o = await picked(w, false);
        await addProof(w, o);
        const r = await deliver(w, o);
        assert.equal(r.status, 200);
        assert.equal((await Order.findById(o._id)).status, 'delivered');
    });

    test('with a PIN the photo is optional: the right PIN delivers, a wrong one does not', async () => {
        const w = await world();
        const o = await picked(w, true);
        assert.equal((await deliver(w, o, { pin: '0000x' })).status, 400);
        const ok = await deliver(w, o, { pin: pins.pinFor(o) });
        assert.equal(ok.status, 200);
        assert.equal((await Order.findById(o._id)).status, 'delivered');
    });
});
