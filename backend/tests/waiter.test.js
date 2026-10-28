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
const TableSession = require('../src/models/TableSession');
const TableRequest = require('../src/models/TableRequest');
const tokenService = require('../src/services/tokenService');
const orderStatus = require('../src/services/orderStatusService');
const tableBill = require('../src/services/tableBill');
const pushChannel = require('../src/notifications/channels/push');

// Phase 3 of the kitchen and waiter panels: the waiter's floor (serve, requests, tables, bills).
let w;
let cook;
let waiter;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('waiter-shop');
    await setShop({});
    cook = await hire('kitchen', '9111111111', 'Ramesh');
    waiter = await hire('waiter', '9222222222', 'Suresh');
});
afterEach(() => mock.restoreAll());

async function setShop({ dine = {}, staff = {} }) {
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: {
        'settings.orders.staff': { kitchenOn: true, waiterOn: true, max: 10, ...staff },
        'settings.orders.dineIn': { enabled: true, tableCount: 10, callOn: true, ...dine },
    } });
    tenantRecognizer.invalidateTenant('waiter-shop');
}
async function hire(role, phone, name) {
    const add = await request(app).post('/api/shop/staff').set(w.owner.headers).send({ phone, name, role });
    assert.equal(add.status, 201, JSON.stringify(add.body));
    const sessionId = new mongoose.Types.ObjectId();
    const { accessToken, refreshToken } = tokenService.generateTokens({ userId: add.body.userId, tenantId: w.tenant._id, sessionId });
    await Session.create({ _id: sessionId, userId: add.body.userId, tenantId: w.tenant._id, refreshTokenHash: tokenService.hashToken(refreshToken), expiresAt: new Date(Date.now() + tokenService.REFRESH_TTL_MS) });
    return { id: add.body.userId, headers: { Authorization: `Bearer ${accessToken}`, 'x-tenant-slug': 'waiter-shop' } };
}
const visit = (table = '4') => TableSession.create({ tenantId: w.tenant._id, table, customers: [w.customer.user._id], status: 'open' });
const mk = (s, o = {}) => f.makeOrder(w.tenant, w.customer.user, {
    status: 'ready', orderType: 'dine_in', tableNo: s.table, tableSessionId: s._id, statusHistory: [{ status: 'placed' }, { status: 'accepted' }, { status: 'ready' }], ...o,
});
const overview = (who = waiter) => request(app).get('/api/staff/waiter/overview').set(who.headers);
const serve = (id, who = waiter) => request(app).post(`/api/staff/waiter/orders/${id}/serve`).set(who.headers);

describe('the floor', () => {
    test('ready dishes to serve, what is cooking, and the tables', async () => {
        const s4 = await visit('4');
        const s5 = await visit('5');
        await mk(s4);
        await mk(s4, { status: 'preparing' });
        await mk(s5, { status: 'placed' });
        const r = await overview();
        assert.equal(r.status, 200);
        assert.equal(r.body.serve.length, 1);
        assert.equal(r.body.serve[0].table, '4');
        assert.equal(r.body.counts.serve, 1);
        const t4 = r.body.tables.find((t) => t.table === '4');
        assert.equal(t4.ready, 1);
        assert.equal(t4.cooking, 1);
        assert.equal(r.body.tables.find((t) => t.table === '1').state, 'free');
        assert.ok(!/9000000030/.test(JSON.stringify(r.body)), 'no customer phone');
    });

    test('a call and a bill request are listed, oldest first', async () => {
        const s = await visit('3');
        await TableRequest.create({ tenantId: w.tenant._id, sessionId: s._id, table: '3', userId: w.customer.user._id, kind: 'water' });
        await TableSession.updateOne({ _id: s._id }, { $set: { status: 'bill_asked', billAskedAt: new Date() } });
        const r = await overview();
        assert.deepEqual(r.body.requests.map((x) => x.type).sort(), ['bill', 'call']);
        assert.equal(r.body.counts.bills, 1);
        assert.equal(r.body.tables.find((t) => t.table === '3').requests, 2);
    });

    test('a ready dish waiting longer than the shop allows is late', async () => {
        const s = await visit();
        await mk(s, { statusHistory: [{ status: 'ready', at: new Date(Date.now() - 12 * 60000) }] });
        const r = await overview();
        assert.equal(r.body.serve[0].late, true);
        assert.equal(r.body.counts.late, 1);
    });

    test('a cook and a customer cannot use the waiter routes; a waiter cannot use the kitchen', async () => {
        assert.equal((await overview(cook)).status, 403);
        assert.equal((await request(app).get('/api/staff/waiter/overview').set(w.customer.headers)).status, 403);
        assert.equal((await request(app).get('/api/staff/kitchen/orders').set(waiter.headers)).status, 403);
    });
});

describe('Served', () => {
    test('a ready dish is served, and it remembers who', async () => {
        const o = await mk(await visit());
        const r = await serve(o._id);
        assert.equal(r.status, 200);
        assert.equal(r.body.already, false);
        const fresh = await Order.findById(o._id);
        assert.equal(fresh.status, 'delivered');
        assert.equal(fresh.statusHistory[fresh.statusHistory.length - 1].byType, 'staff');
        assert.equal(fresh.statusHistory[fresh.statusHistory.length - 1].byLabel, 'Suresh');
        assert.equal((await overview()).body.serve.length, 0);
    });

    test('two waiters at the same moment: one serves, the other is told it is done', async () => {
        const second = await hire('waiter', '9333333333', 'Mahesh');
        const o = await mk(await visit());
        const both = await Promise.all([serve(o._id), serve(o._id, second)]);
        assert.ok(both.every((r) => r.status === 200), JSON.stringify(both.map((r) => r.body)));
        assert.equal(both.filter((r) => r.body.already === false).length, 1);
    });

    test('a dish still cooking, a cancelled one, and a pickup order cannot be served', async () => {
        const s = await visit();
        const cooking = await mk(s, { status: 'preparing' });
        assert.equal((await serve(cooking._id)).status, 409);
        const cancelled = await mk(s, { status: 'cancelled' });
        assert.equal((await serve(cancelled._id)).status, 409);
        const pickup = await mk(s, { orderType: 'pickup', tableNo: undefined, tableSessionId: undefined });
        assert.equal((await serve(pickup._id)).status, 404);
    });

    test('a waiter can do nothing else to an order', async () => {
        const o = await mk(await visit());
        const order = await Order.findById(o._id);
        const actor = { type: 'staff', role: 'waiter', id: waiter.id, label: 'Suresh' };
        await assert.rejects(() => orderStatus.change({ order, status: 'cancelled', actor, reasonCode: 'busy' }), /cannot make this change/);
        await assert.rejects(() => orderStatus.change({ order, status: 'preparing', actor }), /cannot make this change/);
        const delivery = await f.makeOrder(w.tenant, w.customer.user, { status: 'ready', orderType: 'delivery' });
        const dOrder = await Order.findById(delivery._id);
        await assert.rejects(() => orderStatus.change({ order: dOrder, status: 'delivered', actor }), /tables only/);
    });
});

describe('requests', () => {
    test('a call is done by a waiter, once', async () => {
        const s = await visit('3');
        const call = await TableRequest.create({ tenantId: w.tenant._id, sessionId: s._id, table: '3', userId: w.customer.user._id, kind: 'water' });
        const done = (who = waiter) => request(app).post(`/api/staff/waiter/requests/${call._id}/done`).set(who.headers);
        assert.equal((await done()).status, 200);
        const row = await TableRequest.findById(call._id);
        assert.equal(row.status, 'done');
        assert.equal(row.doneBy, 'staff');
        assert.equal(row.doneByName, 'Suresh');
        const again = await done();
        assert.equal(again.status, 200);
        assert.equal(again.body.already, true);
    });
});

describe('the bill', () => {
    test('a waiter sees the bill and takes the money; the visit is closed in their name', async () => {
        const s = await visit();
        await mk(s, { status: 'delivered', statusHistory: [{ status: 'delivered' }] });
        const bill = await request(app).get(`/api/staff/waiter/tables/${s._id}`).set(waiter.headers);
        assert.equal(bill.status, 200);
        assert.equal(bill.body.canSettle, true);
        assert.equal(bill.body.rounds.length, 1);
        assert.ok(!bill.body.guests && !JSON.stringify(bill.body).includes('9000000030'), 'no customer phone');
        const paid = await request(app).post(`/api/staff/waiter/tables/${s._id}/settle`).set(waiter.headers).send({ method: 'cash' });
        assert.equal(paid.status, 200);
        const closed = await TableSession.findById(s._id);
        assert.equal(closed.status, 'closed');
        assert.equal(closed.closedBy, 'staff');
        assert.equal(closed.closedByName, 'Suresh');
        assert.equal(closed.paidVia, 'cash');
        assert.equal((await request(app).post(`/api/staff/waiter/tables/${s._id}/settle`).set(waiter.headers).send({ method: 'cash' })).status, 404, 'a closed bill cannot be paid twice');
    });

    test('a dish not yet served stops the payment', async () => {
        const s = await visit();
        await mk(s);
        const r = await request(app).post(`/api/staff/waiter/tables/${s._id}/settle`).set(waiter.headers).send({ method: 'upi' });
        assert.equal(r.status, 409);
        assert.match(r.body.error, /Serve or cancel/);
        assert.equal((await TableSession.findById(s._id)).status, 'open');
    });

    test('when the owner keeps the money, a waiter can look but not take it', async () => {
        await setShop({ dine: { waiterSettles: false } });
        const s = await visit();
        await mk(s, { status: 'delivered', statusHistory: [{ status: 'delivered' }] });
        const bill = await request(app).get(`/api/staff/waiter/tables/${s._id}`).set(waiter.headers);
        assert.equal(bill.body.canSettle, false);
        assert.equal((await overview()).body.rules.canSettle, false);
        const r = await request(app).post(`/api/staff/waiter/tables/${s._id}/settle`).set(waiter.headers).send({ method: 'cash' });
        assert.equal(r.status, 403);
        assert.equal((await TableSession.findById(s._id)).status, 'open');
    });

    test('a bad method, a missing bill and a pickup bill are refused', async () => {
        const s = await visit();
        assert.equal((await request(app).post(`/api/staff/waiter/tables/${s._id}/settle`).set(waiter.headers).send({ method: 'card' })).status, 400);
        assert.equal((await request(app).get(`/api/staff/waiter/tables/${new mongoose.Types.ObjectId()}`).set(waiter.headers)).status, 404);
        const debt = await TableSession.create({ tenantId: w.tenant._id, table: 'Pickup #5', kind: 'pickup', customers: [w.customer.user._id], status: 'closed', walkout: true, owedPaise: 10000 });
        assert.equal((await request(app).get(`/api/staff/waiter/tables/${debt._id}`).set(waiter.headers)).status, 404);
    });
});

describe('alerts', () => {
    test('a ready dish rings the waiters, not the cooks', async () => {
        const spy = mock.method(pushChannel, 'send', async () => ({ sent: 1, tokens: 1 }));
        const s = await visit();
        const o = await mk(s, { status: 'preparing', statusHistory: [{ status: 'placed' }, { status: 'preparing' }] });
        await orderStatus.change({ order: await Order.findById(o._id), status: 'ready', actor: { type: 'staff', role: 'kitchen', id: cook.id, label: 'Ramesh' } });
        await f.waitFor(() => spy.mock.calls.some((c) => c.arguments[0].data?.type === 'waiter_serve'));
        const rings = spy.mock.calls.map((c) => c.arguments[0]).filter((a) => a.data?.type === 'waiter_serve');
        assert.equal(rings.length, 1);
        assert.equal(String(rings[0].userId), String(waiter.id));
        assert.match(rings[0].title, /Table 4/);
        assert.ok(!spy.mock.calls.some((c) => String(c.arguments[0].userId) === String(cook.id) && c.arguments[0].data?.type === 'waiter_serve'));
    });

    test('a guest calling the waiter or asking for the bill rings the waiters', async () => {
        const spy = mock.method(pushChannel, 'send', async () => ({ sent: 1, tokens: 1 }));
        const tenant = await Tenant.findById(w.tenant._id);
        await tableBill.callWaiter({ tenant, userId: w.customer.user._id, kind: 'water', table: '4' });
        await f.waitFor(() => spy.mock.calls.some((c) => c.arguments[0].data?.type === 'waiter_call'));
        const call = spy.mock.calls.map((c) => c.arguments[0]).find((a) => a.data?.type === 'waiter_call');
        assert.equal(String(call.userId), String(waiter.id));
        assert.match(call.body, /asked for water/);
        assert.match(call.data.speech, /^Table 4, .+ asked for water$/);   // who asked and for what, spoken
        assert.match(call.data.speechHi, /^टेबल 4, .+ ने पानी मांगा$/);

        const s = await visit('6');
        await tableBill.askForBill({ tenantId: w.tenant._id, userId: w.customer.user._id });
        await f.waitFor(() => spy.mock.calls.some((c) => c.arguments[0].data?.type === 'waiter_bill'));
        assert.ok(spy.mock.calls.some((c) => c.arguments[0].data?.type === 'waiter_bill' && c.arguments[0].data.table === s.table));

        // asking again is a reminder: refused inside a minute, rings again after it
        await assert.rejects(() => tableBill.askForBill({ tenantId: w.tenant._id, userId: w.customer.user._id }), (e) => e.status === 429);
        await TableSession.updateOne({ _id: s._id }, { $set: { billAskedAt: new Date(Date.now() - 120000) } });
        const before = spy.mock.calls.filter((c) => c.arguments[0].data?.type === 'waiter_bill').length;
        await tableBill.askForBill({ tenantId: w.tenant._id, userId: w.customer.user._id });
        await f.waitFor(() => spy.mock.calls.filter((c) => c.arguments[0].data?.type === 'waiter_bill').length > before);
    });

    test('a guest pressing "please hurry" rings the cooks', async () => {
        const spy = mock.method(pushChannel, 'send', async () => ({ sent: 1, tokens: 1 }));
        const s = await visit('7');
        await mk(s, { status: 'preparing', createdAt: new Date(Date.now() - 20 * 60000), statusHistory: [{ status: 'preparing' }] });
        await tableBill.nudge({ tenantId: w.tenant._id, userId: w.customer.user._id });
        await f.waitFor(() => spy.mock.calls.some((c) => c.arguments[0].data?.type === 'kitchen_hurry'));
        const hurry = spy.mock.calls.map((c) => c.arguments[0]).find((a) => a.data?.type === 'kitchen_hurry');
        assert.equal(String(hurry.userId), String(cook.id));
        assert.match(hurry.title, /Table 7/);
    });

    test('nobody is rung when the waiter screen is off', async () => {
        const spy = mock.method(pushChannel, 'send', async () => ({ sent: 1, tokens: 1 }));
        await setShop({ staff: { waiterOn: false } });
        const s = await visit();
        const o = await mk(s, { status: 'preparing', statusHistory: [{ status: 'preparing' }] });
        await orderStatus.change({ order: await Order.findById(o._id), status: 'ready', actor: { type: 'owner', id: w.owner.user._id, label: 'owner' } });
        await new Promise((r) => setTimeout(r, 300));
        assert.ok(!spy.mock.calls.some((c) => /waiter_/.test(c.arguments[0].data?.type || '')));
    });
});
