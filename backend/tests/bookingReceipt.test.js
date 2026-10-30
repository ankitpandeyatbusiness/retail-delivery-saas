require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const Tenant = require('../src/models/Tenant');
const TableBooking = require('../src/models/TableBooking');
const Notification = require('../src/models/Notification');
const pushChannel = require('../src/notifications/channels/push');
const payments = require('../src/services/adapters/payments');
const tb = require('../src/services/tableBooking');
const receipt = require('../src/services/bookingReceipt');

// The deposit of a table booking comes with a receipt, the same for the guest and the owner.
let w; let n = 0; let slug;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
    slug = `receipt-${++n}`;
    w = await f.makeWorld(slug);
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'business.legalName': 'Spice Garden Foods Pvt Ltd', 'business.gstin': '09ABCDE1234F1Z5', phone: '9811111111' } });
    tenantRecognizer.invalidateTenant(slug);
});
afterEach(() => mock.restoreAll());

const MIN = 60000;
const paid = (o = {}) => TableBooking.create({
    tenantId: w.tenant._id, userId: w.customer.user._id, code: 'ABCDE', name: 'Anil', phone: '9000000030', date: '2026-11-20', time: '20:00', party: 4,
    startsAt: new Date(Date.now() + 60 * MIN), endsAt: new Date(Date.now() + 120 * MIN), status: 'confirmed', rules: { refundHours: 2, depositMode: 'adjust' },
    seller: { name: 'Spice Garden Foods Pvt Ltd', gstin: '09ABCDE1234F1Z5' }, deposit: { amount: 800, status: 'paid' },
    payment: { rzpOrderId: 'order_x', rzpPaymentId: 'pay_x1', amountPaise: 80000, paidAt: new Date() }, ...o,
});
const pdf = (headers, path) => request(app).get(path).set(headers).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });

describe('booking receipt', () => {
    test('the guest and the owner both download it as a PDF', async () => {
        const b = await paid();
        const g = await pdf(w.customer.headers, `/api/bookings/${b._id}/receipt`);
        assert.equal(g.status, 200);
        assert.match(g.headers['content-type'], /application\/pdf/);
        assert.equal(g.body.slice(0, 4).toString(), '%PDF');
        assert.match(g.headers['content-disposition'], /Booking-ABCDE-receipt\.pdf/);
        const o = await pdf(w.owner.headers, `/api/shop/booking/${b._id}/receipt`);
        assert.equal(o.status, 200);
        assert.equal(o.body.slice(0, 4).toString(), '%PDF');
    });

    test('only the guest\'s own booking, and only when a deposit was paid', async () => {
        const b = await paid();
        const other = await f.makeUser(w.tenant, 'customer', '9000000077');
        assert.equal((await pdf(other.headers, `/api/bookings/${b._id}/receipt`)).status, 404);
        const unpaid = await paid({ code: 'UNPAI', deposit: { amount: 800, status: 'unpaid' }, payment: { rzpOrderId: 'order_y' }, status: 'held' });
        assert.equal((await pdf(w.customer.headers, `/api/bookings/${unpaid._id}/receipt`)).status, 404);
        assert.equal((await pdf(w.customer.headers, '/api/bookings/000000000000000000000000/receipt')).status, 404);
    });

    test('it says the amount, the code, the shop\'s GSTIN and what became of the deposit', async () => {
        const b = (o) => receipt.dataFor(paid_(o), { name: 'x' });
        const base = { code: 'ABCDE', name: 'Anil', phone: '1', date: '2026-11-20', time: '20:00', party: 4, status: 'confirmed', rules: { refundHours: 2, depositMode: 'adjust' }, seller: { name: 'Spice Garden', gstin: '09ABCDE1234F1Z5' }, payment: { rzpPaymentId: 'pay_x1', paidAt: new Date() } };
        function paid_(o) { return { ...base, ...o, deposit: { amount: 800, ...(o.deposit || {}) } }; }
        const d = b({ deposit: { status: 'paid' } });
        assert.deepEqual([d.receiptNo, d.amount, d.shop.gstin, d.paymentId], ['BK-ABCDE', 800, '09ABCDE1234F1Z5', 'pay_x1']);
        assert.match(d.outcome.text, /taken off your table bill/i);
        assert.match(b({ deposit: { status: 'adjusted' } }).outcome.text, /Taken off your table bill/);
        assert.match(b({ rules: { depositMode: 'keep' }, deposit: { status: 'paid' } }).outcome.text, /keeps it as the booking amount/);
        assert.match(b({ status: 'no_show', deposit: { status: 'kept' } }).outcome.text, /not used/);
        assert.match(b({ status: 'cancelled', deposit: { status: 'kept' } }).outcome.text, /after the free cancellation time/);
        const r = b({ status: 'cancelled', cancelNote: 'We are closed that day.', deposit: { status: 'refunded', refundId: 'rfnd_1', refundedAt: new Date() } });
        assert.match(r.outcome.text, /^Refunded on/);
        assert.deepEqual([r.refundId, r.cancelNote], ['rfnd_1', 'We are closed that day.']);
        assert.match(b({ deposit: { status: 'refunding' } }).outcome.text, /on its way/);
    });
});

describe('the receipt follows a real payment', () => {
    const sign = (orderId, paymentId) => crypto.createHmac('sha256', 'mock_key_secret').update(`${orderId}|${paymentId}`).digest('hex');

    test('paying saves the shop\'s details, tells the guest, and the receipt is ready', async () => {
        const date = tb.addDays(tb.todayYmd(), 2);
        const s = await request(app).put('/api/shop/booking/settings').set(w.owner.headers).send({ windows: [{ days: [], open: '19:00', close: '21:00' }], seatsPerSlot: 20, depositAmount: 200, enabled: true });
        assert.equal(s.status, 200, JSON.stringify(s.body));
        const r = await request(app).post('/api/bookings').set(w.customer.headers).send({ date, time: '19:00', party: 2, name: 'Anil', phone: '9000000030' });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        assert.equal((await pdf(w.customer.headers, `/api/bookings/${r.body.booking._id}/receipt`)).status, 404);   // nothing paid yet
        payments._mock.setPayment({ id: 'pay_r1', orderId: r.body.pay.rzpOrderId, status: 'captured', amountPaise: r.body.pay.amountPaise });
        const v = await request(app).post(`/api/bookings/${r.body.booking._id}/verify`).set(w.customer.headers).send({ razorpay_order_id: r.body.pay.rzpOrderId, razorpay_payment_id: 'pay_r1', razorpay_signature: sign(r.body.pay.rzpOrderId, 'pay_r1') });
        assert.equal(v.body.paid, true);
        const row = await TableBooking.findById(r.body.booking._id).lean();
        assert.deepEqual([row.seller.name, row.seller.gstin], ['Spice Garden Foods Pvt Ltd', '09ABCDE1234F1Z5']);
        await new Promise((x) => setTimeout(x, 300));
        const note = await Notification.findOne({ userId: w.customer.user._id, type: 'booking_paid' }).lean();
        assert.match(note.body, /Deposit of Rs\. 400 paid/);
        assert.match(note.body, /Download receipt/);
        assert.equal((await pdf(w.customer.headers, `/api/bookings/${r.body.booking._id}/receipt`)).status, 200);
        // the shop changes its GSTIN later: the receipt keeps the one it was paid under
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'business.gstin': '09ZZZZZ9999Z1Z9' } });
        assert.equal(receipt.dataFor(await TableBooking.findById(row._id).lean(), { name: 'x', business: { gstin: '09ZZZZZ9999Z1Z9' } }).shop.gstin, '09ABCDE1234F1Z5');
    });
});
