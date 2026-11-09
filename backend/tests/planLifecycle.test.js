require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const Tenant = require('../src/models/Tenant');
const PartnerWallet = require('../src/models/PartnerWallet');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const center = require('../src/notifications/center');
const life = require('../src/services/planLifecycle');
const wallet = require('../src/services/partnerWalletService');

// Phase 6 of plans: reminders 7/3/1, the end, grace, pause, a scheduled lower plan, wallet alerts. Every step sends once and catches up.
let w; let slug; let sent; let n = 0;
const DAY = 86400000;
const setPlan = async (plan) => { await Tenant.updateOne({ _id: w.tenant._id }, { $set: { plan } }); tenantRecognizer.invalidateTenant(slug); };
const plan = async () => (await Tenant.findById(w.tenant._id).lean()).plan;
const kinds = () => sent.filter((s) => s.tenantId && String(s.tenantId) === String(w.tenant._id)).map((s) => s.type);
const sweepAt = (d) => life.sweep(new Date(d));

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    slug = `plan-life-${++n}`;
    w = await f.makeWorld(slug);
    sent = [];
    mock.method(center, 'notify', (type, p) => { sent.push({ type, ...p }); return Promise.resolve(); });
});
afterEach(() => mock.restoreAll());

describe('reminders before the end', () => {
    test('7, 3 and 1 days: each once, and a repeat run adds nothing', async () => {
        const end = new Date(Date.now() + 6.5 * DAY);
        await setPlan({ id: 'growth', startedAt: new Date(), endsAt: end });
        await sweepAt(Date.now()); await sweepAt(Date.now());
        assert.deepEqual(kinds(), ['plan_ending']);   // 7 days
        await sweepAt(end.getTime() - 2.5 * DAY); await sweepAt(end.getTime() - 2.5 * DAY);
        assert.deepEqual(kinds(), ['plan_ending', 'plan_ending']);   // 3 days
        await sweepAt(end.getTime() - 0.5 * DAY); await sweepAt(end.getTime() - 0.5 * DAY);
        assert.deepEqual(kinds(), ['plan_ending', 'plan_ending', 'plan_ending']);   // 1 day
    });

    test('a job that was down sends only the nearest reminder, not three', async () => {
        const end = new Date(Date.now() + 0.5 * DAY);
        await setPlan({ id: 'pro', startedAt: new Date(), endsAt: end });
        await sweepAt(Date.now());
        assert.deepEqual(kinds(), ['plan_ending']);
        await sweepAt(Date.now());
        assert.deepEqual(kinds(), ['plan_ending']);
    });

    test('a renewal (a new end date) starts the reminders clean', async () => {
        const end = new Date(Date.now() + 0.5 * DAY);
        await setPlan({ id: 'growth', startedAt: new Date(), endsAt: end });
        await sweepAt(Date.now());
        const t = await Tenant.findById(w.tenant._id).lean();
        await Tenant.updateOne({ _id: t._id }, { $set: { 'plan.endsAt': new Date(Date.now() + 29.5 * DAY) } });   // paid for another month
        await sweepAt(Date.now() + 28.5 * DAY);
        assert.equal(kinds().length, 2);
    });

    test('Partner has no end date and nothing is sent', async () => {
        await setPlan({ id: 'partner' });
        await sweepAt(Date.now() + 400 * DAY);
        assert.deepEqual(kinds(), []);
    });
});

describe('the end, grace and pause', () => {
    const OWNER = () => request(app).get('/api/shop/categories').set(w.owner.headers);   // a closed route while paused (orders stay open)

    test('ended: told once; inside the grace days the shop still works; after them it is paused', async () => {
        const end = new Date(Date.now() - 1000);
        await setPlan({ id: 'growth', startedAt: new Date(Date.now() - 30 * DAY), endsAt: end });
        await sweepAt(Date.now()); await sweepAt(Date.now());
        assert.deepEqual(kinds().filter((k) => k === 'plan_ended'), ['plan_ended']);
        assert.equal((await plan()).paused, undefined);
        assert.notEqual((await OWNER()).status, 403);
        await sweepAt(end.getTime() + 10 * DAY);
        assert.equal((await plan()).paused, true);
        assert.equal(kinds().filter((k) => k === 'plan_paused').length, 1);
        await sweepAt(end.getTime() + 11 * DAY);
        assert.equal(kinds().filter((k) => k === 'plan_paused').length, 1);
    });

    test('paused: the owner panel is closed except Plan and Wallet; running orders can still finish', async () => {
        await setPlan({ id: 'growth', startedAt: new Date(Date.now() - 40 * DAY), endsAt: new Date(Date.now() - 10 * DAY), paused: true });
        const r = await OWNER();
        assert.equal(r.status, 403);
        assert.equal(r.body.planPaused, true);
        assert.equal((await request(app).get('/api/shop/plan').set(w.owner.headers)).status, 200);
        const o = await f.makeOrder(w.tenant, w.customer.user, { status: 'ready', orderType: 'pickup' });
        const fin = await request(app).patch(`/api/shop/orders/${o._id}/status`).set(w.owner.headers).send({ status: 'delivered', skipCode: true });
        assert.equal(fin.status, 200);
    });

    test('the supreme admin choosing a plan opens the shop again', async () => {
        await setPlan({ id: 'growth', startedAt: new Date(Date.now() - 40 * DAY), endsAt: new Date(Date.now() - 10 * DAY), paused: true, notified: { ended: 'x' } });
        const admin = await f.makeSuperAdmin();
        const r = await request(app).put(`/api/admin/tenants/${w.tenant._id}/plan`).set({ Authorization: `Bearer ${admin.token}` }).send({ to: 'growth', freeDays: 10 });
        assert.equal(r.status, 200);
        const p = await plan();
        assert.equal(p.paused, undefined);
        assert.equal(p.notified, undefined);
        assert.notEqual((await OWNER()).status, 403);
        assert.ok(kinds().includes('plan_changed') === false);   // same plan: no "changed" message
    });
});

describe('a scheduled lower plan', () => {
    test('to Partner: it starts at the end, no grace, no pause, both sides are told', async () => {
        const end = new Date(Date.now() + 1 * DAY);
        await setPlan({ id: 'pro', startedAt: new Date(), endsAt: end, scheduled: { to: 'partner', at: new Date(end.getTime() + 1), by: 'owner' }, extras: [{ key: 'riderLiveMap' }] });
        await sweepAt(end.getTime() + 1000);
        const p = await plan();
        assert.equal(p.id, 'partner');
        assert.equal(p.endsAt, undefined);
        assert.equal(p.scheduled, undefined);
        assert.ok(kinds().includes('plan_changed'));
        await sweepAt(end.getTime() + 20 * DAY);
        assert.equal((await plan()).paused, undefined);
    });

    test('to Growth: it starts ended (nothing paid for it yet) and goes through the grace days', async () => {
        const end = new Date(Date.now() - 1000);
        await setPlan({ id: 'pro', startedAt: new Date(Date.now() - 30 * DAY), endsAt: end, scheduled: { to: 'growth', at: new Date(end.getTime() + 1), by: 'owner' } });
        await sweepAt(Date.now());
        assert.equal((await plan()).id, 'growth');
        assert.ok(kinds().includes('plan_changed') && kinds().includes('plan_ended'));
    });
});

describe('Partner wallet alerts', () => {
    const set = (x) => PartnerWallet.updateOne({ tenantId: w.tenant._id }, { $set: x }, { upsert: true });
    beforeEach(() => setPlan({ id: 'partner' }));

    test('low once, empty once; a top-up clears the marks so the next dip tells again', async () => {
        await wallet.credit({ tenantId: w.tenant._id, amountPaise: 50000, paymentId: 'ptopup:l1' });
        await set({ balancePaise: 9000 });   // under 20% of Rs 500
        await sweepAt(Date.now()); await sweepAt(Date.now());
        assert.deepEqual(kinds(), ['wallet_low']);
        await set({ balancePaise: 0 });
        await sweepAt(Date.now()); await sweepAt(Date.now());
        assert.deepEqual(kinds(), ['wallet_low', 'wallet_empty']);
        await wallet.credit({ tenantId: w.tenant._id, amountPaise: 50000, paymentId: 'ptopup:l2' });
        await set({ balancePaise: 5000 });
        await sweepAt(Date.now());
        assert.deepEqual(kinds(), ['wallet_low', 'wallet_empty', 'wallet_low']);
    });

    test('a healthy wallet says nothing', async () => {
        await wallet.credit({ tenantId: w.tenant._id, amountPaise: 50000, paymentId: 'ptopup:l3' });
        await sweepAt(Date.now());
        assert.deepEqual(kinds(), []);
    });
});

describe('who the owner is told changed the plan', () => {
    test('a change by the platform team says "Changed by the Platform", never the admin\'s own name; the superadmin alert keeps who', async () => {
        const planService = require('../src/services/planService');
        const t = await Tenant.findById(w.tenant._id).lean();
        await planService.setPlan(t, { to: 'pro', freeDays: 0, by: 'ankit@example.com' });
        const m = sent.find((s) => s.type === 'plan_changed');
        assert.ok(m, 'the owner is told');
        assert.match(m.body, /Changed by the Platform\./);
        assert.ok(!m.body.includes('ankit@example.com'));
        assert.ok(m.vars.summary.includes('ankit@example.com'));   // the superadmin alert still names who
    });
});
