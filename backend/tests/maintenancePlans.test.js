require('./helpers/env');
// Planned maintenance: warnings in advance, the exact start (shops pause), the end, a cancel, and the banner the apps read.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const plans = require('../src/services/maintenancePlans');
const MaintenancePlan = require('../src/models/MaintenancePlan');
const Tenant = require('../src/models/Tenant');
const PlatformSettings = require('../src/models/PlatformSettings');
const Notification = require('../src/models/Notification');

let token; let w; let w2;
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    token = (await f.makeSuperAdmin('root@test.com')).token;
    w = await f.makeWorld('mp1-' + Date.now().toString(36));
    w2 = await f.makeWorld('mp2-' + Date.now().toString(36));
});
const H = 3600000;
const post = (u, b) => request(app).post(u).set({ Authorization: 'Bearer ' + token }).send(b || {});
const settle = () => new Promise((r) => setTimeout(r, 400));   // notices are sent without waiting

describe('planned maintenance', () => {
    test('a plan for one shop: announced, warned, paused at the start, opened at the end; the other shop is untouched', async () => {
        const start = Date.now() + 5 * H;
        const r = await post('/api/admin/maintenance/plans', { scope: 'shops', tenantIds: [String(w.tenant._id)], startAt: new Date(start).toISOString(), endAt: new Date(start + H).toISOString(), message: 'Server upgrade' });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        await settle();
        let p = await MaintenancePlan.findById(r.body.id);
        assert.ok(p.sent.includes('announce'));
        const before = await Notification.countDocuments({ type: 'broadcast' });
        await plans.tick(Date.now() + 10 * 60000); await settle();   // the 24 hour mark has passed already: nothing more is sent
        assert.equal(await Notification.countDocuments({ type: 'broadcast' }), before, 'no 24 hour notice after a 5 hour plan');
        const owners = await Notification.countDocuments({ type: 'broadcast', tenantId: w.tenant._id });
        assert.ok(owners >= 1, 'the owner of the shop was told');
        assert.equal(await Notification.countDocuments({ type: 'broadcast', tenantId: w2.tenant._id }), 0, 'the other shop was not told');

        // the banner
        assert.equal((await plans.noticeFor(w.tenant._id)).message, 'Server upgrade');
        assert.equal(await plans.noticeFor(w2.tenant._id), null);

        // 1 hour before: the 1 hour warning, once
        await plans.tick(start - H + 1000); await settle();
        await plans.tick(start - H + 2000); await settle();
        p = await MaintenancePlan.findById(r.body.id);
        assert.ok(p.sent.includes('1h'));
        assert.equal(p.sent.filter((x) => x === '1h').length, 1);
        assert.equal((await Tenant.findById(w.tenant._id)).maintenance.on, false);

        // the start: paused
        await plans.tick(start + 1000); await settle();
        p = await MaintenancePlan.findById(r.body.id);
        assert.equal(p.status, 'active');
        const t = await Tenant.findById(w.tenant._id);
        assert.equal(t.maintenance.on, true);
        assert.equal(t.maintenance.message, 'Server upgrade');
        assert.equal((await Tenant.findById(w2.tenant._id)).maintenance.on, false);

        // the end: open again
        await plans.tick(start + H + 1000); await settle();
        p = await MaintenancePlan.findById(r.body.id);
        assert.equal(p.status, 'ended');
        assert.equal((await Tenant.findById(w.tenant._id)).maintenance.on, false);
    });

    test('a plan for every shop uses the platform switch and stays on until you end it (no end time)', async () => {
        const start = Date.now() + 3 * H;
        const r = await post('/api/admin/maintenance/plans', { scope: 'all', startAt: new Date(start).toISOString(), message: 'Big upgrade' });
        assert.equal(r.status, 201);
        await plans.tick(start + 1000);
        assert.equal((await PlatformSettings.findById('main')).maintenance.on, true);
        await plans.tick(start + 48 * H);
        assert.equal((await PlatformSettings.findById('main')).maintenance.on, true, 'no end time: it stays until you switch it off');
        const c = await post(`/api/admin/maintenance/plans/${r.body.id}/cancel`);
        assert.equal(c.status, 200);
        assert.equal(c.body.status, 'ended');
        assert.equal((await PlatformSettings.findById('main')).maintenance.on, false);
    });

    test('cancelling a plan that has not started tells people and leaves the shop alone', async () => {
        const start = Date.now() + 10 * H;
        const r = await post('/api/admin/maintenance/plans', { scope: 'shops', tenantIds: [String(w.tenant._id)], startAt: new Date(start).toISOString() });
        await settle();
        const c = await post(`/api/admin/maintenance/plans/${r.body.id}/cancel`);
        assert.equal(c.body.status, 'cancelled');
        await plans.tick(start + 1000);
        assert.equal((await Tenant.findById(w.tenant._id)).maintenance.on, false);
        assert.equal(await plans.noticeFor(w.tenant._id), null);
    });

    test('a switch you turned on by hand is not switched off by an ended plan', async () => {
        const start = Date.now() + 2 * H;
        const r = await post('/api/admin/maintenance/plans', { scope: 'shops', tenantIds: [String(w.tenant._id)], startAt: new Date(start).toISOString(), endAt: new Date(start + H).toISOString() });
        await plans.tick(start + 1000);
        // you switch it on again by hand (no plan id on it)
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'maintenance.on': true }, $unset: { 'maintenance.planId': 1 } });
        await plans.tick(start + H + 1000);
        assert.equal((await MaintenancePlan.findById(r.body.id)).status, 'ended');
        assert.equal((await Tenant.findById(w.tenant._id)).maintenance.on, true);
    });

    test('bad plans are refused', async () => {
        assert.equal((await post('/api/admin/maintenance/plans', { scope: 'all', startAt: 'soon' })).status, 400);
        assert.equal((await post('/api/admin/maintenance/plans', { scope: 'all', startAt: new Date(Date.now() - 5 * H).toISOString() })).status, 400);
        const s = new Date(Date.now() + 2 * H);
        assert.equal((await post('/api/admin/maintenance/plans', { scope: 'all', startAt: s.toISOString(), endAt: new Date(s.getTime() - H).toISOString() })).status, 400);
        assert.equal((await post('/api/admin/maintenance/plans', { scope: 'shops', tenantIds: [], startAt: s.toISOString() })).status, 400);
        assert.equal((await post('/api/admin/maintenance/plans', { scope: 'all', startAt: s.toISOString(), audience: { owners: false, staff: false, riders: false, customers: false } })).status, 400);
    });
});
