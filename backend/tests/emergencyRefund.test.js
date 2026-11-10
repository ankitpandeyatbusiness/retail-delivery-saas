require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const Tenant = require('../src/models/Tenant');
const PlanPayment = require('../src/models/PlanPayment');
const PartnerTopup = require('../src/models/PartnerTopup');
const PartnerWallet = require('../src/models/PartnerWallet');
const PlatformRefund = require('../src/models/PlatformRefund');
const payments = require('../src/services/adapters/payments');
const wallet = require('../src/services/partnerWalletService');
const sales = require('../src/services/platformSales');
const planService = require('../src/services/planService');

// Emergency refunds: real money back for the unused plan or the wallet balance. Supreme admin only, once per request id, never more than was paid.
let w; let supreme; let plain; let n = 0; let asked;
const DAY = 86400000;
const call = (a, m, p, b) => request(app)[m](`/api/admin${p}`).set({ Authorization: `Bearer ${a.token}` }).send(b);
const url = () => `/tenants/${w.tenant._id}/refunds`;
let rid = 0;
const post = (b) => call(supreme, 'post', url(), { requestId: `req-test-${++rid}-aaaa`, reason: 'shop closing for good', ...b });

// a Pro plan paid 10 days ago for 30 days, so 20 days are unused
const paidPro = async (extra = {}) => {
    const startsAt = new Date(Date.now() - 10 * DAY); const endsAt = new Date(Date.now() + 20 * DAY);
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { plan: { id: 'pro', startedAt: startsAt, endsAt } } });
    return PlanPayment.create({ tenantId: w.tenant._id, kind: 'new', from: 'partner', to: 'pro', months: 1, status: 'paid', paymentId: 'pay_plan1', paidAt: startsAt, payablePaise: 300000,
        quote: { startsAt, endsAt, taxablePaise: 254237, gstPaise: 45763, gstPercent: 18, totalPaise: 300000 }, ...extra });
};
const topup = async () => {
    await PartnerTopup.create({ tenantId: w.tenant._id, amountPaise: 50000, gstPercent: 18, gstPaise: 9000, payablePaise: 59000, status: 'paid', paymentId: 'pay_top1', paidAt: new Date() });
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { plan: { id: 'partner' } } });
    await wallet.credit({ tenantId: w.tenant._id, amountPaise: 50000, type: 'topup', paymentId: 'pay_top1' });
};
const balance = async () => (await PartnerWallet.findOne({ tenantId: w.tenant._id }).lean()).balancePaise;

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld(`refund-${++n}`);
    supreme = await f.makeSuperAdmin();
    plain = await f.makeSuperAdmin('plain@example.com', { phones: [] });
    asked = [];
    mock.method(payments, 'refund', async (a) => { asked.push(a); return { refundId: `rfnd_${asked.length}`, status: 'processed', amountPaise: a.amountPaise }; });
});
afterEach(() => mock.restoreAll());

describe('who and how', () => {
    test('only the supreme admin; a reason and a request id are needed', async () => {
        await paidPro();
        assert.equal((await call(plain, 'get', url())).status, 403);
        assert.equal((await call(plain, 'post', url(), { kind: 'plan', requestId: 'abcdefgh1', reason: 'because', amountPaise: 1000 })).status, 403);
        assert.equal((await post({ kind: 'plan', amountPaise: 1000, reason: 'x' })).status, 400);
        assert.equal((await call(supreme, 'post', url(), { kind: 'plan', amountPaise: 1000, reason: 'a real reason' })).status, 400);
        assert.equal(asked.length, 0);
    });
});

describe('a plan payment', () => {
    test('the overview suggests the unused share; refunding it ends the plan and nets the money screens', async () => {
        const p = await paidPro();
        const o = (await call(supreme, 'get', url())).body;
        const row = o.plan[0];
        assert.equal(row.current, true);
        assert.equal(row.suggestedPaise, 200000);   // 20 of 30 days
        const r = await post({ kind: 'plan', sourceId: String(p._id), amountPaise: row.suggestedPaise });
        assert.equal(r.status, 201);
        assert.equal(r.body.cashPaise, 200000);
        assert.equal(asked[0].paymentId, 'pay_plan1');
        assert.equal(asked[0].amountPaise, 200000);
        const t = await Tenant.findById(w.tenant._id).lean();
        assert.equal(planService.viewOf(t).status, 'ended');
        const rows = await sales.paid({ tenantId: w.tenant._id });
        assert.equal(rows.length, 2);
        assert.equal(rows.reduce((x, y) => x + y.total, 0), 1000);   // Rs 3,000 paid, Rs 2,000 sent back
        const neg = rows.find((x) => x.refund);
        assert.equal(neg.total, -2000);
        assert.equal(Math.round(neg.baseAmount * 100 + neg.gstAmount * 100), -200000);
    });

    test('a double tap with the same request id refunds once; more than was paid is refused', async () => {
        const p = await paidPro();
        const b = { kind: 'plan', sourceId: String(p._id), amountPaise: 150000, endPlan: false, requestId: 'same-request-1' };
        assert.equal((await post(b)).status, 201);
        const again = await post(b);
        assert.equal(again.status, 200);
        assert.equal(again.body.duplicate, true);
        assert.equal(asked.length, 1);
        assert.equal((await post({ kind: 'plan', sourceId: String(p._id), amountPaise: 160000, endPlan: false })).status, 400);   // only 150000 is left
        assert.equal((await post({ kind: 'plan', sourceId: String(p._id), amountPaise: 150000, endPlan: false })).status, 201);
        assert.equal((await post({ kind: 'plan', sourceId: String(p._id), amountPaise: 100, endPlan: false })).status, 400);        // nothing left
    });

    test('the partner refusing changes nothing', async () => {
        const p = await paidPro();
        mock.restoreAll();
        mock.method(payments, 'refund', async () => { throw new Error('refused'); });
        const r = await post({ kind: 'plan', sourceId: String(p._id), amountPaise: 100000 });
        assert.equal(r.status, 409);
        const t = await Tenant.findById(w.tenant._id).lean();
        assert.equal(planService.viewOf(t).status, 'active');
        assert.equal((await sales.paid({ tenantId: w.tenant._id })).length, 1);
        assert.equal((await PlatformRefund.findOne().lean()).status, 'failed');
    });

    test('a held payment can be refunded in full and is not in the sales', async () => {
        const p = await paidPro({ status: 'held', paymentId: 'pay_held1', paidAt: new Date() });
        const o = (await call(supreme, 'get', url())).body;
        assert.equal(o.plan[0].suggestedPaise, 300000);
        assert.equal((await post({ kind: 'plan', sourceId: String(p._id), amountPaise: 300000, endPlan: false })).status, 201);
        assert.equal((await sales.paid({ tenantId: w.tenant._id })).length, 0);
    });
});

describe('the wallet', () => {
    test('the balance goes back with its GST share, the wallet is emptied first, a double tap does nothing', async () => {
        await topup();
        const o = (await call(supreme, 'get', url())).body;
        assert.equal(o.wallet.refundableBasePaise, 50000);
        assert.equal(o.wallet.estimatedCashPaise, 59000);
        const b = { kind: 'wallet', amountPaise: 30000, requestId: 'wallet-req-1' };
        const r = await post(b);
        assert.equal(r.status, 201);
        assert.equal(r.body.cashPaise, 35400);   // 30000 + 18%
        assert.equal(asked[0].paymentId, 'pay_top1');
        assert.equal(asked[0].amountPaise, 35400);
        assert.equal(await balance(), 20000);
        assert.equal((await post(b)).body.duplicate, true);
        assert.equal(await balance(), 20000);
        assert.equal(asked.length, 1);
        const neg = (await sales.paid({ tenantId: w.tenant._id })).find((x) => x.refund);
        assert.equal(neg.kind, 'wallet');
        assert.equal(neg.total, -354);
    });

    test('more than the paid balance, or more than the wallet holds, is refused', async () => {
        await topup();
        await wallet.credit({ tenantId: w.tenant._id, amountPaise: 20000, type: 'adjust', note: 'free credit' });   // not paid online
        assert.equal((await post({ kind: 'wallet', amountPaise: 60000 })).status, 400);
        assert.equal((await post({ kind: 'wallet', amountPaise: 50000 })).status, 201);
        assert.equal(await balance(), 20000);
    });

    test('when the partner refuses, the balance is put back', async () => {
        await topup();
        mock.restoreAll();
        mock.method(payments, 'refund', async () => { throw new Error('refused'); });
        const r = await post({ kind: 'wallet', amountPaise: 20000 });
        assert.equal(r.status, 201);
        assert.equal(r.body.failed, 1);
        assert.equal(await balance(), 50000);
        assert.equal((await sales.paid({ tenantId: w.tenant._id })).filter((x) => x.refund).length, 0);
    });
});

describe('the credit note', () => {
    const PlatformSettings = require('../src/models/PlatformSettings');
    const biz = () => PlatformSettings.updateOne({ _id: 'main' }, { $set: { 'business.gstin': '09AAAAA0000A1Z5', 'business.legalName': 'Test Co', 'business.state': 'Uttar Pradesh', 'business.address': 'Lucknow' } }, { upsert: true });
    const pdf = (req) => req.buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });

    test('a sent refund gets a credit note: its number is in the history and in the money screens, the PDF opens for the admin and the owner, once only', async () => {
        await biz();
        const p = await paidPro();
        const r = await post({ kind: 'plan', sourceId: String(p._id), amountPaise: 200000, endPlan: false });
        assert.equal(r.status, 201);
        const h = (await call(supreme, 'get', url())).body.history[0];
        assert.match(h.creditNoteNo, /\//);
        const row = (await sales.paid({ tenantId: w.tenant._id })).find((x) => x.refund);
        assert.equal(row.invoiceNo, h.creditNoteNo);
        assert.equal(row.invoice.kind, 'credit_note');
        const refundId = h.id;
        const a = await pdf(call(supreme, 'get', `/tenants/${w.tenant._id}/refunds/${refundId}/credit-note`));
        assert.equal(a.status, 200);
        assert.equal(a.body.slice(0, 4).toString(), '%PDF');
        const o = await pdf(request(app).get(`/api/shop/plan/refunds/${refundId}/credit-note`).set(w.owner.headers));
        assert.equal(o.status, 200);
        assert.equal((await call(supreme, 'get', url())).body.history[0].creditNoteNo, h.creditNoteNo);   // the same number, none taken again
        const ov = (await request(app).get('/api/shop/plan').set(w.owner.headers)).body;
        assert.equal(ov.refunds[0].creditNoteNo, h.creditNoteNo);
    });

    test('without business details the refund still goes, the credit note is made the first time it is asked for after they are filled in', async () => {
        const p = await paidPro();
        assert.equal((await post({ kind: 'plan', sourceId: String(p._id), amountPaise: 100000, endPlan: false })).status, 201);
        const id = (await call(supreme, 'get', url())).body.history[0].id;
        assert.equal((await call(supreme, 'get', url())).body.history[0].creditNoteNo, null);
        assert.equal((await call(supreme, 'get', `/tenants/${w.tenant._id}/refunds/${id}/credit-note`)).status, 409);
        await biz();
        const a = await pdf(call(supreme, 'get', `/tenants/${w.tenant._id}/refunds/${id}/credit-note`));
        assert.equal(a.status, 200);
    });

    test('another shop cannot open it', async () => {
        await biz();
        const p = await paidPro();
        await post({ kind: 'plan', sourceId: String(p._id), amountPaise: 100000, endPlan: false });
        const id = (await call(supreme, 'get', url())).body.history[0].id;
        const other = await f.makeWorld(`refund-other-${n}`);
        assert.equal((await request(app).get(`/api/shop/plan/refunds/${id}/credit-note`).set(other.owner.headers)).status, 404);
    });
});
