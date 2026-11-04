require('./helpers/env');
// The superadmin can make a person a cook or a waiter too (with the staff record their panel reads), and take them back.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Staff = require('../src/models/Staff');
const User = require('../src/models/User');

let token;
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); token = (await f.makeSuperAdmin('root@test.com')).token; });
const auth = () => ({ Authorization: 'Bearer ' + token });

describe('role: cook and waiter', () => {
    test('customer -> cook -> waiter -> customer, with the staff record following', async () => {
        const w = await f.makeWorld('rk-' + Date.now().toString(36));
        const url = `/api/admin/tenants/${w.tenant._id}/users/${w.customer.user._id}/role`;
        const set = (role) => request(app).patch(url).set(auth()).send({ role });

        let r = await set('kitchen');
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal((await User.findById(w.customer.user._id).lean()).role, 'kitchen');
        assert.equal((await Staff.findOne({ userId: w.customer.user._id }).lean()).role, 'kitchen');

        r = await set('waiter');
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const st = await Staff.find({ userId: w.customer.user._id }).lean();
        assert.equal(st.length, 1, 'one staff record, not two');
        assert.equal(st[0].role, 'waiter');
        assert.equal(st[0].isActive, true);

        r = await set('customer');
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(await Staff.countDocuments({ userId: w.customer.user._id }), 0, 'no longer staff');
        assert.equal((await set('chef')).status, 400);
    });
});
