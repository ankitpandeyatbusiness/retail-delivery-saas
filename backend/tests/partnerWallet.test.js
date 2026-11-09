require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const crypto = require('crypto');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const PartnerTransaction = require('../src/models/PartnerTransaction');
const PartnerTopup = require('../src/models/PartnerTopup');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const wallet = require('../src/services/partnerWalletService');
const payments = require('../src/services/adapters/payments');
const planService = require('../src/services/planService');

// Phase 4 of plans: the Partner wallet. Fee per completed order, once; overdraft; top-up with GST on top; owner and supreme routes.
let w; let slug; let admin; let n = 0;
const setPlan = async (id) => { await Tenant.updateOne({ _id: w.tenant._id }, { $set: { plan: { id } } }); tenantRecognizer.invalidateTenant(slug); };
const owner = (m, p, b) => request(app)[m](`/api/shop${p}`).set(w.owner.headers).send(b);
const mk = (base, o = {}) => f.makeOrder(w.tenant, w.customer.user, { partnerFeeBase: base, pricing: { subtotal: base, total: base }, ...o });
const sign = (o, p) => crypto.createHmac('sha256', 'mock_key_secret').update(`${o}|${p}`).digest('hex');
const bal = async () => (await wallet.status(w.tenant._id)).balancePaise;

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    payments._mock.reset();
    slug = `pwallet-${++n}`;
    w = await f.makeWorld(slug);
    admin = await f.makeSuperAdmin();
    await setPlan('partner');
});

describe('fee slabs', () => {
    test('the amount falls in the right slab', () => {
        const s = planService.getDefaults ? require('../src/config/plans').DEFAULTS.feeSlabs : [];
        const at = (v) => wallet.feeRs(v, s);
        assert.deepEqual([at(1), at(150), at(150.5), at(300), at(500), at(800), at(801), at(5000)], [3, 3, 6, 6, 9, 12, 15, 15]);
    });
});

describe('the fee of a completed order', () => {
    test('taken once, from the order value at checkout, and never twice', async () => {
        const o = await mk(420);
        const r = await wallet.chargeOrder(o);
        assert.equal(r.feePaise, 900);   // Rs 301 to 500 = Rs 9
        assert.equal(await bal(), -900);
        assert.equal((await wallet.chargeOrder(o)).duplicate, true);
        assert.equal(await bal(), -900);
        assert.equal((await wallet.reconcile(w.tenant._id)).differencePaise, 0);
    });

    test('editing the items later does not change the fee (the base is fixed at checkout)', async () => {
        const o = await mk(420);
        await Order.updateOne({ _id: o._id }, { $set: { 'pricing.subtotal': 100, 'pricing.total': 100 } });
        assert.equal((await wallet.chargeOrder(await Order.findById(o._id))).feePaise, 900);
    });

    test('Growth and Pro shops pay no fee', async () => {
        await setPlan('growth');
        assert.equal((await wallet.chargeOrder(await mk(420))).skipped, 'not_partner');
        assert.equal(await PartnerTransaction.countDocuments({}), 0);
    });

    test('marking the order delivered takes the fee', async () => {
        await wallet.credit({ tenantId: w.tenant._id, amountPaise: 50000, type: 'adjust', note: 'start' });
        const o = await mk(200, { status: 'ready', orderType: 'pickup' });
        const res = await request(app).patch(`/api/shop/orders/${o._id}/status`).set(w.owner.headers).send({ status: 'delivered', skipCode: true });
        assert.equal(res.status, 200);
        await f.waitFor(async () => (await bal()) === 50000 - 600);
        assert.equal(await bal(), 49400);
    });

    test('putting a completed order back returns the fee, completing again takes it again', async () => {
        const o = await mk(200);
        await wallet.chargeOrder(o);
        assert.equal((await wallet.reverseFee(o._id)).ok, true);
        assert.equal(await bal(), 0);
        assert.equal((await wallet.chargeOrder(o)).feePaise, 600);
        assert.equal(await bal(), -600);
        assert.equal((await wallet.reconcile(w.tenant._id)).differencePaise, 0);
    });

    test('the kill switch stops fees', async () => {
        process.env.PARTNER_FEES = 'off';
        try { assert.equal((await wallet.chargeOrder(await mk(200))).skipped, 'kill_switch'); } finally { delete process.env.PARTNER_FEES; }
    });
});

describe('overdraft: new orders stop, nothing else', () => {
    test('allowed while balance + Rs 100 is above zero, refused after', async () => {
        await wallet.assertCanTakeOrders({ _id: w.tenant._id, plan: { id: 'partner' } });   // empty wallet, overdraft Rs 100: still fine
        for (const base of [900, 900, 900, 900, 900, 900, 900]) await wallet.chargeOrder(await mk(base));   // 7 x Rs 15 = Rs 105 below zero
        assert.ok((await bal()) <= -10000);
        await assert.rejects(() => wallet.assertCanTakeOrders({ _id: w.tenant._id, plan: { id: 'partner' } }), /not taking new orders/);
        // a Growth shop is never stopped
        await wallet.assertCanTakeOrders({ _id: w.tenant._id, plan: { id: 'growth' } });
    });
    test('the top-up pays the overdraft back', async () => {
        for (let i = 0; i < 7; i += 1) await wallet.chargeOrder(await mk(900));
        await wallet.credit({ tenantId: w.tenant._id, amountPaise: 50000, paymentId: 'ptopup:x1' });
        assert.equal(await bal(), 50000 - 10500);
        const s = await wallet.status(w.tenant._id);
        assert.equal(s.canTakeOrders, true);
    });
});

describe('top-up', () => {
    test('GST on top, wallet gets the chosen amount, a repeated webhook adds nothing', async () => {
        const start = await owner('post', '/wallet/topup/start', { amountPaise: 50000 });
        assert.equal(start.status, 201);
        const t = await PartnerTopup.findById(start.body.topupId).lean();
        assert.equal(t.amountPaise, 50000);
        assert.equal(start.body.amountPaise, t.payablePaise);   // no platform GSTIN in the test: no GST
        payments._mock.setPayment({ id: 'pay_w1', orderId: start.body.rzpOrderId, status: 'captured', amountPaise: t.payablePaise });
        const proof = { razorpay_order_id: start.body.rzpOrderId, razorpay_payment_id: 'pay_w1', razorpay_signature: sign(start.body.rzpOrderId, 'pay_w1') };
        assert.equal((await owner('post', `/wallet/topup/${start.body.topupId}/verify`, proof)).body.paid, true);
        assert.equal(await bal(), 50000);
        assert.equal((await owner('post', `/wallet/topup/${start.body.topupId}/verify`, proof)).body.paid, true);   // again
        await require('../src/services/platformCheckout').onPlatformPayment({ id: 'pay_w1', orderId: start.body.rzpOrderId, status: 'captured', amountPaise: t.payablePaise });   // the webhook too
        assert.equal(await bal(), 50000);
        assert.equal((await wallet.reconcile(w.tenant._id)).differencePaise, 0);
    });

    test('a payment of the wrong amount adds nothing', async () => {
        const start = await owner('post', '/wallet/topup/start', { amountPaise: 50000 });
        payments._mock.setPayment({ id: 'pay_w2', orderId: start.body.rzpOrderId, status: 'captured', amountPaise: 100 });
        const r = await owner('post', `/wallet/topup/${start.body.topupId}/verify`, { razorpay_order_id: start.body.rzpOrderId, razorpay_payment_id: 'pay_w2', razorpay_signature: sign(start.body.rzpOrderId, 'pay_w2') });
        assert.equal(r.status, 409);
        assert.equal(await bal(), 0);
    });

    test('amounts outside the limits are refused', async () => {
        assert.equal((await owner('post', '/wallet/topup/start', { amountPaise: 500 })).status, 400);
        assert.equal((await owner('post', '/wallet/topup/start', { amountPaise: 999999999 })).status, 400);
    });
});

describe('who can see the wallet', () => {
    test('only a Partner shop has one, and the slab table is never sent', async () => {
        const r = await owner('get', '/wallet');
        assert.equal(r.status, 200);
        assert.deepEqual(r.body.feeRange, { minRs: 3, maxRs: 15 });
        assert.equal(JSON.stringify(r.body).includes('slab'), false);
        await setPlan('growth');
        assert.equal((await owner('get', '/wallet')).status, 404);
    });

    test('history shows the order, its value and the fee', async () => {
        await wallet.chargeOrder(await mk(420, { orderNo: 1042 }));
        const h = (await owner('get', '/wallet/history')).body;
        assert.equal(h.items[0].orderNo, 1042);
        assert.equal(h.items[0].baseRs, 420);
        assert.equal(h.items[0].amountPaise, -900);
        assert.equal(h.feesThisMonth.paise, 900);
    });

    test('another shop cannot read this wallet (each call is for its own shop)', async () => {
        const other = await f.makeWorld(`pwallet-other-${n}`);
        await Tenant.updateOne({ _id: other.tenant._id }, { $set: { plan: { id: 'partner' } } });
        tenantRecognizer.invalidateTenant(other.tenant.slug);
        await wallet.credit({ tenantId: w.tenant._id, amountPaise: 77700, type: 'adjust', note: 'x' });
        const r = await request(app).get('/api/shop/wallet').set(other.owner.headers);
        assert.equal(r.body.balancePaise, 0);
    });
});

describe('supreme admin corrections', () => {
    const adj = (a, b) => request(app).post(`/api/admin/tenants/${w.tenant._id}/wallet/adjust`).set({ Authorization: `Bearer ${a.token}` }).send(b);
    test('add and take need a reason and are written to the ledger; a plain superadmin is refused', async () => {
        const plain = await f.makeSuperAdmin('plain@example.com', { phones: [] });
        assert.equal((await adj(plain, { direction: 'add', amountPaise: 1000, note: 'test' })).status, 403);
        assert.equal((await adj(admin, { direction: 'add', amountPaise: 1000 })).status, 400);   // no reason
        assert.equal((await adj(admin, { direction: 'add', amountPaise: 5000, note: 'goodwill' })).status, 200);
        assert.equal((await adj(admin, { direction: 'take', amountPaise: 2000, note: 'mistake' })).status, 200);
        assert.equal(await bal(), 3000);
        const g = await request(app).get(`/api/admin/tenants/${w.tenant._id}/wallet`).set({ Authorization: `Bearer ${plain.token}` });
        assert.equal(g.body.check.differencePaise, 0);
    });
});

describe('the top-up invoice (PDF)', () => {
    test('the history carries the top-up id, and the invoice opens as a PDF once the business is set up', async () => {
        const PlatformSettings = require('../src/models/PlatformSettings');
        await PlatformSettings.updateOne({ _id: 'main' }, { $set: { 'business.gstin': '09AAAAA0000A1Z5', 'business.legalName': 'Test Co', 'business.state': 'Uttar Pradesh', 'business.address': 'Lucknow' } }, { upsert: true });
        const start = await owner('post', '/wallet/topup/start', { amountPaise: 50000 });
        const t = await PartnerTopup.findById(start.body.topupId).lean();
        payments._mock.setPayment({ id: 'pay_inv1', orderId: start.body.rzpOrderId, status: 'captured', amountPaise: t.payablePaise });
        await owner('post', `/wallet/topup/${start.body.topupId}/verify`, { razorpay_order_id: start.body.rzpOrderId, razorpay_payment_id: 'pay_inv1', razorpay_signature: sign(start.body.rzpOrderId, 'pay_inv1') });
        const h = (await owner('get', '/wallet/history')).body;
        const row = h.items.find((x) => x.type === 'topup');
        assert.equal(row.topupId, String(start.body.topupId));
        const pdf = await owner('get', `/wallet/topups/${row.topupId}/invoice`).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
        assert.equal(pdf.status, 200);
        assert.match(pdf.headers['content-type'], /pdf/);
        assert.equal(pdf.body.slice(0, 4).toString(), '%PDF');
        assert.equal((await owner('get', `/wallet/topups/${'0'.repeat(24)}/invoice`)).status, 404);   // another shop's or unknown top-up
    });
});
