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

// Phase 2 of the kitchen and waiter panels: the cook's queue, Start cooking, Ready, and telling the owner about a problem.
let w;
let cook;
let waiter;
let product;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('kitchen-shop');
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.staff': { kitchenOn: true, waiterOn: true, max: 10 } } });
    tenantRecognizer.invalidateTenant('kitchen-shop');
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
    return { id: add.body.userId, headers: { Authorization: `Bearer ${accessToken}`, 'x-tenant-slug': 'kitchen-shop' } };
}
const mk = (o = {}) => f.makeOrder(w.tenant, w.customer.user, {
    status: 'accepted', orderType: 'dine_in', tableNo: '4', statusHistory: [{ status: 'placed' }, { status: 'accepted' }],
    items: [{ productId: product._id, name: 'Dosa', quantity: 2, unitPrice: 100, lineTotal: 200, selections: [{ name: 'Extra cheese' }], note: 'no onion' }], ...o,
});
const get = (who = cook) => request(app).get('/api/staff/kitchen/orders').set(who.headers);
const post = (id, what, body, who = cook) => request(app).post(`/api/staff/kitchen/orders/${id}/${what}`).set(who.headers).send(body || {});

describe('the queue', () => {
    test('shows what is to be made, with the dishes, and nothing about money or the customer', async () => {
        await mk();
        const r = await get();
        assert.equal(r.status, 200);
        assert.equal(r.body.items.length, 1);
        const o = r.body.items[0];
        assert.equal(o.stage, 'new');
        assert.equal(o.tableNo, '4');
        assert.deepEqual(o.items[0].options, ['Extra cheese']);
        assert.equal(o.items[0].note, 'no onion');
        assert.equal(r.body.counts.new, 1);
        const text = JSON.stringify(r.body);
        assert.ok(!/phone|9000000030|total|unitPrice|price/i.test(text), 'no money, no phone');
    });

    test('only accepted, cooking and ready orders; not placed, cancelled or delivered', async () => {
        await mk({ status: 'placed' });
        await mk({ status: 'cancelled' });
        await mk({ status: 'delivered' });
        await mk({ status: 'accepted' });
        await mk({ status: 'preparing' });
        const r = await get();
        assert.deepEqual(r.body.items.map((o) => o.stage).sort(), ['cooking', 'new']);
    });

    test('the oldest comes first, and a late order is flagged', async () => {
        const old = await mk({ createdAt: new Date(Date.now() - 40 * 60000), statusHistory: [{ status: 'accepted', at: new Date(Date.now() - 40 * 60000) }] });
        await mk({ statusHistory: [{ status: 'accepted', at: new Date() }] });
        const r = await get();
        assert.equal(r.body.items[0].id, String(old._id));
        assert.equal(r.body.items[0].late, true);
        assert.equal(r.body.items[1].late, false);
        assert.equal(r.body.counts.late, 1);
    });

    test('a pickup for later waits for its start time', async () => {
        await mk({ orderType: 'pickup', tableNo: undefined, scheduledFor: new Date(Date.now() + 3 * 3600000) });
        const r = await get();
        assert.equal(r.body.items[0].early, true);
    });

    test('the kinds of order the super admin chose are the only ones shown', async () => {
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.staff.kitchenSees': ['dine_in'] } });
        tenantRecognizer.invalidateTenant('kitchen-shop');
        await mk({ orderType: 'delivery', tableNo: undefined });
        const dine = await mk();
        const r = await get();
        assert.deepEqual(r.body.items.map((o) => o.id), [String(dine._id)]);
    });

    test('a waiter and a customer cannot use the kitchen', async () => {
        assert.equal((await get(waiter)).status, 403);
        assert.equal((await request(app).get('/api/staff/kitchen/orders').set(w.customer.headers)).status, 403);
    });
});

describe('Start cooking and Ready', () => {
    test('start: the order is being prepared, and it remembers who', async () => {
        const o = await mk();
        const r = await post(o._id, 'start');
        assert.equal(r.status, 200);
        assert.equal(r.body.already, false);
        const fresh = await Order.findById(o._id);
        assert.equal(fresh.status, 'preparing');
        assert.equal(fresh.kitchen.startedByName, 'Ramesh');
        const last = fresh.statusHistory[fresh.statusHistory.length - 1];
        assert.equal(last.byType, 'staff');
    });

    test('two cooks tap the same order: the second is told who started it', async () => {
        const second = await hire('kitchen', '9333333333', 'Mahesh');
        const o = await mk();
        assert.equal((await post(o._id, 'start')).body.already, false);
        const r = await post(o._id, 'start', {}, second);
        assert.equal(r.status, 200);
        assert.equal(r.body.already, true);
        assert.equal(r.body.by, 'Ramesh');
    });

    test('at the same moment only one start counts', async () => {
        const second = await hire('kitchen', '9333333333', 'Mahesh');
        const o = await mk();
        const both = await Promise.all([post(o._id, 'start'), post(o._id, 'start', {}, second)]);
        assert.ok(both.every((r) => r.status === 200), JSON.stringify(both.map((r) => r.body)));
        assert.equal(both.filter((r) => r.status === 200 && r.body.already === false).length, 1);
        assert.equal((await Order.findById(o._id)).status, 'preparing');
    });

    test('a cancelled order cannot be started, and an unaccepted one is not ready to cook', async () => {
        const c = await mk({ status: 'cancelled' });
        const rc = await post(c._id, 'start');
        assert.equal(rc.status, 409);
        assert.match(rc.body.error, /cancelled/);
        const p = await mk({ status: 'placed' });
        assert.equal((await post(p._id, 'start')).status, 409);
    });

    test('ready: a dine in or pickup order becomes ready, once', async () => {
        const o = await mk();
        assert.equal((await post(o._id, 'ready')).status, 409, 'start first');
        await post(o._id, 'start');
        const r = await post(o._id, 'ready');
        assert.equal(r.status, 200);
        assert.equal((await Order.findById(o._id)).status, 'ready');
        const again = await post(o._id, 'ready');
        assert.equal(again.body.already, true);
        assert.equal((await get()).body.items[0].stage, 'ready');
    });

    test('ready on a delivery order: it stays "preparing" for the rider, and says the food is packed', async () => {
        const o = await mk({ orderType: 'delivery', tableNo: undefined });
        await post(o._id, 'start');
        const r = await post(o._id, 'ready');
        assert.equal(r.status, 200);
        const fresh = await Order.findById(o._id);
        assert.equal(fresh.status, 'preparing');
        assert.ok(fresh.kitchen.readyAt);
        assert.equal((await post(o._id, 'ready')).body.already, true);
        assert.equal((await get()).body.items[0].stage, 'ready');
    });

    test('a cook can do nothing else to an order', async () => {
        const o = await mk();
        const order = await Order.findById(o._id);
        const actor = { type: 'staff', role: 'kitchen', id: cook.id, label: 'Ramesh' };
        await assert.rejects(() => orderStatus.change({ order, status: 'cancelled', actor, reasonCode: 'busy' }), /cannot make this change/);
        await assert.rejects(() => orderStatus.change({ order, status: 'delivered', actor }), /cannot make this change/);
        await assert.rejects(() => orderStatus.change({ order, status: 'ready', actor }), /not being cooked/);
        const owner = await request(app).patch(`/api/shop/orders/${o._id}/status`).set(cook.headers).send({ status: 'cancelled', reasonCode: 'busy' });
        assert.equal(owner.status, 403, 'the owner routes stay closed to staff');
    });

    test('an order of a kind the cook does not see cannot be started', async () => {
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.staff.kitchenSees': ['dine_in'] } });
        tenantRecognizer.invalidateTenant('kitchen-shop');
        const o = await mk({ orderType: 'delivery', tableNo: undefined });
        assert.equal((await post(o._id, 'start')).status, 404);
    });
});

describe('a problem', () => {
    test('a finished dish is switched off and the owner is told', async () => {
        const o = await mk();
        const r = await post(o._id, 'problem', { kind: 'out_of_stock', productId: String(product._id) });
        assert.equal(r.status, 200);
        assert.equal(r.body.dishOff, true);
        assert.equal((await Product.findById(product._id)).isAvailable, false);
        assert.equal((await Order.findById(o._id)).status, 'accepted', 'the owner decides about the order');
        await f.waitFor(async () => (await Notification.countDocuments({ tenantId: w.tenant._id, type: 'kitchen_problem' })) === 1);
        const n = await Notification.findOne({ tenantId: w.tenant._id, type: 'kitchen_problem' });
        assert.match(n.body, /Dosa is finished/);
        assert.match(n.body, /Ramesh/);
    });

    test('the same order cannot be reported again straight away; a bad report is refused', async () => {
        const o = await mk();
        assert.equal((await post(o._id, 'problem', { kind: 'cannot_make' })).status, 200);
        assert.equal((await post(o._id, 'problem', { kind: 'cannot_make' })).status, 429);
        const o2 = await mk();
        assert.equal((await post(o2._id, 'problem', { kind: 'other' })).status, 400, 'other needs words');
        assert.equal((await post(o2._id, 'problem', { kind: 'nonsense' })).status, 400);
        assert.equal((await post(o2._id, 'problem', { kind: 'out_of_stock', productId: String(new mongoose.Types.ObjectId()) })).status, 400, 'a dish that is not in the order');
    });
});

describe('alerts', () => {
    test('a new order (accepted) rings the cooks; a cancelled one tells them to stop; a waiter hears nothing', async () => {
        const spy = mock.method(pushChannel, 'send', async () => ({ sent: 1, tokens: 1 }));
        const o = await mk({ status: 'placed', statusHistory: [{ status: 'placed' }] });
        const order = await Order.findById(o._id);
        await orderStatus.change({ order, status: 'accepted', actor: { type: 'owner', id: w.owner.user._id, label: 'owner' } });
        await f.waitFor(() => spy.mock.calls.some((c) => c.arguments[0].data?.type === 'kitchen_new'));
        const rings = spy.mock.calls.map((c) => c.arguments[0]).filter((a) => a.data?.type === 'kitchen_new');
        assert.equal(rings.length, 1);
        assert.equal(String(rings[0].userId), String(cook.id));
        assert.ok(rings[0].channelId, 'on the loud channel');
        assert.match(rings[0].title, new RegExp(`#${o.orderNo}`));

        const now = await Order.findById(o._id);
        await orderStatus.change({ order: now, status: 'cancelled', actor: { type: 'owner', id: w.owner.user._id, label: 'owner' }, reasonCode: 'busy' });
        await f.waitFor(() => spy.mock.calls.some((c) => c.arguments[0].data?.type === 'kitchen_cancelled'));
        assert.equal(spy.mock.calls.map((c) => c.arguments[0]).filter((a) => a.data?.type === 'kitchen_cancelled').length, 1);
        assert.ok(!spy.mock.calls.some((c) => String(c.arguments[0].userId) === String(waiter.id) && /kitchen_/.test(c.arguments[0].data?.type || '')));
    });

    test('no ring when the kitchen panel is off or the kind of order is not the cook\'s', async () => {
        const spy = mock.method(pushChannel, 'send', async () => ({ sent: 1, tokens: 1 }));
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.staff.kitchenSees': ['pickup'] } });
        tenantRecognizer.invalidateTenant('kitchen-shop');
        const o = await mk({ status: 'placed', statusHistory: [{ status: 'placed' }] });
        await orderStatus.change({ order: await Order.findById(o._id), status: 'accepted', actor: { type: 'owner', id: w.owner.user._id, label: 'owner' } });
        await new Promise((r) => setTimeout(r, 300));
        assert.ok(!spy.mock.calls.some((c) => /kitchen_/.test(c.arguments[0].data?.type || '')));
    });
});
