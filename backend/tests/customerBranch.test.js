require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeTenant, makeUser, makeSuperAdmin } = require('./helpers/factory');
const User = require('../src/models/User');
const Session = require('../src/models/Session');
const Address = require('../src/models/Address');
const tokenService = require('../src/services/tokenService');
const riders = require('../src/services/riderService');

let supreme;
const post = (url, body) => request(app).post(url).set({ Authorization: `Bearer ${supreme}` }).send(body);

before(async () => { await db.connect(); });
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    supreme = (await makeSuperAdmin('boss@example.com')).token;
});

async function brandOfTwo() {
    const brand = (await post('/api/admin/brands', { name: 'Savera', branchLimit: 5 })).body.brand;
    const out = [];
    for (const c of ['delhi', 'mumbai']) out.push((await post(`/api/admin/brands/${brand._id}/branches`, { name: `Savera ${c}`, slug: `savera-${c}`, city: c })).body.branch);
    return { brand, out };
}
async function tokenFor(tenantId, phone) {
    const user = await User.findOne({ tenantId, phone });
    const sid = new mongoose.Types.ObjectId();
    const { accessToken } = tokenService.generateTokens({ userId: user._id, tenantId, sessionId: sid });
    await Session.create({ _id: sid, userId: user._id, tenantId, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600000) });
    return accessToken;
}
const sw = (slug, token, body) => request(app).post('/api/customer-branch/session').set('x-tenant-slug', slug).set('Authorization', `Bearer ${token}`).send(body);

describe('a customer uses any branch with one sign-in', () => {
    test('the same phone gets its own account at the other branch, once, with its name; the two accounts stay separate', async () => {
        const { out } = await brandOfTwo();
        const [delhi, mumbai] = out;
        const delhiShop = await mongoose.model('Tenant').findById(delhi.id);
        const c = await makeUser(delhiShop, 'customer', '9811111111');
        await User.updateOne({ _id: c.user._id }, { $set: { name: 'Asha', language: 'hi' } });
        await Address.create({ tenantId: delhi.id, userId: c.user._id, label: 'Home', line1: 'A 1', phone: '9811111111', latitude: 28.6, longitude: 77.2 }).catch(() => null);

        const r = await sw(delhi.slug, c.accessToken, { slug: mumbai.slug });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.slug, mumbai.slug);
        assert.ok(r.body.accessToken && r.body.refreshToken);
        const there = await User.findOne({ tenantId: mumbai.id, phone: '9811111111' });
        assert.equal(there.role, 'customer');
        assert.equal(there.name, 'Asha');
        assert.equal(there.language, 'hi');
        assert.notEqual(String(there._id), String(c.user._id));
        assert.equal(await Address.countDocuments({ tenantId: mumbai.id }), 0);   // nothing of Delhi is copied

        // the new token works at Mumbai only
        assert.equal((await request(app).get('/api/addresses').set('x-tenant-slug', mumbai.slug).set('Authorization', `Bearer ${r.body.accessToken}`)).status, 200);
        assert.equal((await request(app).get('/api/addresses').set('x-tenant-slug', delhi.slug).set('Authorization', `Bearer ${r.body.accessToken}`)).status, 403);

        // a second switch finds the same account
        const again = await sw(delhi.slug, c.accessToken, { slug: mumbai.slug });
        assert.equal(again.status, 200);
        assert.equal(await User.countDocuments({ tenantId: mumbai.id, phone: '9811111111' }), 1);
    });

    test('refused: not a branch of the brand, another brand, a blocked account, a worker, a rider, a single shop', async () => {
        const { out } = await brandOfTwo();
        const [delhi, mumbai] = out;
        const delhiShop = await mongoose.model('Tenant').findById(delhi.id);
        const c = await makeUser(delhiShop, 'customer', '9822222222');

        assert.equal((await sw(delhi.slug, c.accessToken, { slug: 'nowhere' })).status, 404);
        const other = await makeTenant('other-brand-shop');
        assert.equal((await sw(delhi.slug, c.accessToken, { slug: other.slug })).status, 404);
        assert.equal((await sw(delhi.slug, c.accessToken, {})).status, 400);

        // blocked at the target
        await makeUser(await mongoose.model('Tenant').findById(mumbai.id), 'customer', '9822222222').then((m) => User.updateOne({ _id: m.user._id }, { $set: { isBlocked: true } }));
        assert.equal((await sw(delhi.slug, c.accessToken, { slug: mumbai.slug })).status, 403);

        // the number is a rider at the target: no customer account there
        await riders.addByPhone({ tenantId: mumbai.id, phone: '9833333333', name: 'Rider' });
        const c2 = await makeUser(delhiShop, 'customer', '9833333333');
        assert.equal((await sw(delhi.slug, c2.accessToken, { slug: mumbai.slug })).status, 409);

        // a rider or an owner of the branch does not use this route
        await riders.addByPhone({ tenantId: delhi.id, phone: '9844444444', name: 'Rider2' });
        assert.equal((await sw(delhi.slug, await tokenFor(delhi.id, '9844444444'), { slug: mumbai.slug })).status, 403);

        // a shop that is not a branch
        const solo = await makeTenant('solo-customer');
        const sc = await makeUser(solo, 'customer', '9855555551');
        assert.equal((await sw(solo.slug, sc.accessToken, { slug: mumbai.slug })).status, 403);

        // a suspended branch
        await mongoose.model('Tenant').updateOne({ _id: mumbai.id }, { $set: { status: 'suspended' } });
        require('../src/middlewares/tenantRecognizer').invalidateTenant(mumbai.slug);
        const c3 = await makeUser(delhiShop, 'customer', '9866666661');
        assert.equal((await sw(delhi.slug, c3.accessToken, { slug: mumbai.slug })).status, 403);
    });
});
