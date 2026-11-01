require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeWorld, makeUser } = require('./helpers/factory');
const Order = require('../src/models/Order');
const OnlineRefund = require('../src/models/OnlineRefund');
const TableBooking = require('../src/models/TableBooking');
const payments = require('../src/services/adapters/payments');
const paymentService = require('../src/services/paymentService');
const orderService = require('../src/services/orderService');

// "If you cancel now you get Rs ... back": the number shown before the customer confirms must be the number he really gets.
let seq = 7000;
const oid = () => new mongoose.Types.ObjectId();
const sign = (a, b) => crypto.createHmac('sha256', paymentService.MOCK_SECRET).update(`${a}|${b}`).digest('hex');
const mk = (w, over = {}) => Order.create({
    tenantId: w.tenant._id, userId: w.customer.user._id, orderNo: ++seq, orderType: 'pickup',
    items: [{ productId: oid(), name: 'Dal', quantity: 1, unitPrice: 100, lineTotal: 100 }],
    pricing: { subtotal: 100, total: 100 }, payment: { method: 'upi', status: 'pending' }, ...over,
});
async function paidOrder(w, over = {}) {
    const order = await mk(w, over);
    const start = await paymentService.startForOrder({ order });
    const payId = `pay_${order.orderNo}`;
    payments._mock.setPayment({ id: payId, orderId: start.rzpOrderId, status: 'captured', amountPaise: 10000, capturedPaise: 10000, refundedPaise: 0, method: 'upi', notes: {} });
    await paymentService.verifyFromApp({ order, rzpOrderId: start.rzpOrderId, rzpPaymentId: payId, signature: sign(start.rzpOrderId, payId) });
    return order;
}
const preview = (w, id, h = w.customer.headers) => request(app).get(`/api/orders/${id}/cancel-preview`).set(h);

describe('the refund shown before cancelling', () => {
    let w;
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(async () => { await db.clear(); payments._mock.reset(); w = await makeWorld(`cp-${++seq}`); });

    test('a free cancel shows the whole amount, and that is what comes back', async () => {
        const o = await paidOrder(w);
        const p = await preview(w, o._id);
        assert.equal(p.status, 200, JSON.stringify(p.body));
        assert.deepEqual([p.body.online, p.body.refundPaise, p.body.keptPaise], [true, 10000, 0]);
        await orderService.cancelByCustomer({ tenant: w.tenant, userId: w.customer.user._id, orderId: o._id });
        assert.equal((await OnlineRefund.findOne({ orderId: o._id }).lean()).amountPaise, p.body.refundPaise);
    });

    test('while preparing the shop keeps half: the preview says so, and matches the refund', async () => {
        const o = await paidOrder(w);
        await Order.updateOne({ _id: o._id }, { $set: { status: 'preparing' } });
        const p = await preview(w, o._id);
        assert.deepEqual([p.body.refundPaise, p.body.keptPaise], [5000, 5000]);
        await orderService.cancelByCustomer({ tenant: w.tenant, userId: w.customer.user._id, orderId: o._id });
        assert.equal((await OnlineRefund.findOne({ orderId: o._id }).lean()).amountPaise, 5000);
    });

    test('the preview changes nothing', async () => {
        const o = await paidOrder(w);
        await preview(w, o._id);
        await preview(w, o._id);
        const cur = await Order.findById(o._id).lean();
        assert.deepEqual([cur.status, cur.payment.status], ['placed', 'paid']);
        assert.equal(await OnlineRefund.countDocuments({ orderId: o._id }), 0);
    });

    test('cash on delivery has nothing to refund; an unpaid online order too', async () => {
        const cod = await mk(w, { payment: { method: 'cod', status: 'pending' } });
        const c = await preview(w, cod._id);
        assert.deepEqual([c.body.online, c.body.refundPaise], [false, 0]);
        const unpaid = await mk(w);
        assert.equal((await preview(w, unpaid._id)).body.refundPaise, 0);
    });

    test('cash on delivery cancelled while the food is on the way: marked as charged', async () => {
        const cod = await mk(w, { payment: { method: 'cod', status: 'pending' }, status: 'preparing' });
        assert.equal((await preview(w, cod._id)).body.charged, true);
    });

    test("nobody can preview another customer's order", async () => {
        const o = await paidOrder(w);
        const other = await makeUser(w.tenant, 'customer', '9111111199');
        assert.equal((await preview(w, o._id, other.headers)).status, 404);
        const { Authorization, authorization, ...noAuth } = w.customer.headers;
        assert.equal((await request(app).get(`/api/orders/${o._id}/cancel-preview`).set(noAuth)).status, 401);   // not logged in
    });
});

describe('the deposit shown before cancelling a booking', () => {
    let w;
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(async () => { await db.clear(); w = await makeWorld(`cpb-${++seq}`); });

    const booking = (hoursAhead, deposit = 'paid') => TableBooking.create({
        tenantId: w.tenant._id, userId: w.customer.user._id, code: 'PPPPP', name: 'Anil', phone: '9000000030', date: '2030-01-01', time: '20:00',
        startsAt: new Date(Date.now() + hoursAhead * 3600000), party: 2, status: 'confirmed', rules: { refundHours: 2 },
        deposit: { amount: 400, status: deposit }, payment: { rzpOrderId: 'order_p', rzpPaymentId: 'pay_p', amountPaise: 40000 },
    });
    const prev = (b, h = w.customer.headers) => request(app).get(`/api/bookings/${b._id}/cancel-preview`).set(h);

    test('early enough: the whole deposit comes back; too late: the restaurant keeps it', async () => {
        const early = await prev(await booking(5));
        assert.equal(early.status, 200, JSON.stringify(early.body));
        assert.deepEqual([early.body.paid, early.body.refundPaise, early.body.keptPaise], [true, 40000, 0]);
        const late = await prev(await booking(1));
        assert.deepEqual([late.body.refundPaise, late.body.keptPaise], [0, 40000]);
    });

    test('an unpaid booking has no deposit to show', async () => {
        const p = await prev(await booking(5, 'unpaid'));
        assert.deepEqual([p.body.paid, p.body.refundPaise, p.body.keptPaise], [false, 0, 0]);
    });

    test('the real cancel agrees with the preview', async () => {
        const b = await booking(5);
        const shown = (await prev(b)).body.refundPaise;
        const done = await request(app).post(`/api/bookings/${b._id}/cancel`).set(w.customer.headers);
        assert.equal(done.status, 200, JSON.stringify(done.body));
        assert.equal(done.body.deposit.status, shown ? 'refunded' : 'kept');
    });

    test("another guest's booking is not visible", async () => {
        const b = await booking(5);
        const other = await makeUser(w.tenant, 'customer', '9111111188');
        assert.equal((await prev(b, other.headers)).status, 404);
    });
});
