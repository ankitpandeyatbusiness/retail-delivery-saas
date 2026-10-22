require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const Product = require('../src/models/Product');
const Category = require('../src/models/Category');
const Notification = require('../src/models/Notification');
const Session = require('../src/models/Session');
const tokenService = require('../src/services/tokenService');
const orderStatus = require('../src/services/orderStatusService');
const pushChannel = require('../src/notifications/channels/push');

// Phase 5: the owner's Kitchen staff / Waiters pages and the person's own "My work": what each did, what they are making now, their leaves.
let w;
let cook;
let waiter;
let product;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('stats-shop');
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.staff': { kitchenOn: true, waiterOn: true, max: 10 } } });
    tenantRecognizer.invalidateTenant('stats-shop');
    cook = await hire('kitchen', '9111111111', 'Ramesh');
    waiter = await hire('waiter', '9222222222', 'Suresh');
    const cat = await Category.create({ tenantId: w.tenant._id, name: 'Main' });
    product = await Product.create({ tenantId: w.tenant._id, categoryId: cat._id, name: 'Dosa', price: 100, isVeg: true });
});
afterEach(() => mock.restoreAll());

async function hire(role, phone, name) {
    const add = await request(app).post('/api/shop/staff').set(w.owner.headers).send({ phone, name, role });
    assert.equal(add.status, 201, JSON.stringify(add.body));
    const sessionId = new mongoose.Types.ObjectId();
    const { accessToken, refreshToken } = tokenService.generateTokens({ userId: add.body.userId, tenantId: w.tenant._id, sessionId });
    await Session.create({ _id: sessionId, userId: add.body.userId, tenantId: w.tenant._id, refreshTokenHash: tokenService.hashToken(refreshToken), expiresAt: new Date(Date.now() + tokenService.REFRESH_TTL_MS) });
    return { id: add.body.userId, headers: { Authorization: `Bearer ${accessToken}`, 'x-tenant-slug': 'stats-shop' } };
}
const mk = (o = {}) => f.makeOrder(w.tenant, w.customer.user, {
    status: 'accepted', orderType: 'dine_in', tableNo: '4', statusHistory: [{ status: 'placed' }, { status: 'accepted' }],
    items: [{ productId: product._id, name: 'Dosa', quantity: 2, unitPrice: 100, lineTotal: 200 }], ...o,
});
const ownerGet = (path) => request(app).get(`/api/shop/staff${path}`).set(w.owner.headers);

describe('what each person did', () => {
    test('a cook\'s orders and dishes, how long he takes, what he is making now; the owner sees it per person and in the list', async () => {
        const a = await mk(); const b = await mk(); const c = await mk();
        for (const o of [a, b]) {
            assert.equal((await request(app).post(`/api/staff/kitchen/orders/${o._id}/start`).set(cook.headers)).status, 200);
        }
        assert.equal((await request(app).post(`/api/staff/kitchen/orders/${a._id}/ready`).set(cook.headers)).status, 200);
        await Order.updateOne({ _id: a._id }, { $set: { 'kitchen.startedAt': new Date(Date.now() - 12 * 60000) } });
        assert.equal((await request(app).post(`/api/staff/kitchen/orders/${c._id}/start`).set(waiter.headers)).status, 403, 'a waiter cannot cook');

        const one = await ownerGet(`/${cook.id}`);
        assert.equal(one.status, 200, JSON.stringify(one.body));
        assert.equal(one.body.person.name, 'Ramesh');
        assert.equal(one.body.person.phone, '9111111111');
        assert.equal(one.body.stats.today.orders, 1);
        assert.equal(one.body.stats.today.dishes, 2);
        assert.ok(one.body.stats.avgMin >= 11 && one.body.stats.avgMin <= 13, `about 12 minutes, got ${one.body.stats.avgMin}`);
        assert.equal(one.body.working.length, 1, 'the second one is still on his stove');
        assert.equal(one.body.working[0].orderNo, b.orderNo);
        assert.ok(!JSON.stringify(one.body).match(/rupee|price|total/i), 'no money');

        const list = await ownerGet('?stats=1');
        const row = list.body.items.find((x) => x.userId === String(cook.id));
        assert.equal(row.stats.week.orders, 1);
        assert.equal(list.body.items.find((x) => x.userId === String(waiter.id)).stats.week.orders, 0);
        assert.equal((await ownerGet('')).body.items[0].stats, undefined, 'the plain list stays light');
    });

    test('a waiter\'s served orders, tables and the wait of a ready dish; his own "My work" shows the same; another shop\'s person is not found', async () => {
        const o = await mk({ status: 'ready', statusHistory: [{ status: 'placed' }, { status: 'accepted' }, { status: 'ready', at: new Date(Date.now() - 5 * 60000) }] });
        assert.equal((await request(app).post(`/api/staff/waiter/orders/${o._id}/serve`).set(waiter.headers)).status, 200);
        const mine = await request(app).get('/api/staff/work').set(waiter.headers);
        assert.equal(mine.status, 200, JSON.stringify(mine.body));
        assert.equal(mine.body.stats.today.orders, 1);
        assert.equal(mine.body.stats.tables, 1);
        assert.ok(mine.body.stats.avgMin >= 4 && mine.body.stats.avgMin <= 6);
        assert.deepEqual(mine.body.working, []);
        const seen = await ownerGet(`/${waiter.id}`);
        assert.equal(seen.body.stats.today.orders, 1);
        assert.equal((await ownerGet(`/${new mongoose.Types.ObjectId()}`)).status, 404);
        assert.equal((await ownerGet('/nope')).status, 404);
    });

    test('leaves and days off are in the detail, and the owner\'s answer is on the person\'s screen at once', async () => {
        const realtime = require('../src/services/realtime');
        const tell = mock.method(realtime, 'toKitchen', () => {});
        const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
        const ask = await request(app).post('/api/staff/duty/leave').set(cook.headers).send({ from: day, to: day, reason: 'Family function' });
        assert.equal(ask.status, 201, JSON.stringify(ask.body));
        const before = await request(app).get('/api/staff/work').set(cook.headers);
        assert.equal(before.body.leaves[0].status, 'pending');
        const pending = (await request(app).get('/api/shop/staff/leaves').set(w.owner.headers)).body.pending[0];
        assert.equal((await request(app).post(`/api/shop/staff/leaves/${pending.id}`).set(w.owner.headers).send({ approve: true })).status, 200);
        assert.ok(tell.mock.calls.some((c) => c.arguments[2]?.leave === true), 'the cook\'s screen is told');
        const after = await request(app).get('/api/staff/work').set(cook.headers);
        assert.equal(after.body.leaves[0].status, 'approved');
        assert.equal(after.body.holidays.length, 1);
        const seen = await ownerGet(`/${cook.id}`);
        assert.equal(seen.body.leaves[0].status, 'approved');
        assert.equal(seen.body.holidays[0].leave, true);
    });
});

describe('taking leaves and days off back', () => {
    const dayIn = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

    test('the person can cancel an approved leave that has not ended; the days off go with it', async () => {
        const ask = await request(app).post('/api/staff/duty/leave').set(cook.headers).send({ from: dayIn(3), to: dayIn(4), reason: 'Wedding' });
        assert.equal(ask.status, 201);
        const id = (await request(app).get('/api/staff/work').set(cook.headers)).body.leaves[0].id;
        assert.equal((await request(app).post(`/api/shop/staff/leaves/${id}`).set(w.owner.headers).send({ approve: true })).status, 200);
        assert.equal((await request(app).get('/api/staff/work').set(cook.headers)).body.holidays.length, 1);
        const back = await request(app).post(`/api/staff/duty/leave/${id}/cancel`).set(cook.headers);
        assert.equal(back.status, 200, JSON.stringify(back.body));
        const now = (await request(app).get('/api/staff/work').set(cook.headers)).body;
        assert.equal(now.leaves[0].status, 'cancelled');
        assert.equal(now.holidays.length, 0);
    });

    test('the owner can remove a pending leave, an approved leave and a day off the person set; the person is told and their screen changes', async () => {
        const realtime = require('../src/services/realtime');
        const tell = mock.method(realtime, 'toKitchen', () => {});
        await request(app).post('/api/staff/duty/leave').set(cook.headers).send({ from: dayIn(2), to: dayIn(2), reason: 'Doctor' });
        await request(app).post('/api/staff/duty/leave').set(cook.headers).send({ from: dayIn(8), to: dayIn(9), reason: 'Trip' });
        const mine = (await request(app).get('/api/staff/work').set(cook.headers)).body.leaves;
        const trip = mine.find((l) => l.reason === 'Trip'); const doctor = mine.find((l) => l.reason === 'Doctor');
        await request(app).post(`/api/shop/staff/leaves/${trip.id}`).set(w.owner.headers).send({ approve: true });
        await request(app).post('/api/staff/duty/holidays').set(cook.headers).send({ from: dayIn(12), to: dayIn(12), note: 'Eid' });

        let seen = (await ownerGet(`/${cook.id}`)).body;
        assert.equal(seen.holidays.length, 2, 'the approved leave and the plain day off');
        assert.equal((await request(app).delete(`/api/shop/staff/leaves/${doctor.id}`).set(w.owner.headers)).status, 200, 'a pending leave');
        assert.equal((await request(app).delete(`/api/shop/staff/leaves/${trip.id}`).set(w.owner.headers)).status, 200, 'an approved leave');
        const plain = seen.holidays.find((h) => !h.leave);
        assert.equal((await request(app).delete(`/api/shop/staff/${cook.id}/holidays/${plain.id}`).set(w.owner.headers)).status, 200, 'a plain day off');
        seen = (await ownerGet(`/${cook.id}`)).body;
        assert.equal(seen.holidays.length, 0);
        assert.ok(seen.leaves.every((l) => l.status === 'cancelled'));
        assert.ok(tell.mock.calls.filter((c) => c.arguments[2]?.leave === true).length >= 3, 'their screen is told each time');
        await f.waitFor(async () => (await require('../src/models/Notification').countDocuments({ tenantId: w.tenant._id, type: 'staff_leave_removed' })) === 3);
        assert.equal((await request(app).delete(`/api/shop/staff/leaves/${trip.id}`).set(w.owner.headers)).status, 404, 'already gone');
    });
});

describe('the owner\'s message when he takes a leave away', () => {
    test('the message reaches the person in the notification', async () => {
        const day = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
        await request(app).post('/api/staff/duty/leave').set(cook.headers).send({ from: day, to: day, reason: 'Trip' });
        const id = (await request(app).get('/api/staff/work').set(cook.headers)).body.leaves[0].id;
        await request(app).post(`/api/shop/staff/leaves/${id}`).set(w.owner.headers).send({ approve: true });
        const r = await request(app).delete(`/api/shop/staff/leaves/${id}`).set(w.owner.headers).send({ note: 'We need you that day' });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const Notification = require('../src/models/Notification');
        await f.waitFor(async () => !!(await Notification.findOne({ tenantId: w.tenant._id, type: 'staff_leave_removed' })));
        const n = await Notification.findOne({ tenantId: w.tenant._id, type: 'staff_leave_removed' });
        assert.match(n.body, /We need you that day/);
        assert.match(n.body, /on duty/);
    });
});
