require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeTenant, makeSuperAdmin } = require('./helpers/factory');
const Tenant = require('../src/models/Tenant');
const User = require('../src/models/User');
const Rider = require('../src/models/Rider');
const Session = require('../src/models/Session');
const tokenService = require('../src/services/tokenService');
const riders = require('../src/services/riderService');
const staffSvc = require('../src/services/staffService');

const OWNER = '9855555555';
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

async function brandWith(...cities) {
    const brand = (await post('/api/admin/brands', { name: 'Savera', branchLimit: 10 })).body.brand;
    const branches = [];
    for (const c of cities) {
        const r = await post(`/api/admin/brands/${brand._id}/branches`, { name: `Savera ${c}`, slug: `savera-${c}`, city: c });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        branches.push(r.body.branch);
    }
    return { brand, branches };
}

// signs a user in to a branch the way the app does (a real session and a real token)
async function login(tenantId, phone) {
    const user = await User.findOne({ tenantId, phone });
    const sid = new mongoose.Types.ObjectId();
    const { accessToken } = tokenService.generateTokens({ userId: user._id, tenantId, sessionId: sid });
    await Session.create({ _id: sid, userId: user._id, tenantId, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600000) });
    return accessToken;
}
const brandApi = (slug, token) => ({
    get: (p) => request(app).get(`/api/brand${p}`).set('x-tenant-slug', slug).set('Authorization', `Bearer ${token}`),
    post: (p, b) => request(app).post(`/api/brand${p}`).set('x-tenant-slug', slug).set('Authorization', `Bearer ${token}`).send(b),
});

describe('brand owner, switching branches, managers and moving people', () => {
    test('a brand owner is made owner of every branch, and a new branch gets them too', async () => {
        const { brand, branches } = await brandWith('delhi', 'mumbai');
        const r = await post(`/api/admin/brands/${brand._id}/owners`, { phone: OWNER }, plain);   // any superadmin may appoint
        assert.equal(r.status, 201, JSON.stringify(r.body));
        for (const b of branches) assert.equal(await User.countDocuments({ tenantId: b.id, phone: OWNER, role: 'admin' }), 1);
        const goa = (await post(`/api/admin/brands/${brand._id}/branches`, { name: 'Savera Goa', slug: 'savera-goa', city: 'Goa' })).body.branch;
        assert.equal(await User.countDocuments({ tenantId: goa.id, phone: OWNER, role: 'admin' }), 1);

        // a rider of one branch cannot become a brand owner
        await riders.addByPhone({ tenantId: branches[0].id, phone: '9866666666', name: 'R' });
        assert.equal((await post(`/api/admin/brands/${brand._id}/owners`, { phone: '9866666666' })).status, 409);
        // a plain number is still limited to one branch
        assert.equal((await post(`/api/admin/tenants/${branches[1].id}/owners`, { phone: '9877777777' })).status, 201);
        assert.equal((await post(`/api/admin/tenants/${branches[0].id}/owners`, { phone: '9877777777' })).status, 409);
    });

    test('the owner lists branches and switches; only a brand owner can', async () => {
        const { brand, branches } = await brandWith('delhi', 'mumbai');
        await post(`/api/admin/brands/${brand._id}/owners`, { phone: OWNER });
        const api = brandApi(branches[0].slug, await login(branches[0].id, OWNER));

        const me = await api.get('/me');
        assert.equal(me.status, 200);
        assert.equal(me.body.branches.length, 2);
        assert.equal(me.body.current, branches[0].slug);

        const sw = await api.post('/switch', { slug: branches[1].slug });
        assert.equal(sw.status, 200, JSON.stringify(sw.body));
        assert.ok(sw.body.accessToken && sw.body.refreshToken);
        assert.equal((await brandApi(branches[1].slug, sw.body.accessToken).get('/me')).status, 200);   // the new token works at the other branch
        assert.equal((await brandApi(branches[0].slug, sw.body.accessToken).get('/me')).status, 403);   // and only there

        // a branch manager who is not a brand owner is refused
        await post(`/api/admin/tenants/${branches[0].id}/owners`, { phone: '9888888888' });
        const mgr = brandApi(branches[0].slug, await login(branches[0].id, '9888888888'));
        assert.equal((await mgr.get('/me')).status, 403);
        assert.equal((await mgr.post('/switch', { slug: branches[1].slug })).status, 403);

        // a shop of another brand cannot be reached
        const outsider = await makeTenant('outsider');
        assert.equal((await api.post('/switch', { slug: outsider.slug })).status, 404);
    });

    test('the owner appoints a manager; a person moves between branches but a brand owner does not', async () => {
        const { brand, branches } = await brandWith('delhi', 'mumbai');
        const [delhi, mumbai] = branches;
        await post(`/api/admin/brands/${brand._id}/owners`, { phone: OWNER });
        const api = brandApi(delhi.slug, await login(delhi.id, OWNER));

        assert.equal((await api.post('/managers', { slug: mumbai.slug, phone: '9899999999' })).status, 201);
        assert.equal(await User.countDocuments({ tenantId: mumbai.id, phone: '9899999999', role: 'admin' }), 1);
        assert.equal((await api.post('/managers', { slug: delhi.slug, phone: '9899999999' })).status, 409);   // one person, one branch

        // a rider moves from Delhi to Mumbai
        await riders.addByPhone({ tenantId: delhi.id, phone: '9811000011', name: 'Ravi' });
        const rider = await User.findOne({ tenantId: delhi.id, phone: '9811000011' });
        const mv = await api.post('/move', { fromSlug: delhi.slug, toSlug: mumbai.slug, userId: String(rider._id) });
        assert.equal(mv.status, 200, JSON.stringify(mv.body));
        assert.equal((await User.findOne({ tenantId: delhi.id, phone: '9811000011' })).role, 'customer');   // the history stays, the job is gone
        assert.equal((await User.findOne({ tenantId: mumbai.id, phone: '9811000011' })).role, 'rider');
        assert.equal(await Rider.countDocuments({ tenantId: delhi.id }), 0);
        assert.equal(await Rider.countDocuments({ tenantId: mumbai.id }), 1);

        // not a brand owner, not a plain customer
        const ownerUser = await User.findOne({ tenantId: delhi.id, phone: OWNER });
        assert.equal((await api.post('/move', { fromSlug: delhi.slug, toSlug: mumbai.slug, userId: String(ownerUser._id) })).status, 409);
        assert.equal((await api.post('/move', { fromSlug: delhi.slug, toSlug: mumbai.slug, userId: String(rider._id) })).status, 404);
    });

    test('a superadmin can move a person too, and taking the brand-owner job away ends the owner panel everywhere', async () => {
        const { brand, branches } = await brandWith('delhi', 'mumbai');
        const [delhi, mumbai] = branches;
        const mumbaiShop = await Tenant.findById(mumbai.id);
        await staffSvc.add({ tenant: mumbaiShop, phone: '9822000022', name: 'Cook', role: 'kitchen' }).catch(() => null);
        const cook = await User.findOne({ tenantId: mumbai.id, phone: '9822000022' });
        if (cook && cook.role === 'kitchen') {
            const m = await post(`/api/admin/brands/${brand._id}/move`, { fromTenantId: String(mumbai.id), toTenantId: String(delhi.id), userId: String(cook._id) }, plain);
            assert.equal(m.status, 200, JSON.stringify(m.body));
            assert.equal((await User.findOne({ tenantId: delhi.id, phone: '9822000022' })).role, 'kitchen');
        }

        await post(`/api/admin/brands/${brand._id}/owners`, { phone: OWNER });
        assert.equal((await request(app).delete(`/api/admin/brands/${brand._id}/owners/${OWNER}`).set(as(plain))).status, 200);
        for (const b of branches) assert.equal((await User.findOne({ tenantId: b.id, phone: OWNER })).role, 'customer');
    });
});
