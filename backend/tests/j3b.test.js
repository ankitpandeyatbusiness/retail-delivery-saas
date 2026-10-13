require('./helpers/env');
process.env.SECRETS_KEY = process.env.SECRETS_KEY || Buffer.alloc(32, 7).toString('base64');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeWorld, makeSuperAdmin } = require('./helpers/factory');
const Order = require('../src/models/Order');
const OnlinePayment = require('../src/models/OnlinePayment');
const OnlineRefund = require('../src/models/OnlineRefund');
const PaymentDispute = require('../src/models/PaymentDispute');
const payments = require('../src/services/adapters/payments');
const paymentService = require('../src/services/paymentService');
const refundIssuer = require('../src/services/refundIssuer');
const paymentGuard = require('../src/services/paymentGuard');
const notify = require('../src/services/notificationService');
const adminAlerts = require('../src/services/adminAlerts');

const DAY = 86400000;
let seq = 7000;
let evSeq = 0;
const oid = () => new mongoose.Types.ObjectId();
const sign = (rzpOrderId, rzpPaymentId) => crypto.createHmac('sha256', paymentService.MOCK_SECRET).update(`${rzpOrderId}|${rzpPaymentId}`).digest('hex');
const mk = (w, over = {}) => Order.create({
    tenantId: w.tenant._id, userId: w.customer.user._id, orderNo: ++seq, orderType: 'pickup',
    items: [{ productId: oid(), name: 'Dal', quantity: 1, unitPrice: 100, lineTotal: 100 }],
    pricing: { subtotal: 100, total: 100 },
    payment: { method: 'upi', status: 'pending' },
    ...over,
});
async function paidOrder(w, over = {}) {
    const order = await mk(w, over);
    const start = await paymentService.startForOrder({ order });
    const payId = `pay_${order.orderNo}`;
    payments._mock.setPayment({ id: payId, orderId: start.rzpOrderId, status: 'captured', amountPaise: 10000, capturedPaise: 10000, refundedPaise: 0, method: 'upi', notes: {} });
    await paymentService.verifyFromApp({ order, rzpOrderId: start.rzpOrderId, rzpPaymentId: payId, signature: sign(start.rzpOrderId, payId) });
    return { order, payId };
}
const hook = (account, body) => request(app)
    .post(`/api/webhooks/razorpay/${account}`)
    .set('content-type', 'application/json')
    .set('x-razorpay-event-id', `evt_j3b_${++evSeq}`)
    .send(JSON.stringify(body));
const disputeBody = (name, id, payId, over = {}) => ({
    event: `payment.dispute.${name}`,
    payload: { dispute: { entity: { id, payment_id: payId, amount: 10000, reason_code: 'goods_not_received', phase: 'chargeback', respond_by: Math.floor((Date.now() + 5 * DAY) / 1000), ...over } } },
});
const send = (w, name, id, payId, over) => hook(w.tenant._id, disputeBody(name, id, payId, over));

describe('J3b: key-change guard, order hiding, disputes', () => {
    let toOwner;
    let alerts;
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(async () => {
        await db.clear(); payments._mock.reset();
        toOwner = mock.method(notify, 'toOwner', () => { });
        alerts = mock.method(adminAlerts, 'alert', async () => { });
    });
    afterEach(() => mock.restoreAll());

    test('openMoney: only live and recent money blocks', async () => {
        const w = await makeWorld('j3b-guard');
        assert.equal(await paymentGuard.openMoney(w.tenant._id), null);

        const { order } = await paidOrder(w);   // mock mode payment: test money
        assert.equal(await paymentGuard.openMoney(w.tenant._id), null);

        await OnlinePayment.updateOne({ orderId: order._id }, { $set: { mode: 'live', capturedAt: new Date() } });
        assert.match(await paymentGuard.openMoney(w.tenant._id), /last 3 days/);

        await OnlinePayment.updateOne({ orderId: order._id }, { $set: { capturedAt: new Date(Date.now() - 4 * DAY) } });
        assert.equal(await paymentGuard.openMoney(w.tenant._id), null);   // 4 days old

        await OnlineRefund.create({ tenantId: w.tenant._id, orderId: order._id, paymentId: (await OnlinePayment.findOne({ orderId: order._id }))._id, rzpPaymentId: 'pay_x', amountPaise: 1000, key: 'k-guard', status: 'pending' });
        assert.match(await paymentGuard.openMoney(w.tenant._id), /refunds/);
        await OnlineRefund.updateMany({}, { $set: { status: 'processed' } });
        assert.equal(await paymentGuard.openMoney(w.tenant._id), null);

        const pay = await OnlinePayment.findOne({ orderId: order._id });
        await PaymentDispute.create({ tenantId: w.tenant._id, orderId: order._id, paymentId: pay._id, rzpPaymentId: pay.rzpPaymentId, rzpDisputeId: 'disp_g', status: 'created' });
        assert.match(await paymentGuard.openMoney(w.tenant._id), /dispute/);
        await PaymentDispute.updateOne({ rzpDisputeId: 'disp_g' }, { $set: { status: 'won' } });
        assert.equal(await paymentGuard.openMoney(w.tenant._id), null);
    });

    test('changing keys: blocked while live money is open, allowed when acknowledged', async () => {
        const w = await makeWorld('j3b-keys');
        const { token } = await makeSuperAdmin();
        const auth = { Authorization: `Bearer ${token}` };
        const url = `/api/admin/tenants/${w.tenant._id}/payments/keys`;
        const keys = { keyId: 'rzp_test_AbCdEf123456', keySecret: 'my-very-secret-key-123' };

        const { order } = await paidOrder(w);
        await OnlinePayment.updateOne({ orderId: order._id }, { $set: { mode: 'live', capturedAt: new Date() } });

        const blocked = await request(app).put(url).set(auth).send({ ...keys });
        assert.equal(blocked.status, 409);
        assert.match(blocked.body.error || blocked.body.message || '', /acknowledgeOpenMoney/);

        const ok = await request(app).put(url).set(auth).send({ ...keys, acknowledgeOpenMoney: true });
        assert.equal(ok.status, 200);

        const secret = await request(app).post(`/api/admin/tenants/${w.tenant._id}/payments/webhook-secret`).set(auth);
        assert.equal(secret.status, 200);
        assert.ok(secret.body.disputeEvents.includes('payment.dispute.lost'));
        assert.ok(secret.body.events.includes('payment.captured'));
    });

    test('the owner cannot see or assign a rider on an unpaid online order, but can after payment', async () => {
        const w = await makeWorld('j3b-hide');
        const unpaid = await mk(w, { orderType: 'delivery' });
        const h = w.owner.headers;
        assert.equal((await request(app).get(`/api/shop/orders/${unpaid._id}/delivery`).set(h)).status, 404);
        assert.equal((await request(app).post(`/api/shop/orders/${unpaid._id}/assign`).set(h).send({ auto: true })).status, 404);
        assert.equal((await request(app).post(`/api/shop/orders/${unpaid._id}/unassign`).set(h).send({ reason: 'x' })).status, 404);

        const { order } = await paidOrder(w, { orderType: 'delivery' });
        assert.equal((await request(app).get(`/api/shop/orders/${order._id}/delivery`).set(h)).status, 200);
    });

    test('a dispute is saved once, the owner is told once, and a repeat does nothing', async () => {
        const w = await makeWorld('j3b-created');
        const { order, payId } = await paidOrder(w);
        const r1 = await send(w, 'created', 'disp_1', payId);
        assert.equal(r1.status, 200);
        const rows = await PaymentDispute.find({ rzpDisputeId: 'disp_1' });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].status, 'created');
        assert.equal(rows[0].amountPaise, 10000);
        assert.equal(String(rows[0].orderId), String(order._id));
        assert.equal(toOwner.mock.callCount(), 1);
        assert.equal(alerts.mock.callCount(), 1);

        await send(w, 'created', 'disp_1', payId);   // a different event id, same stage
        assert.equal(await PaymentDispute.countDocuments({ rzpDisputeId: 'disp_1' }), 1);
        assert.equal(toOwner.mock.callCount(), 1);
        assert.equal(alerts.mock.callCount(), 1);
    });

    test('stages: under_review is silent, a final stage is never reverted by a late open event', async () => {
        const w = await makeWorld('j3b-stages');
        const { payId } = await paidOrder(w);
        await send(w, 'created', 'disp_2', payId);
        await send(w, 'under_review', 'disp_2', payId);
        assert.equal(toOwner.mock.callCount(), 1);   // under_review sends nothing
        assert.equal((await PaymentDispute.findOne({ rzpDisputeId: 'disp_2' })).status, 'under_review');

        await send(w, 'lost', 'disp_2', payId);
        assert.equal(toOwner.mock.callCount(), 2);
        await send(w, 'under_review', 'disp_2', payId);   // arrives late
        await send(w, 'won', 'disp_2', payId);            // nonsense after a final stage
        const d = await PaymentDispute.findOne({ rzpDisputeId: 'disp_2' });
        assert.equal(d.status, 'lost');
        assert.deepEqual(d.history.map((x) => x.status), ['created', 'under_review', 'lost']);
        assert.equal(toOwner.mock.callCount(), 2);
    });

    test('unknown payment and the platform account are not saved; the unknown one tells the superadmin', async () => {
        const w = await makeWorld('j3b-unknown');
        const r = await send(w, 'created', 'disp_3', 'pay_not_ours');
        assert.equal(r.status, 200);
        assert.equal(await PaymentDispute.countDocuments(), 0);
        assert.equal(alerts.mock.callCount(), 1);
        assert.equal(toOwner.mock.callCount(), 0);

        const p = await hook('platform', disputeBody('created', 'disp_4', 'pay_any'));
        assert.equal(p.status, 200);
        assert.equal(await PaymentDispute.countDocuments(), 0);
    });

    test('no refund is sent while a dispute is open; it works after the dispute is won', async () => {
        const w = await makeWorld('j3b-refund');
        const { order, payId } = await paidOrder(w);
        await send(w, 'created', 'disp_5', payId);
        const sent = mock.method(payments, 'refund', async () => ({ refundId: 'rfnd_d', status: 'processed' }));

        const blocked = await refundIssuer.issueRefund({ tenantId: w.tenant._id, orderId: order._id, amountPaise: 2000, reason: 'test', key: 'k-disp' });
        assert.equal(blocked.ok, false);
        assert.match(blocked.error, /dispute/);
        assert.equal(sent.mock.callCount(), 0);
        assert.equal(await OnlineRefund.countDocuments({ orderId: order._id }), 0);

        await send(w, 'won', 'disp_5', payId);
        const ok = await refundIssuer.issueRefund({ tenantId: w.tenant._id, orderId: order._id, amountPaise: 2000, reason: 'test', key: 'k-disp' });
        assert.equal(ok.ok, true);
        assert.equal(sent.mock.callCount(), 1);
    });

    test('the shop report counts lost disputes and shows open ones; the list hides notes; owner only', async () => {
        const w = await makeWorld('j3b-report');
        const other = await makeWorld('j3b-report-other');
        const a = await paidOrder(w);
        const b = await paidOrder(w);
        await send(w, 'created', 'disp_6', a.payId);
        await send(w, 'created', 'disp_7', b.payId);
        await send(w, 'lost', 'disp_7', b.payId);

        const rep = await request(app).get('/api/shop/payments/report').set(w.owner.headers);
        assert.equal(rep.status, 200);
        assert.equal(rep.body.captured.paise, 20000);
        assert.equal(rep.body.disputesLost.paise, 10000);
        assert.equal(rep.body.disputesLost.count, 1);
        assert.equal(rep.body.netPaise, 10000);
        assert.equal(rep.body.disputesOpen, 1);

        await PaymentDispute.updateOne({ rzpDisputeId: 'disp_6' }, { $push: { notes: { at: new Date(), by: 'x', text: 'secret note' } } });
        const list = await request(app).get('/api/shop/payments/disputes').set(w.owner.headers);
        assert.equal(list.status, 200);
        assert.equal(list.body.items.length, 2);
        assert.ok(!JSON.stringify(list.body).includes('secret note'));
        assert.equal((await request(app).get('/api/shop/payments/disputes').set(other.owner.headers)).body.items.length, 0);
        assert.ok([401, 403].includes((await request(app).get('/api/shop/payments/disputes').set(w.customer.headers)).status));
    });

    test('superadmin sees the disputes of a shop and adds notes (limits apply)', async () => {
        const w = await makeWorld('j3b-admin');
        const { payId } = await paidOrder(w);
        await send(w, 'created', 'disp_8', payId);
        const { token } = await makeSuperAdmin();
        const auth = { Authorization: `Bearer ${token}` };
        const base = `/api/admin/tenants/${w.tenant._id}/disputes`;

        const list = await request(app).get(base).set(auth);
        assert.equal(list.status, 200);
        assert.equal(list.body.items.length, 1);
        const id = list.body.items[0].id;

        const add = await request(app).post(`${base}/${id}/notes`).set(auth).send({ text: 'Sent the delivery proof' });
        assert.equal(add.status, 201);
        assert.equal(add.body.notes.length, 1);
        assert.equal((await request(app).post(`${base}/${id}/notes`).set(auth).send({ text: '' })).status, 400);
        assert.equal((await request(app).post(`${base}/${id}/notes`).set(auth).send({ text: 'x'.repeat(501) })).status, 400);
        assert.equal((await request(app).post(`${base}/${oid()}/notes`).set(auth).send({ text: 'hi' })).status, 404);
        assert.equal((await request(app).post(`${base}/bad-id/notes`).set(auth).send({ text: 'hi' })).status, 404);
        assert.ok([401, 403].includes((await request(app).get(base).set(w.owner.headers)).status));

        await PaymentDispute.updateOne({ _id: id }, { $set: { notes: Array.from({ length: 50 }, () => ({ at: new Date(), by: 'x', text: 'n' })) } });
        assert.equal((await request(app).post(`${base}/${id}/notes`).set(auth).send({ text: 'one more' })).status, 404);
    });
});