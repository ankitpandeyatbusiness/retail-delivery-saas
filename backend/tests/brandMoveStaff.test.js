require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeUser, makeOrder, makeSuperAdmin } = require('./helpers/factory');
const Tenant = require('../src/models/Tenant');
const User = require('../src/models/User');
const Staff = require('../src/models/Staff');
const Order = require('../src/models/Order');
const TableSession = require('../src/models/TableSession');
const staffSvc = require('../src/services/staffService');

let supreme;
const post = (url, body) => request(app).post(url).set({ Authorization: `Bearer ${supreme}` }).send(body);

before(async () => { await db.connect(); });
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    supreme = (await makeSuperAdmin('boss@example.com')).token;
});

// two branches with the cook and waiter panels switched on; a cook and a waiter in Delhi
async function setup() {
    const brand = (await post('/api/admin/brands', { name: 'Savera', branchLimit: 4 })).body.brand;
    const d = (await post(`/api/admin/brands/${brand._id}/branches`, { name: 'Savera Delhi', slug: 'savera-delhi', city: 'Delhi' })).body.branch;
    const m = (await post(`/api/admin/brands/${brand._id}/branches`, { name: 'Savera Mumbai', slug: 'savera-mumbai', city: 'Mumbai' })).body.branch;
    for (const b of [d, m]) await Tenant.updateOne({ _id: b.id }, { $set: { 'settings.orders.staff': { kitchenOn: true, waiterOn: true, max: 10 } } });
    const delhi = await Tenant.findById(d.id);
    await staffSvc.add({ tenant: delhi, phone: '9811000001', name: 'Cook', role: 'kitchen' });
    await staffSvc.add({ tenant: delhi, phone: '9811000002', name: 'Waiter', role: 'waiter' });
    const cook = await User.findOne({ tenantId: d.id, phone: '9811000001' });
    const waiter = await User.findOne({ tenantId: d.id, phone: '9811000002' });
    return { brand, d, m, delhi, cook, waiter };
}
const move = (w, user) => post(`/api/admin/brands/${w.brand._id}/move`, { fromTenantId: String(w.d.id), toTenantId: String(w.m.id), userId: String(user._id) });

describe('moving a cook or a waiter checks for live work', () => {
    test('a cook who started an order and has not marked it ready stays; once it is ready he can go', async () => {
        const w = await setup();
        const guest = await makeUser(w.delhi, 'customer', '9822000001');
        const order = await makeOrder(w.delhi, guest.user, { status: 'preparing' });
        await Order.updateOne({ _id: order._id }, { $set: { 'kitchen.startedBy': w.cook._id, 'kitchen.startedAt': new Date() } });

        const refused = await move(w, w.cook);
        assert.equal(refused.status, 409);
        assert.match(refused.body.error, /is making order #\d+ right now/);
        assert.equal((await User.findById(w.cook._id)).role, 'kitchen');   // nothing changed
        assert.equal(await Staff.countDocuments({ tenantId: w.d.id, userId: w.cook._id }), 1);

        await Order.updateOne({ _id: order._id }, { $set: { 'kitchen.readyAt': new Date(), status: 'ready' } });
        const ok = await move(w, w.cook);
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
        assert.equal((await User.findOne({ tenantId: w.d.id, phone: '9811000001' })).role, 'customer');
        assert.equal((await User.findOne({ tenantId: w.m.id, phone: '9811000001' })).role, 'kitchen');
        assert.equal(await Staff.countDocuments({ tenantId: w.m.id, role: 'kitchen' }), 1);
    });

    test('an order another cook is making, or an old one that is already done, does not hold him', async () => {
        const w = await setup();
        await staffSvc.add({ tenant: w.delhi, phone: '9811000003', name: 'Cook 2', role: 'kitchen' });
        const other = await User.findOne({ tenantId: w.d.id, phone: '9811000003' });
        const guest = await makeUser(w.delhi, 'customer', '9822000002');
        const busy = await makeOrder(w.delhi, guest.user, { status: 'preparing' });
        await Order.updateOne({ _id: busy._id }, { $set: { 'kitchen.startedBy': other._id } });
        const done = await makeOrder(w.delhi, guest.user, { status: 'delivered' });
        await Order.updateOne({ _id: done._id }, { $set: { 'kitchen.startedBy': w.cook._id } });
        assert.equal((await move(w, w.cook)).status, 200);
        assert.equal((await move(w, other)).status, 409);   // the other cook is the busy one
    });

    test('a waiter serving an open table or a table waiting to pay stays; when the table is closed he can go', async () => {
        const w = await setup();
        const insert = (status, table) => TableSession.collection.insertOne({ tenantId: new mongoose.Types.ObjectId(w.d.id), table, party: 'A', status, billFor: [w.waiter._id], customers: [], openedAt: new Date(), lastOrderAt: new Date() });
        const open = await insert('open', 'T1');
        const refused = await move(w, w.waiter);
        assert.equal(refused.status, 409);
        assert.match(refused.body.error, /serving 1 open table/);

        await TableSession.collection.updateOne({ _id: open.insertedId }, { $set: { status: 'bill_asked' } });
        assert.equal((await move(w, w.waiter)).status, 409);   // still waiting to pay

        await insert('open', 'T2');
        assert.match((await move(w, w.waiter)).body.error, /serving 2 open tables/);

        await TableSession.collection.updateMany({ tenantId: new mongoose.Types.ObjectId(w.d.id) }, { $set: { status: 'closed' } });
        const ok = await move(w, w.waiter);
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
        assert.equal((await User.findOne({ tenantId: w.m.id, phone: '9811000002' })).role, 'waiter');
    });

    test('the brand owner gets the same protection from the app route', async () => {
        const w = await setup();
        await post(`/api/admin/brands/${w.brand._id}/owners`, { phone: '9855555555' });
        const owner = await User.findOne({ tenantId: w.d.id, phone: '9855555555' });
        const tokenService = require('../src/services/tokenService');
        const Session = require('../src/models/Session');
        const sid = new mongoose.Types.ObjectId();
        const { accessToken } = tokenService.generateTokens({ userId: owner._id, tenantId: w.d.id, sessionId: sid });
        await Session.create({ _id: sid, userId: owner._id, tenantId: w.d.id, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600000) });
        await TableSession.collection.insertOne({ tenantId: new mongoose.Types.ObjectId(w.d.id), table: 'T1', party: 'A', status: 'open', billFor: [w.waiter._id], customers: [], openedAt: new Date(), lastOrderAt: new Date() });
        const r = await request(app).post('/api/brand/move').set('x-tenant-slug', 'savera-delhi').set('Authorization', `Bearer ${accessToken}`)
            .send({ fromSlug: 'savera-delhi', toSlug: 'savera-mumbai', userId: String(w.waiter._id) });
        assert.equal(r.status, 409);
        assert.match(r.body.error, /serving 1 open table/);
    });
});
