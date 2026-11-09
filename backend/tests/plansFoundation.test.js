require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const plans = require('../src/config/plans');
const { hasFeature } = require('../src/services/featureGate');

// Phase 1 of plans: catalog, hasFeature, supreme-only plan switch, defaults, extras.
let w; let supreme; let plain; let n = 0;
const as = (a) => ({ Authorization: `Bearer ${a.token}` });
const put = (a, p, b) => request(app).put(`/api/admin${p}`).set(as(a)).send(b);
const get = (a, p) => request(app).get(`/api/admin${p}`).set(as(a));

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld(`plan-found-${++n}`);
    supreme = await f.makeSuperAdmin();
    plain = await f.makeSuperAdmin('plain@example.com', { phones: [] });
});

describe('plan catalog', () => {
    test('Partner has no rider map, Growth has it, Pro has bulk', () => {
        assert.equal(plans.planIncludes('partner', 'riderLiveMap'), false);
        assert.equal(plans.planIncludes('growth', 'riderLiveMap'), true);
        assert.equal(plans.planIncludes('growth', 'bulkOrders'), false);
        assert.equal(plans.planIncludes('pro', 'bulkOrders'), true);
        assert.equal(plans.limitFor('partner', 'riders'), 2);
        assert.equal(plans.limitFor('pro', 'staff'), null);
    });
    test('fee slab check', () => {
        assert.equal(plans.checkFeeSlabs(plans.DEFAULTS.feeSlabs), null);
        assert.ok(plans.checkFeeSlabs([{ upTo: 100, feeRs: 2 }, { upTo: null, feeRs: 15 }]));
        assert.ok(plans.checkFeeSlabs([{ upTo: 200, feeRs: 5 }, { upTo: 100, feeRs: 6 }, { upTo: null, feeRs: 7 }]));
        assert.ok(plans.checkFeeSlabs([{ upTo: 200, feeRs: 5 }]));
    });
    test('a shop with no plan is not restricted', () => {
        assert.equal(hasFeature({}, 'bulkOrders'), true);
    });
});

describe('switching a shop plan', () => {
    test('only the supreme admin can switch; a plain superadmin can read', async () => {
        const r = await put(plain, `/tenants/${w.tenant._id}/plan`, { to: 'growth' });
        assert.equal(r.status, 403);
        assert.equal((await get(plain, `/tenants/${w.tenant._id}/plan`)).status, 200);
    });

    test('Growth with free days: dates, features, history', async () => {
        const r = await put(supreme, `/tenants/${w.tenant._id}/plan`, { to: 'growth', freeDays: 30 });
        assert.equal(r.status, 200);
        assert.equal(r.body.id, 'growth');
        assert.equal(r.body.status, 'free');
        assert.equal(r.body.features.riderLiveMap, true);
        assert.equal(r.body.features.bulkOrders, false);
        assert.ok(r.body.daysLeft >= 29 && r.body.daysLeft <= 31);
    });

    test('Partner has no end date and a bad plan is refused', async () => {
        const r = await put(supreme, `/tenants/${w.tenant._id}/plan`, { to: 'partner' });
        assert.equal(r.body.id, 'partner');
        assert.equal(r.body.endsAt, null);
        assert.equal((await put(supreme, `/tenants/${w.tenant._id}/plan`, { to: 'classic' })).status, 400);
    });

    test('an extra turns a feature on outside the plan; dropping a plan that now includes it clears it', async () => {
        await put(supreme, `/tenants/${w.tenant._id}/plan`, { to: 'partner' });
        let r = await put(supreme, `/tenants/${w.tenant._id}/plan/extras`, { key: 'services', on: true });
        assert.deepEqual(r.body.extras, ['services']);
        r = await put(supreme, `/tenants/${w.tenant._id}/plan`, { to: 'growth' });
        assert.deepEqual(r.body.extras, []);   // Growth includes services, so the extra is no longer needed
    });

    test('per-shop terms and web/native switches', async () => {
        await put(supreme, `/tenants/${w.tenant._id}/plan`, { to: 'growth' });
        const r = await put(supreme, `/tenants/${w.tenant._id}/plan/terms`, { webEnabled: false, freeDays: 10 });
        assert.equal(r.body.webEnabled, false);
        assert.equal(r.body.nativeEnabled, true);
        assert.equal((await put(supreme, `/tenants/${w.tenant._id}/plan/terms`, { freeDays: 9999 })).status, 400);
    });
});

describe('platform defaults', () => {
    test('read for all, change for the supreme only, validated', async () => {
        assert.equal((await get(plain, '/plans')).body.defaults.growth.pricePaise, 299900);
        assert.equal((await put(plain, '/platform/plans', { freeDays: 10 })).status, 403);
        const ok = await put(supreme, '/platform/plans', { freeDays: 14, growth: { pricePaise: 349900 } });
        assert.equal(ok.status, 200);
        assert.equal(ok.body.freeDays, 14);
        assert.equal(ok.body.growth.pricePaise, 349900);
        assert.equal((await put(supreme, '/platform/plans', { feeSlabs: [{ upTo: null, feeRs: 20 }] })).status, 400);
        assert.equal((await put(supreme, '/platform/plans', {})).status, 400);
    });
});
