require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeWorld, makeUser, waitFor } = require('./helpers/factory');
const Category = require('../src/models/Category');
const Product = require('../src/models/Product');
const BulkOrder = require('../src/models/BulkOrder');
const BulkPayment = require('../src/models/BulkPayment');
const Notification = require('../src/models/Notification');
const pushChannel = require('../src/notifications/channels/push');
const adminAlerts = require('../src/services/adminAlerts');
const notificationService = require('../src/services/notificationService');
const payments = require('../src/services/adapters/payments');
const paymentService = require('../src/services/paymentService');
const bulkPayment = require('../src/services/bulkPayment');
const bulkOrders = require('../src/services/bulkOrders');
const reconcile = require('../src/services/paymentReconcile');
const razorpayWebhook = require('../src/services/razorpayWebhook');

// The advance of a bulk order: a quote of Rs 10000, 50 % advance = Rs 5000 (500000 paise).
const sign = (orderId, paymentId) => crypto.createHmac('sha256', paymentService.MOCK_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
const days = (n) => new Date(Date.now() + n * 86400000).toISOString();
const ADVANCE = 500000;
let n = 0; let payN = 0;

describe('bulk order advance: paying, refunds, safety', () => {
    let w; let id; let alerts;
    const owner = (m, p, b) => request(app)[m](`/api/shop/bulk${p}`).set(w.owner.headers).send(b);
    const cust = (m, p, b, h = w.customer.headers) => request(app)[m](`/api/bulk${p}`).set(h).send(b);

    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(async () => {
        await db.clear();
        payments._mock.reset();
        mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
        alerts = [];
        mock.method(adminAlerts, 'alert', async (key, opts) => { alerts.push({ key, ...opts }); });
        w = await makeWorld(`bulkpay-${++n}`);
        const cat = await Category.create({ tenantId: w.tenant._id, name: 'Main', isActive: true });
        const dish = await Product.create({ tenantId: w.tenant._id, categoryId: cat._id, name: 'Dal', price: 100, isVeg: true, isActive: true });
        await owner('put', '/settings', { enabled: true, noticeHours: 1, advancePercent: 50, fullRefundHours: 48 });
        const r = await cust('post', '/', { fulfilment: 'pickup', when: days(5), items: [{ productId: String(dish._id), quantity: 100 }], contact: { name: 'Raj', phone: '9000000051' } });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        id = r.body.id;
        await quote();
    });
    afterEach(() => mock.restoreAll());

    async function quote() {
        const o = (await owner('get', `/${id}`)).body;
        const q = await owner('post', `/${id}/quote`, { lines: o.lines.map((l) => ({ id: l.id, unitPrice: l.unitPrice })) });
        assert.equal(q.status, 200, JSON.stringify(q.body));
        assert.equal(q.body.quote.advancePaise, ADVANCE);
        return q.body;
    }
    const start = async () => { const r = await cust('post', `/${id}/pay`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
    const capture = (pay, amountPaise = pay.amountPaise) => {
        const pid = `pay_bulk_${++payN}`;
        payments._mock.setPayment({ id: pid, orderId: pay.rzpOrderId, status: 'captured', amountPaise, capturedPaise: amountPaise, refundedPaise: 0, method: 'upi', notes: {} });
        return pid;
    };
    const verify = (pay, pid, h = w.customer.headers) => cust('post', `/${id}/verify`, { razorpay_order_id: pay.rzpOrderId, razorpay_payment_id: pid, razorpay_signature: sign(pay.rzpOrderId, pid) }, h);
    const row = () => BulkOrder.findById(id).lean();
    const payRow = (extra = {}) => BulkPayment.findOne({ bulkId: id, ...extra }).lean();
    const paid = async () => { const pay = await start(); const pid = capture(pay); const r = await verify(pay, pid); assert.equal(r.body.paid, true, JSON.stringify(r.body)); return { pay, pid }; };
    const spyRefund = () => mock.method(payments, 'refund', async ({ amountPaise }) => ({ refundId: `rfnd_${++payN}`, status: 'processed', amountPaise }));

    /* ------------------------------ paying ------------------------------ */
    test('the amount is the quote\'s advance; the same open order is reused; nobody else can pay it', async () => {
        const a = await start();
        assert.deepEqual([a.amountPaise, a.currency, !!a.keyId], [ADVANCE, 'INR', true]);
        assert.equal((await start()).rzpOrderId, a.rzpOrderId);
        assert.equal(await BulkPayment.countDocuments({ bulkId: id }), 1);
        const other = await makeUser(w.tenant, 'customer', '9111111166');
        assert.equal((await cust('post', `/${id}/pay`, {}, other.headers)).status, 404);
    });

    test('no payment without an open quote', async () => {
        await BulkOrder.updateOne({ _id: id }, { $set: { 'quote.validUntil': new Date(Date.now() - 1000) } });
        const late = await cust('post', `/${id}/pay`);
        assert.equal(late.status, 409);
        assert.match(late.body.error, /run out/);
        await BulkOrder.updateOne({ _id: id }, { $set: { status: 'requested' } });
        assert.equal((await cust('post', `/${id}/pay`)).status, 409);
    });

    test('a wrong proof confirms nothing; a right one confirms the order once and tells both sides', async () => {
        const pay = await start();
        const pid = capture(pay);
        const bad = await cust('post', `/${id}/verify`, { razorpay_order_id: pay.rzpOrderId, razorpay_payment_id: pid, razorpay_signature: 'nope' });
        assert.equal(bad.status, 400);
        assert.equal((await row()).status, 'quoted');

        const ok = await verify(pay, pid);
        assert.deepEqual([ok.body.paid, ok.body.order.status], [true, 'confirmed']);
        const cur = await row();
        assert.deepEqual([cur.status, cur.payment.advancePaise], ['confirmed', ADVANCE]);
        assert.ok(cur.confirmedAt);
        assert.ok(await waitFor(() => Notification.findOne({ type: 'bulk_paid' }).lean()), 'the owner is told');
        assert.ok(await waitFor(() => Notification.findOne({ userId: w.customer.user._id, type: 'bulk_confirmed' }).lean()), 'the customer is told');

        const again = await verify(pay, pid);   // a repeat changes nothing
        assert.equal(again.body.paid, true);
        assert.equal(await BulkPayment.countDocuments({ bulkId: id }), 1);
        assert.equal((await Notification.countDocuments({ type: 'bulk_paid' })), 1);
        assert.ok((await payRow()).settledAt);
    });

    test('"did it get paid?" asks Razorpay, so a lost proof never loses the payment', async () => {
        const pay = await start();
        assert.equal((await cust('post', `/${id}/check`)).body.paid, false);
        capture(pay);
        const c = await cust('post', `/${id}/check`);
        assert.deepEqual([c.body.paid, c.body.order.status], [true, 'confirmed']);
    });

    test('the webhook confirms it too, and the same event twice does nothing more', async () => {
        const pay = await start();
        const pid = capture(pay);
        const body = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: pid, order_id: pay.rzpOrderId, status: 'captured', captured: true, amount: pay.amountPaise, method: 'upi' } } } }));
        const hook = () => razorpayWebhook.handle({ account: String(w.tenant._id), rawBody: body, signature: 'x', eventIdHeader: 'evt_bulk_1' });
        const r = await hook();
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal((await row()).status, 'confirmed');
        assert.equal((await hook()).body.duplicate, true);
    });

    test('another shop\'s webhook cannot confirm this order', async () => {
        const pay = await start();
        const pid = capture(pay);
        const other = await makeWorld(`bulkpay-other-${++n}`);
        const body = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: pid, order_id: pay.rzpOrderId, status: 'captured', captured: true, amount: pay.amountPaise } } } }));
        await razorpayWebhook.handle({ account: String(other.tenant._id), rawBody: body, signature: 'x', eventIdHeader: 'evt_bulk_other' });
        assert.equal((await row()).status, 'quoted');
    });

    /* ------------------------------ money going wrong ------------------------------ */
    test('a payment of the wrong amount goes back in full and the order stays unconfirmed', async () => {
        const pay = await start();
        const send = spyRefund();
        const pid = capture(pay, 400000);
        const r = await verify(pay, pid);
        assert.equal(r.body.paid, false);
        assert.equal(send.mock.callCount(), 1);
        assert.equal(send.mock.calls[0].arguments[0].amountPaise, 400000);
        assert.equal((await row()).status, 'quoted');
        await verify(pay, pid);
        assert.equal(send.mock.callCount(), 1, 'never twice');
    });

    test('a payment that arrives after the customer cancelled goes back, once', async () => {
        const pay = await start();
        await cust('post', `/${id}/cancel`);
        const send = spyRefund();
        const pid = capture(pay);
        await verify(pay, pid);
        assert.equal(send.mock.callCount(), 1);
        assert.equal(send.mock.calls[0].arguments[0].amountPaise, ADVANCE);
        assert.equal((await row()).status, 'cancelled');
        await verify(pay, pid);
        assert.equal(send.mock.callCount(), 1);
    });

    test('a payment for an older quote goes back; the new quote stays open', async () => {
        const pay = await start();                                                   // paying quote 1...
        await cust('post', `/${id}/change`, { note: 'cheaper please' });
        await quote();                                                               // ...but the shop sent quote 2
        const send = spyRefund();
        const pid = capture(pay);
        await verify(pay, pid);
        assert.equal(send.mock.callCount(), 1);
        const cur = await row();
        assert.deepEqual([cur.status, cur.quote.version], ['quoted', 2]);
    });

    test('a quote that ran out a moment ago but is not marked yet still takes the payment the customer started in time', async () => {
        const pay = await start();
        await BulkOrder.updateOne({ _id: id }, { $set: { 'quote.validUntil': new Date(Date.now() - 1000) } });
        const pid = capture(pay);
        assert.equal((await verify(pay, pid)).body.order.status, 'confirmed');
    });

    test('the crash between "captured" and "confirmed" is finished by a repeat or by the repair job, once', async () => {
        const pay = await start();
        const pid = capture(pay);
        mock.method(BulkOrder, 'findOneAndUpdate', () => ({ lean: () => Promise.reject(new Error('server died')) }), { times: 1 });   // the server dies when the order is about to be confirmed
        const r = await verify(pay, pid);
        assert.equal(r.status, 500);
        assert.equal((await payRow()).status, 'captured');
        assert.equal((await row()).status, 'quoted');

        assert.equal((await verify(pay, pid)).body.paid, true);                    // too soon for a repeat to take over
        assert.equal((await row()).status, 'quoted');

        await BulkPayment.updateOne({ bulkId: id }, { $set: { settleStartedAt: new Date(Date.now() - 5 * 60000) } });
        await reconcile.runPaymentReconcile();
        assert.equal((await row()).status, 'confirmed');
        assert.equal(await Notification.countDocuments({ type: 'bulk_paid' }), 1);
        assert.equal((await reconcile.runPaymentReconcile()).bulkRepaired, 0);
    });

    test('a payment nobody told us about is found by the repair job', async () => {
        const pay = await start();
        capture(pay);
        await BulkPayment.collection.updateOne({ bulkId: (await row())._id }, { $set: { createdAt: new Date(Date.now() - 20 * 60000) } });   // below Mongoose, which keeps createdAt fixed
        await reconcile.runPaymentReconcile();
        assert.equal((await row()).status, 'confirmed');
    });

    /* ------------------------------ cancelling ------------------------------ */
    test('the customer cancels early: the popup and the refund agree, the whole advance goes back once', async () => {
        await paid();
        const p = await cust('get', `/${id}/cancel-preview`);
        assert.deepEqual([p.body.paid, p.body.refundPaise, p.body.keptPaise, p.body.refundHours], [true, ADVANCE, 0, 48]);
        const send = spyRefund();
        const c = await cust('post', `/${id}/cancel`);
        assert.equal(c.status, 200, JSON.stringify(c.body));
        assert.equal(c.body.status, 'cancelled');
        assert.equal(send.mock.callCount(), 1);
        assert.equal(send.mock.calls[0].arguments[0].amountPaise, ADVANCE);
        const pr = await payRow();
        assert.deepEqual([pr.refund.status, pr.refund.amountPaise], ['refunded', ADVANCE]);
        assert.equal((await row()).payment.refundStatus, 'refunded');
        assert.equal((await cust('post', `/${id}/cancel`)).status, 409);
        assert.equal(send.mock.callCount(), 1);
        assert.ok(await waitFor(() => Notification.findOne({ userId: w.customer.user._id, type: 'bulk_refund' }).lean()));
    });

    test('the customer cancels too late: the shop keeps the advance, nothing is sent, and the popup said so', async () => {
        await paid();
        await BulkOrder.updateOne({ _id: id }, { $set: { when: new Date(Date.now() + 10 * 3600000) } });   // 10 hours to go, the rule is 48
        const p = await cust('get', `/${id}/cancel-preview`);
        assert.deepEqual([p.body.refundPaise, p.body.keptPaise], [0, ADVANCE]);
        const send = spyRefund();
        const c = await cust('post', `/${id}/cancel`);
        assert.equal(c.body.status, 'cancelled');
        assert.equal(send.mock.callCount(), 0);
        const cur = await row();
        assert.deepEqual([cur.payment.advanceKept, cur.payment.refundDuePaise], [true, 0]);
        await reconcile.runPaymentReconcile();
        assert.equal(send.mock.callCount(), 0, 'the repair job does not refund a kept advance');
    });

    test('the rule is the one in the quote the customer saw, not today\'s setting', async () => {
        await paid();
        await owner('put', '/settings', { fullRefundHours: 1 });                         // the shop changes its mind later
        await BulkOrder.updateOne({ _id: id }, { $set: { when: new Date(Date.now() + 10 * 3600000) } });
        assert.equal((await cust('get', `/${id}/cancel-preview`)).body.refundPaise, 0);   // still 48 hours for this customer
    });

    test('the shop cancels a confirmed order: everything goes back, even inside the cutoff', async () => {
        await paid();
        await BulkOrder.updateOne({ _id: id }, { $set: { when: new Date(Date.now() + 2 * 3600000) } });
        const send = spyRefund();
        assert.equal((await owner('post', `/${id}/cancel`, { reason: '' })).status, 400);
        const c = await owner('post', `/${id}/cancel`, { reason: 'Our oven broke' });
        assert.equal(c.status, 200, JSON.stringify(c.body));
        assert.deepEqual([c.body.status, c.body.cancelledBy], ['cancelled', 'owner']);
        assert.equal(send.mock.callCount(), 1);
        assert.equal(send.mock.calls[0].arguments[0].amountPaise, ADVANCE);
        assert.ok(await waitFor(() => Notification.findOne({ userId: w.customer.user._id, type: 'bulk_shop_cancelled' }).lean()));
        assert.equal((await owner('post', `/${id}/cancel`, { reason: 'again' })).status, 409);
        assert.equal(send.mock.callCount(), 1);
    });

    test('a refund that fails is kept, shown as pending, and sent by the repair job once Razorpay works', async () => {
        await paid();
        let fail = true;
        const send = mock.method(payments, 'refund', async ({ amountPaise }) => { if (fail) throw new Error('bank busy'); return { refundId: 'rfnd_ok', status: 'processed', amountPaise }; });
        await cust('post', `/${id}/cancel`);
        assert.equal((await payRow()).refund.status, 'failed');
        assert.equal((await row()).payment.refundStatus, 'pending');
        assert.equal(alerts.filter((a) => a.key === 'admin_refund_failed').length, 1);

        await reconcile.runPaymentReconcile();                       // too soon (it waits 3 minutes)
        assert.equal(send.mock.callCount(), 1);

        fail = false;
        await BulkPayment.updateOne({ bulkId: id }, { $set: { 'refund.at': new Date(Date.now() - 10 * 60000) } });
        await reconcile.runPaymentReconcile();
        assert.equal(send.mock.callCount(), 2);
        assert.deepEqual([(await payRow()).refund.status, (await row()).payment.refundStatus], ['refunded', 'refunded']);
        await reconcile.runPaymentReconcile();
        assert.equal(send.mock.callCount(), 2, 'never again');
    });

    test('before any retry Razorpay is asked: a refund that already went out is only recorded', async () => {
        const { pid } = await paid();
        payments._mock.setRefunds(pid, [{ id: 'rfnd_already', paymentId: pid, amountPaise: ADVANCE, status: 'processed', notes: { refundKey: `bulk:${id}:advance` } }]);
        const send = mock.method(payments, 'refund', async () => { throw new Error('must not be called'); });
        await cust('post', `/${id}/cancel`);
        assert.equal(send.mock.callCount(), 0);
        const pr = await payRow();
        assert.deepEqual([pr.refund.status, pr.refund.refundId], ['refunded', 'rfnd_already']);
    });

    test('if Razorpay cannot be asked, nothing is sent blind', async () => {
        await paid();
        mock.method(payments, 'listRefunds', async () => { throw new Error('network down'); });
        const send = mock.method(payments, 'refund', async () => ({ refundId: 'x', status: 'processed', amountPaise: ADVANCE }));
        await cust('post', `/${id}/cancel`);
        assert.equal(send.mock.callCount(), 0);
        assert.equal((await payRow()).refund.status, 'failed');
    });

    test('a shop with too little Razorpay balance: the refund waits and the owner is told once', async () => {
        await paid();
        const told = [];
        mock.method(notificationService, 'toOwner', (tenantId, p) => { told.push(p); });
        mock.method(payments, 'refund', async () => { throw Object.assign(new Error('Your account does not have enough balance to carry out the refund operation.'), { razorpay: true, status: 400 }); });
        await cust('post', `/${id}/cancel`);
        assert.equal(told.length, 1);
        assert.match(told[0].body, /balance/i);
        await BulkPayment.updateOne({ bulkId: id }, { $set: { 'refund.at': new Date(Date.now() - 10 * 60000) } });
        await reconcile.runPaymentReconcile();
        assert.equal(told.length, 1, 'no second message');
        assert.equal((await payRow()).refund.status, 'failed');
    });

    test('a cancel whose refund was never started (the server stopped) is found by the repair job', async () => {
        await paid();
        const send = spyRefund();
        await cust('post', `/${id}/cancel`);
        // make the state of a server that stopped right after the cancel: the order owes a refund that was never started
        await BulkPayment.updateOne({ bulkId: id }, { $unset: { refund: 1 } });
        await BulkOrder.updateOne({ _id: id }, { $unset: { 'payment.refundStatus': 1, 'payment.refundDueDone': 1 }, $set: { updatedAt: new Date(Date.now() - 10 * 60000) } }, { timestamps: false });
        send.mock.resetCalls();
        await reconcile.runPaymentReconcile();
        assert.equal(send.mock.callCount(), 1);
        await reconcile.runPaymentReconcile();
        assert.equal(send.mock.callCount(), 1);
    });

    /* ------------------------------ the rest ------------------------------ */
    test('a customer cannot cancel a confirmed order once the shop moved it on', async () => {
        await paid();
        await BulkOrder.updateOne({ _id: id }, { $set: { status: 'preparing' } });
        const c = await cust('post', `/${id}/cancel`);
        assert.equal(c.status, 409);
        assert.equal((await cust('get', `/${id}/cancel-preview`)).body.canCancel, false);
    });

    test('quotes that ran out are marked by the job', async () => {
        await BulkOrder.updateOne({ _id: id }, { $set: { 'quote.validUntil': new Date(Date.now() - 1000) } });
        await reconcile.runPaymentReconcile();
        assert.equal((await row()).status, 'expired');
    });
});
