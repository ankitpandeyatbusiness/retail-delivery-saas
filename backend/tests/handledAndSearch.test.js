require('./helpers/env');
// "Handled by hand" marks with a 10 minute undo (Money and Orders attention), and the two search boxes.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const OnlineRefund = require('../src/models/OnlineRefund');
const HandledMark = require('../src/models/HandledMark');
const { paidPlan } = require('./helpers/planPay');
const Order = require('../src/models/Order');

let token;
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); token = (await f.makeSuperAdmin('root@test.com')).token; });
const auth = () => ({ Authorization: 'Bearer ' + token });
const get = (url) => request(app).get(url).set(auth());
const post = (url, body) => request(app).post(url).set(auth()).send(body || {});

async function failedRefund(w) {
    const o = await f.makeOrder(w.tenant, w.customer.user, {});
    return OnlineRefund.create({ tenantId: w.tenant._id, orderId: o._id, paymentId: new mongoose.Types.ObjectId(), rzpPaymentId: 'pay_x1', amountPaise: 33900, key: 'hk-' + Math.random(), status: 'failed', lastError: 'The payment id is invalid' });
}

describe('handled by hand', () => {
    test('a failed refund shows its reason, can be marked handled, leaves the count, and can be taken back', async () => {
        const w = await f.makeWorld('hm-' + Date.now().toString(36));
        const r = await failedRefund(w);
        let a = (await get('/api/admin/finance/attention')).body;
        assert.equal(a.items.find((i) => i.key === 'refunds_failed').count, 1);

        let list = (await get('/api/admin/finance/attention/refunds_failed')).body;
        assert.equal(list.open.length, 1);
        assert.match(list.open[0].detail, /invalid/);
        assert.equal(list.open[0].paise, 33900);

        const m = await post('/api/admin/handled', { kind: 'refund_failed', refId: String(r._id), note: 'Refunded from the Razorpay dashboard', title: 'Refund 339' });
        assert.equal(m.status, 201);
        assert.ok(m.body.undoLeftSec > 500);
        assert.ok(!(await get('/api/admin/finance/attention')).body.items.find((i) => i.key === 'refunds_failed'));
        list = (await get('/api/admin/finance/attention/refunds_failed')).body;
        assert.equal(list.open.length, 0);
        assert.equal(list.handled.length, 1);
        assert.equal(list.handled[0].mark.note, 'Refunded from the Razorpay dashboard');
        // the refund itself is untouched
        assert.equal((await OnlineRefund.findById(r._id)).status, 'failed');

        const u = await post(`/api/admin/handled/${m.body.id}/undo`);
        assert.equal(u.status, 200);
        assert.equal((await get('/api/admin/finance/attention')).body.items.find((i) => i.key === 'refunds_failed').count, 1);
    });

    test('marking twice does nothing more, and after 10 minutes it cannot be taken back', async () => {
        const w = await f.makeWorld('hm2-' + Date.now().toString(36));
        const r = await failedRefund(w);
        const a = await post('/api/admin/handled', { kind: 'refund_failed', refId: String(r._id) });
        const b = await post('/api/admin/handled', { kind: 'refund_failed', refId: String(r._id) });
        assert.equal(a.body.id, b.body.id);
        assert.equal(await HandledMark.countDocuments(), 1);
        await HandledMark.collection.updateOne({ _id: new mongoose.Types.ObjectId(a.body.id) }, { $set: { createdAt: new Date(Date.now() - 11 * 60000) } });
        const u = await post(`/api/admin/handled/${a.body.id}/undo`);
        assert.equal(u.status, 409);
        assert.match(u.body.message || u.body.error || '', /10 minutes/);
    });

    test('an unknown list is refused', async () => {
        assert.equal((await post('/api/admin/handled', { kind: 'nonsense', refId: 'x' })).status, 400);
        assert.equal((await get('/api/admin/finance/attention/nonsense')).status, 404);
    });

    test('an order problem can be marked handled and leaves the Orders attention list', async () => {
        const w = await f.makeWorld('hm3-' + Date.now().toString(36));
        const o = await f.makeOrder(w.tenant, w.customer.user, { status: 'placed' });
        await Order.collection.updateOne({ _id: o._id }, { $set: { createdAt: new Date(Date.now() - 3 * 3600000) } });
        let a = (await get('/api/admin/orders/attention')).body;
        assert.equal(a.items.length, 1);
        const m = await post('/api/admin/handled', { kind: 'order_problem', refId: a.items[0].refId, note: 'Called the shop' });
        assert.equal(m.status, 201);
        a = (await get('/api/admin/orders/attention')).body;
        assert.equal(a.items.length, 0);
        assert.equal(a.handled.length, 1);
        await post(`/api/admin/handled/${m.body.id}/undo`);
        assert.equal((await get('/api/admin/orders/attention')).body.items.length, 1);
    });
});

describe('order search', () => {
    test('several words in any order, by status, shop, customer, dish, amount and reference', async () => {
        const w = await f.makeWorld('os-' + Date.now().toString(36));
        const o = await f.makeOrder(w.tenant, w.customer.user, { status: 'delivered' });
        const one = (await Order.findById(o._id)).toObject();
        const q = async (s) => (await get('/api/admin/orders').query({ q: s })).body.items.map((x) => String(x.id));
        assert.deepEqual(await q(String(one.orderNo)), [String(o._id)]);
        assert.deepEqual(await q('delivered'), [String(o._id)]);
        assert.deepEqual(await q('cancelled'), []);
        assert.deepEqual(await q(`${w.tenant.name.split(' ')[0]} delivered`), [String(o._id)]);
        assert.deepEqual(await q(`delivered ${w.tenant.name.split(' ')[0]}`), [String(o._id)]);
        assert.deepEqual(await q(one.items[0].name.split(' ')[0]), [String(o._id)]);
        assert.deepEqual(await q(String(one.pricing.total)), [String(o._id)]);
        if (one.ref) assert.deepEqual(await q(one.ref), [String(o._id)]);
        assert.deepEqual(await q('zzzznothing'), []);
    });
});

describe('money search', () => {
    test('finds a bill by number, shop and amount, a refund by its Razorpay id, and needs 2 characters', async () => {
        const w = await f.makeWorld('ms-' + Date.now().toString(36));
        const inv = await paidPlan(w.tenant._id, { baseRs: 1000, invoiceNo: 'MS/2026/0007' });
        const r = await failedRefund(w);
        const s = async (x) => (await get('/api/admin/finance/search').query({ q: x })).body;
        let b = await s('MS/2026/0007');
        assert.equal(b.groups.find((g) => g.key === 'invoices').items[0].id, String(inv._id));
        b = await s('1180 paid');
        assert.equal(b.groups.find((g) => g.key === 'invoices').items.length, 1);
        b = await s('1180 held');
        assert.ok(!b.groups.find((g) => g.key === 'invoices'));
        b = await s('pay_x1 failed');
        assert.equal(b.groups.find((g) => g.key === 'refunds').items[0].id, String(r._id));
        b = await s('339');
        assert.ok(b.groups.find((g) => g.key === 'refunds'));
        assert.equal((await get('/api/admin/finance/search').query({ q: 'a' })).status, 400);
    });
});
