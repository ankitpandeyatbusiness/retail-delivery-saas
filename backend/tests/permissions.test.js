require('./helpers/env');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeWorld, makeOrder, makeTenant } = require('./helpers/factory');

describe('permissions', () => {
    let a;
    let b;
    before(async () => {
        await db.connect();
        a = await makeWorld('shop-aaa');
        b = await makeWorld('shop-bbb');
    });
    after(() => db.disconnect());

    test('no token gives 401', async () => {
        const res = await request(app).get('/api/orders').set('x-tenant-slug', a.tenant.slug);
        assert.equal(res.status, 401);
    });

    test('a customer cannot call owner routes', async () => {
        const res = await request(app).get('/api/shop/orders').set(a.customer.headers);
        assert.equal(res.status, 403);
    });

    test('a rider cannot call owner routes', async () => {
        const res = await request(app).get('/api/shop/orders').set(a.rider.headers);
        assert.equal(res.status, 403);
    });

    test('an owner cannot use the rider app', async () => {
        const res = await request(app).get('/api/rider/orders').set(a.owner.headers);
        assert.equal(res.status, 403);
    });

    test('a shop login token is not a superadmin token', async () => {
        const res = await request(app).get('/api/admin/tenants').set('Authorization', a.owner.headers.Authorization);
        assert.equal(res.status, 401);
    });

    test('a token of shop A does not work on shop B', async () => {
        const res = await request(app).get('/api/orders')
            .set({ Authorization: a.customer.headers.Authorization, 'x-tenant-slug': b.tenant.slug });
        assert.equal(res.status, 403);
    });

    test('the owner of shop A cannot read an order of shop B', async () => {
        const order = await makeOrder(b.tenant, b.customer.user);
        const res = await request(app).get(`/api/shop/orders/${order._id}`).set(a.owner.headers);
        assert.equal(res.status, 404);
        const own = await request(app).get(`/api/shop/orders/${order._id}`).set(b.owner.headers);
        assert.equal(own.status, 200);
    });

    test('a customer cannot read the order of another customer', async () => {
        const other = await makeOrder(a.tenant, a.owner.user);   // bought by the owner
        const res = await request(app).get(`/api/orders/${other._id}`).set(a.customer.headers);
        assert.equal(res.status, 404);
    });

    test('unknown or broken order ids give 404, not 500', async () => {
        const missing = await request(app).get(`/api/orders/${new mongoose.Types.ObjectId()}`).set(a.customer.headers);
        assert.equal(missing.status, 404);
        const broken = await request(app).get('/api/orders/not-an-id').set(a.customer.headers);
        assert.equal(broken.status, 404);
        const shopBroken = await request(app).get('/api/shop/orders/not-an-id').set(a.owner.headers);
        assert.equal(shopBroken.status, 404);
    });

    test('a rider does not see the customer name, phone or full address before accepting', async () => {
        const w = await makeWorld('shop-ccc');
        await makeOrder(w.tenant, w.customer.user, {
            status: 'accepted',
            address: { line1: '12 Secret Street', city: 'Lucknow', pincode: '226001', phone: '9111111111' },
            delivery: {
                riderId: w.rider.user._id, status: 'assigned', offerExpiresAt: new Date(Date.now() + 120000),
                offers: [{ riderId: w.rider.user._id, offeredAt: new Date(), result: 'offered', by: 'owner' }],
            },
        });
        const res = await request(app).get('/api/rider/orders?tab=offered').set(w.rider.headers);
        assert.equal(res.status, 200);
        assert.equal(res.body.items.length, 1);
        assert.equal(res.body.items[0].customer, null);
        const text = JSON.stringify(res.body);
        assert.ok(!text.includes('Secret Street'));
        assert.ok(!text.includes(w.customer.user.phone));
        assert.ok(!text.includes('9111111111'));
    });

    test('a shop that does not exist gives 404 on a login-needed route', async () => {
        await makeTenant('shop-ddd');
        const res = await request(app).get('/api/orders').set({ 'x-tenant-slug': 'shop-zzz-none' });
        assert.equal(res.status, 404);
    });
});