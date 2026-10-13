require('./helpers/env');
process.env.SECRETS_KEY = process.env.SECRETS_KEY || Buffer.alloc(32, 7).toString('base64');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeTenant } = require('./helpers/factory');
const Order = require('../src/models/Order');
const Tenant = require('../src/models/Tenant');
const SmsTopup = require('../src/models/SmsTopup');
const SmsWallet = require('../src/models/SmsWallet');
const OnlinePayment = require('../src/models/OnlinePayment');
const OnlineRefund = require('../src/models/OnlineRefund');
const PaymentWebhookEvent = require('../src/models/PaymentWebhookEvent');
const payments = require('../src/services/adapters/payments');
const paymentService = require('../src/services/paymentService');
const refundIssuer = require('../src/services/refundIssuer');
const smsTopupService = require('../src/services/smsTopupService');
const secretBox = require('../src/utils/secretBox');

const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
let seq = 0;
let evSeq = 0;

const mkOrder = (tenant, over = {}) => Order.create({
    tenantId: tenant._id, userId: new mongoose.Types.ObjectId(), orderNo: ++seq, orderType: 'pickup',
    items: [{ productId: new mongoose.Types.ObjectId(), name: 'Dal', quantity: 1, unitPrice: 100, lineTotal: 100 }],
    pricing: { subtotal: 100, total: 100 },   // Rs 100 = 10000 paise
    payment: { method: 'upi', status: 'pending' },
    ...over,
});
const setCaptured = (id, rzpOrderId, amountPaise = 10000) => payments._mock.setPayment({
    id, orderId: rzpOrderId, status: 'captured', amountPaise, capturedPaise: amountPaise, refundedPaise: 0, method: 'upi', notes: {},
});
const capturedBody = (id, rzpOrderId, amount = 10000) => ({
    event: 'payment.captured',
    payload: { payment: { entity: { id, order_id: rzpOrderId, status: 'captured', captured: true, amount, method: 'upi', notes: [] } } },
});
const hook = (account, body, { eventId, headers = {} } = {}) => request(app)
    .post(`/api/webhooks/razorpay/${account}`)
    .set('content-type', 'application/json')
    .set('x-razorpay-event-id', eventId || `evt_${++evSeq}`)
    .set(headers)
    .send(JSON.stringify(body));
// start a payment for a fresh order and get everything a test needs
async function paidSetup(slug, over = {}) {
    const tenant = await makeTenant(slug);
    const order = await mkOrder(tenant, over);
    const start = await paymentService.startForOrder({ order });
    return { tenant, order, start };
}

describe('J1b: online payments, refunds, webhooks', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(async () => { await db.clear(); payments._mock.reset(); });
    afterEach(() => mock.restoreAll());

    test('start: the amount comes from the order, and a second start reuses the same payment', async () => {
        const { order, start } = await paidSetup('j1b-start');
        assert.equal(start.amountPaise, 10000);
        assert.ok(start.rzpOrderId);
        const again = await paymentService.startForOrder({ order });
        assert.equal(again.rzpOrderId, start.rzpOrderId);
        assert.equal(await OnlinePayment.countDocuments({ orderId: order._id }), 1);
    });

    test('app check: a valid proof marks the order paid once, a repeat does nothing more', async () => {
        const { order, start } = await paidSetup('j1b-app');
        setCaptured('pay_app1', start.rzpOrderId);
        const signature = hmac(paymentService.MOCK_SECRET, `${start.rzpOrderId}|pay_app1`);
        const a = await paymentService.verifyFromApp({ order, rzpOrderId: start.rzpOrderId, rzpPaymentId: 'pay_app1', signature });
        assert.equal(a.paid, true);
        const b = await paymentService.verifyFromApp({ order, rzpOrderId: start.rzpOrderId, rzpPaymentId: 'pay_app1', signature });
        assert.equal(b.duplicate, true);
        const o = await Order.findById(order._id);
        assert.equal(o.payment.status, 'paid');
        assert.equal(o.payment.paymentId, 'pay_app1');
        const p = await OnlinePayment.findOne({ orderId: order._id });
        assert.equal(p.status, 'captured');
        assert.equal(p.capturedPaise, 10000);
    });

    test('app check: a wrong proof, or a proof for another order, is refused', async () => {
        const { order, start } = await paidSetup('j1b-badproof');
        setCaptured('pay_x', start.rzpOrderId);
        await assert.rejects(
            paymentService.verifyFromApp({ order, rzpOrderId: start.rzpOrderId, rzpPaymentId: 'pay_x', signature: 'nope' }),
            (e) => e.status === 400,
        );
        await assert.rejects(
            paymentService.verifyFromApp({ order, rzpOrderId: 'order_other', rzpPaymentId: 'pay_x', signature: 'nope' }),
            (e) => e.status === 400,
        );
        assert.equal((await Order.findById(order._id)).payment.status, 'pending');
    });

    test('a payment with the wrong amount does not pay the order, and all of it goes back', async () => {
        const { order, start } = await paidSetup('j1b-amount');
        const r = await hook(order.tenantId, capturedBody('pay_low', start.rzpOrderId, 5000));
        assert.equal(r.status, 200);
        const p = await OnlinePayment.findOne({ orderId: order._id });
        assert.equal(p.status, 'mismatch');
        assert.equal((await Order.findById(order._id)).payment.status, 'pending');
        const refunds = await OnlineRefund.find({ orderId: order._id });
        assert.equal(refunds.length, 1);
        assert.equal(refunds[0].amountPaise, 5000);
        assert.equal(refunds[0].status, 'processed');
    });

    test('webhook: the same event twice is handled once, a new event id for the same payment changes nothing', async () => {
        const { tenant, order, start } = await paidSetup('j1b-dup');
        const body = capturedBody('pay_w1', start.rzpOrderId);
        const a = await hook(tenant._id, body, { eventId: 'evt_same' });
        const b = await hook(tenant._id, body, { eventId: 'evt_same' });
        const c = await hook(tenant._id, body, { eventId: 'evt_other' });
        assert.equal(a.status, 200);
        assert.equal(b.body.duplicate, true);
        assert.equal(c.status, 200);
        assert.equal(c.body.duplicate, true);   // the payment was already captured
        assert.equal(await PaymentWebhookEvent.countDocuments({ account: String(tenant._id) }), 2);
        assert.equal((await Order.findById(order._id)).payment.status, 'paid');
        assert.equal(await OnlineRefund.countDocuments({}), 0);
    });

    test('webhook: an unknown shop is 404, an unknown order is ignored, a failed payment is only remembered', async () => {
        const { tenant, order, start } = await paidSetup('j1b-misc');
        assert.equal((await hook(new mongoose.Types.ObjectId(), capturedBody('p', 'o'))).status, 404);
        assert.equal((await hook('not-an-id', capturedBody('p', 'o'))).status, 404);
        const ign = await hook(tenant._id, capturedBody('pay_z', 'order_unknown'));
        assert.equal(ign.status, 200);
        assert.equal(ign.body.ignored, 'unknown_order');
        const f = await hook(tenant._id, { event: 'payment.failed', payload: { payment: { entity: { id: 'pay_f', order_id: start.rzpOrderId, status: 'failed', error_description: 'Bank declined' } } } });
        assert.equal(f.status, 200);
        const p = await OnlinePayment.findOne({ orderId: order._id });
        assert.equal(p.status, 'created');
        assert.equal(p.lastFailure.reason, 'Bank declined');
        assert.equal((await Order.findById(order._id)).payment.status, 'pending');
    });

    test('a failed webhook answers 500, is tried again, and then works', async () => {
        const { tenant, order, start } = await paidSetup('j1b-retry');
        const orig = Order.updateOne.bind(Order);
        let boom = true;
        mock.method(Order, 'updateOne', (...a) => {
            if (boom) { boom = false; throw new Error('db down'); }
            return orig(...a);
        });
        const body = capturedBody('pay_r1', start.rzpOrderId);
        const first = await hook(tenant._id, body, { eventId: 'evt_retry' });
        assert.equal(first.status, 500);
        assert.equal((await PaymentWebhookEvent.findOne({ eventId: 'evt_retry' })).status, 'failed');
        const second = await hook(tenant._id, body, { eventId: 'evt_retry' });
        assert.equal(second.status, 200);
        assert.equal((await Order.findById(order._id)).payment.status, 'paid');   // the half-done first try was repaired
        assert.equal((await PaymentWebhookEvent.findOne({ eventId: 'evt_retry' })).status, 'done');
    });

    test('late payment: money for a cancelled order goes back, except what the shop keeps', async () => {
        const { tenant, order, start } = await paidSetup('j1b-late');
        await Order.updateOne({ _id: order._id }, { $set: { status: 'cancelled', cancel: { by: 'shop', reasonCode: 'x', keptPaise: 2000, refundPaise: 8000 } } });
        const r = await hook(tenant._id, capturedBody('pay_late', start.rzpOrderId));
        assert.equal(r.status, 200);
        const refunds = await OnlineRefund.find({ orderId: order._id });
        assert.equal(refunds.length, 1);
        assert.equal(refunds[0].amountPaise, 8000);
        assert.equal(refunds[0].key, `order:${order._id}:cancel`);
        assert.equal((await Order.findById(order._id)).payment.status, 'paid');   // the shop kept 20 rupees
    });

    test('late payment with nothing kept: full refund and the order shows refunded', async () => {
        const { tenant, order, start } = await paidSetup('j1b-latefull');
        await Order.updateOne({ _id: order._id }, { $set: { status: 'cancelled', cancel: { by: 'system', reasonCode: 'payment_timeout', keptPaise: 0, refundPaise: 10000 } } });
        await hook(tenant._id, capturedBody('pay_late2', start.rzpOrderId));
        const refunds = await OnlineRefund.find({ orderId: order._id });
        assert.equal(refunds[0].amountPaise, 10000);
        assert.equal((await Order.findById(order._id)).payment.status, 'refunded');
    });

    test('refunds: the same key twice is one refund, and the total can never go above the money paid', async () => {
        const { tenant, order, start } = await paidSetup('j1b-cap');
        await hook(tenant._id, capturedBody('pay_cap', start.rzpOrderId));
        const base = { tenantId: tenant._id, orderId: order._id };
        const a = await refundIssuer.issueRefund({ ...base, amountPaise: 6000, reason: 'complaint', key: 'k1' });
        const b = await refundIssuer.issueRefund({ ...base, amountPaise: 6000, reason: 'complaint', key: 'k1' });
        assert.equal(a.ok, true);
        assert.equal(b.duplicate, true);
        const c = await refundIssuer.issueRefund({ ...base, amountPaise: 5000, reason: 'complaint', key: 'k2' });   // 6000 + 5000 > 10000
        assert.equal(c.ok, false);
        const d = await refundIssuer.issueRefund({ ...base, amountPaise: 4000, reason: 'complaint', key: 'k3' });   // exactly the rest
        assert.equal(d.ok, true);
        const p = await OnlinePayment.findOne({ orderId: order._id });
        assert.equal(p.refundedPaise, 10000);
        assert.equal(await OnlineRefund.countDocuments({ status: 'processed' }), 2);
        assert.equal((await Order.findById(order._id)).payment.status, 'refunded');
    });

    test('refunds: COD orders and orders never paid online are skipped', async () => {
        const tenant = await makeTenant('j1b-cod');
        const order = await mkOrder(tenant, { payment: { method: 'cod', status: 'pending' } });
        const r = await refundIssuer.issueRefund({ tenantId: tenant._id, orderId: order._id, amountPaise: 5000, reason: 'complaint', key: 'kx' });
        assert.equal(r.skipped, 'not_paid_online');
        assert.equal(await OnlineRefund.countDocuments({}), 0);
    });

    test('refunds: a network error keeps it pending, and the retry adopts the refund Razorpay already made (no second one)', async () => {
        const { tenant, order, start } = await paidSetup('j1b-net');
        await hook(tenant._id, capturedBody('pay_net', start.rzpOrderId));
        mock.method(payments, 'refund', async () => { throw new Error('socket hang up'); });
        const r = await refundIssuer.issueRefund({ tenantId: tenant._id, orderId: order._id, amountPaise: 3000, reason: 'complaint', key: 'knet' });
        assert.equal(r.pending, true);
        const row = await OnlineRefund.findOne({ key: 'knet' });
        assert.equal(row.status, 'pending');
        assert.equal(row.attempts, 1);
        mock.restoreAll();
        // Razorpay did make it, we just never heard back
        let sent = 0;
        mock.method(payments, 'refund', async () => { sent += 1; return { refundId: 'rfnd_new', status: 'processed' }; });
        mock.method(payments, 'listRefunds', async () => [{ id: 'rfnd_old', notes: { refundKey: 'knet' }, amountPaise: 3000, status: 'processed' }]);
        await OnlineRefund.updateOne({ _id: row._id }, { $set: { lastTryAt: new Date(Date.now() - 10 * 60000) } });
        await refundIssuer.retryPending();
        assert.equal(sent, 0);
        const after = await OnlineRefund.findOne({ key: 'knet' });
        assert.equal(after.status, 'processed');
        assert.equal(after.rzpRefundId, 'rfnd_old');
        assert.equal((await OnlinePayment.findOne({ orderId: order._id })).refundedPaise, 3000);
    });

    test('refunds: a clear "no" from Razorpay marks it failed and gives the money back to the limit', async () => {
        const { tenant, order, start } = await paidSetup('j1b-no');
        await hook(tenant._id, capturedBody('pay_no', start.rzpOrderId));
        mock.method(payments, 'refund', async () => { throw Object.assign(new Error('Refund not allowed'), { razorpay: true, status: 400 }); });
        const r = await refundIssuer.issueRefund({ tenantId: tenant._id, orderId: order._id, amountPaise: 3000, reason: 'complaint', key: 'kno' });
        assert.equal(r.ok, false);
        assert.equal((await OnlineRefund.findOne({ key: 'kno' })).status, 'failed');
        assert.equal((await OnlinePayment.findOne({ orderId: order._id })).refundedPaise, 0);
    });

    test('webhook: a refund made in the Razorpay dashboard is counted, and refund.failed releases the amount', async () => {
        const { tenant, order, start } = await paidSetup('j1b-ext');
        await hook(tenant._id, capturedBody('pay_ext', start.rzpOrderId));
        const ext = await hook(tenant._id, { event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_ext', payment_id: 'pay_ext', amount: 2500, status: 'processed', notes: [] } } } });
        assert.equal(ext.body.external, true);
        assert.equal((await OnlinePayment.findOne({ orderId: order._id })).refundedPaise, 2500);
        // one of ours fails later at the bank
        mock.method(payments, 'refund', async () => ({ refundId: 'rfnd_mine', status: 'created' }));
        await refundIssuer.issueRefund({ tenantId: tenant._id, orderId: order._id, amountPaise: 1000, reason: 'complaint', key: 'kfail' });
        assert.equal((await OnlineRefund.findOne({ key: 'kfail' })).status, 'processing');
        assert.equal((await OnlinePayment.findOne({ orderId: order._id })).refundedPaise, 3500);
        await hook(tenant._id, { event: 'refund.failed', payload: { refund: { entity: { id: 'rfnd_mine', payment_id: 'pay_ext', amount: 1000, status: 'failed', notes: [] } } } });
        assert.equal((await OnlineRefund.findOne({ key: 'kfail' })).status, 'failed');
        assert.equal((await OnlinePayment.findOne({ orderId: order._id })).refundedPaise, 2500);
    });

    test('SMS top-up: the platform webhook credits the wallet once, and a wrong amount credits nothing', async () => {
        const tenant = await makeTenant('j1b-topup');
        const t1 = await smsTopupService.create({ tenantId: tenant._id, amountPaise: 10000, actor: { type: 'system' } });
        const qrBody = (topup, amount) => ({
            event: 'qr_code.credited',
            payload: {
                qr_code: { entity: { id: topup.qrId, notes: { purpose: 'sms_topup', referenceId: String(topup._id) } } },
                payment: { entity: { id: `pay_${topup._id}`, status: 'captured', captured: true, amount, notes: [] } },
            },
        });
        const bad = await hook('platform', qrBody(t1, 5000));
        assert.equal(bad.status, 200);
        assert.equal((await SmsTopup.findById(t1._id)).status, 'pending');
        const ok = await hook('platform', qrBody(t1, 10000));
        assert.equal(ok.body.topup, 'credited');
        await hook('platform', qrBody(t1, 10000));   // again, other event id
        assert.equal((await SmsTopup.findById(t1._id)).status, 'paid');
        assert.equal((await SmsWallet.findOne({ tenantId: tenant._id })).balancePaise, 10000);
    });

    test('real signatures: wrong or missing is 401, correct is accepted and the shop shows a webhook received', async () => {
        const tenant = await makeTenant('j1b-sign');
        const prev = process.env.PAYMENTS_MOCK;
        process.env.PAYMENTS_MOCK = 'false';
        try {
            const body = JSON.stringify({ event: 'payment.authorized', payload: {} });
            const send = (sig) => request(app).post(`/api/webhooks/razorpay/${tenant._id}`)
                .set('content-type', 'application/json').set('x-razorpay-event-id', `evt_s${++evSeq}`)
                .set(sig ? { 'x-razorpay-signature': sig } : {}).send(body);
            assert.equal((await send(hmac('whsec_test_123', body))).status, 401);   // no secret saved for this shop yet
            await Tenant.collection.updateOne({ _id: tenant._id }, { $set: { 'payments.webhookSecretEnc': secretBox.encrypt('whsec_test_123') } });
            assert.equal((await send('wrong')).status, 401);
            assert.equal((await send(null)).status, 401);
            assert.ok(!(await Tenant.findById(tenant._id)).payments?.lastWebhookAt);
            const good = await send(hmac('whsec_test_123', body));
            assert.equal(good.status, 200);
            assert.ok((await Tenant.findById(tenant._id)).payments.lastWebhookAt);
        } finally {
            process.env.PAYMENTS_MOCK = prev;
        }
    });
});