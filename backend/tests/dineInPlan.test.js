require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const Tenant = require('../src/models/Tenant');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const { resolveConfig } = require('../src/services/tenantConfigService');

// Dine-in ordering with QR tables is a Growth and Pro feature: Partner takes delivery and pickup only (table booking stays on every plan).
let w; let slug; let n = 0;
const DAY = 86400000;
const setPlan = async (plan) => { await Tenant.updateOne({ _id: w.tenant._id }, { $set: { plan } }); tenantRecognizer.invalidateTenant(slug); };
const cfg = async () => resolveConfig(await Tenant.findById(w.tenant._id).lean()).orders.dineIn.enabled;
const saveOrders = (orders) => request(app).put('/api/shop/settings').set(w.owner.headers).send({ orders });

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    slug = `dine-${++n}`;
    w = await f.makeWorld(slug);
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.dineIn.enabled': true } });
    tenantRecognizer.invalidateTenant(slug);
});

describe('dine-in follows the plan', () => {
    test('Partner: off whatever the saved setting says; Growth, Pro and a shop with no plan: on; the setting is kept', async () => {
        await setPlan({ id: 'partner' });
        assert.equal(await cfg(), false);
        await setPlan({ id: 'growth', startedAt: new Date(), endsAt: new Date(Date.now() + 5 * DAY) });
        assert.equal(await cfg(), true);                 // the saved "on" works again
        await setPlan({ id: 'pro', startedAt: new Date(), endsAt: new Date(Date.now() + 5 * DAY) });
        assert.equal(await cfg(), true);
        await Tenant.updateOne({ _id: w.tenant._id }, { $unset: { plan: 1 } });
        assert.equal(await cfg(), true);
    });

    test('the customer config of a Partner shop says dine-in is off', async () => {
        await setPlan({ id: 'partner' });
        const c = (await request(app).get('/api/tenants/config').set('x-tenant-slug', slug)).body;
        assert.equal((c.full || c.config || c).orders.dineIn.enabled, false);
    });

    test('a Partner owner cannot switch dine-in on; a Growth owner can', async () => {
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.dineIn.enabled': false } });
        await setPlan({ id: 'partner' });
        const no = await saveOrders({ dineIn: { enabled: true } });
        assert.equal(no.status, 403);
        assert.match(no.body.error, /not in your plan/);
        await setPlan({ id: 'growth', startedAt: new Date(), endsAt: new Date(Date.now() + 5 * DAY) });
        assert.equal((await saveOrders({ dineIn: { enabled: true } })).status, 200);
    });

    test('a scanned table code is refused on Partner as not taking dine in orders', async () => {
        await setPlan({ id: 'partner' });
        const r = await request(app).post('/api/dinein/scan').set('x-tenant-slug', slug).send({ table: '1', k: 'x' });
        assert.equal(r.status, 400);
        assert.match(r.body.error, /not taking dine in orders/);
        await setPlan({ id: 'growth', startedAt: new Date(), endsAt: new Date(Date.now() + 5 * DAY) });
        const g = await request(app).post('/api/dinein/scan').set('x-tenant-slug', slug).send({ table: '1', k: 'x' });
        assert.match(g.body.error, /QR code is not valid/);   // dine-in is on: it got as far as checking the code
    });

    test('table booking is not touched by the plan', async () => {
        const plans = require('../src/config/plans');
        assert.equal(plans.planIncludes('partner', 'tableBooking'), true);   // not plan-gated at all
        assert.equal(plans.planIncludes('partner', 'dineIn'), false);
    });
});
