require('./helpers/env');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const User = require('../src/models/User');
const Rider = require('../src/models/Rider');
const Order = require('../src/models/Order');
const { makeWorld, makeUser, makeOrder, makeSuperAdmin } = require('./helpers/factory');

describe('accounts', () => {
    before(() => db.connect());
    after(() => db.disconnect());

    test('B6: adding an owner never silently converts people', async () => {
        const w = await makeWorld('owner-shop');   // owner 9000000010, rider 9000000020, customer 9000000030
        const { token } = await makeSuperAdmin();
        const add = (phone) => request(app).post(`/api/admin/tenants/${w.tenant._id}/owners`)
            .set('Authorization', `Bearer ${token}`).send({ phone });

        // an active rider is refused, and stays a rider
        assert.equal((await add('9000000020')).status, 409);
        assert.equal((await User.findById(w.rider.user._id)).role, 'rider');
        assert.equal(await Rider.countDocuments({ tenantId: w.tenant._id }), 1);

        // a blocked user is refused and stays blocked
        const blocked = await makeUser(w.tenant, 'customer', '9000000040');
        await User.updateOne({ _id: blocked.user._id }, { $set: { isBlocked: true } });
        assert.equal((await add('9000000040')).status, 409);
        assert.equal((await User.findById(blocked.user._id)).isBlocked, true);

        // a customer with an order in progress is refused
        await makeOrder(w.tenant, w.customer.user, { status: 'preparing' });
        assert.equal((await add('9000000030')).status, 409);

        // a free customer becomes an owner
        const free = await makeUser(w.tenant, 'customer', '9000000050');
        assert.equal((await add('9000000050')).status, 201);
        assert.equal((await User.findById(free.user._id)).role, 'admin');

        // a brand new number becomes an owner
        assert.equal((await add('9000000051')).status, 201);
        // an owner who is already an owner is fine
        assert.equal((await add('9000000010')).status, 200);
        // a bad number
        assert.equal((await add('123')).status, 400);
    });

    test('B6: a switched-off rider with no orders can become an owner, and his rider profile goes', async () => {
        const w = await makeWorld('owner-shop-2');
        const { token } = await makeSuperAdmin('boss2@example.com');
        await Rider.updateOne({ userId: w.rider.user._id }, { $set: { isActive: false, isOnline: false } });
        const res = await request(app).post(`/api/admin/tenants/${w.tenant._id}/owners`)
            .set('Authorization', `Bearer ${token}`).send({ phone: '9000000020' });
        assert.equal(res.status, 201);
        assert.equal((await User.findById(w.rider.user._id)).role, 'admin');
        assert.equal(await Rider.countDocuments({ userId: w.rider.user._id }), 0);
    });

    test('B7: a rider cannot delete his account in the middle of a delivery', async () => {
        const w = await makeWorld('rider-delete-shop');
        const order = await makeOrder(w.tenant, w.customer.user, {
            status: 'out_for_delivery',
            delivery: { riderId: w.rider.user._id, status: 'picked_up' },
        });
        const del = () => request(app).delete('/api/me').set(w.rider.headers).send({ confirm: true });

        const refused = await del();
        assert.equal(refused.status, 409);
        assert.equal(await User.countDocuments({ _id: w.rider.user._id }), 1);

        await Order.updateOne({ _id: order._id }, { $set: { status: 'delivered' } });   // the delivery is over
        const done = await del();
        assert.equal(done.status, 200);
        assert.equal(await User.countDocuments({ _id: w.rider.user._id }), 0);
        assert.equal(await Rider.countDocuments({ userId: w.rider.user._id }), 0);   // his rider profile is gone too
    });

    test('a customer with no orders can still delete his account', async () => {
        const w = await makeWorld('customer-delete-shop');
        const res = await request(app).delete('/api/me').set(w.customer.headers).send({ confirm: true });
        assert.equal(res.status, 200);
        assert.equal(await User.countDocuments({ _id: w.customer.user._id }), 0);
    });
});