require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const Tenant = require('../src/models/Tenant');
const PlanPayment = require('../src/models/PlanPayment');
const PlatformSettings = require('../src/models/PlatformSettings');
const PlatformCoupon = require('../src/models/PlatformCoupon');
const PlatformDispute = require('../src/models/PlatformDispute');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const center = require('../src/notifications/center');
const sales = require('../src/services/platformSales');
const planService = require('../src/services/planService');
const refunds = require('../src/services/emergencyRefund');

// What the supreme admin needs to run plans by hand: record an outside payment, give more time, a shop's own terms, held payments, the overview.
let w; let supreme; let plain; let slug; let sent; let n = 0;
const DAY = 86400000;
const call = (a, m, p, b) => request(app)[m](`/api/admin${p}`).set({ Authorization: `Bearer ${a.token}` }).send(b);
const setPlan = async (plan) => { await Tenant.updateOne({ _id: w.tenant._id }, { $set: { plan } }); tenantRecognizer.invalidateTenant(slug); };
const shopNow = async () => Tenant.findById(w.tenant._id).lean();
const url = (p) => `/tenants/${w.tenant._id}/plan${p}`;
const biz = () => PlatformSettings.updateOne({ _id: 'main' }, { $set: { 'business.gstin': '09AAAAA0000A1Z5', 'business.legalName': 'Test Co', 'business.state': 'Uttar Pradesh', 'business.address': 'Lucknow' } }, { upsert: true });

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    slug = `admintools-${++n}`;
    w = await f.makeWorld(slug);
    supreme = await f.makeSuperAdmin();
    plain = await f.makeSuperAdmin('plain@example.com', { phones: [] });
    sent = [];
    mock.method(center, 'notify', (type, p) => { sent.push({ type, ...p }); return Promise.resolve(); });
});
afterEach(() => mock.restoreAll());

describe('recording a payment made outside the app', () => {
    const body = (o = {}) => ({ to: 'growth', months: 1, receivedPaise: 299900, method: 'bank', reference: 'UTR 4455', ...o });

    test('the plan starts for the term, an invoice is made, the money screens show it, the owner is told "Changed by the Platform"', async () => {
        await biz();
        await setPlan({ id: 'partner' });
        const q = await call(supreme, 'get', url('/record-payment?to=growth&months=1'));
        assert.equal(q.status, 200);
        assert.equal(q.body.suggestedPaise, 353882);   // 2,999 + 18% GST
        const r = await call(supreme, 'post', url('/record-payment'), body({ receivedPaise: 353882 }));
        assert.equal(r.status, 201);
        const t = await shopNow();
        assert.equal(t.plan.id, 'growth');
        assert.ok(new Date(t.plan.endsAt) > new Date(Date.now() + 28 * DAY));
        const pay = await PlanPayment.findById(r.body.paymentId).lean();
        assert.equal(pay.status, 'paid');
        assert.equal(pay.paymentId, undefined);
        assert.equal(pay.offline.method, 'bank');
        assert.equal(pay.invoice.paymentMode, 'bank');
        assert.equal(pay.invoice.paymentRef, 'UTR 4455');
        assert.equal(pay.invoice.total, 3538.82);
        assert.equal(pay.invoice.gstAmount, 539.82);
        const rows = await sales.paid({ tenantId: w.tenant._id });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].total, 3538.82);
        assert.match(sent.find((x) => x.type === 'plan_changed').body, /Changed by the Platform/);
        assert.equal((await refunds.overview(t)).plan.length, 0);   // no online money: nothing to send back through the payment partner
    });

    test('the amount can differ from the price (a discount you agreed); renewing adds the term after the current end', async () => {
        const end = new Date(Date.now() + 10 * DAY);
        await setPlan({ id: 'growth', startedAt: new Date(), endsAt: end });
        const r = await call(supreme, 'post', url('/record-payment'), body({ receivedPaise: 250000, months: 2 }));
        assert.equal(r.status, 201);
        const t = await shopNow();
        assert.ok(new Date(t.plan.endsAt) > new Date(end.getTime() + 55 * DAY));
        assert.equal((await PlanPayment.findById(r.body.paymentId).lean()).payablePaise, 250000);
    });

    test('only the supreme admin; the amount, the way and the reference are needed; a lower plan cannot be recorded', async () => {
        await setPlan({ id: 'partner' });
        assert.equal((await call(plain, 'post', url('/record-payment'), body())).status, 403);
        assert.equal((await call(supreme, 'post', url('/record-payment'), body({ receivedPaise: 50 }))).status, 400);
        assert.equal((await call(supreme, 'post', url('/record-payment'), body({ method: 'cheque' }))).status, 400);
        assert.equal((await call(supreme, 'post', url('/record-payment'), body({ reference: 'x' }))).status, 400);
        assert.equal((await call(supreme, 'post', url('/record-payment'), body({ to: 'partner' }))).status, 400);
        await setPlan({ id: 'pro', startedAt: new Date(), endsAt: new Date(Date.now() + 20 * DAY) });
        assert.equal((await call(supreme, 'post', url('/record-payment'), body({ to: 'growth' }))).status, 409);
        assert.equal(await PlanPayment.countDocuments({ status: 'paid' }), 0);
    });
});

describe('more time for a shop', () => {
    test('days are added after the current end; the owner is told the new day; a free period moves with it', async () => {
        const end = new Date(Date.now() + 3 * DAY);
        await setPlan({ id: 'growth', startedAt: new Date(), endsAt: end, freeUntil: end });
        const r = await call(supreme, 'post', url('/extend'), { days: 7 });
        assert.equal(r.status, 200);
        const t = await shopNow();
        const gained = (new Date(t.plan.endsAt) - end) / DAY;
        assert.ok(gained > 6.9 && gained < 8.1);
        assert.equal(new Date(t.plan.freeUntil).getTime(), new Date(t.plan.endsAt).getTime());
        assert.match(sent.find((x) => x.type === 'plan_changed').body, /Your plan now runs until .* Changed by the Platform\./);
    });

    test('an exact end day; an ended and paused shop is opened again', async () => {
        await setPlan({ id: 'pro', startedAt: new Date(Date.now() - 40 * DAY), endsAt: new Date(Date.now() - 5 * DAY), paused: true });
        const day = new Date(Date.now() + 20 * DAY + 5.5 * 3600000).toISOString().slice(0, 10);
        const r = await call(supreme, 'post', url('/extend'), { endsOn: day });
        assert.equal(r.status, 200);
        const t = await shopNow();
        assert.equal(t.plan.paused, undefined);
        assert.equal(planService.viewOf(t).status, 'active');
    });

    test('Partner, a shorter or past end, bad input, a prepaid plan waiting, and a plain admin are all refused', async () => {
        await setPlan({ id: 'partner' });
        assert.equal((await call(supreme, 'post', url('/extend'), { days: 5 })).status, 409);
        const end = new Date(Date.now() + 10 * DAY);
        await setPlan({ id: 'growth', startedAt: new Date(), endsAt: end });
        assert.equal((await call(supreme, 'post', url('/extend'), { endsOn: new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10) })).status, 400);
        assert.equal((await call(supreme, 'post', url('/extend'), { days: 0 })).status, 400);
        assert.equal((await call(supreme, 'post', url('/extend'), {})).status, 400);
        assert.equal((await call(plain, 'post', url('/extend'), { days: 5 })).status, 403);
        await setPlan({ id: 'pro', startedAt: new Date(), endsAt: end, freeUntil: end, scheduled: { to: 'growth', at: new Date(end.getTime() + 1), by: 'owner payment', prepaid: { startsAt: new Date(end.getTime() + 1), endsAt: new Date(end.getTime() + 31 * DAY), months: 1, paymentId: 'x' } } });
        assert.equal((await call(supreme, 'post', url('/extend'), { days: 5 })).status, 409);
    });
});

describe("a shop's own terms", () => {
    test('they are read back for the admin screen, change what the owner is quoted, and null clears them', async () => {
        await setPlan({ id: 'partner' });
        assert.deepEqual((await call(supreme, 'get', url(''))).body.terms, { pricePaise: null, freeDays: null, feeSlabs: null });
        const r = await call(supreme, 'put', url('/terms'), { pricePaise: 199900, freeDays: 14 });
        assert.equal(r.status, 200);
        const t = (await call(supreme, 'get', url(''))).body.terms;
        assert.equal(t.pricePaise, 199900);
        assert.equal(t.freeDays, 14);
        const q = await request(app).post('/api/shop/plan/quote').set(w.owner.headers).send({ to: 'growth', months: 1 });
        assert.equal(q.body.taxablePaise, 199900);
        await call(supreme, 'put', url('/terms'), { pricePaise: null, freeDays: null });
        assert.equal((await call(supreme, 'get', url(''))).body.terms.pricePaise, null);
    });

    test('the fee slabs of a shop are never in what the owner sees', async () => {
        await setPlan({ id: 'partner' });
        await call(supreme, 'put', url('/terms'), { feeSlabs: [{ upTo: 200, feeRs: 4 }, { upTo: null, feeRs: 8 }] });
        const owner = (await request(app).get('/api/shop/plan').set(w.owner.headers)).body;
        assert.equal(JSON.stringify(owner).includes('feeSlabs'), false);
    });
});

describe('coupons: delete', () => {
    test('an unused coupon is deleted; a used one only switches off', async () => {
        const mk = (code, used) => PlatformCoupon.create({ code, pct: 10, plans: ['pro'], startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + 5 * DAY), usedCount: used });
        const a = await mk('GONE10', 0); const b = await mk('USED10', 2);
        assert.equal((await call(plain, 'delete', `/plan-coupons/${a._id}`)).status, 403);
        assert.equal((await call(supreme, 'delete', `/plan-coupons/${a._id}`)).status, 200);
        assert.equal(await PlatformCoupon.countDocuments({ code: 'GONE10' }), 0);
        assert.equal((await call(supreme, 'delete', `/plan-coupons/${b._id}`)).status, 409);
        assert.equal(await PlatformCoupon.countDocuments({ code: 'USED10' }), 1);
    });
});

describe('the plans overview and held payments', () => {
    test('counts per plan and state, plans ending within 7 days, ended shops, held payments and open disputes', async () => {
        await setPlan({ id: 'growth', startedAt: new Date(), endsAt: new Date(Date.now() + 3 * DAY) });
        const b = await f.makeWorld(`ov-b-${n}`);
        await Tenant.updateOne({ _id: b.tenant._id }, { $set: { plan: { id: 'pro', startedAt: new Date(Date.now() - 40 * DAY), endsAt: new Date(Date.now() - 2 * DAY) } } });
        const c = await f.makeWorld(`ov-c-${n}`);
        await Tenant.updateOne({ _id: c.tenant._id }, { $set: { plan: { id: 'partner' } } });
        await PlanPayment.create({ tenantId: w.tenant._id, kind: 'new', to: 'pro', months: 1, status: 'held', heldWhy: 'The shop plan changed after the owner saw the price', paymentId: 'pay_h1', paidAt: new Date(), payablePaise: 100000, quote: { startsAt: new Date(), endsAt: new Date(Date.now() + 30 * DAY) } });
        await PlatformDispute.create({ tenantId: c.tenant._id, kind: 'wallet', sourceId: 'x', rzpDisputeId: 'disp_ov', status: 'created', amountPaise: 59000 });
        const o = (await call(plain, 'get', '/plan-overview')).body;
        assert.equal(o.counts.growth.active, 1);
        assert.equal(o.counts.pro.ended, 1);
        assert.equal(o.counts.partner, 1);
        assert.equal(o.expiring.length, 1);
        assert.equal(o.expiring[0].plan, 'growth');
        assert.equal(o.ended[0].plan, 'pro');
        assert.equal(o.held[0].to, 'pro');
        assert.equal(o.disputes[0].kind, 'wallet');
    });

    test('a held payment is applied as the owner saw it, only by the supreme admin', async () => {
        await setPlan({ id: 'partner' });
        const startsAt = new Date(); const endsAt = new Date(Date.now() + 30 * DAY);
        const p = await PlanPayment.create({ tenantId: w.tenant._id, kind: 'new', from: 'growth', to: 'pro', months: 1, status: 'held', heldWhy: 'The shop plan changed after the owner saw the price', paymentId: 'pay_h2', paidAt: new Date(), payablePaise: 499900, quote: { startsAt, endsAt, taxablePaise: 499900, gstPaise: 0, gstPercent: 0, totalPaise: 499900, lines: [], features: { on: [], off: [] }, notes: [] } });
        assert.equal((await call(plain, 'post', `/plan-money/held/${p._id}/apply`)).status, 403);
        assert.equal((await call(supreme, 'post', `/plan-money/held/${p._id}/apply`)).status, 200);
        const t = await shopNow();
        assert.equal(t.plan.id, 'pro');
        assert.equal((await PlanPayment.findById(p._id).lean()).status, 'paid');
        assert.equal((await call(supreme, 'post', `/plan-money/held/${p._id}/apply`)).status, 404);   // no longer held
    });
});
