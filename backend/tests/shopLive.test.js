require('./helpers/env');
// A change of a shop reaches its open apps at once (a quiet "shop:changed"), and the owner is told only about the big ones.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const realtime = require('../src/services/realtime');
const Notification = require('../src/models/Notification');
const { invalidateTenant } = require('../src/middlewares/tenantRecognizer');

let token;
const put = (u, b) => request(app).put(u).set({ Authorization: `Bearer ${token}` }).send(b);
const owner = (tenantId, re) => Notification.find({ tenantId, role: 'owner', type: 'platform_message', title: re }).lean();
const waitFor = async (fn, ms = 1500) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); } return fn(); };

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); token = (await f.makeSuperAdmin('root@test.com')).token; });

describe('shop changed: live message and owner notices', () => {
    test('saving a shop tells that shop only, once a second at most', async () => {
        const w = await f.makeWorld('live-a-' + Date.now().toString(36));
        const calls = [];
        const orig = realtime.toShop;
        realtime.toShop = (id, ev) => calls.push([String(id), ev]);
        try {
            invalidateTenant(w.tenant.slug);
            await waitFor(() => calls.length);
            invalidateTenant(w.tenant.slug);   // inside the same second: not sent again
            await new Promise((r) => setTimeout(r, 100));
        } finally { realtime.toShop = orig; }
        assert.deepEqual(calls, [[String(w.tenant._id), 'shop:changed']]);
    });

    test('maintenance on and off tell the owner once each; editing the message while on does not repeat it', async () => {
        const w = await f.makeWorld('live-b-' + Date.now().toString(36));
        const url = '/api/admin/tenants/' + w.tenant._id + '/maintenance';
        assert.equal((await put(url, { on: true, message: 'Upgrading the kitchen system' })).status, 200);
        const on = await waitFor(async () => { const r = await owner(w.tenant._id, /paused for maintenance/); return r.length ? r : null; });
        assert.equal(on.length, 1);
        assert.match(on[0].body, /Upgrading the kitchen system/);
        await put(url, { on: true, message: 'Still upgrading' });
        await new Promise((r) => setTimeout(r, 150));
        assert.equal((await owner(w.tenant._id, /paused for maintenance/)).length, 1);
        await put(url, { on: false });
        const off = await waitFor(async () => { const r = await owner(w.tenant._id, /back/); return r.length ? r : null; });
        assert.equal(off.length, 1);
    });

    test('blocking the owner panel tells him without the private reason; allowing tells him again', async () => {
        const w = await f.makeWorld('live-c-' + Date.now().toString(36));
        const url = '/api/admin/tenants/' + w.tenant._id + '/owner-access';
        await put(url, { blocked: true, reason: 'secret reason' });
        const b = await waitFor(async () => { const r = await owner(w.tenant._id, /locked/); return r.length ? r : null; });
        assert.equal(b.length, 1);
        assert.ok(!JSON.stringify(b[0]).includes('secret reason'));
        await put(url, { blocked: true, reason: 'again' });
        await new Promise((r) => setTimeout(r, 150));
        assert.equal((await owner(w.tenant._id, /locked/)).length, 1);   // no change of state, no second notice
        await put(url, { blocked: false });
        const a = await waitFor(async () => { const r = await owner(w.tenant._id, /open again/); return r.length ? r : null; });
        assert.equal(a.length, 1);
    });
});
