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
const Address = require('../src/models/Address');
const Tenant = require('../src/models/Tenant');
const BulkOrder = require('../src/models/BulkOrder');
const BulkPayment = require('../src/models/BulkPayment');
const Notification = require('../src/models/Notification');
const pushChannel = require('../src/notifications/channels/push');
const adminAlerts = require('../src/services/adminAlerts');
const payments = require('../src/services/adapters/payments');
const paymentService = require('../src/services/paymentService');
const billable = require('../src/services/billableService');
const reconcile = require('../src/services/paymentReconcile');

// Step 3: making it, the handover, the balance (online or cash), completion, the rent count and the invoice.
// A quote of Rs 10000, advance 50 % = Rs 5000, balance Rs 5000 (500000 paise).
const sign = (orderId, paymentId) => crypto.createHmac('sha256', paymentService.MOCK_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
const days = (n) => new Date(Date.now() + n * 86400000).toISOString();
const PART = 500000;
const period = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
let n = 0; let payN = 0;

describe('bulk order: stages, balance, completion, invoice', () => {
    let w; let id; let dish; let addr;
    const owner = (m, p, b) => request(app)[m](`/api/shop/bulk${p}`).set(w.owner.headers).send(b);
    const cust = (m, p, b, h = w.customer.headers) => request(app)[m](`/api/bulk${p}`).set(h).send(b);
    const row = () => BulkOrder.findById(id).lean();

    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(async () => {
        await db.clear();
        payments._mock.reset();
        mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
        mock.method(adminAlerts, 'alert', async () => { });
        w = await makeWorld(`bulkhand-${++n}`);
        // the shop is live, so a finished bulk order counts for the rent
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'billing.isLive': true, 'billing.goLiveAt': new Date(Date.now() - 30 * 86400000) } });
        const cat = await Category.create({ tenantId: w.tenant._id, name: 'Main', isActive: true });
        dish = await Product.create({ tenantId: w.tenant._id, categoryId: cat._id, name: 'Dal', price: 100, isVeg: true, isActive: true });
        addr = await Address.create({ tenantId: w.tenant._id, userId: w.customer.user._id, label: 'Office', line1: '5 MG Road', city: 'Pune', pincode: '411001', name: 'Meera', phone: '9000000041' });
        await owner('put', '/settings', { enabled: true, noticeHours: 1, advancePercent: 50, fullRefundHours: 48 });
    });
    afterEach(() => mock.restoreAll());

    const request1 = async (extra = {}, quoteExtra = {}) => {
        const r = await cust('post', '/', { fulfilment: 'pickup', when: days(5), items: [{ productId: String(dish._id), quantity: 100 }], contact: { name: 'Raj', phone: '9000000051' }, ...extra });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        id = r.body.id;
        const o = (await owner('get', `/${id}`)).body;
        const q = await owner('post', `/${id}/quote`, { lines: o.lines.map((l) => ({ id: l.id, unitPrice: l.unitPrice })), ...quoteExtra });
        assert.equal(q.status, 200, JSON.stringify(q.body));
        return q.body;
    };
    const capture = (pay, amountPaise = pay.amountPaise) => {
        const pid = `pay_hand_${++payN}`;
        payments._mock.setPayment({ id: pid, orderId: pay.rzpOrderId, status: 'captured', amountPaise, capturedPaise: amountPaise, refundedPaise: 0, method: 'upi', notes: {} });
        return pid;
    };
    const verify = (pay, pid, h = w.customer.headers) => cust('post', `/${id}/verify`, { razorpay_order_id: pay.rzpOrderId, razorpay_payment_id: pid, razorpay_signature: sign(pay.rzpOrderId, pid) }, h);
    const payAdvance = async () => { const pay = (await cust('post', `/${id}/pay`)).body; const pid = capture(pay); const r = await verify(pay, pid); assert.equal(r.body.paid, true, JSON.stringify(r.body)); return pid; };
    const stage = (to) => owner('post', `/${id}/stage`, { to, ...(to === 'delivered' ? { skipCode: true } : {}) });
    const go = async (...steps) => { for (const s of steps) { const r = await stage(s); assert.equal(r.status, 200, `${s}: ${JSON.stringify(r.body)}`); } };
    const startBalance = () => cust('post', `/${id}/pay-balance`);
    const payBalance = async () => { const s = await startBalance(); assert.equal(s.status, 200, JSON.stringify(s.body)); const pid = capture(s.body); const r = await verify(s.body, pid); return { pay: s.body, pid, res: r }; };
    const spyRefund = () => mock.method(payments, 'refund', async ({ amountPaise }) => ({ refundId: `rfnd_${++payN}`, status: 'processed', amountPaise }));

    /* ------------------------------ the stages ------------------------------ */
    test('a pickup goes confirmed -> preparing -> ready -> handed over, nothing skipped, and the customer hears each step', async () => {
        await request1(); await payAdvance();
        assert.equal((await stage('ready')).status, 409, 'cannot skip preparing');
        assert.equal((await stage('delivered')).status, 409);
        await go('preparing', 'ready');
        assert.equal((await stage('out_for_delivery')).status, 409, 'a pickup does not go out');
        assert.equal((await stage('preparing')).status, 409, 'no going back');
        const d = await stage('delivered');
        assert.equal(d.body.status, 'delivered');                           // the balance is still open
        const cur = await row();
        assert.ok(cur.stageAt.preparing && cur.stageAt.ready && cur.stageAt.delivered);
        assert.equal(await Notification.countDocuments({ userId: w.customer.user._id, type: 'bulk_stage' }), 3);
        const last = await Notification.findOne({ userId: w.customer.user._id, type: 'bulk_stage' }).sort({ createdAt: -1 }).lean();
        assert.match(JSON.stringify(last), /balance of ₹5000/);
    });

    test('a delivery goes out first; a customer or a stranger cannot move an order', async () => {
        await request1({ fulfilment: 'delivery', addressId: String(addr._id) }); await payAdvance();
        await go('preparing', 'ready');
        assert.equal((await stage('delivered')).status, 409, 'a delivery goes out first');
        await go('out_for_delivery', 'delivered');
        assert.equal((await cust('post', `/${id}/stage`, { to: 'delivered' })).status, 404);
        const r = await request(app).post(`/api/shop/bulk/${id}/stage`).set(w.customer.headers).send({ to: 'preparing' });
        assert.ok([401, 403].includes(r.status), String(r.status));
    });

    test('an order that was not paid cannot be made', async () => {
        await request1();
        assert.equal((await stage('preparing')).status, 409);
    });

    /* ------------------------------ the balance, online ------------------------------ */
    test('the balance can be paid online once the order is ready; it completes when the order is handed over, and counts once for the rent', async () => {
        await request1(); await payAdvance();
        const early = await startBalance();
        assert.equal(early.status, 409);
        assert.match(early.body.error, /ready or delivered/);
        await go('preparing', 'ready');

        const s = await startBalance();
        assert.deepEqual([s.body.amountPaise, s.body.currency], [PART, 'INR']);
        assert.equal((await startBalance()).body.rzpOrderId, s.body.rzpOrderId, 'the same open order');
        const pid = capture(s.body);
        const bad = await cust('post', `/${id}/verify`, { razorpay_order_id: s.body.rzpOrderId, razorpay_payment_id: pid, razorpay_signature: 'nope' });
        assert.equal(bad.status, 400);
        assert.equal((await verify(s.body, pid)).body.paid, true);
        let cur = await row();
        assert.deepEqual([cur.status, cur.payment.balancePaid, cur.payment.balanceVia, cur.payment.balancePaise], ['ready', true, 'online', PART]);
        assert.ok(await waitFor(() => Notification.findOne({ type: 'bulk_balance_paid' }).lean()), 'the owner is told');
        assert.equal((await startBalance()).status, 409, 'already paid');

        assert.equal(await billable.countInPeriod(w.tenant._id, period()), 0, 'not counted before the handover');
        await go('delivered');
        cur = await row();
        assert.equal(cur.status, 'completed');
        assert.ok(cur.completedAt);
        assert.deepEqual([cur.billing.billable, cur.billing.reason], [true, 'completed']);
        assert.equal(await billable.countInPeriod(w.tenant._id, period()), 1);
        assert.equal((await Tenant.findById(w.tenant._id).lean()).billing.billableCount, 1);
        await verify(s.body, pid);
        assert.equal((await Tenant.findById(w.tenant._id).lean()).billing.billableCount, 1, 'a repeat counts nothing more');
        assert.ok(await waitFor(() => Notification.findOne({ userId: w.customer.user._id, type: 'bulk_completed' }).lean()));
    });

    test('paying the balance online after the handover completes it at once', async () => {
        await request1(); await payAdvance();
        await go('preparing', 'ready', 'delivered');
        assert.equal((await row()).status, 'delivered');
        const { res } = await payBalance();
        assert.equal(res.body.order.status, 'completed');
        assert.equal(await billable.countInPeriod(w.tenant._id, period()), 1);
    });

    test('a balance payment of the wrong amount goes back in full and the order stays open', async () => {
        await request1(); await payAdvance(); await go('preparing', 'ready');
        const s = (await startBalance()).body;
        const send = spyRefund();
        const pid = capture(s, 300000);
        const r = await verify(s, pid);
        assert.equal(r.body.paid, false);
        assert.equal(send.mock.callCount(), 1);
        assert.equal(send.mock.calls[0].arguments[0].amountPaise, 300000);
        assert.equal((await row()).payment.balancePaid, undefined);
    });

    /* ------------------------------ the balance, in cash ------------------------------ */
    test('the owner marks the cash as received; the order completes; online payment is then closed', async () => {
        await request1(); await payAdvance();
        assert.equal((await owner('post', `/${id}/cash-received`)).status, 409, 'not before the handover');
        await go('preparing', 'ready');
        const c = await owner('post', `/${id}/cash-received`);
        assert.equal(c.status, 200, JSON.stringify(c.body));
        assert.deepEqual([c.body.payment.balancePaid, c.body.payment.balanceVia], [true, 'cash']);
        assert.equal((await owner('post', `/${id}/cash-received`)).status, 409, 'not twice');
        const s = await startBalance();
        assert.equal(s.status, 409);
        await go('delivered');
        assert.equal((await row()).status, 'completed');
        assert.equal(await billable.countInPeriod(w.tenant._id, period()), 1);
    });

    test('cash cannot be marked after the customer paid online', async () => {
        await request1(); await payAdvance(); await go('preparing', 'ready');
        await payBalance();
        const c = await owner('post', `/${id}/cash-received`);
        assert.equal(c.status, 409);
        assert.match(c.body.error, /online/);
    });

    test('if the customer pays online at the very moment the owner takes cash, the online payment goes back by itself', async () => {
        await request1(); await payAdvance(); await go('preparing', 'ready');
        const s = (await startBalance()).body;                       // the customer opened the payment...
        assert.equal((await owner('post', `/${id}/cash-received`)).status, 200);   // ...the owner took cash
        const send = spyRefund();
        const pid = capture(s);
        await verify(s, pid);                                        // ...and the online payment lands
        assert.equal(send.mock.callCount(), 1);
        assert.equal(send.mock.calls[0].arguments[0].amountPaise, PART);
        const cur = await row();
        assert.deepEqual([cur.payment.balanceVia, cur.payment.balancePaymentId], ['cash', undefined]);
    });

    /* ------------------------------ other ways to finish ------------------------------ */
    test('with a 100 % advance nothing is left: the order completes when it is handed over', async () => {
        await request1({}, { advancePercent: 100 }); await payAdvance();
        await go('preparing', 'ready');
        assert.equal((await owner('post', `/${id}/cash-received`)).status, 409, 'nothing to collect');
        await go('delivered');
        assert.equal((await row()).status, 'completed');
    });

    test('a delivered order whose completion was missed (a crash) is finished by the repair job', async () => {
        await request1(); await payAdvance(); await go('preparing', 'ready');
        await owner('post', `/${id}/cash-received`);
        await BulkOrder.updateOne({ _id: id }, { $set: { status: 'delivered' } });     // delivered, paid, but never completed
        await BulkOrder.updateOne({ _id: id }, { $set: { updatedAt: new Date(Date.now() - 10 * 60000) } }, { timestamps: false });
        await reconcile.runPaymentReconcile();
        assert.equal((await row()).status, 'completed');
        assert.equal(await billable.countInPeriod(w.tenant._id, period()), 1);
        await reconcile.runPaymentReconcile();
        assert.equal(await billable.countInPeriod(w.tenant._id, period()), 1);
    });

    test('the crash between "captured" and "recorded" for the balance is finished by the repair job, once', async () => {
        await request1(); await payAdvance(); await go('preparing', 'ready');
        const s = (await startBalance()).body;
        const pid = capture(s);
        mock.method(BulkOrder, 'findOneAndUpdate', () => ({ lean: () => Promise.reject(new Error('server died')) }), { times: 1 });
        assert.equal((await verify(s, pid)).status, 500);
        assert.equal((await row()).payment.balancePaid, undefined);
        await BulkPayment.updateOne({ rzpOrderId: s.rzpOrderId }, { $set: { settleStartedAt: new Date(Date.now() - 5 * 60000) } });
        await reconcile.runPaymentReconcile();
        assert.equal((await row()).payment.balancePaid, true);
        await go('delivered');
        assert.equal((await row()).status, 'completed');
    });

    /* ------------------------------ cancelling on the way ------------------------------ */
    test('the shop cancels after the customer paid the balance online: both payments go back, once each', async () => {
        await request1(); await payAdvance(); await go('preparing', 'ready');
        await payBalance();
        const send = spyRefund();
        const c = await owner('post', `/${id}/cancel`, { reason: 'Our kitchen caught fire' });
        assert.equal(c.status, 200, JSON.stringify(c.body));
        assert.equal(send.mock.callCount(), 2);
        assert.deepEqual(send.mock.calls.map((x) => x.arguments[0].amountPaise).sort(), [PART, PART]);
        const cur = await row();
        assert.deepEqual([cur.status, cur.payment.refundStatus, cur.payment.refundPaise], ['cancelled', 'refunded', 2 * PART]);
        await reconcile.runPaymentReconcile();
        assert.equal(send.mock.callCount(), 2);
    });

    test('the shop cancels after taking the balance in cash: only the advance goes back, the cash is for the owner to return', async () => {
        await request1(); await payAdvance(); await go('preparing', 'ready');
        await owner('post', `/${id}/cash-received`);
        const send = spyRefund();
        const c = await owner('post', `/${id}/cancel`, { reason: 'Sorry' });
        assert.equal(c.body.payment.balanceVia, 'cash');
        assert.equal(send.mock.callCount(), 1);
        assert.equal(send.mock.calls[0].arguments[0].amountPaise, PART);
    });

    test('the shop cannot cancel a delivered order, and the customer cannot cancel once it is being made', async () => {
        await request1(); await payAdvance(); await go('preparing');
        assert.equal((await cust('post', `/${id}/cancel`)).status, 409);
        await go('ready', 'delivered');
        assert.equal((await owner('post', `/${id}/cancel`, { reason: 'x' })).status, 409);
    });

    test('a customer who cancels too late: the shop keeps the advance, and that counts for the rent', async () => {
        await request1(); await payAdvance();
        await BulkOrder.updateOne({ _id: id }, { $set: { when: new Date(Date.now() + 10 * 3600000) } });
        const send = spyRefund();
        await cust('post', `/${id}/cancel`);
        assert.equal(send.mock.callCount(), 0);
        await waitFor(async () => (await row()).billing?.billable);
        assert.deepEqual([(await row()).billing.billable, (await row()).billing.reason], [true, 'cancel_kept']);
        assert.equal(await billable.countInPeriod(w.tenant._id, period()), 1);
    });

    /* ------------------------------ the invoice ------------------------------ */
    const pdf = (req) => req.buffer().parse((res, cb) => { const d = []; res.on('data', (c) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });

    test('the invoice is ready only for a completed order, for its customer and its shop', async () => {
        await request1({ contact: { name: 'Raj', phone: '9000000051', company: 'Acme Ltd', gstin: '27AAAAA0000A1Z5' } }); await payAdvance(); await go('preparing', 'ready');
        assert.equal((await cust('get', `/${id}/invoice`)).status, 409);
        assert.equal((await owner('get', `/${id}/invoice`)).status, 409);
        await owner('post', `/${id}/cash-received`); await go('delivered');
        assert.equal((await row()).status, 'completed');

        const c = await pdf(request(app).get(`/api/bulk/${id}/invoice`).set(w.customer.headers));
        assert.equal(c.status, 200);
        assert.match(c.headers['content-type'], /pdf/);
        assert.equal(c.body.slice(0, 4).toString(), '%PDF');
        const o = await pdf(request(app).get(`/api/shop/bulk/${id}/invoice`).set(w.owner.headers));
        assert.equal(o.status, 200);
        assert.equal(o.body.slice(0, 4).toString(), '%PDF');

        const other = await makeUser(w.tenant, 'customer', '9111111177');
        assert.equal((await request(app).get(`/api/bulk/${id}/invoice`).set(other.headers)).status, 404);
    });

    test('the invoice carries what the customer paid: the numbers match the quote', async () => {
        await request1({ contact: { name: 'Raj', phone: '9000000051', company: 'Acme Ltd', gstin: '27AAAAA0000A1Z5' } }); await payAdvance(); await go('preparing', 'ready');
        await owner('post', `/${id}/cash-received`); await go('delivered');
        const { invoiceFor } = require('../src/services/bulkOrders');
        const { order } = await invoiceFor({ tenant: w.tenant, id });
        assert.equal(order.orderNo, `B${(await row()).code}`);
        assert.equal(order.pricing.total, 10000);
        assert.equal(order.customer.name, 'Acme Ltd');
        assert.equal(order.customer.gstin, '27AAAAA0000A1Z5');
        assert.deepEqual(order.paidParts, [['Advance paid (online)', 'Rs. 5000.00'], ['Balance paid (cash)', 'Rs. 5000.00']]);
        assert.equal(order.items.reduce((s, l) => s + l.lineTotal, 0), 10000);
    });
});
