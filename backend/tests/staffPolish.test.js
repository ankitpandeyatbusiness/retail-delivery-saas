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
const Session = require('../src/models/Session');
const AuditLog = require('../src/models/AuditLog');
const Notification = require('../src/models/Notification');
const tokenService = require('../src/services/tokenService');
const pushChannel = require('../src/notifications/channels/push');
const { runStaffNudges } = require('../src/jobs/staffNudges');

// Phase 5 of the kitchen and waiter panels: nudges, the packed-food message to the rider, and the activity log with names.
let w;
let cook;
let waiter;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('polish-shop');
    await setShop();
    cook = await hire('kitchen', '9111111111', 'Ramesh');
    waiter = await hire('waiter', '9222222222', 'Suresh');
});
afterEach(() => mock.restoreAll());

async function setShop(staff = {}) {
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.staff': { kitchenOn: true, waiterOn: true, max: 10, ...staff } } });
    tenantRecognizer.invalidateTenant('polish-shop');
}
async function hire(role, phone, name) {
    const add = await request(app).post('/api/shop/staff').set(w.owner.headers).send({ phone, name, role });
    assert.equal(add.status, 201, JSON.stringify(add.body));
    const sessionId = new mongoose.Types.ObjectId();
    const { accessToken, refreshToken } = tokenService.generateTokens({ userId: add.body.userId, tenantId: w.tenant._id, sessionId });
    await Session.create({ _id: sessionId, userId: add.body.userId, tenantId: w.tenant._id, refreshTokenHash: tokenService.hashToken(refreshToken), expiresAt: new Date(Date.now() + tokenService.REFRESH_TTL_MS) });
    return { id: add.body.userId, headers: { Authorization: `Bearer ${accessToken}`, 'x-tenant-slug': 'polish-shop' } };
}
const minsAgo = (m) => new Date(Date.now() - m * 60000);
const mk = (o = {}) => f.makeOrder(w.tenant, w.customer.user, { status: 'accepted', orderType: 'pickup', createdAt: minsAgo(30), statusHistory: [{ status: 'accepted', at: minsAgo(30) }], ...o });
const pushes = () => mock.method(pushChannel, 'send', async () => ({ sent: 1, tokens: 1 }));
const typesOf = (spy) => spy.mock.calls.map((c) => c.arguments[0].data?.type);

describe('nudges', () => {
    test('an accepted order nobody started is nudged to the cooks, once', async () => {
        const spy = pushes();
        await mk({ createdAt: minsAgo(12), statusHistory: [{ status: 'accepted', at: minsAgo(12) }] });
        assert.equal(await runStaffNudges(), 1);
        const call = spy.mock.calls.map((c) => c.arguments[0]).find((a) => a.data?.type === 'kitchen_nudge');
        assert.equal(String(call.userId), String(cook.id));
        assert.match(call.body, /Please start it/);
        assert.equal(await runStaffNudges(), 0, 'not again');
        assert.equal(typesOf(spy).filter((t) => t === 'kitchen_nudge').length, 1);
    });

    test('a fresh order, a scheduled-for-later one and a switched-off shop are left alone', async () => {
        const spy = pushes();
        await mk({ createdAt: minsAgo(2), statusHistory: [{ status: 'accepted', at: minsAgo(2) }] });
        await mk({ scheduledFor: new Date(Date.now() + 4 * 3600000) });
        assert.equal(await runStaffNudges(), 0);
        await setShop({ nudgeMin: 0 });
        await mk({ createdAt: minsAgo(30) });
        assert.equal(await runStaffNudges(), 0, 'nudgeMin 0 means no nudges');
        await setShop({ kitchenOn: false });
        assert.equal(await runStaffNudges(), 0);
        assert.equal(spy.mock.calls.length, 0);
    });

    test('an order still cooking after the late time is nudged once; a ready one is not', async () => {
        const spy = pushes();
        await mk({ status: 'preparing', createdAt: minsAgo(40), statusHistory: [{ status: 'accepted', at: minsAgo(40) }], kitchen: { startedAt: minsAgo(35) } });
        await mk({ status: 'preparing', createdAt: minsAgo(40), statusHistory: [{ status: 'accepted', at: minsAgo(40) }], kitchen: { startedAt: minsAgo(35), readyAt: minsAgo(5) } });
        assert.equal(await runStaffNudges(), 1);
        assert.deepEqual(typesOf(spy).filter((t) => /kitchen_/.test(t)), ['kitchen_late']);
        assert.equal(await runStaffNudges(), 0);
    });

    test('a dish ready too long is nudged to the waiters, once, and not to the cooks', async () => {
        const spy = pushes();
        const s = await mongoose.model('TableSession').create({ tenantId: w.tenant._id, table: '4', customers: [w.customer.user._id], status: 'open' });
        await mk({ status: 'ready', orderType: 'dine_in', tableNo: '4', tableSessionId: s._id, statusHistory: [{ status: 'ready', at: minsAgo(9) }], updatedAt: minsAgo(9) });
        assert.equal(await runStaffNudges(), 1);
        const call = spy.mock.calls.map((c) => c.arguments[0]).find((a) => a.data?.type === 'waiter_nudge');
        assert.equal(String(call.userId), String(waiter.id));
        assert.match(call.title, /Table 4/);
        assert.equal(await runStaffNudges(), 0);
    });

    test('two runs at the same moment send one nudge', async () => {
        const spy = pushes();
        await mk({ createdAt: minsAgo(20), statusHistory: [{ status: 'accepted', at: minsAgo(20) }] });
        const both = await Promise.all([runStaffNudges(), runStaffNudges()]);
        assert.equal(both[0] + both[1], 1);
        assert.equal(typesOf(spy).filter((t) => t === 'kitchen_nudge').length, 1);
    });
});

describe('the rider hears the food is packed', () => {
    test('when the cook marks a delivery order ready, the rider who is coming is told', async () => {
        pushes();
        const o = await mk({ orderType: 'delivery', status: 'preparing', delivery: { riderId: w.rider.user._id, status: 'accepted' }, kitchen: { startedAt: minsAgo(8) } });
        const r = await request(app).post(`/api/staff/kitchen/orders/${o._id}/ready`).set(cook.headers);
        assert.equal(r.status, 200);
        await f.waitFor(async () => (await Notification.countDocuments({ tenantId: w.tenant._id, userId: w.rider.user._id, type: 'food_packed_rider' })) === 1);
        const n = await Notification.findOne({ tenantId: w.tenant._id, userId: w.rider.user._id, type: 'food_packed_rider' });
        assert.match(n.title, /is packed/);
    });

    test('no rider yet: nobody is told, and nothing breaks', async () => {
        pushes();
        const o = await mk({ orderType: 'delivery', status: 'preparing', kitchen: { startedAt: minsAgo(8) } });
        assert.equal((await request(app).post(`/api/staff/kitchen/orders/${o._id}/ready`).set(cook.headers)).status, 200);
        assert.equal(await Notification.countDocuments({ tenantId: w.tenant._id, type: 'food_packed_rider' }), 0);
    });
});

describe('the activity log names the person', () => {
    test('a cook starting an order is logged as "Ramesh (kitchen)" and the owner can filter staff', async () => {
        const o = await mk();
        assert.equal((await request(app).post(`/api/staff/kitchen/orders/${o._id}/start`).set(cook.headers)).status, 200);
        await f.waitFor(async () => (await AuditLog.countDocuments({ tenantId: w.tenant._id, actorType: 'staff' })) >= 1);
        const row = await AuditLog.findOne({ tenantId: w.tenant._id, actorType: 'staff' });
        assert.equal(row.actorLabel, 'Ramesh (kitchen)');
        assert.match(row.action, /kitchen\/orders\/:id\/start/);
        const log = await request(app).get('/api/shop/activity?actorType=staff').set(w.owner.headers);
        assert.equal(log.status, 200);
        assert.equal(log.body.items.length, 1);
        assert.equal(log.body.items[0].actorLabel, 'Ramesh (kitchen)');
    });
});
