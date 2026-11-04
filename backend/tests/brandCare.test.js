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
const Session = require('../src/models/Session');
const Complaint = require('../src/models/Complaint');
const Review = require('../src/models/Review');
const Product = require('../src/models/Product');
const Category = require('../src/models/Category');
const tokenService = require('../src/services/tokenService');

const OWNER = '9855555555';
let supreme;
const post = (url, body) => request(app).post(url).set({ Authorization: `Bearer ${supreme}` }).send(body);

before(async () => { await db.connect(); });
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    supreme = (await makeSuperAdmin('boss@example.com')).token;
});

async function setup() {
    const brand = (await post('/api/admin/brands', { name: 'Savera' })).body.brand;
    const d = (await post(`/api/admin/brands/${brand._id}/branches`, { name: 'Savera Delhi', slug: 'savera-delhi', city: 'Delhi' })).body.branch;
    const m = (await post(`/api/admin/brands/${brand._id}/branches`, { name: 'Savera Mumbai', slug: 'savera-mumbai', city: 'Mumbai' })).body.branch;
    await post(`/api/admin/brands/${brand._id}/owners`, { phone: OWNER });
    const owner = await User.findOne({ tenantId: d.id, phone: OWNER });
    const sid = new mongoose.Types.ObjectId();
    const { accessToken } = tokenService.generateTokens({ userId: owner._id, tenantId: d.id, sessionId: sid });
    await Session.create({ _id: sid, userId: owner._id, tenantId: d.id, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600000) });
    const api = (path) => request(app).get(`/api/brand${path}`).set('x-tenant-slug', 'savera-delhi').set('Authorization', `Bearer ${accessToken}`);
    return { brand, d, m, api, delhi: await Tenant.findById(d.id), mumbai: await Tenant.findById(m.id) };
}

describe('the All branches panel: customers, complaints and reviews', () => {
    test('customers are only counted: per branch, and the same phone at two branches is one person', async () => {
        const w = await setup();
        const a = await makeUser(w.delhi, 'customer', '9811000001');
        await makeUser(w.delhi, 'customer', '9811000002');
        await makeUser(w.mumbai, 'customer', '9811000001');   // the same person, also at Mumbai
        await makeUser(w.mumbai, 'customer', '9811000003');
        await makeOrder(w.delhi, a.user, { status: 'delivered' });

        const r = await w.api('/customers?range=30');
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const [delhi, mumbai] = r.body.branches;
        assert.deepEqual([delhi.customers, delhi.newInRange, delhi.orderedInRange], [2, 2, 1]);
        assert.deepEqual([mumbai.customers, mumbai.orderedInRange], [2, 0]);
        assert.deepEqual([r.body.totals.customers, r.body.totals.people, r.body.totals.inMoreThanOneBranch], [4, 3, 1]);
        assert.equal(JSON.stringify(r.body).includes('9811000001'), false);   // no phone numbers or names leave this route
    });

    test('complaints of every branch, labelled, filtered by branch and status, with the open count per branch', async () => {
        const w = await setup();
        const dc = await makeUser(w.delhi, 'customer', '9822000001');
        const mc = await makeUser(w.mumbai, 'customer', '9822000002');
        const add = async (tenant, c, status, text, n) => {
            const o = await makeOrder(tenant, c.user, { status: 'delivered' });
            return Complaint.create({ tenantId: tenant._id, orderId: o._id, orderNo: o.orderNo + n, userId: c.user._id, customerName: 'Guest', type: 'quality', text, status });
        };
        await add(w.delhi, dc, 'open', 'Cold food in Delhi', 0);
        await add(w.mumbai, mc, 'open', 'Missing item in Mumbai', 0);
        await add(w.mumbai, mc, 'resolved', 'Late in Mumbai', 1);

        const all = await w.api('/complaints');
        assert.equal(all.status, 200, JSON.stringify(all.body));
        assert.equal(all.body.items.length, 3);
        assert.deepEqual(Object.fromEntries(all.body.openByBranch.map((b) => [b.slug, b.open])), { 'savera-delhi': 1, 'savera-mumbai': 1 });
        const one = await w.api('/complaints?branch=savera-mumbai&status=open');
        assert.equal(one.body.items.length, 1);
        assert.equal(one.body.items[0].branch.name, 'Savera Mumbai');
        assert.equal((await w.api('/complaints?status=weird')).status, 400);
        assert.equal((await w.api('/complaints?branch=nowhere')).status, 404);
    });

    test('dish ratings: average, count and low ratings per branch, the newest ratings with dish and branch, low only on request', async () => {
        const w = await setup();
        const dc = await makeUser(w.delhi, 'customer', '9833000001');
        const mc = await makeUser(w.mumbai, 'customer', '9833000002');
        const dish = async (t, name) => Product.create({ tenantId: t._id, categoryId: (await Category.create({ tenantId: t._id, name: `C ${name}` }))._id, name, price: 100, isVeg: true });
        const dd = await dish(w.delhi, 'Delhi Dal');
        const md = await dish(w.mumbai, 'Mumbai Vada');
        const rate = async (t, c, p, rating, comment) => Review.create({ tenantId: t._id, userId: c.user._id, orderId: (await makeOrder(t, c.user, { status: 'delivered' }))._id, productId: p._id, rating, comment });
        await rate(w.delhi, dc, dd, 5, 'Great');
        await rate(w.delhi, dc, dd, 3);
        await rate(w.mumbai, mc, md, 1, 'Bad');

        const r = await w.api('/reviews?range=30');
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const [delhi, mumbai] = r.body.branches;
        assert.deepEqual([delhi.average, delhi.count, delhi.low], [4, 2, 0]);
        assert.deepEqual([mumbai.average, mumbai.count, mumbai.low], [1, 1, 1]);
        assert.deepEqual([r.body.total.average, r.body.total.count], [3, 3]);
        assert.equal(r.body.items.length, 3);
        assert.equal(r.body.items.find((i) => i.rating === 1).dish, 'Mumbai Vada');
        const low = await w.api('/reviews?low=1');
        assert.equal(low.body.items.length, 1);
        assert.equal(low.body.items[0].branch.name, 'Savera Mumbai');
        assert.equal((await w.api('/reviews?range=nope')).status, 400);
    });

    test('only a brand owner can read these', async () => {
        const w = await setup();
        await post(`/api/admin/tenants/${w.d.id}/owners`, { phone: '9866666666' });
        const mgr = await User.findOne({ tenantId: w.d.id, phone: '9866666666' });
        const sid = new mongoose.Types.ObjectId();
        const { accessToken } = tokenService.generateTokens({ userId: mgr._id, tenantId: w.d.id, sessionId: sid });
        await Session.create({ _id: sid, userId: mgr._id, tenantId: w.d.id, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600000) });
        for (const p of ['/customers', '/complaints', '/reviews']) {
            const r = await request(app).get(`/api/brand${p}`).set('x-tenant-slug', 'savera-delhi').set('Authorization', `Bearer ${accessToken}`);
            assert.equal(r.status, 403, p);
        }
    });
});
