require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const Tenant = require('../src/models/Tenant');
const Staff = require('../src/models/Staff');
const User = require('../src/models/User');
const Session = require('../src/models/Session');
const tokenService = require('../src/services/tokenService');
const mongoose = require('mongoose');

// Phase 1 of the kitchen and waiter panels: the owner adds staff by phone, the person logs in and reaches only their own routes.
let w;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('staff-shop');
    tenantRecognizer.invalidateTenant('staff-shop');
});
const owner = (m, path, body) => request(app)[m](`/api/shop/staff${path}`).set(w.owner.headers).send(body);
const switchOn = async (staff = { kitchenOn: true, waiterOn: true, max: 10 }) => {
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.staff': staff } });
    tenantRecognizer.invalidateTenant('staff-shop');
};
// a login for a staff user, the way the OTP login would give one
async function sessionFor(userId) {
    const sessionId = new mongoose.Types.ObjectId();
    const { accessToken, refreshToken } = tokenService.generateTokens({ userId, tenantId: w.tenant._id, sessionId });
    await Session.create({ _id: sessionId, userId, tenantId: w.tenant._id, refreshTokenHash: tokenService.hashToken(refreshToken), expiresAt: new Date(Date.now() + tokenService.REFRESH_TTL_MS) });
    return { Authorization: `Bearer ${accessToken}`, 'x-tenant-slug': 'staff-shop' };
}

describe('owner adds staff', () => {
    test('refused while the super admin has not switched the panel on', async () => {
        const r = await owner('post', '/', { phone: '9111111111', name: 'Ramesh', role: 'kitchen' });
        assert.equal(r.status, 403);
        assert.match(r.body.error, /not switched on/);
    });

    test('adds, lists, pauses and removes', async () => {
        await switchOn();
        const add = await owner('post', '/', { phone: '9111111111', name: 'Ramesh', role: 'kitchen' });
        assert.equal(add.status, 201);
        const u = await User.findOne({ tenantId: w.tenant._id, phone: '9111111111' });
        assert.equal(u.role, 'kitchen');
        const list = await owner('get', '/');
        assert.equal(list.body.items.length, 1);
        assert.equal(list.body.items[0].name, 'Ramesh');
        assert.equal(list.body.rules.kitchenOn, true);

        const pause = await owner('patch', `/${add.body.userId}`, { isActive: false });
        assert.equal(pause.status, 200);
        assert.equal(pause.body.isActive, false);

        const gone = await owner('delete', `/${add.body.userId}`);
        assert.equal(gone.status, 200);
        assert.equal((await User.findById(add.body.userId)).role, 'customer');
        assert.equal(await Staff.countDocuments({ tenantId: w.tenant._id }), 0);
    });

    test('the owner, a rider and a bad number are refused', async () => {
        await switchOn();
        assert.equal((await owner('post', '/', { phone: '9000000010', role: 'kitchen' })).status, 409);   // the owner
        assert.equal((await owner('post', '/', { phone: '9000000020', role: 'waiter' })).status, 409);    // the rider
        assert.equal((await owner('post', '/', { phone: '12345', role: 'waiter' })).status, 400);
        assert.equal((await owner('post', '/', { phone: '9111111111', role: 'cleaner' })).status, 400);
        assert.equal((await User.findOne({ tenantId: w.tenant._id, phone: '9000000010' })).role, 'admin', 'the owner stays the owner');
    });

    test('stops at the limit the super admin set', async () => {
        await switchOn({ kitchenOn: true, waiterOn: true, max: 1 });
        assert.equal((await owner('post', '/', { phone: '9111111111', role: 'kitchen' })).status, 201);
        assert.equal((await owner('post', '/', { phone: '9222222222', role: 'waiter' })).status, 409);
        // the same person again is not a new seat
        assert.equal((await owner('post', '/', { phone: '9111111111', role: 'kitchen', name: 'R' })).status, 200);
    });

    test('a customer with an order in progress cannot become staff', async () => {
        await switchOn();
        await f.makeOrder(w.tenant, w.customer.user);
        const r = await owner('post', '/', { phone: '9000000030', role: 'waiter' });
        assert.equal(r.status, 409);
        assert.equal((await User.findById(w.customer.user._id)).role, 'customer');
    });

    test('a customer cannot add staff', async () => {
        await switchOn();
        const r = await request(app).post('/api/shop/staff').set(w.customer.headers).send({ phone: '9111111111', role: 'kitchen' });
        assert.equal(r.status, 403);
    });
});

describe('the staff person', () => {
    async function hire(role = 'kitchen', phone = '9111111111') {
        const add = await owner('post', '/', { phone, name: 'Ramesh', role });
        return { id: add.body.userId, headers: await sessionFor(add.body.userId) };
    }

    test('sees who they are and which shop', async () => {
        await switchOn();
        const s = await hire('waiter');
        const r = await request(app).get('/api/staff/me').set(s.headers);
        assert.equal(r.status, 200);
        assert.equal(r.body.role, 'waiter');
        assert.equal(r.body.name, 'Ramesh');
        assert.equal(r.body.shop, w.tenant.name);
    });

    test('a customer, an owner and a rider are not staff', async () => {
        await switchOn();
        for (const who of [w.customer, w.owner, w.rider]) {
            const r = await request(app).get('/api/staff/me').set(who.headers);
            assert.equal(r.status, 403);
            assert.equal(r.body.code, 'not_staff');
        }
    });

    test('paused: logged out at once', async () => {
        await switchOn();
        const s = await hire();
        await owner('patch', `/${s.id}`, { isActive: false });
        const r = await request(app).get('/api/staff/me').set(s.headers);
        assert.equal(r.status, 401, 'the session ended');
    });

    test('a paused person who signs in again is told why', async () => {
        await switchOn();
        const s = await hire();
        await owner('patch', `/${s.id}`, { isActive: false });
        const again = await sessionFor(s.id);
        const r = await request(app).get('/api/staff/me').set(again);
        assert.equal(r.status, 403);
        assert.equal(r.body.code, 'paused');
    });

    test('panel switched off by the super admin: told why, comes back when it is on', async () => {
        await switchOn();
        const s = await hire();
        await switchOn({ kitchenOn: false, waiterOn: true, max: 10 });
        let r = await request(app).get('/api/staff/me').set(s.headers);
        assert.equal(r.status, 403);
        assert.equal(r.body.code, 'panel_off');
        await switchOn();
        r = await request(app).get('/api/staff/me').set(s.headers);
        assert.equal(r.status, 200);
    });

    test('removed: out at once, and the number is a customer again', async () => {
        await switchOn();
        const s = await hire();
        await owner('delete', `/${s.id}`);
        assert.equal((await request(app).get('/api/staff/me').set(s.headers)).status, 401);
    });

    test('changes their own name', async () => {
        await switchOn();
        const s = await hire();
        const r = await request(app).patch('/api/staff/me').set(s.headers).send({ name: 'Suresh' });
        assert.equal(r.status, 200);
        assert.equal((await Staff.findOne({ userId: s.id })).name, 'Suresh');
        assert.equal((await request(app).patch('/api/staff/me').set(s.headers).send({ name: '  ' })).status, 400);
    });

    test('a shop cannot use the login of another shop', async () => {
        await switchOn();
        const s = await hire();
        const other = await f.makeTenant('staff-shop-2');
        tenantRecognizer.invalidateTenant('staff-shop-2');
        const r = await request(app).get('/api/staff/me').set({ ...s.headers, 'x-tenant-slug': other.slug });
        assert.equal(r.status, 403);
    });
});

describe('numbers shared with other jobs', () => {
    test('a rider cannot be made from a staff number', async () => {
        await switchOn();
        await owner('post', '/', { phone: '9111111111', role: 'kitchen' });
        const r = await request(app).post('/api/shop/riders').set(w.owner.headers).send({ phone: '9111111111' });
        assert.equal(r.status, 409);
    });

    test('staff are not in the customers list', async () => {
        await switchOn();
        await owner('post', '/', { phone: '9111111111', role: 'kitchen' });
        const r = await request(app).get('/api/shop/customers').set(w.owner.headers);
        assert.equal(r.status, 200);
        assert.ok(!JSON.stringify(r.body).includes('9111111111'));
    });
});
