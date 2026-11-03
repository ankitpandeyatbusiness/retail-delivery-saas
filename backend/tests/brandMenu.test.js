require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeSuperAdmin } = require('./helpers/factory');
const Product = require('../src/models/Product');
const Category = require('../src/models/Category');
const User = require('../src/models/User');
const Session = require('../src/models/Session');
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

async function login(tenantId, phone) {
    const user = await User.findOne({ tenantId, phone });
    const sid = new mongoose.Types.ObjectId();
    const { accessToken } = tokenService.generateTokens({ userId: user._id, tenantId, sessionId: sid });
    await Session.create({ _id: sid, userId: user._id, tenantId, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600000) });
    return accessToken;
}

// a brand with a main branch that has a small menu
async function setup() {
    const brand = (await post('/api/admin/brands', { name: 'Savera', branchLimit: 6 })).body.brand;
    const main = (await post(`/api/admin/brands/${brand._id}/branches`, { name: 'Savera Delhi', slug: 'savera-delhi', city: 'Delhi' })).body.branch;
    const starters = await Category.create({ tenantId: main.id, name: 'Starters', sortOrder: 1 });
    const mains = await Category.create({ tenantId: main.id, name: 'Mains', sortOrder: 2 });
    const paneer = await Product.create({
        tenantId: main.id, categoryId: starters._id, name: 'Paneer Tikka', price: 220, isVeg: true,
        optionGroups: [{ id: 'size', name: 'Size', min: 1, max: 1, options: [{ id: 'half', name: 'Half', price: 0, isDefault: true }, { id: 'full', name: 'Full', price: 100 }] }],
        stock: { enabled: true, qty: 7 }, orderCount: 50, rating: 4.5,
    });
    const dal = await Product.create({ tenantId: main.id, categoryId: mains._id, name: 'Dal Makhani', price: 180, isVeg: true });
    await Product.create({ tenantId: main.id, categoryId: mains._id, name: 'Old Special', price: 99, isVeg: false, isActive: false });
    return { brand, main, paneer, dal };
}
const addBranch = (brand, body) => post(`/api/admin/brands/${brand._id}/branches`, body);

describe('branch menus', () => {
    test('a new branch gets a starting copy of the menu: own products, no stock, no ratings, hidden dishes left out', async () => {
        const { brand, main } = await setup();
        const r = await addBranch(brand, { name: 'Savera Mumbai', slug: 'savera-mumbai', city: 'Mumbai', copyFromTenantId: String(main.id) });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        assert.deepEqual([r.body.menu.dishes, r.body.menu.created], [2, 2]);

        const copies = await Product.find({ tenantId: r.body.branch.id }).sort({ name: 1 });
        assert.deepEqual(copies.map((p) => p.name), ['Dal Makhani', 'Paneer Tikka']);
        const tikka = copies[1];
        assert.equal(tikka.price, 220);
        assert.equal(tikka.optionGroups[0].options[1].price, 100);
        assert.equal(tikka.stock.enabled, false);   // the stock is never shared
        assert.equal(tikka.orderCount, 0);
        assert.equal(tikka.rating, 0);
        assert.notEqual(String(tikka._id), String((await Product.findOne({ tenantId: main.id, name: 'Paneer Tikka' }))._id));
        const cats = await Category.find({ tenantId: r.body.branch.id }).sort({ sortOrder: 1 });
        assert.deepEqual(cats.map((c) => c.name), ['Starters', 'Mains']);

        // copyMenu:false copies the look only
        const bare = await addBranch(brand, { name: 'Savera Goa', slug: 'savera-goa', city: 'Goa', copyFromTenantId: String(main.id), copyMenu: false });
        assert.equal(await Product.countDocuments({ tenantId: bare.body.branch.id }), 0);
    });

    test('a push creates missing dishes and updates the others, but never touches stock, hiding or (by default) the price', async () => {
        const { brand, main, paneer, dal } = await setup();
        const a = (await addBranch(brand, { name: 'Savera Mumbai', slug: 'savera-mumbai', city: 'Mumbai', copyFromTenantId: String(main.id) })).body.branch;
        const b = (await addBranch(brand, { name: 'Savera Goa', slug: 'savera-goa', city: 'Goa' })).body.branch;   // empty menu

        // Mumbai: its own price, a hidden dish, its own stock
        const mTikka = await Product.findOne({ tenantId: a.id, name: 'Paneer Tikka' });
        await Product.updateOne({ _id: mTikka._id }, { $set: { price: 260, 'stock.enabled': true, 'stock.qty': 3, 'optionGroups.0.options.1.price': 120 } });
        await Product.updateOne({ tenantId: a.id, name: 'Dal Makhani' }, { $set: { isActive: false } });

        // the main branch improves both dishes
        await Product.updateOne({ _id: paneer._id }, { $set: { description: 'Now with mint chutney', price: 240, 'optionGroups.0.options.1.price': 110 } });
        await Product.updateOne({ _id: dal._id }, { $set: { description: 'Slow cooked', price: 200 } });

        const bearer = await login(main.id, OWNER).catch(() => null);
        assert.equal(bearer, null);   // the owner does not exist yet: pushing needs a brand owner (below)
        await post(`/api/admin/brands/${brand._id}/owners`, { phone: OWNER });
        const token = await login(main.id, OWNER);
        const push = (body) => request(app).post('/api/brand/menu/push').set('x-tenant-slug', 'savera-delhi').set('Authorization', `Bearer ${token}`).send(body);

        const r = await push({ productIds: [String(paneer._id), String(dal._id)], toSlugs: 'all' });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.deepEqual([r.body.created, r.body.updated], [2, 2]);   // Goa gets two new dishes, Mumbai two updates

        const after = await Product.findOne({ _id: mTikka._id });
        assert.equal(after.description, 'Now with mint chutney');    // content follows the push
        assert.equal(after.price, 260);                             // the branch price stays
        assert.equal(after.optionGroups[0].options[1].price, 120);  // and so do its option prices
        assert.equal(after.stock.qty, 3);                           // stock is the branch's own
        assert.equal((await Product.findOne({ tenantId: a.id, name: 'Dal Makhani' })).isActive, false);   // a hidden dish stays hidden
        assert.equal((await Product.findOne({ tenantId: a.id, name: 'Dal Makhani' })).description, 'Slow cooked');
        assert.equal((await Product.findOne({ tenantId: b.id, name: 'Dal Makhani' })).price, 200);          // new dishes come with the pushed price

        // untouched: Mumbai changed Paneer Tikka (260 vs the 220 it came with) so it keeps 260; Dal was never changed there, so it follows to 220
        await Product.updateOne({ _id: dal._id }, { $set: { price: 220 } });
        const r2 = await push({ productIds: [String(paneer._id), String(dal._id)], toSlugs: ['savera-mumbai'], prices: 'untouched' });
        assert.equal(r2.status, 200);
        assert.equal((await Product.findOne({ _id: mTikka._id })).price, 260);
        assert.equal((await Product.findOne({ tenantId: a.id, name: 'Dal Makhani' })).price, 220);

        // all: every price is overwritten
        await push({ productIds: [String(paneer._id)], toSlugs: ['savera-mumbai'], prices: 'all' });
        assert.equal((await Product.findOne({ _id: mTikka._id })).price, 240);
    });

    test('push is refused for other brands, bad choices, and anybody who is not a brand owner', async () => {
        const { brand, main, paneer } = await setup();
        await addBranch(brand, { name: 'Savera Mumbai', slug: 'savera-mumbai', city: 'Mumbai' });
        await post(`/api/admin/tenants/${main.id}/owners`, { phone: '9888888888' });   // a manager, not a brand owner
        const mgr = await login(main.id, '9888888888');
        const r = await request(app).post('/api/brand/menu/push').set('x-tenant-slug', 'savera-delhi').set('Authorization', `Bearer ${mgr}`)
            .send({ productIds: [String(paneer._id)], toSlugs: 'all' });
        assert.equal(r.status, 403);

        await post(`/api/admin/brands/${brand._id}/owners`, { phone: OWNER });
        const tok = await login(main.id, OWNER);
        const push = (body) => request(app).post('/api/brand/menu/push').set('x-tenant-slug', 'savera-delhi').set('Authorization', `Bearer ${tok}`).send(body);
        assert.equal((await push({ productIds: [String(paneer._id)], toSlugs: ['nowhere'] })).status, 404);
        assert.equal((await push({ productIds: [], toSlugs: 'all' })).status, 400);
        assert.equal((await push({ productIds: [String(paneer._id)], toSlugs: 'all', prices: 'free' })).status, 400);
        assert.equal((await push({ productIds: [String(new mongoose.Types.ObjectId())], toSlugs: 'all' })).status, 404);
    });

    test('the supreme admin can push from the panel too', async () => {
        const { brand, main, paneer } = await setup();
        const a = (await addBranch(brand, { name: 'Savera Mumbai', slug: 'savera-mumbai', city: 'Mumbai' })).body.branch;
        const r = await post(`/api/admin/brands/${brand._id}/menu/push`, { fromTenantId: String(main.id), productIds: [String(paneer._id)], toTenantIds: [String(a.id)] });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.created, 1);
        assert.equal(await Product.countDocuments({ tenantId: a.id, name: 'Paneer Tikka' }), 1);
        assert.equal((await post(`/api/admin/brands/${brand._id}/menu/push`, { fromTenantId: String(main.id), productIds: [String(paneer._id)], toTenantIds: [String(main.id)] })).status, 400);
    });
});
