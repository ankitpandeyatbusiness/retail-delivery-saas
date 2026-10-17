require('./helpers/env');
// Rent that is not paid: a late fee every overdue month (5% of the bill, plus GST) as its own invoice, a reminder every
// 3 days, a statement of everything owed, and ONE payment that settles it all.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const payments = require('../src/services/adapters/payments');
const lateFees = require('../src/services/lateFees');
const { runAlerts } = require('../src/services/billingAlerts');
const PlatformSettings = require('../src/models/PlatformSettings');
const SubscriptionInvoice = require('../src/models/SubscriptionInvoice');
const CreditNote = require('../src/models/CreditNote');
const Notification = require('../src/models/Notification');
const DuesPayment = require('../src/models/DuesPayment');

const DAY = 86400000;
let w; let n = 0; let boss;
const call = (m, path, body) => request(app)[m](`/api/shop${path}`).set(w.owner.headers).send(body);
const sign = (orderId, paymentId) => crypto.createHmac('sha256', 'mock_key_secret').update(`${orderId}|${paymentId}`).digest('hex');

// a monthly bill of Rs 3000 + 18% GST that was due `daysAgo` days ago
const monthly = (daysAgo, o = {}) => SubscriptionInvoice.create({
    tenantId: w.tenant._id, kind: 'monthly', period: o.period || '2026-08', invoiceNo: `SUB/LF/${++n}`,
    issueDate: new Date(Date.now() - (daysAgo + 7) * DAY), dueDate: new Date(Date.now() - daysAgo * DAY),
    baseAmount: 3000, gstPercent: 18, gstAmount: 540, total: 3540, status: 'pending',
    lineItems: [{ description: 'App subscription', qty: 1, rate: 3000, amount: 3000 }],
    seller: { legalName: 'Operator Pvt Ltd' }, buyer: { legalName: w.tenant.name }, ...o,
});
const fees = (inv) => SubscriptionInvoice.find({ 'lateFee.forInvoiceId': inv._id }).sort({ 'lateFee.month': 1 }).lean();

before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    payments._mock.reset();
    await PlatformSettings.findByIdAndUpdate('main', {
        $set: {
            'business.legalName': 'Operator Pvt Ltd', 'business.address': '1 Main Road, Lucknow', 'business.gstin': '09AAAAA0000A1Z5',
            'business.pan': 'AAAAA0000A', 'business.state': 'Uttar Pradesh', 'business.stateCode': '09', 'business.sacCode': '998314',
        },
        $unset: { billing: 1 },
    }, { upsert: true });
    w = await f.makeWorld('lf-shop');
    tenantRecognizer.invalidateTenant('lf-shop');
    boss = await f.makeSuperAdmin('boss@example.com');
});

describe('late fee', () => {
    test('nothing before a full overdue month; then 5% of the bill plus 18% GST, as its own invoice with the working shown', async () => {
        const b = await monthly(20);
        assert.equal((await lateFees.run()).issued, 0);
        await SubscriptionInvoice.updateOne({ _id: b._id }, { $set: { dueDate: new Date(Date.now() - 31 * DAY) } });
        assert.equal((await lateFees.run()).issued, 1);
        const [fee] = await fees(b);
        assert.equal(fee.baseAmount, 150);
        assert.equal(fee.gstAmount, 27);
        assert.equal(fee.total, 177);
        assert.equal(fee.status, 'pending');
        assert.equal(fee.graceEndsAt, undefined, 'a late fee never pauses the shop on its own');
        assert.match(fee.lineItems[0].description, /Overdue month 1/);
        assert.match(fee.lineItems[0].description, /5% of Rs 3000/);
        assert.match(fee.lineItems[0].description, new RegExp(b.invoiceNo.replace(/\//g, '\\/')));
        assert.ok(fee.invoiceNo && fee.invoiceNo !== b.invoiceNo);
    });

    test('one fee per month, never twice; a month missed by the job is caught up; there is no fee on a fee', async () => {
        const b = await monthly(95);   // three full months overdue
        assert.equal((await lateFees.run()).issued, 3);
        assert.equal((await lateFees.run()).issued, 0, 'running again adds nothing');
        const list = await fees(b);
        assert.deepEqual(list.map((x) => x.lateFee.month), [1, 2, 3]);
        assert.deepEqual(list.map((x) => x.total), [177, 177, 177], 'each month is 5% of the bill, not of the earlier fees');
        assert.equal(await SubscriptionInvoice.countDocuments({ 'lateFee.forInvoiceId': { $in: list.map((x) => x._id) } }), 0);
    });

    test('a paid bill earns no more fees, but the fees already issued stay to be paid', async () => {
        const b = await monthly(35);
        await lateFees.run();
        await SubscriptionInvoice.updateOne({ _id: b._id }, { $set: { status: 'paid', paidAt: new Date() } });
        await SubscriptionInvoice.updateOne({ _id: b._id }, { $set: { dueDate: new Date(Date.now() - 100 * DAY) } });
        assert.equal((await lateFees.run()).issued, 0);
        assert.equal((await fees(b)).filter((x) => x.status === 'pending').length, 1);
    });

    test('the rate and the month length are settings; 0 switches the late fee off', async () => {
        const b = await monthly(70);
        await PlatformSettings.updateOne({ _id: 'main' }, { $set: { 'billing.lateFeePercent': 0 } });
        assert.equal((await lateFees.run()).issued, 0);
        await PlatformSettings.updateOne({ _id: 'main' }, { $set: { 'billing.lateFeePercent': 10, 'billing.lateFeeEveryDays': 10 } });
        assert.equal((await lateFees.run()).issued, 7);
        assert.equal((await fees(b))[0].baseAmount, 300);
        const put = await request(app).put('/api/admin/platform/billing').set({ Authorization: `Bearer ${boss.token}` }).send({ lateFeePercent: 5, lateFeeEveryDays: 30, overdueRemindDays: 3 });
        assert.equal(put.status, 200, JSON.stringify(put.body));
        assert.equal(put.body.lateFeePercent, 5);
        assert.equal((await request(app).put('/api/admin/platform/billing').set({ Authorization: `Bearer ${boss.token}` }).send({ lateFeePercent: 101 })).status, 400);
    });

    test('waiving the bill cancels its unpaid late fees, each with a credit note', async () => {
        const b = await monthly(65);
        await lateFees.run();
        const r = await request(app).patch(`/api/admin/subscriptions/invoices/${b._id}/waive`).set({ Authorization: `Bearer ${boss.token}` }).send({});
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const list = await fees(b);
        assert.equal(list.length, 2);
        assert.ok(list.every((x) => x.status === 'void'));
        assert.equal(await CreditNote.countDocuments({ originalInvoiceId: { $in: list.map((x) => x._id) } }), 2);
    });
});

describe('waive all late fees of one shop', () => {
    const waive = (token, tenantId, body) => request(app).post(`/api/admin/tenants/${tenantId}/invoices/late-fees/waive-all`).set({ Authorization: `Bearer ${token}` }).send(body);

    test('every unpaid late fee of that shop is cancelled with a credit note; the rent bills and other shops are untouched', async () => {
        const a = await monthly(65, { period: '2026-07' });
        const b = await monthly(35, { period: '2026-08' });
        const other = await f.makeWorld('lf-waive-other');
        const theirs = await SubscriptionInvoice.create({
            tenantId: other.tenant._id, kind: 'monthly', period: '2026-08', invoiceNo: 'SUB/LF/OTHER', issueDate: new Date(Date.now() - 42 * DAY), dueDate: new Date(Date.now() - 35 * DAY),
            baseAmount: 3000, gstPercent: 18, gstAmount: 540, total: 3540, status: 'pending', lineItems: [{ description: 'x', qty: 1, rate: 3000, amount: 3000 }],
        });
        await lateFees.run();
        const st = await call('get', '/billing/status');
        assert.deepEqual([st.body.lateFees.count, st.body.lateFees.amount], [3, 531]);

        assert.equal((await waive(boss.token, w.tenant._id, {})).status, 400, 'a reason is needed');
        const r = await waive(boss.token, w.tenant._id, { reason: 'Goodwill' });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.deepEqual([r.body.waived, r.body.amount], [3, 531]);

        const mine = await SubscriptionInvoice.find({ tenantId: w.tenant._id, 'lateFee.forInvoiceId': { $exists: true } }).lean();
        assert.ok(mine.length === 3 && mine.every((x) => x.status === 'void' && x.voidReason === 'Goodwill'));
        assert.equal(await CreditNote.countDocuments({ originalInvoiceId: { $in: mine.map((x) => x._id) } }), 3);
        assert.equal((await SubscriptionInvoice.findById(a._id).lean()).status, 'pending');
        assert.equal((await SubscriptionInvoice.findById(b._id).lean()).status, 'pending');
        assert.equal((await call('get', '/billing/status')).body.lateFees.count, 0);
        assert.equal((await call('get', '/subscription/dues')).body.grandTotal, 7080, 'only the rent is left to pay');
        assert.equal((await SubscriptionInvoice.findById(theirs._id).lean()).status, 'pending');
        assert.equal((await waive(boss.token, w.tenant._id, { reason: 'again' })).body.waived, 0, 'a second tap changes nothing');
        assert.equal((await lateFees.run()).issued, 0, 'a waived month is not made again');
    });

    test('only the supreme admin can do it', async () => {
        await monthly(35);
        await lateFees.run();
        const ordinary = await f.makeSuperAdmin('vivek@example.com', { phones: ['9876543210'] });
        assert.equal((await waive(ordinary.token, w.tenant._id, { reason: 'x' })).status, 403);
        assert.equal(await SubscriptionInvoice.countDocuments({ tenantId: w.tenant._id, 'lateFee.forInvoiceId': { $exists: true }, status: 'pending' }), 1);
    });
});

describe('reminders every 3 days', () => {
    const overdueNotes = () => Notification.find({ tenantId: w.tenant._id, type: 'bill_overdue' }).lean();

    test('an overdue shop is told once, not again before 3 days, and the message says what it owes with the late fee apart', async () => {
        await monthly(35);
        await runAlerts();
        let list = await overdueNotes();
        assert.equal(list.length, 1);
        assert.match(list[0].body, /Rs 3717/);          // 3540 rent + 177 late fee
        assert.match(list[0].body, /Rs 177 late fee/);
        await runAlerts();
        assert.equal((await overdueNotes()).length, 1);
        await Notification.collection.updateMany({ tenantId: w.tenant._id, type: 'bill_overdue' }, { $set: { createdAt: new Date(Date.now() - 3 * DAY - 60000) } });   // raw: createdAt cannot be changed through the model
        await runAlerts();
        assert.equal((await overdueNotes()).length, 2);
    });

    test('a bill that is not yet past its due date gets no overdue message, and a paid shop gets none', async () => {
        await monthly(-2);
        await runAlerts();
        assert.equal((await overdueNotes()).length, 0);
        const b = await monthly(10, { period: '2026-07' });
        await SubscriptionInvoice.updateOne({ _id: b._id }, { $set: { status: 'paid' } });
        await SubscriptionInvoice.deleteMany({ dueDate: { $gt: new Date() } });
        await runAlerts();
        assert.equal((await overdueNotes()).length, 0);
    });
});

describe('what he owes and paying it all at once', () => {
    test('the statement lists each month with its late fees and one grand total', async () => {
        await monthly(65, { period: '2026-07' });
        await monthly(35, { period: '2026-08' });
        await lateFees.run();
        const r = await call('get', '/subscription/dues');
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.rows.length, 2);
        assert.equal(r.body.rows[0].label, 'July 2026');
        assert.equal(r.body.rows[0].lateFees.length, 2);
        assert.equal(r.body.rows[1].lateFees.length, 1);
        assert.equal(r.body.rows[0].lateFees[0].onAmount, 3000);
        assert.equal(r.body.rentTotal, 7080);
        assert.equal(r.body.lateFeeTotal, 531);          // three fees of 177
        assert.equal(r.body.grandTotal, 7611);
        assert.match(r.body.rule.text, /5%/);
    });

    test('one payment for the grand total settles every bill and fee; a repeat changes nothing', async () => {
        const a = await monthly(65, { period: '2026-07' });
        const b = await monthly(35, { period: '2026-08' });
        await lateFees.run();
        const s = (await call('post', '/subscription/dues/pay/start')).body;
        assert.equal(s.amountPaise, 761100);
        assert.equal(s.bills, 5);
        assert.equal((await call('post', '/subscription/dues/pay/start')).body.rzpOrderId, s.rzpOrderId, 'the same order while the bills are the same');
        payments._mock.setPayment({ id: 'pay_d1', orderId: s.rzpOrderId, status: 'captured', amountPaise: 761100, capturedPaise: 761100, refundedPaise: 0, method: 'upi', notes: {} });
        const v = await call('post', '/subscription/dues/pay/verify', { razorpay_order_id: s.rzpOrderId, razorpay_payment_id: 'pay_d1', razorpay_signature: sign(s.rzpOrderId, 'pay_d1') });
        assert.equal(v.body.paid, true, JSON.stringify(v.body));
        assert.equal(await SubscriptionInvoice.countDocuments({ tenantId: w.tenant._id, status: 'pending' }), 0);
        assert.equal((await SubscriptionInvoice.findById(a._id).lean()).paymentRef, 'pay_d1');
        assert.equal((await DuesPayment.findOne({ rzpOrderId: s.rzpOrderId }).lean()).status, 'paid');
        assert.equal((await call('post', '/subscription/dues/pay/verify', { razorpay_order_id: s.rzpOrderId, razorpay_payment_id: 'pay_d1', razorpay_signature: sign(s.rzpOrderId, 'pay_d1') })).body.paid, true);
        assert.equal((await call('post', '/subscription/dues/pay/start')).status, 409, 'nothing is due any more');
        assert.equal((await call('get', '/subscription/dues')).body.grandTotal, 0);
        assert.ok(b);
    });

    test('a wrong amount, a forged proof or an unpaid payment settles nothing', async () => {
        await monthly(35);
        await lateFees.run();
        const s = (await call('post', '/subscription/dues/pay/start')).body;
        payments._mock.setPayment({ id: 'pay_d2', orderId: s.rzpOrderId, status: 'captured', amountPaise: 354000, capturedPaise: 354000, refundedPaise: 0, method: 'upi', notes: {} });   // the rent only, without the fee
        const short = await call('post', '/subscription/dues/pay/verify', { razorpay_order_id: s.rzpOrderId, razorpay_payment_id: 'pay_d2', razorpay_signature: sign(s.rzpOrderId, 'pay_d2') });
        assert.equal(short.body.paid, false);
        assert.equal((await call('post', '/subscription/dues/pay/verify', { razorpay_order_id: s.rzpOrderId, razorpay_payment_id: 'pay_d2', razorpay_signature: 'f'.repeat(64) })).status, 400);
        assert.equal((await call('post', '/subscription/dues/pay/verify', { razorpay_order_id: 'order_x', razorpay_payment_id: 'pay_d2', razorpay_signature: sign('order_x', 'pay_d2') })).status, 404);
        assert.equal(await SubscriptionInvoice.countDocuments({ tenantId: w.tenant._id, status: 'pending' }), 2);
    });

    test('another shop cannot see or pay these bills', async () => {
        await monthly(35);
        const other = await f.makeWorld('lf-other');
        tenantRecognizer.invalidateTenant('lf-other');
        const r = await request(app).get('/api/shop/subscription/dues').set(other.owner.headers);
        assert.equal(r.body.grandTotal, 0);
        assert.equal((await request(app).post('/api/shop/subscription/dues/pay/start').set(other.owner.headers)).status, 409);
    });
});
