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

describe('paying for extra shops', () => {
    const crypto = require('crypto');
    const payments = require('../src/services/adapters/payments');
    const sign = (o, p) => crypto.createHmac('sha256', 'mock_key_secret').update(`${o}|${p}`).digest('hex');
    const owner = (w, m, p, b) => request(app)[m](`/api/shop/plan${p}`).set(w.owner.headers).send(b);
    const proBrand = async (count = 3, daysLeft = 20.5) => {
        const x = await makeBrand(count);
        await Tenant.updateOne({ _id: x.main.tenant._id }, { $set: { plan: { id: 'pro', startedAt: new Date(), endsAt: new Date(Date.now() + daysLeft * DAY) } } });
        await brandPlan.syncPlan(x.brand._id);
        return x;
    };
    const pay = async (w, start, id) => {
        payments._mock.setPayment({ id, orderId: start.body.rzpOrderId, status: 'captured', amountPaise: start.body.amountPaise });
        return owner(w, 'post', `/pay/${start.body.paymentId}/verify`, { razorpay_order_id: start.body.rzpOrderId, razorpay_payment_id: id, razorpay_signature: sign(start.body.rzpOrderId, id) });
    };
    beforeEach(() => payments._mock.reset());

    test('one extra shop: Rs 1,499 split by the whole days left of 30; a branch\'s owner gets the same quote', async () => {
        const { shops, main } = await proBrand();
        const q = (await owner(main, 'post', '/branch/quote', {})).body;
        assert.equal(q.kind, 'branch');
        assert.equal(q.daysLeft, 20);
        assert.equal(q.taxablePaise, Math.round((149900 * 20) / 30));
        assert.equal(q.totalPaise, q.taxablePaise);   // no GST number in the test platform
        const fromBranch = (await owner(shops[1], 'post', '/branch/quote', {})).body;
        assert.equal(fromBranch.totalPaise, q.totalPaise);
    });

    test('pay first, then the branch can be created; the next one needs another payment', async () => {
        const { brand, main } = await proBrand();
        const extra = await spare();
        const add = (w) => call(supreme, 'post', `/brands/${brand._id}/branches`, { tenantId: String(w.tenant._id), city: 'Lucknow' });
        assert.equal((await add(extra)).status, 409);
        const start = await owner(main, 'post', '/branch/pay/start', {});
        assert.equal(start.status, 201);
        assert.equal((await pay(main, start, 'pay_b1')).body.paid, true);
        assert.equal((await Brand.findById(brand._id).lean()).locations.paidExtra, 1);
        // the same payment again changes nothing
        assert.equal((await pay(main, start, 'pay_b1')).body.paid, true);
        assert.equal((await Brand.findById(brand._id).lean()).locations.paidExtra, 1);
        assert.equal((await add(extra)).status, 201);
        assert.equal((await plan(extra)).id, 'pro');   // the new shop carries the brand plan
        const another = await spare();
        assert.equal((await add(another)).status, 409);
        assert.equal((await call(plain, 'get', `/brands/${brand._id}`)).body.plan.locations.paidExtra, 1);
    });

    test('only a brand owner pays, a plan that is not Pro or has ended cannot add shops', async () => {
        const { shops, main, brand } = await proBrand();
        // a branch manager (not in the brand owners' phones)
        const manager = await f.makeUser(shops[1].tenant, 'admin', '9000000077');
        const r = await request(app).post('/api/shop/plan/branch/pay/start').set(manager.headers).send({});
        assert.equal(r.status, 403);
        assert.equal(r.body.brandOwnerPays, true);
        await Tenant.updateOne({ _id: main.tenant._id }, { $set: { 'plan.id': 'growth' } });
        assert.equal((await owner(main, 'post', '/branch/quote', {})).status, 409);
        await Tenant.updateOne({ _id: main.tenant._id }, { $set: { 'plan.id': 'pro', 'plan.endsAt': new Date(Date.now() - DAY) } });
        assert.equal((await owner(main, 'post', '/branch/quote', {})).status, 409);
        assert.ok(brand);
    });

    test('the renewal is ONE payment: the plan plus the extra shops, discount on both, and it stores what is paid for', async () => {
        const { brand, main } = await proBrand(5);   // 5 shops: 3 are free, 2 are extra
        const q = (await owner(main, 'post', '/quote', { to: 'pro', months: 3 })).body;
        assert.equal(q.kind, 'renew');
        assert.equal(q.extraShops, 2);
        const gross = 499900 * 3 + 2 * 149900 * 3;
        assert.equal(q.lines.length, 3);   // the plan, the extra shops, the 3-month discount
        assert.match(q.lines[1].label, /2 extra shop/);
        assert.equal(q.taxablePaise, gross - Math.round(gross * 0.05));
        const start = await owner(main, 'post', '/pay/start', { to: 'pro', months: 3 });
        assert.equal(start.body.amountPaise, q.totalPaise);
        assert.equal((await pay(main, start, 'pay_b2')).body.paid, true);
        assert.equal((await Brand.findById(brand._id).lean()).locations.paidExtra, 2);
        // a free extra the supreme admin allowed is not billed
        await call(supreme, 'put', `/brands/${brand._id}/locations`, { freeExtra: 1 });
        assert.equal((await owner(main, 'post', '/quote', { to: 'pro', months: 1 })).body.extraShops, 1);
    });

    test('a brand with no extra shops pays the plain plan price', async () => {
        const { main } = await proBrand(3);
        const q = (await owner(main, 'post', '/quote', { to: 'pro', months: 1 })).body;
        assert.equal(q.extraShops, 0);
        assert.equal(q.taxablePaise, 499900);
        assert.equal(q.lines.length, 1);
    });
});

describe('a brand whose branches had their own plans', () => {
    test('the brand screen lists the branches that differ; one action makes every branch follow the main plan', async () => {
        const { brand, shops, main } = await makeBrand(3);
        await Tenant.updateOne({ _id: main.tenant._id }, { $set: { plan: { id: 'pro', endsAt: new Date(Date.now() + 9 * DAY) } } });
        await Tenant.updateOne({ _id: shops[1].tenant._id }, { $set: { plan: { id: 'growth', endsAt: new Date(Date.now() + 3 * DAY) } } });   // its own plan from before
        const before = (await call(plain, 'get', `/brands/${brand._id}`)).body.plan;
        assert.equal(before.differing.length, 2);   // the growth branch, and the branch with no plan
        assert.equal((await call(plain, 'post', `/brands/${brand._id}/sync-plan`)).status, 403);
        const r = await call(supreme, 'post', `/brands/${brand._id}/sync-plan`);
        assert.equal(r.status, 200);
        assert.equal((await plan(shops[1])).id, 'pro');
        assert.equal(String((await plan(shops[1])).inheritedFrom), String(main.tenant._id));
        assert.equal(r.body.summary.differing.length, 0);
    });
});
