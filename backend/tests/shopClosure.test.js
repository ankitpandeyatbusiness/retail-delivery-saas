require('./helpers/env');
// Close a shop: everything is kept, the shop stops. Reopen by hand.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const Brand = require('../src/models/Brand');
const Notification = require('../src/models/Notification');
const closure = require('../src/services/shopClosure');

let token;
const day = 86400000;
let n = 0;
const A = () => ({ Authorization: `Bearer ${token}` });
const post = (u, b) => request(app).post(u).set(A()).send(b || {});
const get = (u) => request(app).get(u).set(A());
const customerView = (slug) => request(app).get('/api/tenants/config').set('x-tenant-slug', slug);
const ownerNotes = (tenantId, re) => Notification.find({ tenantId, role: 'owner', type: 'platform_message', title: re }).lean();
const waitFor = async (fn, ms = 1500) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); } return fn(); };

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); token = (await f.makeSuperAdmin('root@test.com')).token; });

describe('close a shop', () => {
    test('a reason is needed; closing stops the shop for customers; the owner is told without the reason; reopening opens it', async () => {
        const w = await f.makeWorld('cl-a-' + Date.now().toString(36));
        const id = String(w.tenant._id);
        assert.equal((await post(`/api/admin/tenants/${id}/close`, { reason: '  ' })).status, 400);
        assert.equal((await customerView(w.tenant.slug)).status, 200);

        const r = await post(`/api/admin/tenants/${id}/close`, { reason: 'Owner asked to stop for Diwali', kind: 'manual', orders: 'finish' });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.closing, false);
        const t = await Tenant.findById(id).lean();
        assert.equal(t.status, 'suspended');
        assert.equal(t.closure.on, true);
        assert.equal(t.closure.reason, 'Owner asked to stop for Diwali');
        assert.equal((await customerView(w.tenant.slug)).status, 402);
        assert.equal((await post(`/api/admin/tenants/${id}/close`, { reason: 'again please' })).status, 409);

        const told = await waitFor(async () => { const x = await ownerNotes(id, /closed/); return x.length ? x : null; });
        assert.equal(told.length, 1);
        assert.ok(!JSON.stringify(told[0]).includes('Diwali'), 'the private reason is never sent');

        const open = await post(`/api/admin/tenants/${id}/reopen`, {});
        assert.equal(open.status, 200, JSON.stringify(open.body));
        const after = await Tenant.findById(id).lean();
        assert.equal(after.status, 'active');
        assert.equal(after.closure.on, false);
        assert.equal(after.closure.history.length, 1);
        assert.equal((await customerView(w.tenant.slug)).status, 200);
        assert.equal((await post(`/api/admin/tenants/${id}/reopen`, {})).status, 409);
    });

    test('orders in progress: "finish" stops new orders now and closes by itself when the last is done; "cancel" cancels them', async () => {
        const w = await f.makeWorld('cl-b-' + Date.now().toString(36));
        const id = String(w.tenant._id);
        const o = await f.makeOrder(w.tenant, w.customer.user, { status: 'preparing' });
        const pre = await get(`/api/admin/tenants/${id}/closure`);
        assert.equal(pre.body.activeOrders, 1);

        const r = await post(`/api/admin/tenants/${id}/close`, { reason: 'Kitchen fire', orders: 'finish' });
        assert.equal(r.body.closing, true);
        let t = await Tenant.findById(id).lean();
        assert.equal(t.status, 'active');
        assert.equal(t.settings.orders.acceptingOrders, false);
        await closure.sweep();
        assert.equal((await Tenant.findById(id).lean()).status, 'active', 'the order is still running');

        await Order.updateOne({ _id: o._id }, { $set: { status: 'delivered' } });
        await closure.sweep();
        t = await Tenant.findById(id).lean();
        assert.equal(t.status, 'suspended');
        assert.equal(t.closure.closing, false);

        // the other way: cancel what is running
        const w2 = await f.makeWorld('cl-c-' + Date.now().toString(36));
        const o2 = await f.makeOrder(w2.tenant, w2.customer.user, { status: 'placed' });
        const r2 = await post(`/api/admin/tenants/${w2.tenant._id}/close`, { reason: 'Closing down', orders: 'cancel' });
        assert.equal(r2.status, 200, JSON.stringify(r2.body));
        assert.equal(r2.body.cancelled, 1);
        assert.equal((await Order.findById(o2._id).lean()).status, 'cancelled');
        assert.equal((await Tenant.findById(w2.tenant._id).lean()).status, 'suspended');
    });
});
