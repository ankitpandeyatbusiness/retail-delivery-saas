require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeSuperAdmin } = require('./helpers/factory');
const Tenant = require('../src/models/Tenant');
const User = require('../src/models/User');
const Session = require('../src/models/Session');
const SubscriptionInvoice = require('../src/models/SubscriptionInvoice');
const DuesPayment = require('../src/models/DuesPayment');
const PlatformSettings = require('../src/models/PlatformSettings');
const payments = require('../src/services/adapters/payments');
const platformCheckout = require('../src/services/platformCheckout');
const tokenService = require('../src/services/tokenService');

const RAJU = '9855555555';
const DAY = 86400000;
let supreme;
let plain;
const as = (t) => ({ Authorization: `Bearer ${t}` });
const post = (url, body, t = supreme) => request(app).post(url).set(as(t)).send(body);
const sign = (orderId, paymentId) => crypto.createHmac('sha256', 'mock_key_secret').update(`${orderId}|${paymentId}`).digest('hex');

before(async () => { await db.connect(); });
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    payments._mock.reset();
    await PlatformSettings.findByIdAndUpdate('main', { $set: { 'business.legalName': 'Operator Pvt Ltd', 'business.gstin': '09AAAAA0000A1Z5' } }, { upsert: true });
    supreme = (await makeSuperAdmin('boss@example.com')).token;
    plain = (await makeSuperAdmin('other@example.com', { phones: ['9000000077'] })).token;
});

let n = 0;
const bill = (branch, o = {}) => SubscriptionInvoice.create({
    tenantId: branch.id, kind: 'monthly', period: o.period || '2027-01', invoiceNo: `SUB/BP/${++n}`,
    issueDate: new Date(Date.now() - 12 * DAY), dueDate: new Date(Date.now() - 5 * DAY), graceEndsAt: new Date(Date.now() - DAY),
    baseAmount: 3000, gstPercent: 18, gstAmount: 540, total: 3540, status: 'pending',
    lineItems: [{ description: 'App subscription', qty: 1, rate: 3000, amount: 3000 }],
    seller: { legalName: 'Operator Pvt Ltd' }, buyer: { legalName: branch.name }, ...o,
});

// Delhi has two unpaid bills, Mumbai one (and it is paused for it), Goa none
async function setup() {
    const brand = (await post('/api/admin/brands', { name: 'Savera' })).body.brand;
    const out = {};
    for (const c of ['delhi', 'mumbai', 'goa']) out[c] = (await post(`/api/admin/brands/${brand._id}/branches`, { name: `Savera ${c}`, slug: `savera-${c}`, city: c })).body.branch;
    await post(`/api/admin/brands/${brand._id}/owners`, { phone: RAJU });
    await bill(out.delhi, { period: '2027-01' });
    await bill(out.delhi, { period: '2027-02' });
    await bill(out.mumbai, { period: '2027-01' });
    await Tenant.updateOne({ _id: out.mumbai.id }, { $set: { 'billing.state': 'paused', 'billing.isLive': true } });
    const owner = await User.findOne({ tenantId: out.delhi.id, phone: RAJU });
    const sid = new mongoose.Types.ObjectId();
    const { accessToken } = tokenService.generateTokens({ userId: owner._id, tenantId: out.delhi.id, sessionId: sid });
    await Session.create({ _id: sid, userId: owner._id, tenantId: out.delhi.id, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600000) });
    const api = (method, path, body) => request(app)[method](`/api/brand${path}`).set('x-tenant-slug', 'savera-delhi').set('Authorization', `Bearer ${accessToken}`).send(body || {});
    return { brand, out, api };
}
const capture = (orderId, paymentId, amountPaise) => payments._mock.setPayment({ id: paymentId, orderId, status: 'captured', amountPaise, capturedPaise: amountPaise, refundedPaise: 0, method: 'upi', notes: {} });
const pendingCount = (w) => SubscriptionInvoice.countDocuments({ tenantId: { $in: Object.values(w.out).map((b) => b.id) }, status: 'pending' });

describe('the brand owner pays the bills of his branches', () => {
    test('the dues screen: one line per branch and the total', async () => {
        const w = await setup();
        const r = await w.api('get', '/dues');
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const by = Object.fromEntries(r.body.branches.map((b) => [b.slug, b]));
        assert.deepEqual([by['savera-delhi'].count, by['savera-delhi'].grandTotal], [2, 7080]);
        assert.deepEqual([by['savera-mumbai'].count, by['savera-goa'].count], [1, 0]);
        assert.deepEqual([r.body.count, r.body.grandTotal], [3, 10620]);
    });

    test('PAY ALL: one payment for every branch; each bill is settled on its own and the paused branch opens again', async () => {
        const w = await setup();
        const s = (await w.api('post', '/dues/pay/start')).body;
        assert.equal(s.amountPaise, 1062000);
        assert.equal(s.bills, 3);
        assert.equal((await w.api('post', '/dues/pay/start')).body.rzpOrderId, s.rzpOrderId, 'the same order while the bills are the same');

        capture(s.rzpOrderId, 'pay_b1', 1062000);
        const v = await w.api('post', '/dues/pay/verify', { razorpay_order_id: s.rzpOrderId, razorpay_payment_id: 'pay_b1', razorpay_signature: sign(s.rzpOrderId, 'pay_b1') });
        assert.equal(v.body.paid, true, JSON.stringify(v.body));
        assert.equal(await pendingCount(w), 0);
        const paid = await SubscriptionInvoice.find({ tenantId: w.out.mumbai.id }).lean();
        assert.deepEqual([paid[0].status, paid[0].paymentRef, paid[0].markedBy], ['paid', 'pay_b1', 'razorpay']);
        assert.notEqual((await Tenant.findById(w.out.mumbai.id).lean()).billing.state, 'paused');   // the paused branch is open again
        const rec = await DuesPayment.findOne({ rzpOrderId: s.rzpOrderId }).lean();
        assert.deepEqual([rec.status, String(rec.brandId) === String(w.brand._id), rec.invoiceIds.length], ['paid', true, 3]);

        // again: harmless, and nothing is due
        const again = await w.api('post', '/dues/pay/verify', { razorpay_order_id: s.rzpOrderId, razorpay_payment_id: 'pay_b1', razorpay_signature: sign(s.rzpOrderId, 'pay_b1') });
        assert.equal(again.body.paid, true);
        assert.equal((await w.api('post', '/dues/pay/start')).status, 409);
        assert.equal((await w.api('get', '/dues')).body.grandTotal, 0);
    });

    test('PAY THIS BRANCH: only that branch is paid', async () => {
        const w = await setup();
        const s = (await w.api('post', '/dues/pay/start', { slug: 'savera-delhi' })).body;
        assert.deepEqual([s.amountPaise, s.bills], [708000, 2]);
        capture(s.rzpOrderId, 'pay_b2', 708000);
        assert.equal((await w.api('post', '/dues/pay/verify', { razorpay_order_id: s.rzpOrderId, razorpay_payment_id: 'pay_b2', razorpay_signature: sign(s.rzpOrderId, 'pay_b2') })).body.paid, true);
        assert.equal(await SubscriptionInvoice.countDocuments({ tenantId: w.out.delhi.id, status: 'pending' }), 0);
        assert.equal(await SubscriptionInvoice.countDocuments({ tenantId: w.out.mumbai.id, status: 'pending' }), 1);   // Mumbai is untouched
        assert.equal((await w.api('post', '/dues/pay/start', { slug: 'nowhere' })).status, 404);
        assert.equal((await w.api('post', '/dues/pay/start', { slug: 'savera-goa' })).status, 409);   // Goa owes nothing
    });

    test('a wrong amount, a forged proof, another order or an unpaid payment settles nothing', async () => {
        const w = await setup();
        const s = (await w.api('post', '/dues/pay/start')).body;
        capture(s.rzpOrderId, 'pay_b3', 354000);   // too little
        const short = await w.api('post', '/dues/pay/verify', { razorpay_order_id: s.rzpOrderId, razorpay_payment_id: 'pay_b3', razorpay_signature: sign(s.rzpOrderId, 'pay_b3') });
        assert.equal(short.body.paid, false);
        assert.equal((await w.api('post', '/dues/pay/verify', { razorpay_order_id: s.rzpOrderId, razorpay_payment_id: 'pay_b3', razorpay_signature: 'f'.repeat(64) })).status, 400);
        assert.equal((await w.api('post', '/dues/pay/verify', { razorpay_order_id: 'order_x', razorpay_payment_id: 'pay_b3', razorpay_signature: sign('order_x', 'pay_b3') })).status, 404);
        assert.equal(await pendingCount(w), 3);
    });

    test('the background check settles it too when the app died right after paying; a bill paid by hand meanwhile is not paid twice', async () => {
        const w = await setup();
        const s = (await w.api('post', '/dues/pay/start')).body;
        // the superadmin marks one bill paid by hand while the payment is open
        const one = await SubscriptionInvoice.findOne({ tenantId: w.out.mumbai.id });
        await post(`/api/admin/brands/${w.brand._id}/bulk/mark-paid`, { tenantIds: [w.out.mumbai.id], paymentMode: 'upi', receivedBy: 'owner' });
        assert.equal((await SubscriptionInvoice.findById(one._id)).paymentMode, 'upi');
        capture(s.rzpOrderId, 'pay_b4', 1062000);
        const r = await platformCheckout.onPlatformPayment({ id: 'pay_b4', orderId: s.rzpOrderId, status: 'captured', amountPaise: 1062000, capturedPaise: 1062000, refundedPaise: 0, method: 'upi', notes: {} });
        assert.equal(r.dues, 'paid');
        assert.equal(await pendingCount(w), 0);
        assert.equal((await SubscriptionInvoice.findById(one._id)).paymentRef === 'pay_b4', false);   // the hand-marked bill keeps its own record
    });

    test('only a brand owner: a branch manager and the owner of another brand are refused', async () => {
        const w = await setup();
        await post(`/api/admin/tenants/${w.out.delhi.id}/owners`, { phone: '9866666666' });
        const mgr = await User.findOne({ tenantId: w.out.delhi.id, phone: '9866666666' });
        const sid = new mongoose.Types.ObjectId();
        const { accessToken } = tokenService.generateTokens({ userId: mgr._id, tenantId: w.out.delhi.id, sessionId: sid });
        await Session.create({ _id: sid, userId: mgr._id, tenantId: w.out.delhi.id, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600000) });
        for (const [m, p] of [['get', '/dues'], ['post', '/dues/pay/start'], ['post', '/dues/pay/verify']]) {
            const r = await request(app)[m](`/api/brand${p}`).set('x-tenant-slug', 'savera-delhi').set('Authorization', `Bearer ${accessToken}`).send({});
            assert.equal(r.status, 403, p);
        }
    });
});

describe('the supreme admin: bulk actions on a brand', () => {
    test('waive late fees for chosen branches or all; the rent bills stay unpaid', async () => {
        const w = await setup();
        const b1 = await SubscriptionInvoice.findOne({ tenantId: w.out.delhi.id, period: '2027-01' });
        const b2 = await SubscriptionInvoice.findOne({ tenantId: w.out.mumbai.id });
        const fee = (inv, branch, no) => SubscriptionInvoice.create({
            tenantId: branch.id, kind: 'custom', invoiceNo: `SUB/LF/${no}`, issueDate: new Date(), dueDate: new Date(Date.now() + DAY), graceEndsAt: new Date(Date.now() + DAY),
            baseAmount: 150, gstPercent: 18, gstAmount: 27, total: 177, status: 'pending', description: 'Late fee', lineItems: [{ description: 'Late fee', qty: 1, rate: 150, amount: 150 }],
            lateFee: { forInvoiceId: inv._id, forInvoiceNo: inv.invoiceNo, month: 1, percent: 5, onAmount: 3000 }, seller: { legalName: 'Operator Pvt Ltd' }, buyer: { legalName: branch.name },
        });
        await fee(b1, w.out.delhi, 1);
        await fee(b2, w.out.mumbai, 2);

        assert.equal((await post(`/api/admin/brands/${w.brand._id}/bulk/waive-late-fees`, { tenantIds: 'all' })).status, 400);   // a reason is needed
        assert.equal((await post(`/api/admin/brands/${w.brand._id}/bulk/waive-late-fees`, { tenantIds: 'all', reason: 'Goodwill' }, plain)).status, 403);   // supreme admin only
        const one = await post(`/api/admin/brands/${w.brand._id}/bulk/waive-late-fees`, { tenantIds: [w.out.delhi.id], reason: 'Goodwill' });
        assert.equal(one.status, 200, JSON.stringify(one.body));
        assert.deepEqual([one.body.totals.done, one.body.totals.amount, one.body.totals.branches], [1, 177, 1]);
        assert.equal(await SubscriptionInvoice.countDocuments({ tenantId: w.out.mumbai.id, 'lateFee.forInvoiceId': { $exists: true }, status: 'pending' }), 1);   // Mumbai's fee is still there
        const all = await post(`/api/admin/brands/${w.brand._id}/bulk/waive-late-fees`, { tenantIds: 'all', reason: 'Goodwill' });
        assert.deepEqual([all.body.totals.done, all.body.totals.branches], [1, 3]);
        assert.equal(await SubscriptionInvoice.countDocuments({ 'lateFee.forInvoiceId': { $exists: true }, status: 'pending' }), 0);
        assert.equal(await SubscriptionInvoice.countDocuments({ kind: 'monthly', status: 'pending' }), 3);   // the rent bills are untouched
        assert.equal((await post(`/api/admin/brands/${w.brand._id}/bulk/waive-late-fees`, { tenantIds: [new mongoose.Types.ObjectId().toString()], reason: 'x' })).status, 404);
    });

    test('mark paid for chosen branches: every unpaid bill, one payment mode and receiver; mark unpaid undoes a month, but never an online payment', async () => {
        const w = await setup();
        assert.equal((await post(`/api/admin/brands/${w.brand._id}/bulk/mark-paid`, { tenantIds: 'all', paymentMode: 'upi' })).status, 400);   // who received the money is needed
        assert.equal((await post(`/api/admin/brands/${w.brand._id}/bulk/mark-paid`, { tenantIds: 'all', receivedBy: 'owner', paymentMode: 'gold' })).status, 400);

        const r = await post(`/api/admin/brands/${w.brand._id}/bulk/mark-paid`, { tenantIds: [w.out.delhi.id, w.out.mumbai.id], paymentMode: 'bank_transfer', paymentRef: 'UTR123', receivedBy: 'partner', note: 'Head office paid all' });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.deepEqual([r.body.totals.done, r.body.totals.amount, r.body.totals.branches], [3, 10620, 2]);
        const inv = await SubscriptionInvoice.findOne({ tenantId: w.out.delhi.id, period: '2027-01' }).lean();
        assert.deepEqual([inv.status, inv.paymentMode, inv.paymentRef, inv.receivedBy, inv.note], ['paid', 'bank_transfer', 'UTR123', 'partner', 'Head office paid all']);
        assert.notEqual((await Tenant.findById(w.out.mumbai.id).lean()).billing.state, 'paused');

        // one of the January bills was really paid online: it must not be undone by hand
        await SubscriptionInvoice.updateOne({ tenantId: w.out.mumbai.id }, { $set: { markedBy: 'razorpay' } });
        const u = await post(`/api/admin/brands/${w.brand._id}/bulk/mark-unpaid`, { tenantIds: 'all', period: '2027-01' });
        assert.equal(u.status, 200, JSON.stringify(u.body));
        assert.deepEqual([u.body.totals.done, u.body.totals.skipped], [1, 1]);   // Delhi's January goes back, Mumbai's online payment stays
        assert.equal(u.body.rows.find((x) => x.slug === 'savera-mumbai').skipped[0].reason.includes('Paid online'), true);
        assert.equal((await SubscriptionInvoice.findOne({ tenantId: w.out.delhi.id, period: '2027-01' })).status, 'pending');
        assert.equal((await SubscriptionInvoice.findOne({ tenantId: w.out.delhi.id, period: '2027-02' })).status, 'paid');   // other months untouched
        assert.equal((await SubscriptionInvoice.findOne({ tenantId: w.out.mumbai.id })).status, 'paid');
        assert.equal((await post(`/api/admin/brands/${w.brand._id}/bulk/mark-unpaid`, { tenantIds: 'all', period: 'nope' })).status, 400);
        assert.equal((await post(`/api/admin/brands/${w.brand._id}/bulk/mark-paid`, { tenantIds: 'all', receivedBy: 'owner' }, plain)).status, 403);
    });
});
