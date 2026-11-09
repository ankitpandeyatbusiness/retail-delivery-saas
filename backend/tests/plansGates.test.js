require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const Tenant = require('../src/models/Tenant');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const loyalty = require('../src/services/loyaltyService');
const { hasFeature, limitOf } = require('../src/services/featureGate');

// Phase 2 of plans: the server refuses what the plan does not include.
let w; let slug; let n = 0;
const setPlan = async (id, extras) => {
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { plan: { id, extras: extras || undefined } } });
    tenantRecognizer.invalidateTenant(slug);
};
const owner = (m, p, b) => request(app)[m](`/api/shop${p}`).set(w.owner.headers).send(b);

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    slug = `plan-gates-${++n}`;
    w = await f.makeWorld(slug);
});

describe('what a plan includes', () => {
    test('costs and profit: Growth and Pro yes, Partner no, an extra opens it', async () => {
        await setPlan('partner');
        assert.equal((await owner('get', '/costs')).status, 403);
        await setPlan('partner', [{ key: 'costsProfit' }]);
        assert.notEqual((await owner('get', '/costs')).status, 403);
        await setPlan('growth');
        assert.notEqual((await owner('get', '/costs')).status, 403);
    });

    test('autopilot (daily and custom push) and analytics are Pro only', async () => {
        await setPlan('growth');
        assert.equal((await owner('get', '/autopilot')).status, 403);
        assert.equal((await owner('get', '/business-report')).status, 403);
        await setPlan('pro');
        assert.notEqual((await owner('get', '/autopilot')).status, 403);
        assert.notEqual((await owner('get', '/business-report')).status, 403);
    });

    test('a shop with no plan is not limited', async () => {
        await Tenant.updateOne({ _id: w.tenant._id }, { $unset: { plan: 1 } });
        tenantRecognizer.invalidateTenant(slug);
        assert.notEqual((await owner('get', '/costs')).status, 403);
        assert.notEqual((await owner('get', '/autopilot')).status, 403);
    });
});

describe('exports: money columns only below Pro', () => {
    test('people exports are refused, the catalog hides them, orders have no customer columns', async () => {
        await setPlan('growth');
        assert.equal((await owner('get', '/exports/customers/count')).status, 403);
        const cat = await owner('get', '/exports/catalog');
        assert.equal(cat.status, 200);
        const keys = cat.body.items.map((i) => i.key);
        assert.ok(!keys.includes('customers') && !keys.includes('riders') && keys.includes('orders'));
        const cols = cat.body.items.find((i) => i.key === 'orders').levels.everything.columns;
        assert.ok(!cols.includes('Customer') && !cols.includes('Phone') && !cols.includes('Address'));
        assert.ok(cols.includes('Total (₹)'));
    });
    test('Pro gets everything', async () => {
        await setPlan('pro');
        assert.equal((await owner('get', '/exports/customers/count')).status, 200);
        const cols = (await owner('get', '/exports/catalog')).body.items.find((i) => i.key === 'orders').levels.everything.columns;
        assert.ok(cols.includes('Customer') && cols.includes('Phone'));
    });
});

describe('limits', () => {
    test('Partner has 2 riders: the third is refused, Growth has no limit', async () => {
        await setPlan('partner');
        // the world already has one rider (9000000020)
        assert.equal((await owner('post', '/riders', { phone: '9000000041', name: 'Two' })).status, 201);
        const third = await owner('post', '/riders', { phone: '9000000042', name: 'Three' });
        assert.equal(third.status, 403);
        assert.match(third.body.error, /allows 2 riders/);
        await setPlan('growth');
        assert.equal((await owner('post', '/riders', { phone: '9000000042', name: 'Three' })).status, 201);
    });
    test('limitOf', () => {
        assert.equal(limitOf({ plan: { id: 'partner' } }, 'riders'), 2);
        assert.equal(limitOf({ plan: { id: 'growth' } }, 'staff'), 5);
        assert.equal(limitOf({ plan: { id: 'pro' } }, 'staff'), null);
        assert.equal(limitOf({}, 'riders'), null);
    });
});

describe('loyalty and services follow the plan', () => {
    test('Partner earns no points even when the shop had loyalty on', async () => {
        const g = { plan: { id: 'growth' } }; const p = { plan: { id: 'partner' } };
        assert.equal(hasFeature(g, 'loyalty'), true);
        assert.equal(hasFeature(p, 'loyalty'), false);
        assert.equal(hasFeature(p, 'services'), false);
        assert.equal(hasFeature(p, 'tableBooking'), true);   // dine-in and booking are in every plan
        assert.equal((await loyalty.customerView({ ...w.tenant.toObject(), plan: { id: 'partner' } }, w.customer.user?._id || w.customer._id)).enabled, false);
    });
});
