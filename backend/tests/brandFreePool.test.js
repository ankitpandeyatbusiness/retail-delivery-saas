require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeSuperAdmin } = require('./helpers/factory');
const Tenant = require('../src/models/Tenant');
const Brand = require('../src/models/Brand');
const PlatformSettings = require('../src/models/PlatformSettings');
const { syncFreeState, firstBillablePeriod } = require('../src/services/subscriptionService');

let supreme;
let plain;
const as = (t) => ({ Authorization: `Bearer ${t}` });
const post = (url, body, t = supreme) => request(app).post(url).set(as(t)).send(body);
const put = (url, body, t = supreme) => request(app).put(url).set(as(t)).send(body);

before(async () => { await db.connect(); });
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    supreme = (await makeSuperAdmin('boss@example.com')).token;
    plain = (await makeSuperAdmin('other@example.com', { phones: ['9000000077'] })).token;
});

const fresh = (id) => Tenant.findById(id).lean();
const platform = () => PlatformSettings.findById('main').lean();
async function newBrand() { return (await post('/api/admin/brands', { name: 'Savera' })).body.brand; }
async function addBranch(brand, city) {
    const r = await post(`/api/admin/brands/${brand._id}/branches`, { name: `Savera ${city}`, slug: `savera-${city}`, city });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.branch;
}
// "Go live" through the real route (a branch needs its pin first), then a chosen go-live moment
async function goLive(branch, at) {
    await Tenant.updateOne({ _id: branch.id }, { $set: { delivery: { latitude: 19.07, longitude: 72.87, radiusKm: 8 } } });
    const r = await post(`/api/admin/tenants/${branch.id}/billing/go-live`, {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    if (at) {
        // the route ran the free check with today's real date; put the branch back to the pretend date: free, nothing ended yet
        await Tenant.updateOne({ _id: branch.id }, { $set: { 'billing.goLiveAt': at, 'billing.state': 'free' }, $unset: { 'billing.freeEndedAt': 1, 'billing.freeForceEndedAt': 1 } });
        const t = await Tenant.findById(branch.id).select('brandId billing.pooled').lean();
        if (t.brandId && t.billing && t.billing.pooled) {
            // the pool started at the earliest go-live of its branches (the route used today's real date)
            const live = await Tenant.find({ brandId: t.brandId, 'billing.pooled': true, 'billing.isLive': true }).select('billing.goLiveAt').lean();
            const first = new Date(Math.min(...live.map((x) => new Date(x.billing.goLiveAt).getTime())));
            await Brand.updateOne({ _id: t.brandId }, { $set: { 'freeStart.startedAt': first } });
        }
    }
}
const sync = async (branch, now) => { const t = await fresh(branch.id); await syncFreeState(t, await platform(), now); return fresh(branch.id); };

describe('a new branch has no free time of its own', () => {
    test('with the switch off: no free time, and the first bill is the first full month after go-live', async () => {
        const brand = await newBrand();
        const b = await addBranch(brand, 'delhi');
        const t = await fresh(b.id);
        assert.deepEqual([t.billing.freeOrdersOverride, t.billing.freeMonthsOverride, !!t.billing.pooled], [0, 0, false]);

        await goLive(b, new Date('2027-03-03T10:00:00Z'));
        const after = await sync(b, new Date('2027-03-04T10:00:00Z'));
        assert.equal(after.billing.state, 'active');
        assert.equal(new Date(after.billing.freeEndedAt).toISOString(), '2027-03-03T10:00:00.000Z');
        assert.equal(firstBillablePeriod(after.billing.freeEndedAt), '2027-04');   // March (the go-live month) is not billed
    });

    test('a shop that is not a branch keeps the normal free period; existing branches are not changed by the switch', async () => {
        const brand = await newBrand();
        const old = await addBranch(brand, 'goa');
        await Tenant.updateOne({ _id: old.id }, { $set: { 'billing.state': 'active', 'billing.freeEndedAt': new Date('2027-01-10T00:00:00Z'), 'billing.isLive': true } });
        const r = await put(`/api/admin/brands/${brand._id}/free-start`, { on: true });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const t = await fresh(old.id);
        assert.equal(!!t.billing.pooled, false);   // already billing: stays as it is
    });
});

describe('the shared free pool', () => {
    test('branches that go live together share the pool; when it is full they ALL end at the same moment and start billing in the same month', async () => {
        const brand = await newBrand();
        const a = await addBranch(brand, 'delhi');
        const b = await addBranch(brand, 'mumbai');
        assert.equal((await put(`/api/admin/brands/${brand._id}/free-start`, { on: true })).status, 200);
        for (const x of [a, b]) {
            const t = await fresh(x.id);
            assert.deepEqual([!!t.billing.pooled, t.billing.freeOrdersOverride > 1000], [true, true]);
        }
        await goLive(a, new Date('2027-02-10T10:00:00Z'));
        await goLive(b, new Date('2027-02-12T10:00:00Z'));
        assert.equal(new Date((await Brand.findById(brand._id)).freeStart.startedAt).toISOString(), '2027-02-10T10:00:00.000Z');   // the first go-live

        // 60 + 45 orders: neither branch reached 100, together they did
        await Tenant.updateOne({ _id: a.id }, { $set: { 'billing.billableCount': 60 } });
        await Tenant.updateOne({ _id: b.id }, { $set: { 'billing.billableCount': 45 } });
        const now = new Date('2027-02-20T09:00:00Z');
        const ta = await sync(a, now);
        const tb = await sync(b, now);
        const pool = await Brand.findById(brand._id);
        assert.equal(new Date(pool.freeStart.endedAt).toISOString(), now.toISOString());
        for (const t of [ta, tb]) {
            assert.equal(t.billing.state, 'active');
            assert.equal(new Date(t.billing.freeEndedAt).toISOString(), now.toISOString());
            assert.equal(firstBillablePeriod(t.billing.freeEndedAt), '2027-03');
        }
    });

    test('the pool also ends by time: 2 months after the first go-live, exactly at that moment', async () => {
        const brand = await newBrand();
        const a = await addBranch(brand, 'delhi');
        await put(`/api/admin/brands/${brand._id}/free-start`, { on: true });
        await goLive(a, new Date('2027-01-08T10:00:00Z'));
        const ta = await sync(a, new Date('2027-03-20T00:00:00Z'));
        assert.equal(new Date(ta.billing.freeEndedAt).toISOString(), '2027-03-08T10:00:00.000Z');   // start + 2 months, not the moment of the check
        assert.equal(firstBillablePeriod(ta.billing.freeEndedAt), '2027-04');
    });

    test('a branch made while the pool runs shares what is left: the pool ends on the 8th, the new branch (live on the 7th) bills from the same month as the others', async () => {
        const brand = await newBrand();
        const a = await addBranch(brand, 'delhi');
        await put(`/api/admin/brands/${brand._id}/free-start`, { on: true });
        await goLive(a, new Date('2027-01-08T10:00:00Z'));
        const c = await addBranch(brand, 'pune');   // made while the pool runs
        assert.equal((await fresh(c.id)).billing.pooled, true);
        await goLive(c, new Date('2027-03-07T10:00:00Z'));
        const now = new Date('2027-03-09T00:00:00Z');
        const ta = await sync(a, now);
        const tc = await sync(c, now);
        for (const t of [ta, tc]) {
            assert.equal(new Date(t.billing.freeEndedAt).toISOString(), '2027-03-08T10:00:00.000Z');
            assert.equal(firstBillablePeriod(t.billing.freeEndedAt), '2027-04');
        }
    });

    test('after the pool ended: a new branch has no free time, a pooled branch that goes live late gets none, and the pool cannot start again', async () => {
        const brand = await newBrand();
        const a = await addBranch(brand, 'delhi');
        const late = await addBranch(brand, 'goa');       // pooled, but not live yet
        await put(`/api/admin/brands/${brand._id}/free-start`, { on: true });
        await goLive(a, new Date('2027-01-08T10:00:00Z'));
        await sync(a, new Date('2027-03-20T00:00:00Z'));   // the pool ends by time
        const lt = await fresh(late.id);
        assert.deepEqual([!!lt.billing.pooled, lt.billing.freeOrdersOverride, lt.billing.freeMonthsOverride], [false, 0, 0]);

        const n = await addBranch(brand, 'noida');
        assert.deepEqual([(await fresh(n.id)).billing.freeOrdersOverride, !!(await fresh(n.id)).billing.pooled], [0, false]);
        assert.equal((await put(`/api/admin/brands/${brand._id}/free-start`, { on: true })).status, 409);
    });

    test('switching it off ends a running pool now; limits can be set per brand; only the supreme admin; bad numbers refused', async () => {
        const brand = await newBrand();
        const a = await addBranch(brand, 'delhi');
        assert.equal((await put(`/api/admin/brands/${brand._id}/free-start`, { on: true }, plain)).status, 403);
        assert.equal((await put(`/api/admin/brands/${brand._id}/free-start`, { on: 'yes' })).status, 400);
        assert.equal((await put(`/api/admin/brands/${brand._id}/free-start`, { on: true, freeOrders: -3 })).status, 400);

        const on = await put(`/api/admin/brands/${brand._id}/free-start`, { on: true, freeOrders: 300, freeMonths: 3 });
        assert.deepEqual([on.body.freeStart.freeOrders, on.body.freeStart.freeMonths, on.body.freeStart.on], [300, 3, true]);
        await goLive(a, new Date('2027-02-01T10:00:00Z'));
        await Tenant.updateOne({ _id: a.id }, { $set: { 'billing.billableCount': 150 } });
        const t1 = await sync(a, new Date('2027-02-15T00:00:00Z'));
        assert.equal(t1.billing.state, 'free');   // 150 < 300: still in the pool

        const off = await put(`/api/admin/brands/${brand._id}/free-start`, { on: false });
        assert.equal(off.status, 200);
        assert.deepEqual([off.body.freeStart.on, off.body.freeStart.ended], [false, true]);
        const t2 = await sync(a, new Date('2027-02-16T00:00:00Z'));
        assert.equal(t2.billing.state, 'active');

        const detail = await request(app).get(`/api/admin/brands/${brand._id}`).set(as(plain));
        assert.equal(detail.body.freeStart.ended, true);
    });
});
