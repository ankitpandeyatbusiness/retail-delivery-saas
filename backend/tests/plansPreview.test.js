require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const Tenant = require('../src/models/Tenant');
const plans = require('../src/config/plans');

// Phase 7 of plans: the superadmin's live preview comes from the same catalog the server gates with.
let w; let admin; let n = 0;
const get = (p) => request(app).get(`/api/admin${p}`).set({ Authorization: `Bearer ${admin.token}` });
const row = (pv, route) => pv.ownerMenu.find((r) => r.route === route);

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld(`plan-prev-${++n}`);
    admin = await f.makeSuperAdmin('plain@example.com', { phones: [] });   // a plain superadmin may look
});

describe('preview of each plan', () => {
    test('Partner: timeline not map, 2 riders, no staff, locked rows say which plan, the wallet shows, no end date', async () => {
        const pv = (await get('/plans/preview?plan=partner')).body;
        assert.equal(pv.customer.tracking, 'timeline');
        assert.equal(pv.customer.riderCallButton, true);
        assert.deepEqual(pv.limits, { riders: 2, staff: 0 });
        assert.equal(pv.header.endsAt, null);
        assert.deepEqual(pv.header.perOrderFee, { minRs: 3, maxRs: 15 });
        assert.equal(row(pv, 'OwnerWallet').state, 'on');
        assert.deepEqual([row(pv, 'OwnerCosts').state, row(pv, 'OwnerCosts').needs], ['locked', 'Growth']);
        assert.deepEqual([row(pv, 'OwnerAutopilot').state, row(pv, 'OwnerAutopilot').needs], ['locked', 'Pro']);
        assert.equal(row(pv, 'OwnerBulk').state, 'hidden');
        assert.equal(pv.other.exports, 'money columns only');
        assert.equal(pv.other.soundboxVoice, false);
    });

    test('Growth: live map, 5 staff, costs on, autopilot still locked, wallet hidden, free days give an end date', async () => {
        const pv = (await get('/plans/preview?plan=growth&freeDays=10')).body;
        assert.equal(pv.customer.tracking, 'live_map');
        assert.deepEqual(pv.limits, { riders: null, staff: 5 });
        assert.equal(row(pv, 'OwnerCosts').state, 'on');
        assert.equal(row(pv, 'OwnerAutopilot').state, 'locked');
        assert.equal(row(pv, 'OwnerWallet').state, 'hidden');
        assert.equal(pv.header.freeDays, 10);
        assert.ok(pv.header.endsAt);
        assert.equal(pv.header.pricePaise, 299900);
    });

    test('Pro: everything on, unlimited', async () => {
        const pv = (await get('/plans/preview?plan=pro')).body;
        assert.ok(pv.ownerMenu.every((r) => r.state === 'on' || r.state === 'hidden'));
        assert.equal(row(pv, 'OwnerBulk').state, 'on');
        assert.deepEqual(pv.limits, { riders: null, staff: null });
        assert.equal(pv.other.exports, 'everything');
        assert.equal(pv.other.multiBranch, true);
    });

    test('a bad plan is refused', async () => {
        assert.equal((await get('/plans/preview?plan=classic')).status, 400);
    });
});

describe('preview for a shop', () => {
    test('uses the shop\'s own price, free days and extras, and lists what changes', async () => {
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { plan: { id: 'growth', priceOverridePaise: 199900, freeDaysOverride: 45, extras: [{ key: 'analytics' }] } } });
        const r = (await get(`/tenants/${w.tenant._id}/plan/preview?plan=pro`)).body;
        assert.equal(r.current.id, 'growth');
        assert.equal(r.preview.header.pricePaise, 199900);
        assert.equal(r.preview.header.freeDays, 45);
        assert.ok(r.preview.changes.on.includes('Bulk orders'));
        assert.deepEqual(r.preview.changes.off, []);
        const down = (await get(`/tenants/${w.tenant._id}/plan/preview?plan=partner`)).body.preview;
        assert.ok(down.changes.off.includes('Rider live map for customers'));
        assert.deepEqual(down.extras, ['analytics']);   // the extra stays outside the plan
        assert.equal(row(down, 'OwnerReportsHub').state, 'on');
    });
});

describe('the picture and the app cannot drift apart', () => {
    test('every plan-locked menu row in the owner app matches the catalog', () => {
        const src = fs.readFileSync(path.join(__dirname, '../../mobile/src/screens/owners/ShopHubScreen.jsx'), 'utf8');
        const m = src.match(/const LOCKS = \{([^}]*)\}/);
        assert.ok(m, 'LOCKS not found in ShopHubScreen');
        const app = Object.fromEntries([...m[1].matchAll(/(\w+):\s*'(\w+)'/g)].map((x) => [x[1], x[2]]));
        const catalog = Object.fromEntries(plans.OWNER_MENU.filter((r) => r.feature && !r.hiddenWhenOff).map((r) => [r.route, r.feature]));
        assert.deepEqual(app, catalog);
    });
    test('every feature a menu row needs exists in the catalog', () => {
        for (const r of plans.OWNER_MENU) if (r.feature) assert.ok(plans.FEATURES[r.feature], r.route);
    });
});
