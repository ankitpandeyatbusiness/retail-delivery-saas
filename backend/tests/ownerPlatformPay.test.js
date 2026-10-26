require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const request = require('supertest');
const PlatformSettings = require('../src/models/PlatformSettings');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const SubscriptionInvoice = require('../src/models/SubscriptionInvoice');
const SmsTopup = require('../src/models/SmsTopup');
const Notification = require('../src/models/Notification');
const payments = require('../src/services/adapters/payments');
const wallet = require('../src/services/smsWalletService');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');

// The owner pays the platform (rent, SMS top-up) with a UPI app or card, like a customer pays an order;
// the owner can clear his inbox; an owner cannot place an order.
let w; let inv = 0;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    payments._mock.reset();
    await PlatformSettings.findByIdAndUpdate('main', { $set: { 'business.gstin': '22AAAAA0000A1Z5' } }, { upsert: true });   // GST on a top-up needs a registered platform
    w = await f.makeWorld('pp-shop');
    tenantRecognizer.invalidateTenant('pp-shop');
});

const bill = (over = {}) => SubscriptionInvoice.create({
    tenantId: w.tenant._id, kind: 'custom', invoiceNo: `SUB/PP/${++inv}`, issueDate: new Date(), dueDate: new Date(Date.now() + 86400000),
    baseAmount: 1000, total: 1180, status: 'pending', ...over,
});
const call = (m, path, body, headers = w.owner.headers) => request(app)[m](`/api/shop${path}`).set(headers).send(body);
const sign = (orderId, paymentId, secret = 'mock_key_secret') => crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
const proof = (orderId, paymentId, signature) => ({ razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature || sign(orderId, paymentId) });
const captured = (orderId, amountPaise, id = 'pay_1') => payments._mock.setPayment({ id, orderId, status: 'captured', amountPaise, capturedPaise: amountPaise, refundedPaise: 0, method: 'upi', notes: {} });

describe('rent with a UPI app or card', () => {
    test('start makes (and reuses) a Razorpay order for the bill amount', async () => {
        const b = await bill();
        const r = await call('post', `/subscription/invoices/${b._id}/pay/start`);
        assert.equal(r.status, 201, JSON.stringify(r.body));
        assert.equal(r.body.amountPaise, 118000);
        assert.ok(r.body.keyId && r.body.rzpOrderId);
        const again = await call('post', `/subscription/invoices/${b._id}/pay/start`);
        assert.equal(again.body.rzpOrderId, r.body.rzpOrderId, 'the same order while the amount is the same');
    });

    test('a good proof of a captured payment marks the bill paid', async () => {
        const b = await bill();
        const s = (await call('post', `/subscription/invoices/${b._id}/pay/start`)).body;
        captured(s.rzpOrderId, 118000);
        const v = await call('post', `/subscription/invoices/${b._id}/pay/verify`, proof(s.rzpOrderId, 'pay_1'));
        assert.equal(v.status, 200, JSON.stringify(v.body));
        assert.equal(v.body.paid, true);
        const now = await SubscriptionInvoice.findById(b._id).lean();
        assert.equal(now.status, 'paid');
        assert.equal(now.paymentRef, 'pay_1');
        // paying again is harmless
        assert.equal((await call('post', `/subscription/invoices/${b._id}/pay/verify`, proof(s.rzpOrderId, 'pay_1'))).body.paid, true);
        assert.equal((await call('post', `/subscription/invoices/${b._id}/pay/start`)).status, 409, 'a paid bill cannot be started again');
    });

    test('a forged proof, a payment for another order, or one not captured does not pay the bill', async () => {
        const b = await bill();
        const s = (await call('post', `/subscription/invoices/${b._id}/pay/start`)).body;
        captured(s.rzpOrderId, 118000);
        assert.equal((await call('post', `/subscription/invoices/${b._id}/pay/verify`, proof(s.rzpOrderId, 'pay_1', 'f'.repeat(64)))).status, 400);
        assert.equal((await call('post', `/subscription/invoices/${b._id}/pay/verify`, proof('order_other', 'pay_1'))).status, 400);
        payments._mock.setPayment({ id: 'pay_2', orderId: s.rzpOrderId, status: 'authorized', amountPaise: 118000, capturedPaise: 0, refundedPaise: 0, notes: {} });
        const v = await call('post', `/subscription/invoices/${b._id}/pay/verify`, proof(s.rzpOrderId, 'pay_2'));
        assert.equal(v.body.paid, false);
        assert.equal((await SubscriptionInvoice.findById(b._id).lean()).status, 'pending');
    });

    test('the amount must match, and another shop\'s bill cannot be touched', async () => {
        const b = await bill();
        const s = (await call('post', `/subscription/invoices/${b._id}/pay/start`)).body;
        captured(s.rzpOrderId, 100);   // wrong amount
        const v = await call('post', `/subscription/invoices/${b._id}/pay/verify`, proof(s.rzpOrderId, 'pay_1'));
        assert.equal(v.body.paid, false);
        assert.equal((await SubscriptionInvoice.findById(b._id).lean()).status, 'pending');

        const other = await f.makeWorld('pp-other');
        tenantRecognizer.invalidateTenant('pp-other');
        const theirs = await SubscriptionInvoice.create({ tenantId: other.tenant._id, kind: 'custom', invoiceNo: 'SUB/PP/X', issueDate: new Date(), dueDate: new Date(), baseAmount: 1000, total: 1000, status: 'pending' });
        assert.equal((await call('post', `/subscription/invoices/${theirs._id}/pay/start`)).status, 404);
    });
});

describe('SMS top-up with a UPI app or card', () => {
    test('start, pay, verify: the balance goes up once', async () => {
        const s = (await call('post', '/sms/topup/start', { amountPaise: 10000 })).body;
        assert.ok(s.topupId && s.rzpOrderId);
        assert.equal(s.amountPaise, 11800, 'he pays the amount plus 18% GST');
        assert.equal(s.creditPaise, 10000);
        assert.equal(s.gstPaise, 1800);
        captured(s.rzpOrderId, 11800, 'pay_t1');
        const v = await call('post', `/sms/topup/${s.topupId}/verify`, proof(s.rzpOrderId, 'pay_t1'));
        assert.equal(v.body.paid, true, JSON.stringify(v.body));
        assert.equal((await wallet.status(w.tenant._id)).balancePaise, 10000);
        await call('post', `/sms/topup/${s.topupId}/verify`, proof(s.rzpOrderId, 'pay_t1'));
        assert.equal((await wallet.status(w.tenant._id)).balancePaise, 10000, 'a repeat adds nothing');
        assert.equal((await SmsTopup.findById(s.topupId).lean()).status, 'paid');
    });

    test('the options say GST is added on top, the minimum is Rs 100, and paying only the amount without GST credits nothing', async () => {
        const o = (await call('get', '/sms/topup/options')).body;
        assert.equal(o.gstPercent, 18);
        assert.equal(o.minPaise, 10000);
        assert.equal((await call('post', '/sms/topup/start', { amountPaise: 9900 })).status, 400);
        const s = (await call('post', '/sms/topup/start', { amountPaise: 25000 })).body;
        assert.equal(s.amountPaise, 29500);
        captured(s.rzpOrderId, 25000, 'pay_short');
        const v = await call('post', `/sms/topup/${s.topupId}/verify`, proof(s.rzpOrderId, 'pay_short'));
        assert.equal(v.status, 409);
        assert.equal((await wallet.status(w.tenant._id)).balancePaise, 0);
    });

    test('without a GST number on the platform business no GST is charged', async () => {
        await PlatformSettings.findByIdAndUpdate('main', { $unset: { 'business.gstin': '' } });
        const o = (await call('get', '/sms/topup/options')).body;
        assert.equal(o.gstPercent, 0);
        const s = (await call('post', '/sms/topup/start', { amountPaise: 10000 })).body;
        assert.equal(s.amountPaise, 10000);
        assert.equal(s.gstPaise, 0);
    });

    test('too small an amount and a forged proof are refused', async () => {
        assert.equal((await call('post', '/sms/topup/start', { amountPaise: 5 })).status, 400);
        const s = (await call('post', '/sms/topup/start', { amountPaise: 10000 })).body;
        captured(s.rzpOrderId, 11800, 'pay_t2');
        assert.equal((await call('post', `/sms/topup/${s.topupId}/verify`, proof(s.rzpOrderId, 'pay_t2', 'a'.repeat(64)))).status, 400);
        assert.equal((await wallet.status(w.tenant._id)).balancePaise, 0);
    });

    test('the webhook credits it if the app never came back', async () => {
        const s = (await call('post', '/sms/topup/start', { amountPaise: 10000 })).body;
        captured(s.rzpOrderId, 11800, 'pay_t3');
        const r = await require('../src/services/platformCheckout').onPlatformPayment({ id: 'pay_t3', orderId: s.rzpOrderId, status: 'captured', amountPaise: 11800 });
        assert.equal(r.topup, 'credited');
        assert.equal((await wallet.status(w.tenant._id)).balancePaise, 10000);
    });
});

describe('owner inbox: clear all', () => {
    test('hides the messages and marks them read', async () => {
        await Notification.create({ tenantId: w.tenant._id, role: 'owner', type: 'x', title: 'One' });
        await Notification.create({ tenantId: w.tenant._id, role: 'owner', type: 'x', title: 'Two' });
        assert.equal((await call('get', '/notifications')).body.items.length, 2);
        assert.equal((await call('delete', '/notifications')).status, 200);
        const after2 = await call('get', '/notifications');
        assert.equal(after2.body.items.length, 0);
        assert.equal(after2.body.unreadCount, 0);
        assert.equal(await Notification.countDocuments({ tenantId: w.tenant._id, readAt: null }), 0, 'no SMS escalation for cleared messages');
        await Notification.create({ tenantId: w.tenant._id, role: 'owner', type: 'x', title: 'Three' });
        assert.equal((await call('get', '/notifications')).body.items.length, 1, 'new ones still arrive');
    });
});

describe('an owner cannot order', () => {
    test('placing an order with an owner login is refused', async () => {
        const r = await request(app).post('/api/orders').set(w.owner.headers).send({ items: [], paymentMethod: 'cod', type: 'delivery' });
        assert.equal(r.status, 403, JSON.stringify(r.body));
        assert.match(r.body.error, /cannot place orders/);
    });
});

describe('transactions year by year and as a file', () => {
    test('the summary lists 12 months and the years, and adds up what the ledger holds', async () => {
        const year = new Date().getUTCFullYear();
        await SubscriptionInvoice.create({ tenantId: w.tenant._id, kind: 'custom', invoiceNo: 'SUB/PP/SUM', issueDate: new Date(), dueDate: new Date(), paidAt: new Date(), baseAmount: 1000, total: 1000, status: 'paid' });
        const r = await call('get', `/payments/summary?year=${year}`);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.months.length, 12);
        assert.equal(r.body.months[0].month, `${year}-01`);
        assert.ok(r.body.years.includes(year));
        assert.equal(r.body.totals.outPaise, 100000, 'the paid bill is money out');
        assert.equal((await call('get', '/payments/summary?year=1999')).status, 400);
        assert.equal((await call('get', `/payments/summary?year=${year + 1}`)).status, 400);
    });

    test('the transactions can be downloaded as an Excel file (there is no CSV any more)', async () => {
        await SubscriptionInvoice.create({ tenantId: w.tenant._id, kind: 'custom', invoiceNo: 'SUB/PP/CSV', issueDate: new Date(), dueDate: new Date(), paidAt: new Date(), baseAmount: 500, total: 500, status: 'paid' });
        const r = await request(app).get('/api/shop/payments/transactions?format=xlsx').set(w.owner.headers).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
        assert.equal(r.status, 200);
        assert.match(r.headers['content-type'], /spreadsheetml/);
        assert.equal(r.body.slice(0, 2).toString(), 'PK');   // an .xlsx is a zip file
    });
});
