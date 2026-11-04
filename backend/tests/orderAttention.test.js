require('./helpers/env');
// Orders tab: "Needs attention" lists orders in trouble with the reason; "Live now" counts what each shop has running.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Order = require('../src/models/Order');

let token;
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); token = (await f.makeSuperAdmin('root@test.com')).token; });
const auth = () => ({ Authorization: 'Bearer ' + token });
const ago = (m) => new Date(Date.now() - m * 60000);

describe('orders attention and live', () => {
    test('lists stuck orders with a reason, urgent first, and ignores healthy ones', async () => {
        const w = await f.makeWorld('oa-' + Date.now().toString(36));
        const mk = async (patch) => { const o = await f.makeOrder(w.tenant, w.customer.user, {}); await Order.collection.updateOne({ _id: o._id }, { $set: patch }); return o; };
        const fresh = await mk({ status: 'placed', createdAt: ago(1) });
        const unaccepted = await mk({ status: 'placed', createdAt: ago(12) });
        const noRider = await mk({ status: 'ready', orderType: 'delivery', statusHistory: [{ status: 'ready', at: ago(20) }], createdAt: ago(40) });
        const slowCook = await mk({ status: 'preparing', statusHistory: [{ status: 'preparing', at: ago(90) }], createdAt: ago(100) });
        const refund = await mk({ status: 'cancelled', 'payment.method': 'upi', 'payment.status': 'paid', createdAt: ago(300) });
        const later = await mk({ status: 'placed', createdAt: ago(60), scheduledFor: new Date(Date.now() + 3600000) });

        const r = await request(app).get('/api/admin/orders/attention').set(auth());
        assert.equal(r.status, 200);
        const byNo = new Map(r.body.items.map((x) => [x.order.orderNo, x]));
        assert.equal(byNo.get(unaccepted.orderNo).code, 'not_accepted');
        assert.equal(byNo.get(noRider.orderNo).code, 'no_rider');
        assert.equal(byNo.get(slowCook.orderNo).code, 'cooking_long');
        assert.equal(byNo.get(refund.orderNo).code, 'refund_due');
        assert.ok(!byNo.has(fresh.orderNo), 'a one-minute-old order is fine');
        assert.ok(!byNo.has(later.orderNo), 'a booked-for-later order is not late');
        assert.equal(r.body.items[0].code, 'refund_due', 'money first');
        assert.equal(r.body.counts.total, 4);
        assert.ok(byNo.get(unaccepted.orderNo).order.shopName);
    });

    test('live: running orders per shop and today totals', async () => {
        const w = await f.makeWorld('ol-' + Date.now().toString(36));
        const a = await f.makeOrder(w.tenant, w.customer.user, {});
        const b = await f.makeOrder(w.tenant, w.customer.user, {});
        await Order.updateOne({ _id: b._id }, { $set: { status: 'preparing' } });
        const r = await request(app).get('/api/admin/orders/live').set(auth());
        assert.equal(r.status, 200);
        assert.equal(r.body.running, 2);
        assert.equal(r.body.shops.length, 1);
        assert.equal(r.body.shops[0].placed + r.body.shops[0].kitchen, 2);
        assert.equal(r.body.today.orders, 2);
        assert.ok(a);
    });

    test('refund queue lists the unfinished refunds and only a failed one can be sent again', async () => {
        const w = await f.makeWorld('or-' + Date.now().toString(36));
        const o = await f.makeOrder(w.tenant, w.customer.user, {});
        const OnlineRefund = require('../src/models/OnlineRefund');
        const mongoose = require('mongoose');
        const mk = (status, key) => OnlineRefund.create({ tenantId: w.tenant._id, orderId: o._id, paymentId: new mongoose.Types.ObjectId(), rzpPaymentId: 'pay_' + key, amountPaise: 25000, key, status, reason: 'shop_reject' });
        const failed = await mk('failed', 'k1');
        const done = await mk('processed', 'k2');
        const r = await request(app).get('/api/admin/refunds').set(auth());
        assert.equal(r.status, 200);
        assert.equal(r.body.items.length, 1);
        assert.equal(r.body.items[0].status, 'failed');
        assert.equal(r.body.open.failed.count, 1);
        assert.equal(r.body.items[0].orderNo, o.orderNo);
        const d = await request(app).get('/api/admin/refunds?status=done').set(auth());
        assert.equal(d.body.items.length, 1);
        const bad = await request(app).post('/api/admin/refunds/' + done._id + '/retry').set(auth());
        assert.equal(bad.status, 409);
        assert.ok(failed);
    });

    test('shop quality flags a shop that cancels too much, with the reason', async () => {
        const w = await f.makeWorld('oq-' + Date.now().toString(36));
        for (let i = 0; i < 12; i++) {
            const o = await f.makeOrder(w.tenant, w.customer.user, {});
            const patch = i < 3 ? { status: 'cancelled', cancelledBy: 'shop' } : { status: 'delivered', statusHistory: [{ status: 'accepted', at: ago(80) }, { status: 'ready', at: ago(30) }, { status: 'out_for_delivery', at: ago(25) }, { status: 'delivered', at: ago(5) }] };
            await Order.collection.updateOne({ _id: o._id }, { $set: patch });
        }
        const r = await request(app).get('/api/admin/orders/quality?days=7').set(auth());
        assert.equal(r.status, 200);
        const row = r.body.items[0];
        assert.equal(row.orders, 12);
        assert.equal(row.shopCancels, 3);
        assert.equal(row.shopCancelPct, 25);
        assert.equal(row.prepMin, 50);
        assert.equal(row.deliveryMin, 20);
        assert.equal(row.weak, true);
        assert.ok(row.why.some((x) => /cancelled 25%/.test(x)));
        assert.ok(row.why.some((x) => /50 min to prepare/.test(x)));
        assert.equal(r.body.weak, 1);
    });

    test('orders filter by type, and an order shows its complaint', async () => {
        const w = await f.makeWorld('ot-' + Date.now().toString(36));
        const a = await f.makeOrder(w.tenant, w.customer.user, {});
        const b = await f.makeOrder(w.tenant, w.customer.user, {});
        await Order.collection.updateOne({ _id: a._id }, { $set: { orderType: 'pickup' } });
        await Order.collection.updateOne({ _id: b._id }, { $set: { orderType: 'dine_in' } });
        const r = await request(app).get('/api/admin/orders?type=pickup').set(auth());
        assert.equal(r.body.items.length, 1);
        assert.equal(r.body.items[0].orderNo, a.orderNo);
        const bulk = await request(app).get('/api/admin/orders?type=bulk').set(auth());
        assert.equal(bulk.body.items.length, 0);
        const one = await request(app).get('/api/admin/orders/' + a._id).set(auth());
        assert.equal(one.status, 200);
        assert.equal(one.body.complaint, null);
    });

    test('the owner is told when the platform cancels or moves an order by hand', async () => {
        const Notification = require('../src/models/Notification');
        const w = await f.makeWorld('on-' + Date.now().toString(36));
        const o = await f.makeOrder(w.tenant, w.customer.user, {});
        const r = await request(app).patch('/api/admin/orders/' + o._id + '/status').set(auth()).send({ status: 'cancelled', note: 'Shop phone was off', reasonCode: 'platform' });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        await new Promise((ok) => setTimeout(ok, 400));
        const told = await Notification.find({ tenantId: w.tenant._id, type: 'order_by_platform' }).lean();
        assert.ok(told.length >= 1, 'the owner got a message');
        assert.match(told[0].title, /cancelled by the platform/);
    });

    test('the superadmin is told once when an order stays stuck long after the owner was told, and when a new order is never accepted', async () => {
        const Notification = require('../src/models/Notification');
        const { checkStuck } = require('../src/services/stuckOrders');
        const w = await f.makeWorld('es-' + Date.now().toString(36));
        const mk = async (patch) => { const o = await f.makeOrder(w.tenant, w.customer.user, {}); await Order.collection.updateOne({ _id: o._id }, { $set: patch }); return o; };
        const prep = await mk({ status: 'preparing', orderType: 'pickup', statusHistory: [{ status: 'preparing', at: ago(50) }], createdAt: ago(60) });
        const unaccepted = await mk({ status: 'placed', createdAt: ago(15) });
        const fresh = await mk({ status: 'placed', createdAt: ago(2) });
        const adminTold = () => Notification.find({ role: 'superadmin', type: 'admin_order_stuck' }).lean();

        await checkStuck(new Date());
        await new Promise((ok) => setTimeout(ok, 300));
        let told = await adminTold();
        assert.deepEqual([...new Set(told.map((n) => n.data.orderNo))], [unaccepted.orderNo], 'only the unaccepted order so far: the slow one is past the owner limit (45) but not the superadmin limit (90)');
        const first = told.length;

        await Order.collection.updateOne({ _id: prep._id }, { $set: { statusHistory: [{ status: 'preparing', at: ago(100) }] } });
        await checkStuck(new Date());
        await new Promise((ok) => setTimeout(ok, 300));
        told = await adminTold();
        const second = told.length;
        await checkStuck(new Date());   // another pass must not send anything again
        await new Promise((ok) => setTimeout(ok, 300));
        assert.equal((await adminTold()).length, second);
        assert.equal(second, first * 2, 'one more order alerted, once');
        assert.ok(told.some((n) => n.data.orderNo === prep.orderNo && n.data.stage === 'slow_prep'));
        assert.ok(!told.some((n) => n.data.orderNo === fresh.orderNo));
        assert.equal((await Order.findById(prep._id).lean()).stuck.stage, 'slow_prep', 'the owner mark is still there');
    });

    test('the limits can be read and changed, bad values are refused, and the new limit is used', async () => {
        const w = await f.makeWorld('ow-' + Date.now().toString(36));
        const o = await f.makeOrder(w.tenant, w.customer.user, {});
        await Order.collection.updateOne({ _id: o._id }, { $set: { status: 'placed', createdAt: ago(8) } });
        let r = await request(app).get('/api/admin/orders/watch-settings').set(auth());
        assert.equal(r.status, 200);
        assert.equal(r.body.values.attention.accept, 5);
        assert.equal((await request(app).get('/api/admin/orders/attention').set(auth())).body.counts.not_accepted, 1);

        r = await request(app).put('/api/admin/orders/watch-settings').set(auth()).send({ attention: { accept: 15 } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.values.attention.accept, 15);
        assert.equal((await request(app).get('/api/admin/orders/attention').set(auth())).body.counts.not_accepted, undefined, '8 minutes is now within the limit');

        assert.equal((await request(app).put('/api/admin/orders/watch-settings').set(auth()).send({ attention: { accept: 0 } })).status, 400);
        assert.equal((await request(app).put('/api/admin/orders/watch-settings').set(auth()).send({ nope: { x: 1 } })).status, 400);
        assert.equal((await request(app).put('/api/admin/orders/watch-settings').set(auth()).send({ talk: { prepMin: 'abc' } })).status, 400);

        r = await request(app).put('/api/admin/orders/watch-settings').set(auth()).send({ reset: true });
        assert.equal(r.body.values.attention.accept, 5);
    });
});
