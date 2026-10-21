require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Order = require('../src/models/Order');
const Notification = require('../src/models/Notification');
const pushChannel = require('../src/notifications/channels/push');

// A pickup customer tells the shop he is coming, is here, is late or needs more time, before and after his pickup time.
let w;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
    w = await f.makeWorld('intent-shop');
    require('../src/middlewares/tenantRecognizer').invalidateTenant('intent-shop');
});
afterEach(() => mock.restoreAll());

const hours = (h) => new Date(Date.now() + h * 3600000);
const ready = (o = {}) => f.makeOrder(w.tenant, w.customer.user, { orderType: 'pickup', status: 'ready', scheduledFor: hours(2), pickupUntil: hours(2.5), statusHistory: [{ status: 'ready', at: new Date() }], ...o });
const due = () => request(app).get('/api/orders/pickup-due').set(w.customer.headers);
const answer = (id, a) => request(app).post(`/api/orders/${id}/pickup-answer`).set(w.customer.headers).send({ answer: a });

describe('the customer says he is coming', () => {
    test('food that is ready before his time: he is asked once, and the answer tells the owner', async () => {
        const o = await ready();
        const list = (await due()).body.items;
        assert.equal(list.length, 1);
        assert.equal(list[0].mode, 'ready');
        assert.equal(list[0].early, true);

        const r = await answer(o._id, 'coming');
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal((await Order.findById(o._id)).pickupIntent.kind, 'coming');
        await f.waitFor(async () => (await Notification.countDocuments({ tenantId: w.tenant._id, type: 'pickup_intent' })) === 1);
        const n = await Notification.findOne({ tenantId: w.tenant._id, type: 'pickup_intent' });
        assert.match(n.title, /customer is coming/);
        assert.equal((await due()).body.items.length, 0, 'not asked again');
    });

    test('"on my time" tells nobody; "I am here" and "late" and "more time" tell the owner each time', async () => {
        const a = await ready();
        const first = await answer(a._id, 'on_time'); assert.equal(first.status, 200, JSON.stringify(first.body));
        assert.equal(await Notification.countDocuments({ tenantId: w.tenant._id, type: 'pickup_intent' }), 0);
        const b = await ready();
        for (const k of ['arrived', 'late', 'more_time']) assert.equal((await answer(b._id, k)).status, 200, k);
        await f.waitFor(async () => (await Notification.countDocuments({ tenantId: w.tenant._id, type: 'pickup_intent' })) === 3);
        const titles = (await Notification.find({ tenantId: w.tenant._id, type: 'pickup_intent' })).map((n) => n.title).join(' | ');
        assert.match(titles, /customer is here/);
        assert.match(titles, /customer is late/);
        assert.match(titles, /needs more time/);
    });

    test('he can still say he collected it after saying he was here; an unknown answer is refused; an order that is not ready is refused', async () => {
        const o = await ready();
        await answer(o._id, 'arrived');
        assert.equal((await answer(o._id, 'collected')).status, 200);
        assert.equal((await Order.findById(o._id)).pickupClaim.kind, 'collected');
        assert.equal((await answer((await ready())._id, 'banana')).status, 400);
        const cooking = await ready({ status: 'preparing' });
        assert.equal((await answer(cooking._id, 'coming')).status, 409);
    });
});
