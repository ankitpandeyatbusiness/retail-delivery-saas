require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Complaint = require('../src/models/Complaint');
const Order = require('../src/models/Order');
const Notification = require('../src/models/Notification');
const FeedEvent = require('../src/models/FeedEvent');
const refundService = require('../src/services/refundService');
const { runComplaintReminders } = require('../src/jobs/complaintReminders');
const center = require('../src/notifications/center');

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await Promise.all([Complaint.deleteMany({}), Notification.deleteMany({}), FeedEvent.deleteMany({})]); });
afterEach(() => { mock.restoreAll(); delete refundService.issueRefund; });

const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const body = (o = {}) => ({ type: 'missing_item', text: 'The raita was not in the bag', ...o });
const send = (w, orderId, b, who = 'customer') => request(app).post(`/api/orders/${orderId}/complaints`).set(w[who].headers).send(b);
const got = (tenantId, userId, type) => Notification.countDocuments({ tenantId, userId, type });

// a delivered ONLINE order: Rs 500 food + Rs 20 tip, paid
const delivered = (w, extra = {}) => f.makeOrder(w.tenant, w.customer.user, {
    status: 'delivered', deliveredAt: new Date(), pricing: { total: 520, tip: 20 },
    payment: { method: 'upi', status: 'paid' }, ...extra,
});

describe('customer complaint', () => {
    test('a delivered order can be complained about; the owner is told and the feed gets a line', async () => {
        const w = await f.makeWorld('cmp-1');
        const o = await delivered(w);
        const res = await send(w, o._id, body());
        assert.equal(res.status, 201);
        assert.equal(res.body.status, 'open');
        assert.equal(res.body.orderNo, o.orderNo);
        await f.waitFor(async () => (await got(w.tenant._id, w.owner.user._id, 'complaint_new')) === 1);
        await f.waitFor(async () => (await FeedEvent.countDocuments({ tenantId: w.tenant._id })) > 0);
    });

    test('an order that is not delivered, or was delivered over 24 hours ago, is refused', async () => {
        const w = await f.makeWorld('cmp-2');
        const live = await f.makeOrder(w.tenant, w.customer.user, { status: 'preparing' });
        assert.equal((await send(w, live._id, body())).status, 409);
        const old = await delivered(w, { deliveredAt: new Date(Date.now() - 25 * 3600 * 1000) });
        assert.equal((await send(w, old._id, body())).status, 409);
    });

    test('only one complaint per order', async () => {
        const w = await f.makeWorld('cmp-3');
        const o = await delivered(w);
        assert.equal((await send(w, o._id, body())).status, 201);
        assert.equal((await send(w, o._id, body({ text: 'again please' }))).status, 409);
        assert.equal(await Complaint.countDocuments({ orderId: o._id }), 1);
    });

    test('bad input, another customer, bad id and no login are refused', async () => {
        const w = await f.makeWorld('cmp-4');
        const other = await f.makeUser(w.tenant, 'customer', '9000000031');
        const o = await delivered(w);
        assert.equal((await send(w, o._id, body({ type: 'nonsense' }))).status, 400);
        assert.equal((await send(w, o._id, body({ text: 'x' }))).status, 400);
        assert.equal((await send(w, o._id, body({ photos: ['https://a/1', 'https://a/2', 'https://a/3', 'https://a/4'] }))).status, 400);
        assert.equal((await send(w, o._id, body({ photos: ['http://not-secure/x.jpg'] }))).status, 400);
        assert.equal((await send({ ...w, customer: other }, o._id, body())).status, 404);
        assert.equal((await send(w, 'abc', body())).status, 404);
        const { Authorization, authorization, ...noLogin } = w.customer.headers;
        assert.equal((await request(app).post(`/api/orders/${o._id}/complaints`).set(noLogin).send(body())).status, 401);
    });

    test('GET shows the complaint, or says the customer can still complain', async () => {
        const w = await f.makeWorld('cmp-5');
        const o = await delivered(w);
        const before1 = await request(app).get(`/api/orders/${o._id}/complaints`).set(w.customer.headers);
        assert.equal(before1.status, 200);
        assert.equal(before1.body.canComplain, true);
        assert.equal(before1.body.items.length, 0);
        await send(w, o._id, body());
        const after1 = await request(app).get(`/api/orders/${o._id}/complaints`).set(w.customer.headers);
        assert.equal(after1.body.canComplain, false);
        assert.equal(after1.body.items.length, 1);
    });
});

describe('owner decision', () => {
    const make = async (slug, extra) => {
        const w = await f.makeWorld(slug);
        const o = await delivered(w, extra);
        const c = (await send(w, o._id, body())).body;
        return { w, o, c };
    };
    const patch = (w, id, b) => request(app).patch(`/api/shop/complaints/${id}`).set(w.owner.headers).send(b);

    test('the list shows only his shop and filters by status; a bad status is 400', async () => {
        const { w } = await make('cmp-6');
        const x = await make('cmp-6b');
        const list = await request(app).get('/api/shop/complaints').set(w.owner.headers);
        assert.equal(list.status, 200);
        assert.equal(list.body.items.length, 1);
        assert.equal(String(list.body.items[0].id), String(x.c.id) === String(list.body.items[0].id) ? 'x' : String(list.body.items[0].id));
        assert.equal((await request(app).get('/api/shop/complaints?status=resolved').set(w.owner.headers)).body.items.length, 0);
        assert.equal((await request(app).get('/api/shop/complaints?status=bad').set(w.owner.headers)).status, 400);
    });

    test('a reply only moves it to in_progress; it needs text', async () => {
        const { w, c } = await make('cmp-7');
        assert.equal((await patch(w, c.id, {})).status, 400);
        const r = await patch(w, c.id, { ownerReply: 'We are checking.' });
        assert.equal(r.status, 200);
        assert.equal(r.body.status, 'in_progress');
        assert.equal(r.body.refundStatus, 'none');
    });

    test('full refund on a paid online order is the food only (tip stays); it waits for Phase 4', async () => {
        const { w, c } = await make('cmp-8');
        const r = await patch(w, c.id, { resolution: 'refund_full', ownerReply: 'Sorry!' });
        assert.equal(r.status, 200);
        assert.equal(r.body.status, 'resolved');
        assert.equal(r.body.refundPaise, 50000);
        assert.equal(r.body.refundStatus, 'pending');
        await f.waitFor(async () => (await got(w.tenant._id, w.customer.user._id, 'complaint_decision')) === 1);
    });

    test('when issueRefund exists the refund is made and marked done; a failure marks it failed', async () => {
        const a = await make('cmp-9');
        const calls = [];
        refundService.issueRefund = async (x) => { calls.push(x); return { ok: true }; };
        const r = await patch(a.w, a.c.id, { resolution: 'refund_partial', refundPaise: 10000 });
        assert.equal(r.body.refundStatus, 'done');
        assert.equal(calls.length, 1);
        assert.equal(calls[0].amountPaise, 10000);
        const b = await make('cmp-9b');
        refundService.issueRefund = async () => { throw new Error('gateway down'); };
        mock.method(console, 'error', () => { });
        assert.equal((await patch(b.w, b.c.id, { resolution: 'refund_full' })).body.refundStatus, 'failed');
    });

    test('a partial refund must be 1 paise up to the food total', async () => {
        const { w, c } = await make('cmp-10');
        assert.equal((await patch(w, c.id, { resolution: 'refund_partial' })).status, 400);
        assert.equal((await patch(w, c.id, { resolution: 'refund_partial', refundPaise: 50001 })).status, 400);
        assert.equal((await patch(w, c.id, { resolution: 'refund_partial', refundPaise: 0 })).status, 400);
        assert.equal((await patch(w, c.id, { resolution: 'refund_partial', refundPaise: 12.5 })).status, 400);
        assert.equal((await patch(w, c.id, { resolution: 'refund_partial', refundPaise: 5000 })).status, 200);
    });

    test('a COD order only records the decision', async () => {
        const { w, c } = await make('cmp-11', { payment: { method: 'cod', status: 'pending' }, pricing: { total: 300, tip: 0 } });
        const r = await patch(w, c.id, { resolution: 'refund_full' });
        assert.equal(r.body.refundPaise, 30000);
        assert.equal(r.body.refundStatus, 'noted');
    });

    test('no refund needs a reason; a decided complaint cannot be decided again', async () => {
        const { w, c } = await make('cmp-12');
        assert.equal((await patch(w, c.id, { resolution: 'no_refund' })).status, 400);
        assert.equal((await patch(w, c.id, { resolution: 'bogus', ownerReply: 'x' })).status, 400);
        const ok = await patch(w, c.id, { resolution: 'no_refund', ownerReply: 'The item was in the bill.' });
        assert.equal(ok.status, 200);
        assert.equal(ok.body.refundStatus, 'none');
        assert.equal((await patch(w, c.id, { resolution: 'refund_full' })).status, 409);
    });

    test('another shop cannot decide it; a bad id is 404', async () => {
        const { c } = await make('cmp-13');
        const w2 = await f.makeWorld('cmp-13b');
        assert.equal((await patch(w2, c.id, { ownerReply: 'hi' })).status, 404);
        assert.equal((await patch(w2, 'abc', { ownerReply: 'hi' })).status, 404);
    });
});

describe('reminder job and superadmin list', () => {
    test('an unanswered complaint older than 24 hours gets ONE reminder', async () => {
        const w = await f.makeWorld('cmp-14');
        const o = await delivered(w);
        const c = (await send(w, o._id, body())).body;
        assert.equal(await runComplaintReminders(), 0);                      // too new
        await Complaint.collection.updateOne({ _id: new mongoose.Types.ObjectId(String(c.id)) }, { $set: { createdAt: new Date(Date.now() - 25 * 3600 * 1000) } });
        assert.equal(await runComplaintReminders(), 1);
        assert.equal(await runComplaintReminders(), 0);                      // already reminded
        await f.waitFor(async () => (await got(w.tenant._id, w.owner.user._id, 'complaint_reminder')) === 1);
    });

    test('an answered complaint gets no reminder', async () => {
        const w = await f.makeWorld('cmp-15');
        const o = await delivered(w);
        const c = (await send(w, o._id, body())).body;
        await request(app).patch(`/api/shop/complaints/${c.id}`).set(w.owner.headers).send({ ownerReply: 'On it' });
        await Complaint.collection.updateOne({ _id: new mongoose.Types.ObjectId(String(c.id)) }, { $set: { createdAt: new Date(Date.now() - 30 * 3600 * 1000) } });
        assert.equal(await runComplaintReminders(), 0);
    });

    test('the superadmin sees complaints of all shops, can filter, and a login is needed', async () => {
        const a = await f.makeWorld('cmp-16');
        const b = await f.makeWorld('cmp-16b');
        await send(a, (await delivered(a))._id, body());
        await send(b, (await delivered(b))._id, body());
        const { token } = await f.makeSuperAdmin('cmp-admin@example.com');
        const all = await request(app).get('/api/admin/complaints').set(bearer(token));
        assert.equal(all.status, 200);
        assert.equal(all.body.items.length, 2);
        assert.ok(all.body.items.every((x) => x.shop));
        const one = await request(app).get(`/api/admin/complaints?tenantId=${a.tenant._id}`).set(bearer(token));
        assert.equal(one.body.items.length, 1);
        assert.equal((await request(app).get('/api/admin/complaints?tenantId=bad').set(bearer(token))).status, 400);
        assert.equal((await request(app).get('/api/admin/complaints')).status, 401);
    });

    test('the live picture counts the open complaints', async () => {
        const w = await f.makeWorld('cmp-17');
        await send(w, (await delivered(w))._id, body());
        const { token } = await f.makeSuperAdmin('cmp-admin2@example.com');
        const res = await request(app).get(`/api/admin/tenants/${w.tenant._id}/live`).set(bearer(token));
        assert.equal(res.body.openComplaints, 1);
    });
});

describe('low dish rating', () => {
    const rate = (w, orderId, pid, rating) => request(app).post(`/api/orders/${orderId}/rating`).set(w.customer.headers)
        .send({ ratings: [{ productId: String(pid), rating, comment: 'cold' }] });

    test('2 stars alerts the owner; 5 stars does not', async () => {
        const w = await f.makeWorld('cmp-18');
        const o = await delivered(w);
        const pid = new mongoose.Types.ObjectId();
        await Order.collection.updateOne({ _id: o._id }, { $set: { items: [{ productId: pid, name: 'Paneer' }] } });
        const spy = mock.method(center, 'notify', () => { });
        assert.equal((await rate(w, o._id, pid, 5)).status, 200);
        assert.equal(spy.mock.calls.filter((c) => c.arguments[0] === 'dish_low_rating').length, 0);
        assert.equal((await rate(w, o._id, pid, 2)).status, 200);
        const calls = spy.mock.calls.filter((c) => c.arguments[0] === 'dish_low_rating');
        assert.equal(calls.length, 1);
        assert.match(calls[0].arguments[1].body, /Paneer/);
    });
});