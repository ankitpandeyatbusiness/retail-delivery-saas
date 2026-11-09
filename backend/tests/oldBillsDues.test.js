require('./helpers/env');
// OLD rent bills that are still open: the statement of what a shop owes and ONE payment that settles every open bill (kept until phase 9 has settled the old bills).
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const payments = require('../src/services/adapters/payments');
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

describe('what he owes and paying it all at once', () => {
    test('the statement lists each old month and one grand total (no late fee any more)', async () => {
        await monthly(65, { period: '2026-07' });
        await monthly(35, { period: '2026-08' });
        const r = await call('get', '/subscription/dues');
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.rows.length, 2);
        assert.equal(r.body.rows[0].label, 'July 2026');
        assert.equal(r.body.rows[0].lateFees.length, 0);
        assert.equal(r.body.rentTotal, 7080);
        assert.equal(r.body.lateFeeTotal, 0);
        assert.equal(r.body.grandTotal, 7080);
    });

    test('one payment for the grand total settles every old bill; a repeat changes nothing', async () => {
        const a = await monthly(65, { period: '2026-07' });
        const b = await monthly(35, { period: '2026-08' });
        const s = (await call('post', '/subscription/dues/pay/start')).body;
        assert.equal(s.amountPaise, 708000);
        assert.equal(s.bills, 2);
        assert.equal((await call('post', '/subscription/dues/pay/start')).body.rzpOrderId, s.rzpOrderId, 'the same order while the bills are the same');
        payments._mock.setPayment({ id: 'pay_d1', orderId: s.rzpOrderId, status: 'captured', amountPaise: 708000, capturedPaise: 708000, refundedPaise: 0, method: 'upi', notes: {} });
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
        const s = (await call('post', '/subscription/dues/pay/start')).body;
        payments._mock.setPayment({ id: 'pay_d2', orderId: s.rzpOrderId, status: 'captured', amountPaise: 300000, capturedPaise: 300000, refundedPaise: 0, method: 'upi', notes: {} });   // less than the billly, without the fee
        const short = await call('post', '/subscription/dues/pay/verify', { razorpay_order_id: s.rzpOrderId, razorpay_payment_id: 'pay_d2', razorpay_signature: sign(s.rzpOrderId, 'pay_d2') });
        assert.equal(short.body.paid, false);
        assert.equal((await call('post', '/subscription/dues/pay/verify', { razorpay_order_id: s.rzpOrderId, razorpay_payment_id: 'pay_d2', razorpay_signature: 'f'.repeat(64) })).status, 400);
        assert.equal((await call('post', '/subscription/dues/pay/verify', { razorpay_order_id: 'order_x', razorpay_payment_id: 'pay_d2', razorpay_signature: sign('order_x', 'pay_d2') })).status, 404);
        assert.equal(await SubscriptionInvoice.countDocuments({ tenantId: w.tenant._id, status: 'pending' }), 1);
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
