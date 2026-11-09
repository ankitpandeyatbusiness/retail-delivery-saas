require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const Tenant = require('../src/models/Tenant');
const SubscriptionInvoice = require('../src/models/SubscriptionInvoice');
const center = require('../src/notifications/center');
const backup = require('../src/jobs/backupDump');
const mig = require('../src/services/planMigration');

// Phase 9: every existing shop gets Pro, free for 30 days. Dry run first, backup first, idempotent, nothing deleted, undoable.
let supreme; let plain; let sent; let n = 0;
const DAY = 86400000;
const shop = async (extra = {}) => { const w = await f.makeWorld(`mig-${++n}`); if (Object.keys(extra).length) await Tenant.updateOne({ _id: w.tenant._id }, { $set: extra }); return w; };
const get = async (w) => Tenant.findById(w.tenant._id).lean();
const call = (a, m, p, b) => request(app)[m](`/api/admin${p}`).set({ Authorization: `Bearer ${a.token}` }).send(b);

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    supreme = await f.makeSuperAdmin();
    plain = await f.makeSuperAdmin('plain@example.com', { phones: [] });
    sent = [];
    mock.method(center, 'notify', (type, p) => { sent.push({ type, ...p }); return Promise.resolve(); });
    mock.method(backup, 'runBackup', async () => ({ day: '2026-11-09', collections: 3, documents: 10, bytes: 100, pruned: [] }));
});
afterEach(() => mock.restoreAll());

describe('the dry run', () => {
    test('lists who would move, who is skipped and the old open bills; changes nothing', async () => {
        const a = await shop({ 'billing.state': 'paused' });
        const b = await shop();
        const closed = await shop({ status: 'suspended' });
        await SubscriptionInvoice.create({ tenantId: a.tenant._id, invoiceNo: 'T/1', kind: 'monthly', period: '2026-09', status: 'pending', baseAmount: 3000, total: 3000, gstPercent: 0, gstAmount: 0, issueDate: new Date(Date.now() - 40 * DAY), dueDate: new Date(Date.now() - 30 * DAY) });
        const pv = await mig.preview();
        assert.equal(pv.dryRun, true);
        assert.equal(pv.counts.move, 2);
        assert.equal(pv.counts.skip, 1);
        assert.equal(pv.counts.paused, 1);
        assert.equal(pv.move.find((m) => m.id === String(a.tenant._id)).openBills.totalRs, 3000);
        assert.match(pv.skip[0].why, /not active/);
        for (const w of [a, b, closed]) assert.equal((await get(w)).plan?.id, undefined);
        assert.equal(sent.length, 0);
    });
});

describe('the move', () => {
    test('backup first, then Pro free for 30 days; a paused shop is unpaused; bills and settings are kept', async () => {
        const a = await shop({ 'billing.state': 'paused', 'billing.freeOrdersOverride': 250 });
        const inv = await SubscriptionInvoice.create({ tenantId: a.tenant._id, invoiceNo: 'T/2', kind: 'monthly', period: '2026-09', status: 'pending', baseAmount: 3000, total: 3000, gstPercent: 0, gstAmount: 0, issueDate: new Date(Date.now() - 40 * DAY), dueDate: new Date(Date.now() - 30 * DAY) });
        const r = await mig.run({ by: 'test' });
        assert.equal(r.movedCount, 1);
        assert.equal(backup.runBackup.mock.callCount(), 1);
        assert.equal(r.backup.documents, 10);
        const t = await get(a);
        assert.equal(t.plan.id, 'pro');
        assert.ok(new Date(t.plan.endsAt) > new Date(Date.now() + 28 * DAY) && new Date(t.plan.endsAt) < new Date(Date.now() + 31 * DAY));
        assert.equal(String(t.plan.freeUntil), String(t.plan.endsAt));
        assert.equal(t.billing.state, 'active');   // the old pause is cleared
        assert.equal(t.billing.freeOrdersOverride, 250);   // amounts and free-period settings kept
        assert.equal((await SubscriptionInvoice.findById(inv._id).lean()).status, 'pending');   // the old bill is untouched
        assert.equal(sent.filter((s) => s.type === 'plan_changed').length, 1);
    });

    test('a second run moves nobody (idempotent), and a shop that already has a plan is left alone', async () => {
        const a = await shop();
        const b = await shop({ plan: { id: 'growth', endsAt: new Date(Date.now() + 5 * DAY) } });
        assert.equal((await mig.run()).movedCount, 1);
        const again = await mig.run();
        assert.equal(again.movedCount, 0);
        assert.equal((await get(b)).plan.id, 'growth');
        assert.equal((await get(a)).plan.history.length, 1);
    });

    test('a failed backup stops everything', async () => {
        mock.method(backup, 'runBackup', async () => { throw new Error('bucket not set'); });
        const a = await shop();
        await assert.rejects(() => mig.run(), /backup failed/);
        assert.equal((await get(a)).plan?.id, undefined);
    });

    test('a closed shop is skipped and moves later', async () => {
        const c = await shop({ status: 'suspended' });
        assert.equal((await mig.run()).movedCount, 0);
        await Tenant.updateOne({ _id: c.tenant._id }, { $set: { status: 'active' } });
        assert.equal((await mig.run()).movedCount, 1);
    });

    test('after the free days the plan shows as ended and the lifecycle takes over (grace, pause)', async () => {
        const a = await shop();
        await mig.run();
        const life = require('../src/services/planLifecycle');
        await life.sweep(new Date(Date.now() + 31 * DAY));
        assert.ok(sent.some((s) => s.type === 'plan_ended'));
        await life.sweep(new Date(Date.now() + 40 * DAY));
        assert.equal((await get(a)).plan.paused, true);
    });
});

describe('undo', () => {
    test('puts moved shops back to no plan, restores a pause, and leaves a shop that bought a plan', async () => {
        const a = await shop({ 'billing.state': 'paused' });
        const b = await shop();
        await mig.run();
        await Tenant.updateOne({ _id: b.tenant._id }, { $push: { 'plan.history': { at: new Date(), by: 'owner payment', from: 'pro', to: 'growth' } } });   // b has done something since
        const r = await mig.rollback();
        assert.equal(r.rolledBack, 1);
        assert.equal((await get(a)).plan, undefined);
        assert.equal((await get(a)).billing.state, 'paused');
        assert.equal((await get(b)).plan.id, 'pro');
    });
});

describe('routes: supreme only, typed confirmation', () => {
    test('a plain superadmin is refused; the supreme admin must type the phrase', async () => {
        await shop();
        assert.equal((await call(plain, 'get', '/plans/migration/preview')).status, 403);
        assert.equal((await call(plain, 'post', '/plans/migration/run', { confirm: 'MOVE SHOPS TO PRO' })).status, 403);
        assert.equal((await call(supreme, 'post', '/plans/migration/run', { confirm: 'yes' })).status, 400);
        const pv = await call(supreme, 'get', '/plans/migration/preview');
        assert.equal(pv.status, 200);
        assert.equal(pv.body.counts.move, 1);
        const run = await call(supreme, 'post', '/plans/migration/run', { confirm: 'MOVE SHOPS TO PRO' });
        assert.equal(run.status, 200);
        assert.equal(run.body.movedCount, 1);
        assert.equal((await call(supreme, 'post', '/plans/migration/rollback', { confirm: 'UNDO THE MOVE' })).body.rolledBack, 1);
    });
});
