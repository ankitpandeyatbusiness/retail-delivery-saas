require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeTenant, makeUser, makeSuperAdmin } = require('./helpers/factory');
const Tenant = require('../src/models/Tenant');
const User = require('../src/models/User');

let supreme;
let plain;
const as = (t) => ({ Authorization: `Bearer ${t}` });
const post = (url, body, t = supreme) => request(app).post(url).set(as(t)).send(body);

before(async () => { await db.connect(); });
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    supreme = (await makeSuperAdmin('boss@example.com')).token;
    plain = (await makeSuperAdmin('other@example.com', { phones: ['9000000077'] })).token;
});

async function brandWith(...slugs) {
    const brand = (await post('/api/admin/brands', { name: 'Savera' })).body.brand;
    const out = [];
    for (const s of slugs) {
        const r = await post(`/api/admin/brands/${brand._id}/branches`, { name: `Savera ${s}`, slug: `savera-${s}`, city: s });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        out.push(r.body.branch);
    }
    return { brand, branches: out };
}

describe('brands and branches', () => {
    test('only the supreme admin changes brands; others can look', async () => {
        assert.equal((await post('/api/admin/brands', { name: 'Nope' }, plain)).status, 403);
        const { brand } = await brandWith();
        assert.equal((await request(app).get('/api/admin/brands').set(as(plain))).status, 200);
        assert.equal((await request(app).get(`/api/admin/brands/${brand._id}`).set(as(plain))).status, 200);
        assert.equal((await request(app).put(`/api/admin/brands/${brand._id}`).set(as(plain)).send({ name: 'X' })).status, 403);
    });

    test('a new branch is its own shop with a city, and the limit is kept', async () => {
        const brand = (await post('/api/admin/brands', { name: 'Savera', branchLimit: 2 })).body.brand;
        const add = (slug) => post(`/api/admin/brands/${brand._id}/branches`, { name: `Savera ${slug}`, slug: `sav-${slug}`, city: slug, managerPhone: slug === 'delhi' ? '9811111111' : undefined });
        assert.equal((await add('delhi')).status, 201);
        assert.equal((await add('noida')).status, 201);
        const third = await add('mumbai');
        assert.equal(third.status, 409);
        assert.match(third.body.error, /limit of 2/);

        const t = await Tenant.findOne({ slug: 'sav-delhi' }).lean();
        assert.equal(String(t.brandId), String(brand._id));
        assert.equal(t.branchCity, 'delhi');
        assert.equal(await User.countDocuments({ tenantId: t._id, role: 'admin', phone: '9811111111' }), 1);

        const detail = (await request(app).get(`/api/admin/brands/${brand._id}`).set(as(supreme))).body;
        assert.equal(detail.branches.length, 2);
        const delhi = detail.branches.find((b) => b.slug === 'sav-delhi');
        assert.equal(delhi.checklist.owner, true);
        assert.equal(delhi.checklist.location, false);   // no pin and radius yet
        assert.equal(delhi.checklist.keys, false);
        assert.equal(delhi.checklist.ready, false);
        assert.equal(detail.canAdd, false);
        assert.equal((await request(app).put(`/api/admin/brands/${brand._id}`).set(as(supreme)).send({ branchLimit: 1 })).status, 409);
    });

    test('an existing shop can join once, and leave again', async () => {
        const shop = await makeTenant('lonely');
        const { brand } = await brandWith();
        const join = await post(`/api/admin/brands/${brand._id}/branches`, { tenantId: String(shop._id), city: 'Pune' });
        assert.equal(join.status, 201);
        assert.equal((await post(`/api/admin/brands/${brand._id}/branches`, { tenantId: String(shop._id) })).status, 409);
        assert.equal((await request(app).delete(`/api/admin/brands/${brand._id}`).set(as(supreme))).status, 409);   // still has a branch
        assert.equal((await request(app).delete(`/api/admin/brands/${brand._id}/branches/${shop._id}`).set(as(supreme))).status, 200);
        assert.equal((await Tenant.findById(shop._id).lean()).brandId, undefined);
        assert.equal((await request(app).delete(`/api/admin/brands/${brand._id}`).set(as(supreme))).status, 200);
    });

    test('one person, one branch: owner, cook and rider are refused at a second branch; a single shop is not affected', async () => {
        const { branches } = await brandWith('delhi', 'mumbai');
        const [delhi, mumbai] = await Promise.all(branches.map((b) => Tenant.findById(b.id)));
        await post(`/api/admin/tenants/${delhi._id}/owners`, { phone: '9822222222' });

        // the same number as owner at the other branch
        const again = await post(`/api/admin/tenants/${mumbai._id}/owners`, { phone: '9822222222' });
        assert.equal(again.status, 409);
        assert.match(again.body.error, /already works at Savera delhi/);

        // as a new branch manager
        const brandId = delhi.brandId;
        const mgr = await post(`/api/admin/brands/${brandId}/branches`, { name: 'Savera Goa', slug: 'savera-goa', city: 'Goa', managerPhone: '9822222222' });
        assert.equal(mgr.status, 409);

        // a rider of the other branch
        const staffSvc = require('../src/services/riderService');
        await assert.rejects(staffSvc.addByPhone({ tenantId: mumbai._id, phone: '9822222222', name: 'R' }), /already works at/);
        // another number is fine
        await staffSvc.addByPhone({ tenantId: mumbai._id, phone: '9833333333', name: 'R' });

        // a customer of one branch is not limited
        await makeUser(delhi, 'customer', '9844444444');
        await staffSvc.addByPhone({ tenantId: mumbai._id, phone: '9844444444', name: 'R2' });

        // a shop outside any brand: nothing changes
        const solo = await makeTenant('solo-shop');
        assert.equal((await post(`/api/admin/tenants/${solo._id}/owners`, { phone: '9822222222' })).status, 201);
    });
});
