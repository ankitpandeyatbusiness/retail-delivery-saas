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
const settle = () => new Promise((r) => setTimeout(r, 1200));   // notices are sent without waiting

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

    test('only the supreme admin can stop every shop or write to every shop owner; other superadmins can act on chosen shops', async () => {
        const other = (await f.makeSuperAdmin('other@test.com', { phones: [] })).token;
        const as = (m, u, b) => request(app)[m](u).set({ Authorization: 'Bearer ' + other }).send(b || {});
        const start = new Date(Date.now() + 3 * H).toISOString();
        assert.equal((await as('post', '/api/admin/maintenance/plans', { scope: 'all', startAt: start })).status, 403);
        assert.equal((await as('put', '/api/admin/platform/maintenance', { on: true })).status, 403);
        assert.equal((await as('post', '/api/admin/messages', { title: 'Hello', body: 'To everybody' })).status, 403);
        const ok = await as('post', '/api/admin/maintenance/plans', { scope: 'shops', tenantIds: [String(w.tenant._id)], startAt: start });
        assert.equal(ok.status, 201);
        // an "all shops" plan made by the supreme admin cannot be cancelled by the other one
        const big = await post('/api/admin/maintenance/plans', { scope: 'all', startAt: start });
        assert.equal(big.status, 201);
        assert.equal((await as('post', `/api/admin/maintenance/plans/${big.body.id}/cancel`)).status, 403);
        assert.equal((await post(`/api/admin/maintenance/plans/${big.body.id}/cancel`)).status, 200);
    });
});

describe('changing a plan and the customers', () => {
    const put = (u, b) => request(app).put(u).set({ Authorization: 'Bearer ' + token }).send(b || {});
    test('the time of a planned maintenance can be changed; one that has started cannot; customers are never messaged', async () => {
        const start = Date.now() + 5 * H;
        const r = await post('/api/admin/maintenance/plans', { scope: 'shops', tenantIds: [String(w.tenant._id)], startAt: new Date(start).toISOString(), endAt: new Date(start + H).toISOString(), message: 'Upgrade' });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        await settle();
        assert.equal(await Notification.countDocuments({ type: 'broadcast', userId: w.customer.user._id }), 0, 'a customer is not messaged');
        assert.equal(r.body.audience.customers, false);
        const newStart = Date.now() + 8 * H;
        const e = await put(`/api/admin/maintenance/plans/${r.body.id}`, { startAt: new Date(newStart).toISOString(), endAt: new Date(newStart + 2 * H).toISOString(), message: 'Moved' });
        assert.equal(e.status, 200, JSON.stringify(e.body));
        assert.equal(new Date(e.body.startAt).getTime(), newStart);
        assert.equal(e.body.message, 'Moved');
        const bad = await put(`/api/admin/maintenance/plans/${r.body.id}`, { startAt: new Date(newStart).toISOString(), endAt: new Date(newStart - H).toISOString() });
        assert.equal(bad.status, 400, 'the end must be after the start');
        await MaintenancePlan.updateOne({ _id: r.body.id }, { $set: { status: 'active' } });
        assert.equal((await put(`/api/admin/maintenance/plans/${r.body.id}`, { startAt: new Date(newStart).toISOString() })).status, 409, 'a running one cannot be edited');
    });
});

describe('after the time is changed', () => {
    const put = (u, b) => request(app).put(u).set({ Authorization: 'Bearer ' + token }).send(b || {});
    test('the badge stays and everybody is told the new time', async () => {
        const start = Date.now() + 5 * H;
        const r = await post('/api/admin/maintenance/plans', { scope: 'shops', tenantIds: [String(w.tenant._id)], startAt: new Date(start).toISOString(), endAt: new Date(start + H).toISOString(), message: 'Upgrade' });
        await settle();
        const before = await Notification.countDocuments({ type: 'broadcast' });
        const ns = Date.now() + 8 * H;
        const e = await put(`/api/admin/maintenance/plans/${r.body.id}`, { startAt: new Date(ns).toISOString(), endAt: new Date(ns + H).toISOString() });
        assert.equal(e.status, 200);
        await settle();
        const p = await MaintenancePlan.findById(r.body.id).lean();
        assert.ok(p.sent.includes('announce'), 'the plan still counts as announced: ' + JSON.stringify(p.sent));
        const n = await plans.noticeFor(w.tenant._id);
        assert.ok(n && new Date(n.startAt).getTime() === ns, 'the badge shows the new time');
        assert.ok(await Notification.countDocuments({ type: 'broadcast' }) > before, 'the new time was sent');
    });
});

describe('after the time is changed to a near time', () => {
    const put = (u, b) => request(app).put(u).set({ Authorization: 'Bearer ' + token }).send(b || {});
    test('a start only a minute or two away still keeps the badge and tells everybody', async () => {
        const start = Date.now() + 5 * H;
        const r = await post('/api/admin/maintenance/plans', { scope: 'shops', tenantIds: [String(w.tenant._id)], startAt: new Date(start).toISOString(), message: 'Upgrade' });
        await settle();
        const before = await Notification.countDocuments({ type: 'broadcast' });
        const ns = Date.now() + 90000;
        assert.equal((await put(`/api/admin/maintenance/plans/${r.body.id}`, { startAt: new Date(ns).toISOString() })).status, 200);
        await settle();
        const n = await plans.noticeFor(w.tenant._id);
        assert.ok(n && new Date(n.startAt).getTime() === ns, 'the badge shows the new time');
        assert.ok(await Notification.countDocuments({ type: 'broadcast' }) > before, 'the new time was sent');
    });
});
