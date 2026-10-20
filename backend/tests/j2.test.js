require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeWorld, makeUser } = require('./helpers/factory');
const Order = require('../src/models/Order');
const OnlinePayment = require('../src/models/OnlinePayment');
const payments = require('../src/services/adapters/payments');
const paymentService = require('../src/services/paymentService');
const orderService = require('../src/services/orderService');
const orderStatus = require('../src/services/orderStatusService');
const orderTimeout = require('../src/services/orderTimeout');
const notify = require('../src/services/notificationService');
const center = require('../src/notifications/center');
const { onlineProblem } = require('../src/services/onlineOrder');

const MIN = 60000;
let seq = 5000;
const sign = (rzpOrderId, rzpPaymentId) => crypto.createHmac('sha256', paymentService.MOCK_SECRET).update(`${rzpOrderId}|${rzpPaymentId}`).digest('hex');
const mk = (w, over = {}) => Order.create({
    tenantId: w.tenant._id, userId: w.customer.user._id, orderNo: ++seq, orderType: 'pickup',
    items: [{ productId: new mongoose.Types.ObjectId(), name: 'Dal', quantity: 1, unitPrice: 100, lineTotal: 100 }],
    pricing: { subtotal: 100, total: 100 },
    payment: { method: 'upi', status: 'pending' },
    ...over,
});
const age = (order, minutes, extra = {}) => Order.collection.updateOne(
    { _id: order._id }, { $set: { createdAt: new Date(Date.now() - minutes * MIN), ...extra } },
);
const capture = (id, rzpOrderId) => payments._mock.setPayment({
    id, orderId: rzpOrderId, status: 'captured', amountPaise: 10000, capturedPaise: 10000, refundedPaise: 0, method: 'upi', notes: {},
});
// pay an order through the services (the app check path)
async function pay(order, payId = `pay_${order.orderNo}`) {
    const start = await paymentService.startForOrder({ order });
    capture(payId, start.rzpOrderId);
    return paymentService.verifyFromApp({ order, rzpOrderId: start.rzpOrderId, rzpPaymentId: payId, signature: sign(start.rzpOrderId, payId) });
}

describe('J2: online order flow', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(async () => { await db.clear(); payments._mock.reset(); });
    afterEach(() => mock.restoreAll());

    test('payment-config tells the app that UPI and card are available', async () => {
        const w = await makeWorld('j2-config');
        const r = await request(app).get('/api/orders/payment-config').set(w.customer.headers);
        assert.equal(r.status, 200);
        assert.equal(r.body.online, true);
        assert.deepEqual(r.body.methods, ['upi', 'card']);
    });

    test('the customer starts and verifies a payment through the routes, and only for his own order', async () => {
        const w = await makeWorld('j2-routes');
        const other = await makeUser(w.tenant, 'customer', '9000000077');
        const order = await mk(w);
        assert.equal((await request(app).post(`/api/orders/${order._id}/pay`).set(other.headers)).status, 404);

        const start = await request(app).post(`/api/orders/${order._id}/pay`).set(w.customer.headers);
        assert.equal(start.status, 200);
        assert.equal(start.body.amountPaise, 10000);
        capture('pay_route', start.body.rzpOrderId);

        const bad = await request(app).post(`/api/orders/${order._id}/pay/verify`).set(w.customer.headers)
            .send({ razorpay_order_id: start.body.rzpOrderId, razorpay_payment_id: 'pay_route', razorpay_signature: 'wrong' });
        assert.equal(bad.status, 400);
        assert.equal((await request(app).post(`/api/orders/${order._id}/pay/verify`).set(w.customer.headers).send({})).status, 400);

        const ok = await request(app).post(`/api/orders/${order._id}/pay/verify`).set(w.customer.headers)
            .send({ razorpay_order_id: start.body.rzpOrderId, razorpay_payment_id: 'pay_route', razorpay_signature: sign(start.body.rzpOrderId, 'pay_route') });
        assert.equal(ok.status, 200);
        assert.equal(ok.body.paid, true);
        assert.equal(ok.body.order.payment.status, 'paid');

        // paid already: no second payment
        assert.equal((await request(app).post(`/api/orders/${order._id}/pay`).set(w.customer.headers)).status, 409);
    });

    test('a cancelled order can no longer be paid', async () => {
        const w = await makeWorld('j2-cancelled');
        const order = await mk(w, { status: 'cancelled' });
        const r = await request(app).post(`/api/orders/${order._id}/pay`).set(w.customer.headers);
        assert.equal(r.status, 409);
    });

    test('the owner does not see, count or accept an unpaid online order, and sees it once it is paid', async () => {
        const w = await makeWorld('j2-owner');
        const online = await mk(w);
        const cod = await mk(w, { payment: { method: 'cod', status: 'pending' } });

        const list = await request(app).get('/api/shop/orders').set(w.owner.headers);
        assert.equal(list.status, 200);
        assert.deepEqual(list.body.items.map((o) => o.orderNo), [cod.orderNo]);
        assert.equal(list.body.counts.placed, 1);
        assert.equal((await request(app).get(`/api/shop/orders/${online._id}`).set(w.owner.headers)).status, 404);
        const live = await request(app).get('/api/shop/live').set(w.owner.headers);
        assert.equal(live.body.orders.active.placed, 1);
        const tryAccept = await request(app).patch(`/api/shop/orders/${online._id}/status`).set(w.owner.headers).send({ status: 'accepted' });
        assert.equal(tryAccept.status, 409);
        assert.equal((await Order.findById(online._id)).status, 'placed');

        await pay(online);
        const after = await request(app).get('/api/shop/orders').set(w.owner.headers);
        assert.equal(after.body.items.length, 2);
        assert.equal(after.body.counts.placed, 2);
        assert.equal((await request(app).get(`/api/shop/orders/${online._id}`).set(w.owner.headers)).status, 200);
        const accept = await request(app).patch(`/api/shop/orders/${online._id}/status`).set(w.owner.headers).send({ status: 'accepted' });
        assert.equal(accept.status, 200);
    });

    test('the owner is alerted about an online order only when it is paid, and only once', async () => {
        const w = await makeWorld('j2-alert');
        const spy = mock.method(notify, 'orderPlaced', () => { });
        const order = await mk(w);
        await paymentService.startForOrder({ order });
        assert.equal(spy.mock.callCount(), 0);
        await pay(order);
        await new Promise((r) => setTimeout(r, 300));   // the owner is told a moment after the payment (afterPlaced reads the shop first)
        assert.equal(spy.mock.callCount(), 1);
        // the same payment confirmed again (the app check and the webhook both arrive)
        const row = await OnlinePayment.findOne({ orderId: order._id });
        await paymentService.confirmCapture({
            payment: row, source: 'webhook',
            rzp: { id: row.rzpPaymentId, orderId: row.rzpOrderId, status: 'captured', amountPaise: 10000, method: 'upi' },
        });
        await new Promise((r) => setTimeout(r, 300));
        assert.equal(spy.mock.callCount(), 1);
    });

    test('money that arrives for a cancelled order does not alert the owner', async () => {
        const w = await makeWorld('j2-late');
        const spy = mock.method(notify, 'orderPlaced', () => { });
        const order = await mk(w);
        const start = await paymentService.startForOrder({ order });
        await Order.updateOne({ _id: order._id }, { $set: { status: 'cancelled', cancel: { by: 'system', reasonCode: 'payment_timeout', keptPaise: 0, refundPaise: 0 } } });
        capture('pay_l', start.rzpOrderId);
        await paymentService.confirmCapture({
            payment: await OnlinePayment.findOne({ orderId: order._id }), source: 'webhook',
            rzp: { id: 'pay_l', orderId: start.rzpOrderId, status: 'captured', amountPaise: 10000, method: 'upi' },
        });
        assert.equal(spy.mock.callCount(), 0);
    });

    test('timers: unpaid online orders are cancelled after 15 minutes, and the shop waiting time starts at payment', async () => {
        const w = await makeWorld('j2-timers');
        const unpaidOld = await mk(w);          // 16 min, never paid
        const unpaidNew = await mk(w);          // 5 min, still has time
        const codOld = await mk(w, { payment: { method: 'cod', status: 'pending' } });   // 12 min, shop did not answer
        const paidRecent = await mk(w, { payment: { method: 'upi', status: 'paid' } });  // created 30 min ago, paid 2 min ago
        const paidOld = await mk(w, { payment: { method: 'upi', status: 'paid' } });     // paid 11 min ago, shop did not answer
        await age(unpaidOld, 16);
        await age(unpaidNew, 5);
        await age(codOld, 12);
        await age(paidRecent, 30, { 'payment.paidAt': new Date(Date.now() - 2 * MIN) });
        await age(paidOld, 30, { 'payment.paidAt': new Date(Date.now() - 11 * MIN) });

        const r = await orderTimeout.runOrderTimeout();
        assert.equal(r.cancelled, 3);   // 1 unpaid online order + 2 the shop never answered

        const a = await Order.findById(unpaidOld._id);
        assert.equal(a.status, 'cancelled');
        assert.equal(a.cancel.reasonCode, 'payment_timeout');
        assert.equal(a.cancelledBy, 'system');
        assert.equal(a.cancel.refundPaise, 0);
        assert.equal((await Order.findById(unpaidNew._id)).status, 'placed');
        assert.equal((await Order.findById(codOld._id)).cancel.reasonCode, 'not_accepted');
        assert.equal((await Order.findById(paidRecent._id)).status, 'placed');
        const p = await Order.findById(paidOld._id);
        assert.equal(p.cancel.reasonCode, 'not_accepted');
        assert.equal(p.cancel.refundPaise, 10000);   // paid, the shop never answered: full refund
    });

    test('a payment that lands while the timer cancels the order is never lost', async () => {
        const w = await makeWorld('j2-race');
        const order = await mk(w);
        const stale = await Order.findById(order._id);   // what the timer read
        await Order.updateOne({ _id: order._id }, { $set: { 'payment.status': 'paid' } });   // the money arrives
        await assert.rejects(
            orderStatus.change({ order: stale, status: 'cancelled', actor: { type: 'system' }, reasonCode: 'payment_timeout' }),
            (e) => e.status === 409,
        );
        assert.equal((await Order.findById(order._id)).status, 'placed');
    });

    test('cancelling an unpaid online order does not tell the owner, cancelling a paid one does', async () => {
        const w = await makeWorld('j2-cancel-notify');
        const calls = [];
        mock.method(center, 'notify', (event, ctx) => { calls.push({ event, ctx }); });
        const unpaid = await mk(w);
        await orderService.cancelByCustomer({ tenant: w.tenant, userId: w.customer.user._id, orderId: unpaid._id });
        assert.equal(calls.filter((c) => c.event === 'order_cancelled').length, 0);
        const paid = await mk(w, { payment: { method: 'upi', status: 'paid' } });
        await orderService.cancelByCustomer({ tenant: w.tenant, userId: w.customer.user._id, orderId: paid._id });
        assert.ok(calls.filter((c) => c.event === 'order_cancelled').length >= 1);
        assert.equal((await Order.findById(paid._id)).cancel.refundPaise, 10000);
    });

    test('placing an online order: UPI and card, and only when the shop can take money', () => {
        assert.equal(onlineProblem('cod', null), null);
        assert.equal(onlineProblem('upi', { ok: true }), null);
        assert.equal(onlineProblem('upi', { ok: false, reason: 'x' }).status, 409);
        assert.equal(onlineProblem('upi', null).status, 409);
        assert.equal(onlineProblem('card', { ok: true }), null);
        assert.equal(onlineProblem('card', { ok: false, reason: 'x' }).status, 409);
        assert.equal(onlineProblem('wallet', { ok: true }).status, 400);   // wallet is not offered yet
    });
});