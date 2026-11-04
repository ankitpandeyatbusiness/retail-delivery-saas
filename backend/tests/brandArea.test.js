require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeTenant, makeUser, makeSuperAdmin } = require('./helpers/factory');
const Tenant = require('../src/models/Tenant');
const User = require('../src/models/User');
const Session = require('../src/models/Session');
const tokenService = require('../src/services/tokenService');

const RAJU = '9855555555';
const MGR = '9866666666';
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

async function login(tenantId, phone) {
    const user = await User.findOne({ tenantId, phone });
    const sid = new mongoose.Types.ObjectId();
    const { accessToken } = tokenService.generateTokens({ userId: user._id, tenantId, sessionId: sid });
    await Session.create({ _id: sid, userId: user._id, tenantId, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600000) });
    return accessToken;
}
async function setup() {
    const brand = (await post('/api/admin/brands', { name: 'Savera' })).body.brand;
    const m = (await post(`/api/admin/brands/${brand._id}/branches`, { name: 'Savera Mumbai', slug: 'savera-mumbai', city: 'Mumbai' })).body.branch;
    await post(`/api/admin/tenants/${m.id}/owners`, { phone: MGR });
    await post(`/api/admin/brands/${brand._id}/owners`, { phone: RAJU });
    const tok = { mgr: await login(m.id, MGR), raju: await login(m.id, RAJU) };
    const put = (t, delivery) => request(app).put('/api/shop/settings').set('x-tenant-slug', 'savera-mumbai').set('Authorization', `Bearer ${t}`).send({ delivery });
    const get = (t) => request(app).get('/api/shop/settings').set('x-tenant-slug', 'savera-mumbai').set('Authorization', `Bearer ${t}`);
    return { brand, m, tok, put, get };
}
const lock = (w, locked, t = supreme) => post(`/api/admin/brands/${w.brand._id}/branches/${w.m.id}/area-lock`, { locked }, t);

describe('who changed the pin and radius, and the lock', () => {
    test('a change of pin or radius is noted: who, their job, when; a change of something else is not', async () => {
        const w = await setup();
        const r = await w.put(w.tok.mgr, { latitude: 19.07, longitude: 72.87, radiusKm: 5 });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        let d = (await w.get(w.tok.mgr)).body.delivery;
        assert.deepEqual([d.radiusKm, d.locationBy.role], [5, 'branch manager']);
        assert.ok(d.locationBy.who);
        assert.ok(d.locationBy.at);

        // only the minimum order changes: the note stays as it was
        const before = d.locationBy.at;
        await new Promise((ok) => setTimeout(ok, 20));
        await w.put(w.tok.mgr, { minOrder: 200 });
        d = (await w.get(w.tok.mgr)).body.delivery;
        assert.equal(d.locationBy.at, before);
        // the same values again: not a change
        await w.put(w.tok.mgr, { radiusKm: 5 });
        assert.equal((await w.get(w.tok.mgr)).body.delivery.locationBy.at, before);

        // the brand owner changes the radius: noted as the brand owner
        await w.put(w.tok.raju, { radiusKm: 7 });
        d = (await w.get(w.tok.raju)).body.delivery;
        assert.deepEqual([d.radiusKm, d.locationBy.role], [7, 'brand owner']);

        // the superadmin's shop form: noted as the superadmin
        const s = await request(app).put(`/api/admin/tenants/${w.m.id}`).set(as(plain)).send({ delivery: { radiusKm: 9 } });
        assert.equal(s.status, 200, JSON.stringify(s.body));
        d = (await w.get(w.tok.raju)).body.delivery;
        assert.deepEqual([d.radiusKm, d.locationBy.role], [9, 'superadmin']);
    });

    test('a locked area: the branch manager cannot move the pin or widen the radius; the brand owner and the superadmin can', async () => {
        const w = await setup();
        await w.put(w.tok.mgr, { latitude: 19.07, longitude: 72.87, radiusKm: 5 });
        assert.equal((await lock(w, true)).status, 200);

        const radius = await w.put(w.tok.mgr, { radiusKm: 20 });
        assert.equal(radius.status, 403);
        assert.equal(radius.body.areaLocked, true);
        assert.match(radius.body.error, /locked by the head office/);
        assert.equal((await w.put(w.tok.mgr, { latitude: 19.5 })).status, 403);
        assert.equal((await w.get(w.tok.mgr)).body.delivery.radiusKm, 5);   // nothing changed

        // other delivery settings and an unchanged area are fine
        assert.equal((await w.put(w.tok.mgr, { minOrder: 150 })).status, 200);
        assert.equal((await w.put(w.tok.mgr, { radiusKm: 5, latitude: 19.07, longitude: 72.87 })).status, 200);
        assert.equal((await w.get(w.tok.mgr)).body.delivery.locked, true);   // the app can show "locked"

        // the brand owner and a superadmin still can
        assert.equal((await w.put(w.tok.raju, { radiusKm: 8 })).status, 200);
        assert.equal((await request(app).put(`/api/admin/tenants/${w.m.id}`).set(as(plain)).send({ delivery: { radiusKm: 6 } })).status, 200);
        assert.equal((await request(app).put(`/api/admin/tenants/${w.m.id}/shop/settings`).set(as(plain)).send({ delivery: { radiusKm: 4 } })).status, 200);

        // unlock: the manager can again
        assert.equal((await lock(w, false)).status, 200);
        assert.equal((await w.put(w.tok.mgr, { radiusKm: 12 })).status, 200);
    });

    test('only the supreme admin locks; the Brand page shows the lock and who changed the area; a normal shop has nothing to lock', async () => {
        const w = await setup();
        assert.equal((await lock(w, true, plain)).status, 403);
        assert.equal((await post(`/api/admin/brands/${w.brand._id}/branches/${w.m.id}/area-lock`, { locked: 'yes' })).status, 400);
        await lock(w, true);
        await w.put(w.tok.raju, { latitude: 19.0, longitude: 72.8, radiusKm: 6 });
        const detail = await request(app).get(`/api/admin/brands/${w.brand._id}`).set(as(plain));
        const b = detail.body.branches[0];
        assert.equal(b.area.locked, true);
        assert.equal(b.area.by.role, 'brand owner');

        // a shop that is not a branch: its owner changes the area freely, and it is noted as "owner"
        const solo = await makeTenant('solo-area');
        const o = await makeUser(solo, 'admin', '9877777777');
        const r = await request(app).put('/api/shop/settings').set('x-tenant-slug', 'solo-area').set('Authorization', `Bearer ${o.accessToken}`).send({ delivery: { radiusKm: 3 } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal((await Tenant.findById(solo._id)).delivery.locationBy.role, 'owner');
    });
});
