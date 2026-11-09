require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const Tenant = require('../src/models/Tenant');
const Brand = require('../src/models/Brand');
const center = require('../src/notifications/center');
const backup = require('../src/jobs/backupDump');
const brandPlan = require('../src/services/brandPlan');
const life = require('../src/services/planLifecycle');
const mig = require('../src/services/planMigration');

// Stage 1 of the brand plan: one plan per brand on the MAIN shop, branches carry a copy, 3 shops free (editable per brand), more need payment first.
let supreme; let plain; let n = 0; let sent;
const DAY = 86400000;
const call = (a, m, p, b) => request(app)[m](`/api/admin${p}`).set({ Authorization: `Bearer ${a.token}` }).send(b);
// a brand of `count` shops; the first one made is the main shop
const makeBrand = async (count = 3) => {
    const shops = [];
    for (let i = 0; i < count; i += 1) { shops.push(await f.makeWorld(`bp-${++n}-${i}`)); await new Promise((r) => setTimeout(r, 5)); }
    const brand = await Brand.create({ name: 'Savera', ownerPhones: ['9000000010'] });
    await Tenant.updateMany({ _id: { $in: shops.map((s) => s.tenant._id) } }, { $set: { brandId: brand._id } });
    return { brand, shops, main: shops[0] };
};
const plan = async (w) => (await Tenant.findById(w.tenant._id).lean()).plan;
const User = require('../src/models/User');
// the test shops all use the same phone numbers; a shop that becomes a branch must not have a rider who already works at another branch
const spare = async () => { const w = await f.makeWorld(`bp-${++n}-s`); await User.deleteMany({ tenantId: w.tenant._id, role: 'rider' }); return w; };

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    supreme = await f.makeSuperAdmin();
    plain = await f.makeSuperAdmin('plain@example.com', { phones: [] });
    sent = [];
    mock.method(center, 'notify', (type, p) => { sent.push({ type, ...p }); return Promise.resolve(); });
    mock.method(backup, 'runBackup', async () => ({ day: 'd', collections: 1, documents: 1, bytes: 1, pruned: [] }));
});
afterEach(() => mock.restoreAll());

describe('one plan per brand', () => {
    test('setting the plan on the main shop gives every branch a copy; the branches keep their own website and app switches', async () => {
        const { shops, main } = await makeBrand(3);
        await Tenant.updateOne({ _id: shops[1].tenant._id }, { $set: { plan: { webEnabled: false } } });
        const r = await call(supreme, 'put', `/tenants/${main.tenant._id}/plan`, { to: 'pro', freeDays: 30 });
        assert.equal(r.status, 200);
        for (const b of shops.slice(1)) {
            const p = await plan(b);
            assert.equal(p.id, 'pro');
            assert.equal(String(p.inheritedFrom), String(main.tenant._id));
            assert.ok(p.endsAt);
        }
        assert.equal((await plan(shops[1])).webEnabled, false);   // its own switch is kept
        // an extra on the main shop is copied too
        await call(supreme, 'put', `/tenants/${main.tenant._id}/plan`, { to: 'growth', freeDays: 10 });
        await call(supreme, 'put', `/tenants/${main.tenant._id}/plan/extras`, { key: 'bulkOrders', on: true });
        assert.deepEqual((await plan(shops[2])).extras.map((e) => e.key), ['bulkOrders']);
    });

    test('a branch\'s own plan cannot be changed: the answer names the main shop', async () => {
        const { shops, main } = await makeBrand(2);
        const r = await call(supreme, 'put', `/tenants/${shops[1].tenant._id}/plan`, { to: 'pro' });
        assert.equal(r.status, 409);
        assert.match(r.body.error, /set on the main shop/);
        assert.equal((await plan(shops[1])).id, undefined);
        assert.equal((await call(supreme, 'put', `/tenants/${main.tenant._id}/plan`, { to: 'pro' })).status, 200);
    });

    test('the lifecycle works on the main shop only: one message, the pause reaches the branches', async () => {
        const { shops, main } = await makeBrand(3);
        const ended = new Date(Date.now() - 10 * DAY);
        await Tenant.updateOne({ _id: main.tenant._id }, { $set: { plan: { id: 'pro', startedAt: new Date(Date.now() - 40 * DAY), endsAt: ended } } });
        await brandPlan.syncPlan(main.brand ? main.brand._id : (await Tenant.findById(main.tenant._id).lean()).brandId);
        await life.sweep(new Date());
        const mine = (w) => sent.filter((s) => String(s.tenantId) === String(w.tenant._id) && s.type === 'plan_ended').length;
        assert.equal(mine(main), 1);
        assert.equal(mine(shops[1]), 0);   // a branch is never told separately
        for (const b of shops) assert.equal((await plan(b)).paused, true);   // the whole brand pauses together
    });
});

describe('3 shops free, more need payment', () => {
    test('a fourth shop is refused with what to do; the free count is editable per brand; a free extra is allowed by the supreme admin', async () => {
        const { brand, main } = await makeBrand(3);
        const extra = await spare();
        const add = () => call(supreme, 'post', `/brands/${brand._id}/branches`, { tenantId: String(extra.tenant._id), city: 'Lucknow' });
        const first = await add();
        assert.equal(first.status, 409);
        assert.equal(first.body.needsPayment, true);
        assert.equal(first.body.capacity, 3);
        assert.match(first.body.error, /pays for an extra shop first/);
        // this brand gets 3 free branches besides the main shop (4 shops)
        const loc = await call(supreme, 'put', `/brands/${brand._id}/locations`, { includedBranches: 3 });
        assert.equal(loc.status, 200);
        assert.equal(loc.body.locations.capacity, 4);
        assert.equal((await add()).status, 201);
        // a fifth needs a free exception
        const fifth = await spare();
        const addFifth = () => call(supreme, 'post', `/brands/${brand._id}/branches`, { tenantId: String(fifth.tenant._id), city: 'Kanpur' });
        assert.equal((await addFifth()).status, 409);
        assert.equal((await call(supreme, 'put', `/brands/${brand._id}/locations`, { freeExtra: 1 })).status, 200);
        assert.equal((await addFifth()).status, 201);
        // back to the platform default
        const back = await call(supreme, 'put', `/brands/${brand._id}/locations`, { includedBranches: null });
        assert.equal(back.body.locations.includedBranches, 2);
        assert.ok(main);
    });

    test('a branch added later carries the brand plan at once', async () => {
        const { brand, main } = await makeBrand(2);
        await call(supreme, 'put', `/tenants/${main.tenant._id}/plan`, { to: 'pro', freeDays: 30 });
        const late = await spare();
        assert.equal((await call(supreme, 'post', `/brands/${brand._id}/branches`, { tenantId: String(late.tenant._id), city: 'Agra' })).status, 201);
        assert.equal((await plan(late)).id, 'pro');
    });

    test('only the supreme admin changes the free count; the brand screen shows the plan and the shops used', async () => {
        const { brand, main } = await makeBrand(3);
        assert.equal((await call(plain, 'put', `/brands/${brand._id}/locations`, { freeExtra: 1 })).status, 403);
        assert.equal((await call(supreme, 'put', `/brands/${brand._id}/locations`, { includedBranches: 99 })).status, 400);
        assert.equal((await call(supreme, 'put', `/brands/${brand._id}/locations`, {})).status, 400);
        await call(supreme, 'put', `/tenants/${main.tenant._id}/plan`, { to: 'pro', freeDays: 30 });
        const d = (await call(plain, 'get', `/brands/${brand._id}`)).body.plan;
        assert.equal(d.main.id, String(main.tenant._id));
        assert.equal(d.plan.id, 'pro');
        assert.deepEqual([d.locations.used, d.locations.capacity, d.locations.includedLocations], [3, 3, 3]);
    });
});

describe('moving existing shops to plans', () => {
    test('a branch is not moved by itself: the main shop moves and the branches follow', async () => {
        const { shops, main } = await makeBrand(3);
        const solo = await spare();
        const pv = await mig.preview();
        assert.equal(pv.counts.move, 2);   // the main shop and the shop with no brand
        assert.equal(pv.skip.filter((s) => /follows the plan of the main shop/.test(s.why)).length, 2);
        const r = await mig.run({ by: 'test' });
        assert.equal(r.movedCount, 2);
        for (const b of shops) assert.equal((await plan(b)).id, 'pro');
        assert.equal(String((await plan(shops[1])).inheritedFrom), String(main.tenant._id));
        assert.equal((await plan(solo)).id, 'pro');
        // undo: the branches lose the copy too
        assert.equal((await mig.rollback()).rolledBack, 2);
        for (const b of shops) assert.equal((await plan(b))?.id, undefined);
    });
});
