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
const tokenService = require('../src/services/tokenService');

const RAJU = '9855555555';
const MGR = '9866666666';
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
const as = (slug, token) => ({ get: (p) => request(app).get(p).set('x-tenant-slug', slug).set('Authorization', `Bearer ${token}`), post: (p, b) => request(app).post(p).set('x-tenant-slug', slug).set('Authorization', `Bearer ${token}`).send(b || {}) });

const PAY_ROUTES = [
    ['/api/shop/plan/pay/start', { to: 'growth', months: 1 }],
    ['/api/shop/sms/topup', { amountPaise: 10000 }],
    ['/api/shop/sms/topup/start', { amountPaise: 10000 }],
    ['/api/shop/sms/topup/64b000000000000000000001/verify', {}],
];

async function brand() {
    const b = (await post('/api/admin/brands', { name: 'Savera' })).body.brand;
    const mumbai = (await post(`/api/admin/brands/${b._id}/branches`, { name: 'Savera Mumbai', slug: 'savera-mumbai', city: 'Mumbai' })).body.branch;
    await post(`/api/admin/tenants/${mumbai.id}/owners`, { phone: MGR });
    return { b, mumbai };
}

describe('in a brand the brand owner pays for the plan and tops up SMS', () => {
    test('a branch manager is refused on every pay and top-up route, and sees canPay: false', async () => {
        const { mumbai } = await brand();
        await post(`/api/admin/brands/${(await mongoose.model('Brand').findOne({}))._id}/owners`, { phone: RAJU });
        const mgr = as(mumbai.slug, await login(mumbai.id, MGR));
        for (const [path, body] of PAY_ROUTES) {
            const r = await mgr.post(path, body);
            assert.equal(r.status, 403, path);
            assert.equal(r.body.brandOwnerPays, true, path);
        }
        assert.equal((await mgr.get('/api/shop/sms/wallet')).body.canPay, false);
        // reading is still allowed
    });

    test('the brand owner is not stopped by this rule', async () => {
        const { b, mumbai } = await brand();
        await post(`/api/admin/brands/${b._id}/owners`, { phone: RAJU });
        const raju = as(mumbai.slug, await login(mumbai.id, RAJU));
        for (const [path, body] of PAY_ROUTES) {
            const r = await raju.post(path, body);
            assert.notEqual(r.body.brandOwnerPays, true, `${path} -> ${r.status}`);
        }
        assert.equal((await raju.get('/api/shop/sms/wallet')).body.canPay, true);
    });

    test('a brand with no brand owner yet, a shop that is not a branch, and the superadmin are not stopped', async () => {
        const { mumbai } = await brand();   // no brand owner appointed
        const mgr = as(mumbai.slug, await login(mumbai.id, MGR));
        assert.equal((await mgr.get('/api/shop/sms/wallet')).body.canPay, true);
        assert.notEqual((await mgr.post('/api/shop/sms/topup/start', { amountPaise: 10000 })).body.brandOwnerPays, true);

        const solo = await makeTenant('solo-payer');
        const owner = await makeUser(solo, 'admin', '9877777777');
        const o = as(solo.slug, owner.accessToken);
        assert.equal((await o.get('/api/shop/sms/wallet')).body.canPay, true);
        assert.notEqual((await o.post('/api/shop/sms/topup/start', { amountPaise: 10000 })).body.brandOwnerPays, true);
    });

    test('the superadmin acting for a branch is not stopped, even when the brand has an owner', async () => {
        const { b, mumbai } = await brand();
        await post(`/api/admin/brands/${b._id}/owners`, { phone: RAJU });
        const r = await post(`/api/admin/tenants/${mumbai.id}/shop/sms/topup/start`, { amountPaise: 10000 });
        assert.notEqual(r.body.brandOwnerPays, true);
        const w = await request(app).get(`/api/admin/tenants/${mumbai.id}/shop/sms/wallet`).set({ Authorization: `Bearer ${supreme}` });
        assert.equal(w.body.canPay, true);
    });
});
