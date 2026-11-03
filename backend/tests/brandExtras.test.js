require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeSuperAdmin } = require('./helpers/factory');
const Coupon = require('../src/models/Coupon');
const Banner = require('../src/models/Banner');
const Collection = require('../src/models/Collection');
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

const HOUR = 3600000;
// the main branch (Delhi) has two dishes, two coupons (one used 7 times, one over), a banner, a collection of both dishes, and an expired banner
async function setup() {
    const brand = (await post('/api/admin/brands', { name: 'Savera', branchLimit: 5 })).body.brand;
    const d = (await post(`/api/admin/brands/${brand._id}/branches`, { name: 'Savera Delhi', slug: 'savera-delhi', city: 'Delhi' })).body.branch;
    const cat = await Category.create({ tenantId: d.id, name: 'Mains' });
    const tikka = await Product.create({ tenantId: d.id, categoryId: cat._id, name: 'Tikka', price: 200, isVeg: true });
    const dal = await Product.create({ tenantId: d.id, categoryId: cat._id, name: 'Dal', price: 150, isVeg: true });
    const fest = await Coupon.create({ tenantId: d.id, code: 'DIWALI20', discountType: 'percent', discountValue: 20, usedCount: 7 });
    await Coupon.create({ tenantId: d.id, code: 'OLD10', discountType: 'flat', discountValue: 10, endsAt: new Date(Date.now() - HOUR) });
    const banner = await Banner.create({ tenantId: d.id, title: 'Diwali offer', couponCode: 'DIWALI20' });
    await Banner.create({ tenantId: d.id, title: 'Last year', endsAt: new Date(Date.now() - HOUR) });
    const combo = await Collection.create({ tenantId: d.id, kind: 'combo', title: 'Meal deal', productIds: [tikka._id, dal._id] });
    return { brand, d, tikka, dal, fest, banner, combo };
}
const addBranch = (w, body) => post(`/api/admin/brands/${w.brand._id}/branches`, body);

describe('coupons, banners and collections across branches', () => {
    test('a new branch copied from the main one gets the live coupons, banners and collections; used counts start at zero; finished ones stay behind', async () => {
        const w = await setup();
        const r = await addBranch(w, { name: 'Savera Mumbai', slug: 'savera-mumbai', city: 'Mumbai', copyFromTenantId: String(w.d.id) });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        assert.deepEqual([r.body.extras.coupons, r.body.extras.banners, r.body.extras.collections, r.body.extras.conflicts], [1, 1, 1, 0]);

        const m = r.body.branch.id;
        const coupon = await Coupon.findOne({ tenantId: m });
        assert.deepEqual([coupon.code, coupon.discountValue, coupon.usedCount], ['DIWALI20', 20, 0]);
        assert.equal(await Coupon.countDocuments({ tenantId: m }), 1);   // the finished one was left behind
        assert.equal(await Banner.countDocuments({ tenantId: m }), 1);
        assert.equal((await Banner.findOne({ tenantId: m })).couponCode, 'DIWALI20');

        // the collection holds Mumbai's OWN copies of the dishes, not Delhi's
        const col = await Collection.findOne({ tenantId: m });
        const own = await Product.find({ tenantId: m }).select('_id name').lean();
        assert.equal(col.productIds.length, 2);
        assert.deepEqual(col.productIds.map(String).sort(), own.map((p) => String(p._id)).sort());
        assert.notEqual(String((await Coupon.findOne({ tenantId: m }))._id), String(w.fest._id));

        // look only (copyMenu false): none of it
        const bare = await addBranch(w, { name: 'Savera Goa', slug: 'savera-goa', city: 'Goa', copyFromTenantId: String(w.d.id), copyMenu: false });
        assert.equal(bare.body.extras, undefined);
        assert.equal(await Coupon.countDocuments({ tenantId: bare.body.branch.id }), 0);
    });

    test('a push updates what the branch has (not its used count) and creates what is missing; a code clash is skipped and counted', async () => {
        const w = await setup();
        const m = (await addBranch(w, { name: 'Savera Mumbai', slug: 'savera-mumbai', city: 'Mumbai', copyFromTenantId: String(w.d.id) })).body.branch;
        await Coupon.updateOne({ tenantId: m.id, code: 'DIWALI20' }, { $set: { usedCount: 4 } });
        await Coupon.updateOne({ _id: w.fest._id }, { $set: { discountValue: 25, description: 'Bigger Diwali' } });
        const g = (await addBranch(w, { name: 'Savera Goa', slug: 'savera-goa', city: 'Goa' })).body.branch;   // empty
        await Coupon.create({ tenantId: g.id, code: 'DIWALI20', discountType: 'flat', discountValue: 5 });        // a different Goa coupon with the same code

        await post(`/api/admin/brands/${w.brand._id}/owners`, { phone: OWNER });
        const owner = await User.findOne({ tenantId: w.d.id, phone: OWNER });
        const sid = new mongoose.Types.ObjectId();
        const { accessToken } = tokenService.generateTokens({ userId: owner._id, tenantId: w.d.id, sessionId: sid });
        await Session.create({ _id: sid, userId: owner._id, tenantId: w.d.id, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600000) });
        const push = (body) => request(app).post('/api/brand/extras/push').set('x-tenant-slug', 'savera-delhi').set('Authorization', `Bearer ${accessToken}`).send(body);

        const r = await push({ kind: 'coupons', ids: [String(w.fest._id)], toSlugs: 'all' });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.deepEqual([r.body.updated, r.body.created, r.body.conflicts], [1, 0, 1]);   // Mumbai updated, Goa clashed
        const upd = await Coupon.findOne({ tenantId: m.id, code: 'DIWALI20' });
        assert.deepEqual([upd.discountValue, upd.description, upd.usedCount], [25, 'Bigger Diwali', 4]);   // updated, its own count kept
        assert.equal((await Coupon.findOne({ tenantId: g.id, code: 'DIWALI20' })).discountValue, 5);        // the Goa coupon is untouched

        // a banner to Goa
        const b = await push({ kind: 'banners', ids: [String(w.banner._id)], toSlugs: ['savera-goa'] });
        assert.deepEqual([b.body.created, b.body.updated], [1, 0]);
        assert.equal((await Banner.findOne({ tenantId: g.id })).title, 'Diwali offer');

        // a collection to Goa, which has no dishes yet: created empty, and the two dishes are counted as left out
        const c = await push({ kind: 'collections', ids: [String(w.combo._id)], toSlugs: ['savera-goa'] });
        assert.deepEqual([c.body.created, c.body.dishesLeftOut], [1, 2]);
        assert.equal((await Collection.findOne({ tenantId: g.id })).productIds.length, 0);

        // bad input and other brands
        assert.equal((await push({ kind: 'sweets', ids: [String(w.fest._id)], toSlugs: 'all' })).status, 400);
        assert.equal((await push({ kind: 'coupons', ids: [], toSlugs: 'all' })).status, 400);
        assert.equal((await push({ kind: 'coupons', ids: [String(w.fest._id)], toSlugs: ['nowhere'] })).status, 404);
        assert.equal((await push({ kind: 'coupons', ids: [String(new mongoose.Types.ObjectId())], toSlugs: 'all' })).status, 404);
    });

    test('a branch manager cannot push; the supreme admin can from the panel', async () => {
        const w = await setup();
        const m = (await addBranch(w, { name: 'Savera Mumbai', slug: 'savera-mumbai', city: 'Mumbai' })).body.branch;
        await post(`/api/admin/tenants/${w.d.id}/owners`, { phone: '9866666666' });
        const mgr = await User.findOne({ tenantId: w.d.id, phone: '9866666666' });
        const sid = new mongoose.Types.ObjectId();
        const { accessToken } = tokenService.generateTokens({ userId: mgr._id, tenantId: w.d.id, sessionId: sid });
        await Session.create({ _id: sid, userId: mgr._id, tenantId: w.d.id, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600000) });
        const r = await request(app).post('/api/brand/extras/push').set('x-tenant-slug', 'savera-delhi').set('Authorization', `Bearer ${accessToken}`).send({ kind: 'coupons', ids: [String(w.fest._id)], toSlugs: 'all' });
        assert.equal(r.status, 403);

        const s = await post(`/api/admin/brands/${w.brand._id}/extras/push`, { fromTenantId: String(w.d.id), kind: 'coupons', ids: [String(w.fest._id)], toTenantIds: [String(m.id)] });
        assert.equal(s.status, 200, JSON.stringify(s.body));
        assert.equal(s.body.created, 1);
        assert.equal((await post(`/api/admin/brands/${w.brand._id}/extras/push`, { fromTenantId: String(w.d.id), kind: 'coupons', ids: [String(w.fest._id)], toTenantIds: [String(w.d.id)] })).status, 400);
    });
});
