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
const tokenService = require('../src/services/tokenService');
const pushChannel = require('../src/notifications/channels/push');

// Undo for a mistaken tap: the cook, the waiter, the rider, the owner. Each step goes back one step, inside a time window, and never touches money.
let w; let cook; let waiter;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
    w = await f.makeWorld('undo-shop');
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.staff': { kitchenOn: true, waiterOn: true, max: 10 } } });
    tenantRecognizer.invalidateTenant('undo-shop');
    cook = await hire('kitchen', '9111111111', 'Ramesh');
    waiter = await hire('waiter', '9222222222', 'Suresh');
});
afterEach(() => mock.restoreAll());

async function hire(role, phone, name) {
    const add = await request(app).post('/api/shop/staff').set(w.owner.headers).send({ phone, name, role });
    assert.equal(add.status, 201, JSON.stringify(add.body));
    const sessionId = new mongoose.Types.ObjectId();
    const { accessToken, refreshToken } = tokenService.generateTokens({ userId: add.body.userId, tenantId: w.tenant._id, sessionId });
    await Session.create({ _id: sessionId, userId: add.body.userId, tenantId: w.tenant._id, refreshTokenHash: tokenService.hashToken(refreshToken), expiresAt: new Date(Date.now() + tokenService.REFRESH_TTL_MS) });
    return { id: add.body.userId, headers: { Authorization: `Bearer ${accessToken}`, 'x-tenant-slug': 'undo-shop' } };
}
const minsAgo = (m) => new Date(Date.now() - m * 60000);
const mk = (o = {}) => f.makeOrder(w.tenant, w.customer.user, { status: 'accepted', orderType: 'pickup', statusHistory: [{ status: 'accepted', at: minsAgo(1) }], ...o });
const undo = (who, id, path) => request(app).post(path.replace(':id', id)).set(who.headers);
const KITCHEN = '/api/staff/kitchen/orders/:id/undo';

describe('the cook', () => {
    test('undoes Start cooking: the order is waiting again, the cook mark is gone, and the history says so', async () => {
        const o = await mk({ status: 'preparing', statusHistory: [{ status: 'preparing', at: minsAgo(1) }], kitchen: { startedAt: minsAgo(1), startedByName: 'Ramesh' } });
        const r = await undo(cook, o._id, KITCHEN);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const fresh = await Order.findById(o._id);
        assert.equal(fresh.status, 'accepted');
        assert.equal(fresh.kitchen?.startedAt, undefined);
        assert.match(fresh.statusHistory.at(-1).note, /Undo: Start cooking/);
        assert.equal(fresh.statusHistory.at(-1).byLabel, 'Ramesh');
    });

    test('undoes Ready on a pickup (back to cooking) and on a delivery (the packed mark goes)', async () => {
        const p = await mk({ status: 'ready', statusHistory: [{ status: 'ready', at: minsAgo(1) }], kitchen: { startedAt: minsAgo(5), readyAt: minsAgo(1) } });
        assert.equal((await undo(cook, p._id, KITCHEN)).status, 200);
        const a = await Order.findById(p._id);
        assert.equal(a.status, 'preparing');
        assert.equal(a.kitchen?.readyAt, undefined);
        const d = await mk({ orderType: 'delivery', status: 'preparing', statusHistory: [{ status: 'preparing', at: minsAgo(6) }], kitchen: { startedAt: minsAgo(6), readyAt: minsAgo(1) } });
        assert.equal((await undo(cook, d._id, KITCHEN)).status, 200);
        const b = await Order.findById(d._id);
        assert.equal(b.status, 'preparing');
        assert.equal(b.kitchen?.readyAt, undefined);
        assert.ok(b.kitchen?.startedAt, 'still being cooked');
    });

    test('after 5 minutes it is too late for the cook, but the owner can still undo it', async () => {
        const o = await mk({ status: 'preparing', statusHistory: [{ status: 'preparing', at: minsAgo(12) }], kitchen: { startedAt: minsAgo(12) } });
        const late = await undo(cook, o._id, KITCHEN);
        assert.equal(late.status, 409);
        assert.match(late.body.error, /Too late/);
        const owner = await undo(w.owner, o._id, '/api/shop/orders/:id/undo');
        assert.equal(owner.status, 200, JSON.stringify(owner.body));
        assert.equal((await Order.findById(o._id)).status, 'accepted');
    });

    test('a cook cannot undo a served dish, and an order with nothing to undo says so', async () => {
        const o = await mk({ status: 'accepted' });
        assert.equal((await undo(cook, o._id, KITCHEN)).status, 409);
        const s = await mongoose.model('TableSession').create({ tenantId: w.tenant._id, table: '4', customers: [w.customer.user._id], status: 'open' });
        const served = await mk({ orderType: 'dine_in', tableNo: '4', tableSessionId: s._id, status: 'delivered', deliveredAt: minsAgo(1), statusHistory: [{ status: 'delivered', at: minsAgo(1) }] });
        assert.equal((await undo(cook, served._id, KITCHEN)).status, 403);
    });
});

describe('the waiter', () => {
    const WAITER = '/api/staff/waiter/orders/:id/undo';
    test('undoes Served on a dine in dish: it is ready to serve again; not after the table bill is closed', async () => {
        const s = await mongoose.model('TableSession').create({ tenantId: w.tenant._id, table: '4', customers: [w.customer.user._id], status: 'open' });
        const o = await mk({ orderType: 'dine_in', tableNo: '4', tableSessionId: s._id, status: 'delivered', deliveredAt: minsAgo(1), statusHistory: [{ status: 'delivered', at: minsAgo(1) }] });
        const r = await undo(waiter, o._id, WAITER);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const fresh = await Order.findById(o._id);
        assert.equal(fresh.status, 'ready');
        assert.equal(fresh.deliveredAt, undefined);

        await Order.updateOne({ _id: o._id }, { $set: { status: 'delivered', deliveredAt: minsAgo(1) } });
        await TableSession.updateOne({ _id: s._id }, { $set: { status: 'closed' } });
        const closed = await undo(waiter, o._id, WAITER);
        assert.equal(closed.status, 409);
        assert.match(closed.body.error, /already closed/);
    });

    test('a waiter cannot undo a cook\'s step', async () => {
        const o = await mk({ orderType: 'dine_in', tableNo: '4', status: 'ready', statusHistory: [{ status: 'ready', at: minsAgo(1) }], kitchen: { readyAt: minsAgo(1) } });
        assert.equal((await undo(waiter, o._id, WAITER)).status, 403);
    });
});

describe('the rider and the superadmin', () => {
    test('the rider undoes a mistaken pickup within 5 minutes; another rider cannot', async () => {
        const o = await mk({ orderType: 'delivery', status: 'out_for_delivery', statusHistory: [{ status: 'out_for_delivery', at: minsAgo(1) }], delivery: { riderId: w.rider.user._id, status: 'picked_up', pickedUpAt: minsAgo(1) } });
        const r = await request(app).post(`/api/rider/orders/${o._id}/undo-pickup`).set(w.rider.headers);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const fresh = await Order.findById(o._id);
        assert.equal(fresh.status, 'preparing');
        assert.equal(fresh.delivery.status, 'accepted');
        assert.equal(fresh.delivery.pickedUpAt, undefined);
    });

    test('a delivered delivery (cash, rider pay, points) cannot be undone by anyone', async () => {
        const o = await mk({ orderType: 'delivery', status: 'delivered', deliveredAt: minsAgo(1), statusHistory: [{ status: 'delivered', at: minsAgo(1) }], delivery: { riderId: w.rider.user._id, status: 'delivered' } });
        assert.equal((await undo(w.owner, o._id, '/api/shop/orders/:id/undo')).status, 409);
    });
});

describe('the owner decides about a problem the cook reported', () => {
    const Notification = require('../src/models/Notification');
    const solve = (id, body) => request(app).post(`/api/shop/orders/${id}/kitchen-problem`).set(w.owner.headers).send(body);
    const problem = async (o) => {
        const r = await request(app).post(`/api/staff/kitchen/orders/${o._id}/problem`).set(cook.headers).send({ kind: 'cannot_make' });
        assert.equal(r.status, 200, JSON.stringify(r.body));
    };

    test('"tell" sends the customer a polite note and marks it handled; a second answer is refused', async () => {
        const o = await mk({ status: 'preparing', statusHistory: [{ status: 'preparing', at: minsAgo(1) }], kitchen: { startedAt: minsAgo(1) } });
        await problem(o);
        const r = await solve(o._id, { action: 'tell' });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        await f.waitFor(async () => (await Notification.countDocuments({ tenantId: w.tenant._id, userId: w.customer.user._id, type: 'order_shop_note' })) === 1);
        const n = await Notification.findOne({ tenantId: w.tenant._id, type: 'order_shop_note' });
        assert.match(n.body, /Sorry/);
        assert.match(n.body, /patience/);
        assert.ok((await Order.findById(o._id)).kitchen.problem.handledAt);
        assert.equal((await solve(o._id, { action: 'tell' })).status, 409);
    });

    test('"cancel" cancels the order with a sorry note; an order with no problem cannot be answered', async () => {
        const o = await mk({ status: 'preparing', statusHistory: [{ status: 'preparing', at: minsAgo(1) }], kitchen: { startedAt: minsAgo(1) } });
        assert.equal((await solve(o._id, { action: 'cancel' })).status, 409, 'no problem reported yet');
        await problem(o);
        const r = await solve(o._id, { action: 'cancel' });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const fresh = await Order.findById(o._id);
        assert.equal(fresh.status, 'cancelled');
        assert.match(fresh.cancelReason, /Sorry/);
        assert.equal(fresh.cancel.reasonCode, 'out_of_stock');
    });
});

describe('the waiter shows a QR to pay', () => {
    const qr = (sid) => request(app).get(`/api/staff/waiter/tables/${sid}/pay-qr`).set(waiter.headers);
    const table = async () => {
        const s = await mongoose.model('TableSession').create({ tenantId: w.tenant._id, table: '4', customers: [w.customer.user._id], status: 'open' });
        await mk({ orderType: 'dine_in', tableNo: '4', tableSessionId: s._id, status: 'delivered', deliveredAt: minsAgo(1), pricing: { subtotal: 250, total: 250 }, statusHistory: [{ status: 'delivered', at: minsAgo(1) }] });
        return s;
    };
    test('with the shop\'s UPI id: a QR for the exact bill; without it: a clear "not set up"', async () => {
        const s = await table();
        const none = await qr(s._id);
        assert.equal(none.status, 200, JSON.stringify(none.body));
        assert.equal(none.body.available, false);
        assert.equal(none.body.reason, 'no_upi');

        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.dineIn': { enabled: true, tableCount: 10, upiId: 'savera@okaxis' } } });
        tenantRecognizer.invalidateTenant('undo-shop');
        const r = await qr(s._id);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.available, true);
        assert.match(r.body.image, /^data:image\/png;base64,/);
        assert.match(r.body.upiString, /^upi:\/\/pay\?pa=savera%40okaxis/);
        assert.match(r.body.upiString, /am=250\.00/);
    });
    test('the owner can keep money to himself: the waiter gets no QR, and a bad UPI id is refused', async () => {
        const s = await table();
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.dineIn': { enabled: true, tableCount: 10, upiId: 'savera@okaxis', waiterSettles: false } } });
        tenantRecognizer.invalidateTenant('undo-shop');
        assert.equal((await qr(s._id)).status, 403);
        const bad = await request(app).put('/api/shop/settings').set(w.owner.headers).send({ orders: { dineIn: { upiId: 'not a upi id' } } });
        assert.equal(bad.status, 400, JSON.stringify(bad.body));
    });
});

describe('working time: go live, hours and days off', () => {
    const duty = (who, method, path, body) => request(app)[method](`/api/staff/duty${path}`).set(who.headers).send(body);
    const ist = () => new Date(Date.now() + 330 * 60000);
    const today = () => ist().toISOString().slice(0, 10);
    const hhmm = (mins) => `${String(Math.floor(((mins % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((mins % 1440) + 1440) % 1440 % 60).padStart(2, '0')}`;
    const nowMins = () => ist().getUTCHours() * 60 + ist().getUTCMinutes();
    const acceptOne = async () => {
        const o = await f.makeOrder(w.tenant, w.customer.user, { status: 'placed', orderType: 'pickup' });
        const r = await request(app).patch(`/api/shop/orders/${o._id}/status`).set(w.owner.headers).send({ status: 'accepted' });
        assert.equal(r.status, 200, JSON.stringify(r.body));
    };
    const rungCook = (spy) => spy.mock.calls.some((c) => String(c.arguments[0].userId) === String(cook.id) && c.arguments[0].data?.type === 'kitchen_new');

    test('a cook who is off duty gets no push; going live brings it back', async () => {
        mock.restoreAll();
        const spy = mock.method(pushChannel, 'send', async () => ({ sent: 1, tokens: 1 }));
        assert.equal((await duty(cook, 'get', '')).body.onDuty, true, 'on duty by default');
        await acceptOne();
        await f.waitFor(async () => rungCook(spy));

        spy.mock.resetCalls();
        const off = await duty(cook, 'put', '', { online: false });
        assert.equal(off.status, 200, JSON.stringify(off.body));
        assert.equal(off.body.status, 'off');
        await acceptOne();
        await new Promise((r) => setTimeout(r, 500));
        assert.equal(rungCook(spy), false, 'off duty: not told');

        await duty(cook, 'put', '', { online: true });
        spy.mock.resetCalls();
        await acceptOne();
        await f.waitFor(async () => rungCook(spy));
    });

    test('auto hours decide: inside the hours the cook is on duty, outside he is not; a holiday today switches him off; the owner sees it', async () => {
        const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][ist().getUTCDay()];
        const inside = { [day]: { on: true, from: hhmm(nowMins() - 60), to: hhmm(nowMins() + 60) } };
        const outside = { [day]: { on: true, from: hhmm(nowMins() + 120), to: hhmm(nowMins() + 180) } };
        assert.equal((await duty(cook, 'put', '', { mode: 'auto', weekly: inside })).body.status, 'on');
        assert.equal((await duty(cook, 'put', '', { mode: 'auto', weekly: outside })).body.status, 'outside');
        assert.equal((await duty(cook, 'put', '', { mode: 'auto', weekly: inside })).body.status, 'on');

        const h = await duty(cook, 'post', '/holidays', { from: today(), to: today(), note: 'Family function' });
        assert.equal(h.status, 200, JSON.stringify(h.body));
        assert.equal(h.body.status, 'holiday');
        assert.equal(h.body.holidays.length, 1);
        const list = await request(app).get('/api/shop/staff').set(w.owner.headers);
        assert.equal(list.body.items.find((x) => x.name === 'Ramesh').duty, 'holiday');
        const gone = await duty(cook, 'delete', `/holidays/${h.body.holidays[0].id}`);
        assert.equal(gone.body.holidays.length, 0);
        assert.equal(gone.body.status, 'on');
    });

    test('bad times and bad days are refused', async () => {
        assert.equal((await duty(cook, 'put', '', { weekly: { mon: { on: true, from: '25:00', to: '10:00' } } })).status, 400);
        assert.equal((await duty(cook, 'put', '', { weekly: { mon: { on: true, from: '10:00', to: '10:00' } } })).status, 400);
        assert.equal((await duty(cook, 'post', '/holidays', { from: '2020-01-01', to: '2020-01-02' })).status, 400);
        assert.equal((await duty(cook, 'put', '', {})).status, 400);
    });
});

describe('a closed shop has nobody on duty', () => {
    const duty = (who, method, path, body) => request(app)[method](`/api/staff/duty${path}`).set(who.headers).send(body);
    const shut = async (set) => { await Tenant.updateOne({ _id: w.tenant._id }, { $set: set }); tenantRecognizer.invalidateTenant('undo-shop'); };

    test('when the owner pauses orders, the cook and the waiter are off duty and cannot go live, by hand or by the clock; they are back when it reopens', async () => {
        assert.equal((await duty(cook, 'get', '')).body.status, 'on');
        await shut({ 'settings.orders.acceptingOrders': false });
        for (const who of [cook, waiter]) {
            const d = await duty(who, 'get', '');
            assert.equal(d.body.status, 'shop_closed');
            assert.equal(d.body.onDuty, false);
            const live = await duty(who, 'put', '', { online: true });
            assert.equal(live.status, 409);
            assert.match(live.body.error, /shop is closed/);
        }
        // by the clock, with hours that cover now: still off
        const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(Date.now() + 330 * 60000).getUTCDay()];
        const all = { [day]: { on: true, from: '00:00', to: '23:59' } };
        assert.equal((await duty(cook, 'put', '', { mode: 'auto', weekly: all })).body.status, 'shop_closed');
        const list = await request(app).get('/api/shop/staff').set(w.owner.headers);
        assert.equal(list.body.items.find((x) => x.name === 'Ramesh').duty, 'shop_closed');
        assert.equal((await request(app).get('/api/staff/me').set(cook.headers)).body.onDuty, false);

        await shut({ 'settings.orders.acceptingOrders': true });
        assert.equal((await duty(cook, 'get', '')).body.status, 'on');
        assert.equal((await duty(waiter, 'put', '', { online: true })).status, 200);
    });

    test('a closed shop with orders still in hand keeps the cook and the waiter on duty to finish them; when the work is done they are off', async () => {
        mock.restoreAll();
        const spy = mock.method(pushChannel, 'send', async () => ({ sent: 1, tokens: 1 }));
        await shut({ 'settings.orders.acceptingOrders': false });
        assert.equal((await duty(cook, 'get', '')).body.status, 'shop_closed', 'no work: off');
        const o = await f.makeOrder(w.tenant, w.customer.user, { status: 'placed', orderType: 'pickup' });
        await request(app).patch(`/api/shop/orders/${o._id}/status`).set(w.owner.headers).send({ status: 'accepted' });
        const d = await duty(cook, 'get', '');
        assert.equal(d.body.status, 'on', 'an order is in hand');
        assert.equal(d.body.winding, true);
        assert.equal((await duty(waiter, 'get', '')).body.status, 'shop_closed', 'the waiter has no table work');
        await f.waitFor(async () => spy.mock.calls.some((c) => String(c.arguments[0].userId) === String(cook.id)));
        assert.equal(spy.mock.calls.some((c) => String(c.arguments[0].userId) === String(waiter.id)), false);
        await Order.updateOne({ _id: o._id }, { $set: { status: 'ready', 'kitchen.readyAt': new Date() } });
        assert.equal((await duty(cook, 'get', '')).body.status, 'shop_closed', 'the work is done');
    });
});

describe('leave the owner approves', () => {
    const duty = (who, method, path, body) => request(app)[method](`/api/staff/duty${path}`).set(who.headers).send(body);
    const ymd = (add = 0) => new Date(Date.now() + 330 * 60000 + add * 86400000).toISOString().slice(0, 10);
    const Notification = require('../src/models/Notification');

    test('the cook asks, the owner is told and approves; the days go in the calendar and cannot be removed by the cook; the cook is told', async () => {
        const ask = await duty(cook, 'post', '/leave', { from: ymd(0), to: ymd(1), reason: 'Family wedding' });
        assert.equal(ask.status, 201, JSON.stringify(ask.body));
        assert.equal(ask.body.leaves[0].status, 'pending');
        await f.waitFor(async () => (await Notification.countDocuments({ tenantId: w.tenant._id, type: 'staff_leave_request' })) === 1);
        assert.equal((await duty(cook, 'post', '/leave', { from: ymd(1), to: ymd(2), reason: 'Again' })).status, 409, 'overlaps a waiting leave');

        const list = await request(app).get('/api/shop/staff/leaves').set(w.owner.headers);
        assert.equal(list.body.pending.length, 1);
        assert.equal(list.body.pending[0].name, 'Ramesh');
        const decided = await request(app).post(`/api/shop/staff/leaves/${list.body.pending[0].id}`).set(w.owner.headers).send({ approve: true, note: 'Enjoy' });
        assert.equal(decided.status, 200, JSON.stringify(decided.body));
        assert.equal((await request(app).post(`/api/shop/staff/leaves/${list.body.pending[0].id}`).set(w.owner.headers).send({ approve: false })).status, 409, 'decided once');

        const v = await duty(cook, 'get', '');
        assert.equal(v.body.status, 'holiday', 'on leave today: off duty');
        assert.equal(v.body.holidays[0].leave, true);
        assert.equal(v.body.leaves[0].status, 'approved');
        const del = await duty(cook, 'delete', `/holidays/${v.body.holidays[0].id}`);
        assert.equal(del.body.holidays.length, 1, 'the cook cannot remove an approved leave');
        await f.waitFor(async () => (await Notification.countDocuments({ tenantId: w.tenant._id, userId: cook.id, type: 'staff_leave_decision' })) === 1);
        const n = await Notification.findOne({ tenantId: w.tenant._id, userId: cook.id, type: 'staff_leave_decision' });
        assert.match(n.title, /approved/);
    });

    test('the cook can cancel a waiting leave; a rejected one gives no days off; bad dates and no reason are refused', async () => {
        const a = await duty(cook, 'post', '/leave', { from: ymd(3), to: ymd(3), reason: 'Doctor' });
        assert.equal(a.status, 201);
        const cancelled = await duty(cook, 'post', `/leave/${a.body.leaves[0].id}/cancel`, {});
        assert.equal(cancelled.body.leaves[0].status, 'cancelled');
        const b = await duty(cook, 'post', '/leave', { from: ymd(0), to: ymd(0), reason: 'Tired' });
        await request(app).post(`/api/shop/staff/leaves/${b.body.leaves[0].id}`).set(w.owner.headers).send({ approve: false, note: 'Busy day' });
        const v = await duty(cook, 'get', '');
        assert.equal(v.body.status, 'on');
        assert.equal(v.body.holidays.length, 0);
        assert.equal((await duty(cook, 'post', '/leave', { from: '2020-01-01', to: '2020-01-01', reason: 'x' })).status, 400);
        assert.equal((await duty(cook, 'post', '/leave', { from: ymd(5), to: ymd(5), reason: '' })).status, 400);
        assert.equal((await duty(waiter, 'post', `/leave/${a.body.leaves[0].id}/cancel`, {})).status, 404, 'not his leave');
    });
});
