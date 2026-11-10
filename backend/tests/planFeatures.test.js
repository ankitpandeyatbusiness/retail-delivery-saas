require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const Tenant = require('../src/models/Tenant');
const PlanPayment = require('../src/models/PlanPayment');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const center = require('../src/notifications/center');
const plans = require('../src/config/plans');
const featureGate = require('../src/services/featureGate');
const planService = require('../src/services/planService');

// "What each plan includes" (editable by the supreme admin), removing every plan from a shop, and starting a free period.
let w; let supreme; let plain; let slug; let sent; let n = 0;
const call = (a, m, p, b) => request(app)[m](`/api/admin${p}`).set({ Authorization: `Bearer ${a.token}` }).send(b);
const setPlan = async (plan) => { await Tenant.updateOne({ _id: w.tenant._id }, { $set: { plan } }); tenantRecognizer.invalidateTenant(slug); };
const shopNow = async () => Tenant.findById(w.tenant._id).lean();
const ownerSettings = () => request(app).get('/api/shop/settings').set(w.owner.headers);

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    plans.setFeatureOverrides({});
    slug = `feat-${++n}`;
    w = await f.makeWorld(slug);
    supreme = await f.makeSuperAdmin();
    plain = await f.makeSuperAdmin('plain@example.com', { phones: [] });
    sent = [];
    mock.method(center, 'notify', (type, p) => { sent.push({ type, ...p }); return Promise.resolve(); });
});
afterEach(() => mock.restoreAll());

describe('what each plan includes', () => {
    test('the table starts as the code has it, and the admin screen gets it with an editable flag', async () => {
        const c = (await call(supreme, 'get', '/plans')).body;
        assert.deepEqual(c.features.loyalty.plans, ['growth', 'pro']);
        assert.equal(c.features.loyalty.editable, true);
        assert.equal(c.features.staffLogins.editable, false);
        assert.deepEqual(c.defaults.features.bulkOrders, ['pro']);
    });

    test('moving a feature changes the shop at once: the plan, the gate, the "Available in" note', async () => {
        await setPlan({ id: 'growth', startedAt: new Date(), endsAt: new Date(Date.now() + 20 * 86400000) });
        assert.equal(featureGate.hasFeature(await shopNow(), 'loyalty'), true);
        const r = await call(supreme, 'put', '/platform/plans', { features: { loyalty: ['pro'], bulkOrders: ['growth', 'pro'] } });
        assert.equal(r.status, 200);
        assert.deepEqual(r.body.features.loyalty, ['pro']);
        assert.equal(featureGate.hasFeature(await shopNow(), 'loyalty'), false);      // Growth lost it
        assert.equal(featureGate.hasFeature(await shopNow(), 'bulkOrders'), true);    // Growth gained it
        const s = (await ownerSettings()).body.plan;
        assert.equal(s.features.loyalty, false);
        assert.equal(s.features.bulkOrders, true);
        assert.equal(s.needs.loyalty, 'Pro');
    });

    test('the choice is kept in the database: a fresh server memory reads it back', async () => {
        await call(supreme, 'put', '/platform/plans', { features: { costsProfit: ['pro'] } });
        plans.setFeatureOverrides({});   // as if another instance started now
        assert.deepEqual(plans.plansOf('costsProfit'), ['growth', 'pro']);
        await ownerSettings();           // any request refreshes it from the database
        assert.deepEqual(plans.plansOf('costsProfit'), ['pro']);
    });

    test('only the supreme admin; bad input is refused; kitchen and waiter logins cannot be moved', async () => {
        assert.equal((await call(plain, 'put', '/platform/plans', { features: { loyalty: ['pro'] } })).status, 403);
        assert.equal((await call(supreme, 'put', '/platform/plans', { features: { staffLogins: ['pro'] } })).status, 400);
        assert.equal((await call(supreme, 'put', '/platform/plans', { features: { loyalty: ['gold'] } })).status, 400);
        assert.equal((await call(supreme, 'put', '/platform/plans', { features: { nothing: ['pro'] } })).status, 400);
        assert.deepEqual(plans.plansOf('loyalty'), ['growth', 'pro']);
    });

    test('a feature on no plan is possible: nobody has it, a shop can still get it as an extra', async () => {
        await setPlan({ id: 'pro', startedAt: new Date(), endsAt: new Date(Date.now() + 20 * 86400000) });
        await call(supreme, 'put', '/platform/plans', { features: { customDomain: [] } });
        assert.equal(featureGate.hasFeature(await shopNow(), 'customDomain'), false);
        assert.equal((await call(supreme, 'put', `/tenants/${w.tenant._id}/plan/extras`, { key: 'customDomain', on: true })).status, 200);
        assert.equal(featureGate.hasFeature(await shopNow(), 'customDomain'), true);
    });
});

describe('removing every plan from a shop', () => {
    test('the shop has no plan again, the owner is told "Changed by the Platform", a waiting payment is closed', async () => {
        await setPlan({ id: 'pro', startedAt: new Date(), endsAt: new Date(Date.now() + 20 * 86400000), extras: [{ key: 'riderLiveMap' }], webEnabled: false, priceOverridePaise: 100000 });
        const pending = await PlanPayment.create({ tenantId: w.tenant._id, kind: 'new', to: 'pro', months: 1, status: 'pending', payablePaise: 100000, quote: {} });
        const r = await call(supreme, 'delete', `/tenants/${w.tenant._id}/plan`);
        assert.equal(r.status, 200);
        assert.equal(r.body.status, 'none');
        const t = await shopNow();
        assert.equal(t.plan.id, undefined);
        assert.equal(t.plan.endsAt, undefined);
        assert.equal(t.plan.webEnabled, false);              // the website switch stays
        assert.equal(t.plan.priceOverridePaise, 100000);     // the shop's own price stays
        assert.equal((await PlanPayment.findById(pending._id).lean()).status, 'expired');
        const m = sent.find((x) => x.type === 'plan_changed');
        assert.match(m.body, /Your plan was removed\. Changed by the Platform\./);
        assert.equal(planService.viewOf(t).status, 'none');
        assert.equal(featureGate.hasFeature(t, 'bulkOrders'), true);   // no plan: nothing is limited
    });

    test('only the supreme admin; a shop with no plan cannot have it removed again', async () => {
        await setPlan({ id: 'growth', startedAt: new Date(), endsAt: new Date(Date.now() + 5 * 86400000) });
        assert.equal((await call(plain, 'delete', `/tenants/${w.tenant._id}/plan`)).status, 403);
        assert.equal((await call(supreme, 'delete', `/tenants/${w.tenant._id}/plan`)).status, 200);
        assert.equal((await call(supreme, 'delete', `/tenants/${w.tenant._id}/plan`)).status, 409);
    });
});

describe('starting a free period', () => {
    test('a shop with no plan gets Growth free for 5 days: it ends in 5 days, no invoice', async () => {
        await call(supreme, 'put', `/tenants/${w.tenant._id}/plan`, { to: 'growth', freeDays: 5 });
        const v = planService.viewOf(await shopNow());
        assert.equal(v.id, 'growth');
        assert.equal(v.status, 'free');
        assert.ok(v.daysLeft >= 4 && v.daysLeft <= 5);
        assert.equal(await PlanPayment.countDocuments({ tenantId: w.tenant._id }), 0);
    });
});
