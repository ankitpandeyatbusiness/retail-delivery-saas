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
const Order = require('../src/models/Order');
const TableSession = require('../src/models/TableSession');
const TableBooking = require('../src/models/TableBooking');
const Notification = require('../src/models/Notification');
const pushChannel = require('../src/notifications/channels/push');
const tableBill = require('../src/services/tableBill');
const tablePayment = require('../src/services/tablePayment');
const pdf = require('../src/services/tableBillPdf');
const payments = require('../src/services/adapters/payments');

// A guest paid a deposit when he booked; at the table it comes off his bill (adjust mode) or stays with the shop (keep mode).
let w; let n = 0; let slug;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
    slug = `credit-${++n}`;
    w = await f.makeWorld(slug);
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.dineIn': { enabled: true, tableCount: 10 } } });
    tenantRecognizer.invalidateTenant(slug);
});
afterEach(() => mock.restoreAll());

const ist = (ms) => new Date(Date.now() + ms + 330 * 60000).toISOString();
// a confirmed, paid booking that starts `inMin` minutes from now
const paidBooking = (user, { inMin = 30, mode = 'adjust', amount = 800 } = {}) => TableBooking.create({
    tenantId: w.tenant._id, userId: user.user._id, code: 'ABCDE', name: 'Anil', phone: '9000000030', date: ist(0).slice(0, 10), time: ist(inMin * 60000).slice(11, 16),
    startsAt: new Date(Date.now() + inMin * 60000), party: 4, status: 'confirmed', rules: { refundHours: 2, depositMode: mode },
    deposit: { amount, status: 'paid' }, payment: { rzpOrderId: 'order_x', rzpPaymentId: 'pay_x', amountPaise: amount * 100 },
});
const sit = (g, table = '4') => tableBill.joinOrOpen({ tenantId: w.tenant._id, table, userId: g.user._id });
const round = (g, s, total) => f.makeOrder(w.tenant, g.user, { orderType: 'dine_in', tableNo: s.table, tableSessionId: s._id, status: 'delivered', pricing: { subtotal: total, total } });
const owner = (method, path, body) => request(app)[method](`/api/shop${path}`).set(w.owner.headers).send(body);
const sign = (orderId, paymentId) => crypto.createHmac('sha256', 'mock_key_secret').update(`${orderId}|${paymentId}`).digest('hex');

describe('the deposit taken off the table bill', () => {
    test('sitting down attaches the deposit and the bill asks for the rest', async () => {
        const g = w.customer;
        const b = await paidBooking(g);
        const s = await sit(g);
        assert.equal(s.credit.amount, 800);
        const bk = await TableBooking.findById(b._id).lean();
        assert.deepEqual([bk.status, bk.deposit.status, bk.deposit.credit], ['seated', 'adjusted', 'applied']);
        await round(g, s, 1000);
        const bill = await tableBill.billOf(await TableSession.findById(s._id), { owner: false });
        assert.equal(bill.due, 1000);
        assert.deepEqual([bill.credit.applied, bill.credit.code, bill.payable], [800, 'ABCDE', 200]);
    });

    test('a small bill takes only what it needs; the shop keeps the rest', async () => {
        const g = w.customer;
        await paidBooking(g);
        const s = await sit(g);
        await round(g, s, 500);
        const bill = await tableBill.billOf(await TableSession.findById(s._id), { owner: false });
        assert.deepEqual([bill.credit.applied, bill.payable], [500, 0]);
    });

    test('the waiter settles: the bill is paid, the deposit is used, and the bill still states it', async () => {
        const g = w.customer;
        await paidBooking(g);
        const s = await sit(g);
        await round(g, s, 1000);
        await tableBill.settle({ tenantId: w.tenant._id, sessionId: s._id, method: 'cash', by: { type: 'owner' } });
        const done = await TableSession.findById(s._id).lean();
        assert.deepEqual([done.status, done.credit.used, done.credit.appliedAmount], ['closed', true, 800]);
        assert.equal((await Order.find({ tableSessionId: s._id }).lean()).every((o) => o.payment.status === 'paid'), true);
        const data = await pdf.dataFor(done, await Tenant.findById(w.tenant._id).lean());
        assert.deepEqual([data.credit.applied, data.credit.code, data.paid, data.due, data.total], [800, 'ABCDE', 200, 0, 1000]);
    });

    test('paying online asks only for what is left, and uses up the deposit when it is captured', async () => {
        const g = w.customer;
        await paidBooking(g);
        const s = await sit(g);
        await round(g, s, 1000);
        const start = await tablePayment.start({ tenantId: w.tenant._id, userId: g.user._id });
        assert.equal(start.amountPaise, 20000);
        const pid = 'pay_t1';
        payments._mock.setPayment({ id: pid, orderId: start.rzpOrderId, status: 'captured', amountPaise: 20000 });
        const r = await tablePayment.verify({ tenantId: w.tenant._id, userId: g.user._id, rzpOrderId: start.rzpOrderId, rzpPaymentId: pid, signature: sign(start.rzpOrderId, pid) });
        assert.equal(r.paid, true);
        const after = await TableSession.findById(s._id).lean();
        assert.deepEqual([after.credit.used, after.credit.appliedAmount], [true, 800]);
        assert.equal((await Order.find({ tableSessionId: s._id }).lean()).every((o) => o.payment.status === 'paid'), true);
    });

    test('a bill the deposit covers needs no online payment at all', async () => {
        const g = w.customer;
        await paidBooking(g);
        const s = await sit(g);
        await round(g, s, 500);
        assert.deepEqual(await tablePayment.start({ tenantId: w.tenant._id, userId: g.user._id }), { settled: true });
        assert.equal((await Order.find({ tableSessionId: s._id }).lean()).every((o) => o.payment.status === 'paid' && o.payment.settledVia === 'deposit'), true);
        assert.equal((await TableSession.findById(s._id).lean()).credit.appliedAmount, 500);
    });

    test('keep mode never touches the bill; a booking for another time is not attached', async () => {
        const a = w.customer;
        await paidBooking(a, { mode: 'keep' });
        const s = await sit(a);
        assert.equal(s.credit?.bookingId, undefined);
        await round(a, s, 1000);
        assert.equal((await tableBill.billOf(await TableSession.findById(s._id), { owner: false })).payable, 1000);
        const b = await f.makeUser(w.tenant, 'customer', '9000000031');
        await paidBooking(b, { inMin: 6 * 60 });   // dinner booking, sitting down for lunch
        assert.equal((await sit(b, '5')).credit?.bookingId, undefined);
    });

    test('one deposit is used only once', async () => {
        const g = w.customer;
        await paidBooking(g);
        const s = await sit(g);
        await round(g, s, 1000);
        await tableBill.settle({ tenantId: w.tenant._id, sessionId: s._id, method: 'cash', by: { type: 'owner' } });
        const again = await sit(g, '6');   // a new visit the same evening
        assert.equal(again.credit?.bookingId, undefined);
    });
});

describe('allow and deny', () => {
    test('allow tells the guest the table is confirmed, once', async () => {
        const g = w.customer;
        const b = await paidBooking(g);
        assert.equal((await owner('post', `/booking/${b._id}/allow`)).status, 200);
        assert.equal((await owner('post', `/booking/${b._id}/allow`)).status, 400);
        await new Promise((r) => setTimeout(r, 300));
        const note = await Notification.findOne({ userId: g.user._id, type: 'booking_allowed' }).lean();
        assert.match(note.body, /ABCDE/);
    });

    test('deny sends the whole deposit back at once, with the owner\'s message after the standard one', async () => {
        const g = w.customer;
        const b = await paidBooking(g, { inMin: 24 * 60 });
        const r = await owner('post', `/booking/${b._id}/cancel`, { message: 'Sorry, we have a private event that night.' });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.status, 'cancelled');
        assert.equal(r.body.deposit.status, 'refunded');
        assert.equal(r.body.cancelNote, 'Sorry, we have a private event that night.');
        await new Promise((x) => setTimeout(x, 300));
        const note = await Notification.findOne({ userId: g.user._id, type: 'booking_owner_cancelled' }).lean();
        assert.match(note.body, /full deposit of ₹800 is being refunded/);
        assert.match(note.body, /private event/);
        assert.match(note.body, /Please book another time/);
    });

    test('deny without a message still sends the standard text', async () => {
        const g = w.customer;
        const b = await paidBooking(g, { inMin: 24 * 60 });
        await owner('post', `/booking/${b._id}/cancel`, {});
        await new Promise((x) => setTimeout(x, 300));
        const note = await Notification.findOne({ userId: g.user._id, type: 'booking_owner_cancelled' }).lean();
        assert.match(note.body, /refunded/);
        assert.doesNotMatch(note.body, /undefined/);
    });
});
