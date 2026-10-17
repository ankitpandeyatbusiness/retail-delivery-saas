require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const SuperAdmin = require('../src/models/SuperAdmin');
const User = require('../src/models/User');
const Rider = require('../src/models/Rider');

let n = 0;
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const phone = () => `98765${String(20000 + ++n)}`;

before(() => db.connect());
after(() => db.disconnect());
beforeEach(() => db.clear());

describe('superadmin team', () => {
    test('add a superadmin: listed, phones masked for others, duplicate number refused', async () => {
        const { token } = await f.makeSuperAdmin('root@test.com');
        const p = phone();
        const res = await request(app).post('/api/admin/team').set(auth(token)).send({ name: 'Priya', phones: [p] });
        assert.equal(res.status, 201);
        assert.equal(res.body.isActive, true);
        assert.equal(res.body.email, null);                 // placeholder label is never shown

        const list = await request(app).get('/api/admin/team').set(auth(token));
        const added = list.body.items.find((a) => a.name === 'Priya');
        assert.ok(added);
        assert.notEqual(added.phones[0], p);                // masked: only your own numbers are shown in full
        assert.ok(list.body.items.some((a) => a.isMe));

        const dup = await request(app).post('/api/admin/team').set(auth(token)).send({ phones: [p] });
        assert.equal(dup.status, 409);
    });

    test('bad phones are refused', async () => {
        const { token } = await f.makeSuperAdmin('root@test.com');
        for (const phones of [[], ['123'], ['9876543210', '9876543211', '9876543212']]) {
            const res = await request(app).post('/api/admin/team').set(auth(token)).send({ phones });
            assert.equal(res.status, 400);
        }
    });

    test('you cannot change your own role, another superadmin can', async () => {
        const a = await f.makeSuperAdmin('a@test.com');
        const b = await f.makeSuperAdmin('b@test.com', { phones: [] });

        const self = await request(app).post(`/api/admin/team/${a.admin._id}/revoke`).set(auth(a.token)).send({});
        assert.equal(self.status, 403);
        assert.equal((await SuperAdmin.findById(a.admin._id)).isActive, true);

        const other = await request(app).post(`/api/admin/team/${b.admin._id}/revoke`).set(auth(a.token)).send({});
        assert.equal(other.status, 200);
        assert.equal(other.body.isActive, false);

        // the revoked superadmin is out at once
        const me = await request(app).get('/api/admin/me').set(auth(b.token));
        assert.equal(me.status, 401);

        // ...and can be given the access back
        const back = await request(app).post(`/api/admin/team/${b.admin._id}/restore`).set(auth(a.token));
        assert.equal(back.status, 200);
        assert.equal((await request(app).get('/api/admin/me').set(auth(b.token))).status, 200);
    });

    test('only the supreme admin can revoke or restore, and the supreme admin can never be revoked', async () => {
        const sup = await f.makeSuperAdmin('sup@test.com');
        const a = await f.makeSuperAdmin('a@test.com', { phones: [] });
        const b = await f.makeSuperAdmin('b@test.com', { phones: [] });
        const byOrdinary = await request(app).post(`/api/admin/team/${b.admin._id}/revoke`).set(auth(a.token)).send({});
        assert.equal(byOrdinary.status, 403);
        assert.equal((await SuperAdmin.findById(b.admin._id)).isActive, true);
        const onSupreme = await request(app).post(`/api/admin/team/${sup.admin._id}/revoke`).set(auth(a.token)).send({});
        assert.equal(onSupreme.status, 403);
        assert.equal((await SuperAdmin.findById(sup.admin._id)).isActive, true);
        await request(app).post(`/api/admin/team/${b.admin._id}/revoke`).set(auth(sup.token)).send({});
        assert.equal((await request(app).post(`/api/admin/team/${b.admin._id}/restore`).set(auth(a.token))).status, 403);
    });

    test('revoke can make the person a customer, rider or owner of a shop', async () => {
        const a = await f.makeSuperAdmin('a@test.com');
        const b = await f.makeSuperAdmin('b@test.com', { phones: [] });
        const p = phone();
        await SuperAdmin.updateOne({ _id: b.admin._id }, { $set: { phones: [p] } });
        const shop = await f.makeTenant('team-shop-1');

        const bad = await request(app).post(`/api/admin/team/${b.admin._id}/revoke`).set(auth(a.token)).send({ role: 'rider' });
        assert.equal(bad.status, 400);
        assert.equal((await SuperAdmin.findById(b.admin._id)).isActive, true);   // nothing changed

        const res = await request(app).post(`/api/admin/team/${b.admin._id}/revoke`).set(auth(a.token))
            .send({ tenantId: String(shop._id), role: 'rider' });
        assert.equal(res.status, 200);
        assert.equal(res.body.shopRole.role, 'rider');
        const u = await User.findOne({ tenantId: shop._id, phone: p });
        assert.equal(u.role, 'rider');
        assert.ok(await Rider.exists({ tenantId: shop._id, userId: u._id }));
    });

    test('a shop user or no token cannot use the team routes', async () => {
        const shop = await f.makeTenant('team-shop-2');
        const owner = await f.makeUser(shop, 'admin', '9000000011');
        const res = await request(app).get('/api/admin/team').set('Authorization', `Bearer ${owner.accessToken}`);
        assert.equal(res.status, 401);
        assert.equal((await request(app).get('/api/admin/team')).status, 401);
    });
});

describe('change a shop user role', () => {
    test('customer -> rider -> owner -> customer keeps the rider profile in step', async () => {
        const { token } = await f.makeSuperAdmin('root@test.com');
        const shop = await f.makeTenant('role-shop-1');
        const { user } = await f.makeUser(shop, 'customer', '9000000021');
        const url = `/api/admin/tenants/${shop._id}/users/${user._id}/role`;

        let res = await request(app).patch(url).set(auth(token)).send({ role: 'rider' });
        assert.equal(res.status, 200);
        assert.equal(res.body.role, 'rider');
        assert.ok(await Rider.exists({ tenantId: shop._id, userId: user._id }));

        res = await request(app).patch(url).set(auth(token)).send({ role: 'admin' });
        assert.equal(res.body.role, 'admin');
        assert.equal(await Rider.exists({ tenantId: shop._id, userId: user._id }), null);

        res = await request(app).patch(url).set(auth(token)).send({ role: 'customer' });
        assert.equal(res.body.role, 'customer');

        res = await request(app).patch(url).set(auth(token)).send({ role: 'customer' });
        assert.equal(res.body.unchanged, true);
    });

    test('unknown role is refused; a blocked person must be unblocked first', async () => {
        const { token } = await f.makeSuperAdmin('root@test.com');
        const shop = await f.makeTenant('role-shop-2');
        const { user } = await f.makeUser(shop, 'customer', '9000000022');
        const url = `/api/admin/tenants/${shop._id}/users/${user._id}/role`;

        assert.equal((await request(app).patch(url).set(auth(token)).send({ role: 'superadmin' })).status, 400);

        await User.updateOne({ _id: user._id }, { $set: { isBlocked: true } });
        assert.equal((await request(app).patch(url).set(auth(token)).send({ role: 'rider' })).status, 409);
    });

    test('a person from another shop cannot be changed through this shop', async () => {
        const { token } = await f.makeSuperAdmin('root@test.com');
        const shopA = await f.makeTenant('role-shop-3');
        const shopB = await f.makeTenant('role-shop-4');
        const { user } = await f.makeUser(shopB, 'customer', '9000000023');
        const res = await request(app).patch(`/api/admin/tenants/${shopA._id}/users/${user._id}/role`).set(auth(token)).send({ role: 'rider' });
        assert.equal(res.status, 404);
    });
});

describe('shop media list', () => {
    const Media = require('../src/models/Media');

    test('lists hero images in order, filters by kind, refuses an unknown kind', async () => {
        const { token } = await f.makeSuperAdmin('root@test.com');
        const shop = await f.makeTenant('media-shop-1');
        const mk = (kind, n) => Media.create({ tenantId: shop._id, key: `k/${kind}/${n}`, url: `https://cdn.test/${kind}${n}.webp`, kind });
        await mk('hero', 1); await mk('hero', 2); await mk('logo', 1);

        const all = await request(app).get(`/api/admin/tenants/${shop._id}/media`).set(auth(token));
        assert.equal(all.status, 200);
        assert.equal(all.body.items.length, 3);

        const heroes = await request(app).get(`/api/admin/tenants/${shop._id}/media?kind=hero`).set(auth(token));
        assert.deepEqual(heroes.body.items.map((m) => m.url), ['https://cdn.test/hero1.webp', 'https://cdn.test/hero2.webp']);

        // customer photos are not part of the shop's branding list
        assert.equal((await request(app).get(`/api/admin/tenants/${shop._id}/media?kind=customer`).set(auth(token))).status, 400);
    });
});
