require('./helpers/env');
// Close a shop: everything is kept, the shop stops. Reopen by hand (rent owed must be confirmed) or by itself when a rent-closed shop has paid.
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
const SubscriptionInvoice = require('../src/models/SubscriptionInvoice');
const closure = require('../src/services/shopClosure');
const subscription = require('../src/services/subscriptionService');

let token;
const day = 86400000;
let n = 0;
const A = () => ({ Authorization: `Bearer ${token}` });
const post = (u, b) => request(app).post(u).set(A()).send(b || {});
const get = (u) => request(app).get(u).set(A());
const bill = (tenant, o = {}) => SubscriptionInvoice.create({
    tenantId: tenant._id, kind: 'custom', invoiceNo: `C/${++n}`, issueDate: o.issueDate || new Date(Date.now() - 10 * day), dueDate: o.dueDate || new Date(Date.now() - 3 * day),
    baseAmount: 1000, gstPercent: 18, gstAmount: 180, total: 1180, status: o.status || 'pending', paidAt: o.paidAt,
});
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

    test('reopening a shop that still owes rent must be confirmed', async () => {
        const w = await f.makeWorld('cl-d-' + Date.now().toString(36));
        const id = String(w.tenant._id);
        await bill(w.tenant);
        await post(`/api/admin/tenants/${id}/close`, { reason: 'Rent unpaid', kind: 'manual' });
        const no = await post(`/api/admin/tenants/${id}/reopen`, {});
        assert.equal(no.status, 409);
        assert.equal(no.body.needsConfirm, true);
        assert.equal(no.body.owed.total, 1180);
        assert.equal((await Tenant.findById(id).lean()).status, 'suspended');
        assert.equal((await post(`/api/admin/tenants/${id}/reopen`, { confirmDue: true })).status, 200);
        assert.equal((await Tenant.findById(id).lean()).status, 'active');
    });

    test('a shop closed for rent opens by itself the moment it has paid; one closed for another reason does not', async () => {
        const a = await f.makeWorld('cl-e-' + Date.now().toString(36));
        const b = await f.makeWorld('cl-f-' + Date.now().toString(36));
        const invA = await bill(a.tenant);
        await bill(b.tenant);
        await post(`/api/admin/tenants/${a.tenant._id}/close`, { reason: 'Rent unpaid 6 months', kind: 'rent' });
        await post(`/api/admin/tenants/${b.tenant._id}/close`, { reason: 'Owner asked', kind: 'manual' });
        await closure.sweep();
        assert.equal((await Tenant.findById(a.tenant._id).lean()).status, 'suspended', 'still owes');

        await SubscriptionInvoice.updateOne({ _id: invA._id }, { $set: { status: 'paid', paidAt: new Date() } });
        await SubscriptionInvoice.updateMany({ tenantId: b.tenant._id }, { $set: { status: 'paid', paidAt: new Date() } });
        await closure.sweep();
        assert.equal((await Tenant.findById(a.tenant._id).lean()).status, 'active', 'rent paid: open again by itself');
        assert.equal((await Tenant.findById(a.tenant._id).lean()).closure.history[0].how, 'rent paid');
        assert.equal((await Tenant.findById(b.tenant._id).lean()).status, 'suspended', 'a manual closing stays until the superadmin opens it');
        assert.equal((await waitFor(async () => { const x = await ownerNotes(a.tenant._id, /open again/); return x.length ? x : null; })).length, 1);
    });

    test('the owner of a closed shop can still see why and what he owes, and open his rent; the rest of his panel is closed', async () => {
        const w = await f.makeWorld('cl-o-' + Date.now().toString(36));
        const id = String(w.tenant._id);
        await bill(w.tenant);
        await post('/api/admin/tenants/' + id + '/close', { reason: 'private words', kind: 'rent' });
        const why = await request(app).get('/api/shop/closure').set(w.owner.headers);
        assert.equal(why.status, 200, JSON.stringify(why.body));
        assert.equal(why.body.kind, 'rent');
        assert.equal(why.body.owed.total, 1180);
        assert.ok(!JSON.stringify(why.body).includes('private words'));
        assert.equal((await request(app).get('/api/shop/subscription/dues').set(w.owner.headers)).status, 200, 'rent pages stay open');
        assert.equal((await request(app).get('/api/shop/settings').set(w.owner.headers)).status, 402, 'the rest is closed');
        // another reason stays private and shows no amount
        const w2 = await f.makeWorld('cl-p-' + Date.now().toString(36));
        await post('/api/admin/tenants/' + w2.tenant._id + '/close', { reason: 'secret', kind: 'manual' });
        const why2 = await request(app).get('/api/shop/closure').set(w2.owner.headers);
        assert.equal(why2.body.kind, 'manual');
        assert.equal(why2.body.owed, null);
    });

    test('shops with rent unpaid for 6 months are listed (brand branches together) and the superadmin is told once; a closed shop gets no new bills', async () => {
        const Notif = Notification;
        const x = await f.makeWorld('cl-g-' + Date.now().toString(36));
        const y = await f.makeWorld('cl-h-' + Date.now().toString(36));
        const z = await f.makeWorld('cl-i-' + Date.now().toString(36));
        const brand = await Brand.create({ name: 'Savera' });
        await Tenant.updateMany({ _id: { $in: [x.tenant._id, y.tenant._id] } }, { $set: { brandId: brand._id } });
        await bill(x.tenant, { dueDate: new Date(Date.now() - 200 * day) });
        await bill(y.tenant, { dueDate: new Date(Date.now() - 400 * day) });
        await bill(z.tenant, { dueDate: new Date(Date.now() - 20 * day) });   // only 20 days: not listed

        const r = await get('/api/admin/finance/to-close');
        assert.equal(r.status, 200);
        assert.equal(r.body.months, 6);
        assert.equal(r.body.shops.length, 2);
        assert.ok(r.body.shops.every((s) => s.brandName === 'Savera'));
        assert.ok(r.body.shops[0].monthsLate >= 6);

        await closure.sweep();
        await closure.sweep();   // a second run in the same week does not tell again
        const count = await waitFor(async () => { const c = await Notif.countDocuments({ role: 'superadmin', type: 'admin_shop_close_due' }); return c >= 2 ? c : null; });
        assert.equal(count, 2);

        // a closed shop is never listed, and gets no bills
        await post(`/api/admin/tenants/${x.tenant._id}/close`, { reason: 'Rent unpaid 6 months', kind: 'rent' });
        assert.equal((await get('/api/admin/finance/to-close')).body.shops.length, 1);
        const gen = await subscription.generateForPeriod({ tenantId: x.tenant._id, period: '2020-01' });
        assert.equal(gen.checked, 0);
    });
});
