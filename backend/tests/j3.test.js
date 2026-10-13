require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeWorld } = require('./helpers/factory');
const Order = require('../src/models/Order');
const OnlinePayment = require('../src/models/OnlinePayment');
const OnlineRefund = require('../src/models/OnlineRefund');
const payments = require('../src/services/adapters/payments');
const paymentService = require('../src/services/paymentService');
const refundIssuer = require('../src/services/refundIssuer');
const orderService = require('../src/services/orderService');
const orderStatus = require('../src/services/orderStatusService');
const orderTimeout = require('../src/services/orderTimeout');
const reconcile = require('../src/services/paymentReconcile');

const MIN = 60000;
let seq = 9000;
const oid = () => new mongoose.Types.ObjectId();
const sign = (rzpOrderId, rzpPaymentId) => crypto.createHmac('sha256', paymentService.MOCK_SECRET).update(`${rzpOrderId}|${rzpPaymentId}`).digest('hex');
const mk = (w, over = {}) => Order.create({
    tenantId: w.tenant._id, userId: w.customer.user._id, orderNo: ++seq, orderType: 'pickup',
    items: [{ productId: oid(), name: 'Dal', quantity: 1, unitPrice: 100, lineTotal: 100 }],
    pricing: { subtotal: 100, total: 100 },   // Rs 100 = 10000 paise, no tip
    payment: { method: 'upi', status: 'pending' },
    ...over,
});
const capture = (id, rzpOrderId, amountPaise = 10000) => payments._mock.setPayment({
    id, orderId: rzpOrderId, status: 'captured', amountPaise, capturedPaise: amountPaise, refundedPaise: 0, method: 'upi', notes: {},
});
// a real paid online order: Razorpay order, captured payment, app check
async function paidOrder(w, over = {}) {
    const order = await mk(w, over);
    const start = await paymentService.startForOrder({ order });
    const payId = `pay_${order.orderNo}`;
    capture(payId, start.rzpOrderId);
    await paymentService.verifyFromApp({ order, rzpOrderId: start.rzpOrderId, rzpPaymentId: payId, signature: sign(start.rzpOrderId, payId) });
    return order;
}
const refundsOf = (order) => OnlineRefund.find({ orderId: order._id }).lean();
const cancelAsCustomer = (w, order) => orderService.cancelByCustomer({ tenant: w.tenant, userId: w.customer.user._id, orderId: order._id });
const ago = (min) => new Date(Date.now() - min * MIN);

describe('J3: refunds, reconcile and the shop money report', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(async () => { await db.clear(); payments._mock.reset(); });
    afterEach(() => mock.restoreAll());

    test('a customer cancel while preparing: the shop keeps half, the rest goes back once', async () => {
        const w = await makeWorld('j3-prep');
        const order = await paidOrder(w);
        await Order.updateOne({ _id: order._id }, { $set: { status: 'preparing' } });
        await cancelAsCustomer(w, order);
        const refunds = await refundsOf(order);
        assert.equal(refunds.length, 1);
        assert.equal(refunds[0].amountPaise, 5000);
        assert.equal(refunds[0].key, `order:${order._id}:cancel`);
        assert.equal(refunds[0].status, 'processed');
        assert.equal((await OnlinePayment.findOne({ orderId: order._id })).refundedPaise, 5000);
        assert.equal((await Order.findById(order._id)).payment.status, 'paid');   // the shop kept the other half
    });

    test('a free cancel gives everything back, and the order shows refunded', async () => {
        const w = await makeWorld('j3-free');
        const order = await paidOrder(w);
        await cancelAsCustomer(w, order);
        const refunds = await refundsOf(order);
        assert.equal(refunds.length, 1);
        assert.equal(refunds[0].amountPaise, 10000);
        assert.equal((await Order.findById(order._id)).payment.status, 'refunded');
    });

    test('cash orders and unpaid online orders have nothing to refund, and money that comes later still goes back', async () => {
        const w = await makeWorld('j3-nomoney');
        const cod = await mk(w, { payment: { method: 'cod', status: 'pending' } });
        await cancelAsCustomer(w, cod);
        const unpaid = await mk(w);
        const start = await paymentService.startForOrder({ order: unpaid });
        await cancelAsCustomer(w, unpaid);
        assert.equal(await OnlineRefund.countDocuments({}), 0);

        capture('pay_late3', start.rzpOrderId);   // the customer paid just after
        await paymentService.confirmCapture({
            payment: await OnlinePayment.findOne({ orderId: unpaid._id }), source: 'webhook',
            rzp: { id: 'pay_late3', orderId: start.rzpOrderId, status: 'captured', amountPaise: 10000, method: 'upi' },
        });
        const refunds = await refundsOf(unpaid);
        assert.equal(refunds.length, 1);
        assert.equal(refunds[0].amountPaise, 10000);
        assert.equal((await Order.findById(unpaid._id)).payment.status, 'refunded');
    });

    test('the shop never answered a paid online order: the timer cancels it and the full amount goes back', async () => {
        const w = await makeWorld('j3-timeout');
        const order = await paidOrder(w);
        await Order.collection.updateOne({ _id: order._id }, { $set: { createdAt: ago(30), 'payment.paidAt': ago(11) } });
        await orderTimeout.runOrderTimeout();
        assert.equal((await Order.findById(order._id)).cancel.reasonCode, 'not_accepted');
        const refunds = await refundsOf(order);
        assert.equal(refunds.length, 1);
        assert.equal(refunds[0].amountPaise, 10000);
    });

    test('not delivered: shop fault gives everything back, customer fault keeps the food', async () => {
        const w = await makeWorld('j3-undel');
        const owner = { type: 'owner', id: w.owner.user._id, label: 'owner' };
        const make = async () => {
            const o = await paidOrder(w);
            await Order.updateOne({ _id: o._id }, { $set: { orderType: 'delivery', status: 'out_for_delivery', 'delivery.problems': [{ at: ago(20), reason: 'no_answer' }] } });
            return Order.findById(o._id);
        };
        const shopFault = await make();
        await orderStatus.change({ order: shopFault, status: 'undelivered', actor: owner, reasonCode: 'shop' });
        const a = await refundsOf(shopFault);
        assert.equal(a.length, 1);
        assert.equal(a[0].amountPaise, 10000);
        assert.equal(a[0].key, `order:${shopFault._id}:undelivered`);

        const customerFault = await make();
        await orderStatus.change({ order: customerFault, status: 'undelivered', actor: owner, reasonCode: 'customer' });
        assert.equal((await refundsOf(customerFault)).length, 0);
    });

    test('a complaint refund uses the complaint as its key, so it can never go out twice', async () => {
        const w = await makeWorld('j3-complaint');
        const order = await paidOrder(w);
        const complaintId = oid();
        const args = { tenantId: w.tenant._id, orderId: order._id, amountPaise: 3000, reason: 'complaint', complaintId };
        const a = await refundIssuer.issueRefund(args);
        const b = await refundIssuer.issueRefund(args);
        assert.equal(a.ok, true);
        assert.equal(b.duplicate, true);
        const refunds = await refundsOf(order);
        assert.equal(refunds.length, 1);
        assert.equal(refunds[0].key, `complaint:${complaintId}`);
    });

    test('reconcile: a payment whose webhook never came is found at Razorpay and the order is paid', async () => {
        const w = await makeWorld('j3-missed');
        const order = await mk(w);
        const start = await paymentService.startForOrder({ order });
        capture('pay_missed', start.rzpOrderId);
        await OnlinePayment.collection.updateOne({ orderId: order._id }, { $set: { createdAt: ago(10) } });
        const r = await reconcile.runPaymentReconcile();
        assert.equal(r.missed, 1);
        assert.equal((await Order.findById(order._id)).payment.status, 'paid');
        assert.equal((await OnlinePayment.findOne({ orderId: order._id })).source, 'reconcile');
        const again = await reconcile.runPaymentReconcile();
        assert.equal(again.missed, 0);
    });

    test('reconcile: unpaid payments Razorpay never captured are left alone', async () => {
        const w = await makeWorld('j3-notpaid');
        const order = await mk(w);
        await paymentService.startForOrder({ order });
        await OnlinePayment.collection.updateOne({ orderId: order._id }, { $set: { createdAt: ago(10) } });
        const r = await reconcile.runPaymentReconcile();
        assert.equal(r.missed, 0);
        assert.equal((await Order.findById(order._id)).payment.status, 'pending');
    });

    test('reconcile: a crash between "captured" and "order paid" is repaired', async () => {
        const w = await makeWorld('j3-crash1');
        const order = await mk(w);
        await OnlinePayment.create({
            tenantId: w.tenant._id, orderId: order._id, rzpOrderId: 'order_x1', rzpPaymentId: 'pay_x1', amountPaise: 10000,
            status: 'captured', capturedPaise: 10000, capturedAt: ago(5),
        });
        const r = await reconcile.runPaymentReconcile();
        assert.equal(r.repaired, 1);
        assert.equal((await Order.findById(order._id)).payment.status, 'paid');
    });

    test('reconcile: a cancelled order whose refund was never made gets it, once', async () => {
        const w = await makeWorld('j3-crash2');
        const order = await mk(w, {
            status: 'cancelled', payment: { method: 'upi', status: 'paid' }, cancel: { by: 'customer', reasonCode: 'customer_cancel', keptPaise: 2000, refundPaise: 8000 },
        });
        await OnlinePayment.create({
            tenantId: w.tenant._id, orderId: order._id, rzpOrderId: 'order_x2', rzpPaymentId: 'pay_x2', amountPaise: 10000,
            status: 'captured', capturedPaise: 10000, capturedAt: ago(30),
        });
        const r = await reconcile.runPaymentReconcile();
        assert.equal(r.orderRefunds, 1);
        const refunds = await refundsOf(order);
        assert.equal(refunds.length, 1);
        assert.equal(refunds[0].amountPaise, 8000);
        await reconcile.runPaymentReconcile();
        assert.equal((await refundsOf(order)).length, 1);
    });

    test('reconcile: a refund that waited for the network is sent', async () => {
        const w = await makeWorld('j3-retry');
        const order = await paidOrder(w);
        mock.method(payments, 'refund', async () => { throw new Error('socket hang up'); });
        const r1 = await refundIssuer.issueRefund({ tenantId: w.tenant._id, orderId: order._id, amountPaise: 4000, reason: 'complaint', key: 'k-retry' });
        assert.equal(r1.pending, true);
        mock.restoreAll();
        await OnlineRefund.updateOne({ key: 'k-retry' }, { $set: { lastTryAt: ago(10) } });
        const r = await reconcile.runPaymentReconcile();
        assert.equal(r.retried, 1);
        assert.equal((await OnlineRefund.findOne({ key: 'k-retry' })).status, 'processed');
    });

    test('reconcile: refunds Razorpay accepted are closed as processed or failed, and a failed one gives its amount back', async () => {
        const w = await makeWorld('j3-close');
        const order = await paidOrder(w);
        const pay = await OnlinePayment.findOne({ orderId: order._id });
        const mkRefund = (key, amountPaise, rzpRefundId) => OnlineRefund.create({
            tenantId: w.tenant._id, orderId: order._id, paymentId: pay._id, rzpPaymentId: pay.rzpPaymentId,
            amountPaise, key, status: 'processing', rzpRefundId, attempts: 1,
        });
        const ok = await mkRefund('k-ok', 3000, 'rfnd_ok');
        const bad = await mkRefund('k-bad', 2000, 'rfnd_bad');
        await OnlinePayment.updateOne({ _id: pay._id }, { $set: { refundedPaise: 5000, refundIds: [ok._id, bad._id] } });
        await OnlineRefund.collection.updateMany({ _id: { $in: [ok._id, bad._id] } }, { $set: { updatedAt: ago(20) } });
        mock.method(payments, 'listRefunds', async () => [
            { id: 'rfnd_ok', status: 'processed', amountPaise: 3000, notes: {} },
            { id: 'rfnd_bad', status: 'failed', amountPaise: 2000, notes: {} },
        ]);
        const r = await reconcile.runPaymentReconcile();
        assert.equal(r.closed, 2);
        assert.equal((await OnlineRefund.findById(ok._id)).status, 'processed');
        assert.equal((await OnlineRefund.findById(bad._id)).status, 'failed');
        assert.equal((await OnlinePayment.findById(pay._id)).refundedPaise, 3000);
    });

    test('the shop money report and refund list: right numbers, his shop only, owner only', async () => {
        const w = await makeWorld('j3-report');
        const other = await makeWorld('j3-report-other');
        const a = await paidOrder(w);
        const b = await paidOrder(w);
        await cancelAsCustomer(w, b);   // 10000 came in twice, 10000 went back once
        void a;

        const rep = await request(app).get('/api/shop/payments/report').set(w.owner.headers);
        assert.equal(rep.status, 200);
        assert.equal(rep.body.captured.paise, 20000);
        assert.equal(rep.body.captured.count, 2);
        assert.equal(rep.body.refunded.paise, 10000);
        assert.equal(rep.body.netPaise, 10000);
        assert.equal(rep.body.refundsOnTheWay.count, 0);

        const list = await request(app).get('/api/shop/payments/refunds').set(w.owner.headers);
        assert.equal(list.body.items.length, 1);
        assert.equal(list.body.items[0].orderNo, b.orderNo);
        assert.equal(list.body.items[0].status, 'processed');
        assert.equal((await request(app).get('/api/shop/payments/refunds?status=failed').set(w.owner.headers)).body.items.length, 0);
        assert.equal((await request(app).get('/api/shop/payments/refunds?status=nope').set(w.owner.headers)).status, 400);
        assert.equal((await request(app).get('/api/shop/payments/report?from=2026-10-31&to=2026-10-01').set(w.owner.headers)).status, 400);

        const none = await request(app).get('/api/shop/payments/report').set(other.owner.headers);
        assert.equal(none.body.captured.paise, 0);
        assert.equal((await request(app).get('/api/shop/payments/refunds').set(other.owner.headers)).body.items.length, 0);
        assert.ok([401, 403].includes((await request(app).get('/api/shop/payments/report').set(w.customer.headers)).status));
    });
});