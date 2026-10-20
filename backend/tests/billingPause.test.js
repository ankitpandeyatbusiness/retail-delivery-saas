require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const smsChannel = require('../src/notifications/channels/sms');
const pushChannel = require('../src/notifications/channels/push');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const { makeWorld, makeOrder, makeSuperAdmin } = require('./helpers/factory');

// B8. While a shop is paused for unpaid rent these stay OPEN...
const OPEN = [
    '/api/shop/orders', '/api/shop/riders', '/api/shop/riders/locations', '/api/shop/cod/riders',
    '/api/shop/sms/wallet', '/api/shop/activity', '/api/shop/reports/sales',
    '/api/shop/billing/status', '/api/shop/subscription/invoices', '/api/shop/notifications',
];
// ...and these are CLOSED
const CLOSED = [
    ['get', '/api/shop/categories'],
    ['post', '/api/shop/products', {}],
    ['put', '/api/shop/settings', { phone: '9000000050' }],
    ['put', '/api/shop/accepting-orders', { acceptingOrders: true }],
    ['post', '/api/shop/uploads/sign', { kind: 'logo', contentType: 'image/png', bytes: 1000 }],
];

const call = (headers, [method, path, body]) => {
    const r = request(app)[method](path).set(headers);
    return body === undefined ? r : r.send(body);
};

async function worldWith(slug, billingOrTenantFields) {
    const w = await makeWorld(slug);
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: billingOrTenantFields });   // before the first request, so no old copy is cached
    return w;
}

describe('rent pause: what stays open and what closes', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(() => {
        mock.method(smsChannel, 'send', async () => ({ sent: false }));
        mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
    });
    afterEach(() => mock.restoreAll());

    test('the open routes answer 200 while the shop is paused', async () => {
        const w = await worldWith('pause-open', { 'billing.state': 'paused' });
        for (const path of OPEN) {
            const res = await request(app).get(path).set(w.owner.headers);
            assert.equal(res.status, 200, `${path} should stay open`);
        }
    });

    test('the closed routes answer 403 "paused" while the shop is paused', async () => {
        const w = await worldWith('pause-closed', { 'billing.state': 'paused' });
        for (const route of CLOSED) {
            const res = await call(w.owner.headers, route);
            assert.equal(res.status, 403, `${route[0]} ${route[1]} should be closed`);
            assert.equal(res.body.paused, true, `${route[1]}`);
        }
    });

    test('the owner can still finish an order while the shop is paused', async () => {
        const w = await worldWith('pause-finish', { 'billing.state': 'paused' });
        const order = await makeOrder(w.tenant, w.customer.user, { status: 'ready', orderType: 'pickup' });
        const res = await request(app).patch(`/api/shop/orders/${order._id}/status`).set(w.owner.headers).send({ status: 'delivered', skipCode: true });   // a pickup is handed over with its code, or without it on purpose
        assert.equal(res.status, 200);
        assert.equal((await Order.findById(order._id)).status, 'delivered');
    });

    test('the invoice of a delivered order can be downloaded while the shop is paused', async () => {
        const w = await worldWith('pause-invoice', { 'billing.state': 'paused' });
        const order = await makeOrder(w.tenant, w.customer.user, { status: 'delivered', deliveredAt: new Date() });
        const res = await request(app).get(`/api/shop/orders/${order._id}/invoice`).set(w.owner.headers);
        assert.equal(res.status, 200);
        assert.match(res.headers['content-type'], /application\/pdf/);
        const pending = await makeOrder(w.tenant, w.customer.user, { status: 'preparing' });
        assert.equal((await request(app).get(`/api/shop/orders/${pending._id}/invoice`).set(w.owner.headers)).status, 409);
        assert.equal((await request(app).get('/api/shop/orders/not-an-id/invoice').set(w.owner.headers)).status, 404);
    });

    test('a shop that is NOT paused can use the closed routes too', async () => {
        const w = await makeWorld('pause-not');
        assert.equal((await request(app).get('/api/shop/categories').set(w.owner.headers)).status, 200);
        assert.equal((await request(app).get('/api/shop/riders').set(w.owner.headers)).status, 200);
        const res = await request(app).put('/api/shop/settings').set(w.owner.headers).send({ phone: '9000000050' });
        assert.equal(res.status, 200);
    });

    test('when the superadmin blocks the owner panel, the riders routes close too (the rent pause does not do that)', async () => {
        const w = await worldWith('pause-blocked', { ownerBlocked: true });
        const riders = await request(app).get('/api/shop/riders').set(w.owner.headers);
        assert.equal(riders.status, 403);
        assert.equal(riders.body.blocked, true);
        assert.equal((await request(app).get('/api/shop/categories').set(w.owner.headers)).status, 403);
    });

    test('the superadmin is never closed out of a paused shop', async () => {
        const w = await worldWith('pause-admin', { 'billing.state': 'paused' });
        const { token } = await makeSuperAdmin('pause-admin@example.com');
        const auth = { Authorization: `Bearer ${token}` };
        for (const path of ['/shop/riders', '/shop/categories', '/shop/cod/riders', '/shop/reports/sales']) {
            const res = await request(app).get(`/api/admin/tenants/${w.tenant._id}${path}`).set(auth);
            assert.equal(res.status, 200, path);
        }
    });

    test('a customer or a rider still cannot use the open owner routes', async () => {
        const w = await worldWith('pause-roles', { 'billing.state': 'paused' });
        assert.equal((await request(app).get('/api/shop/riders').set(w.customer.headers)).status, 403);
        assert.equal((await request(app).get('/api/shop/cod/riders').set(w.rider.headers)).status, 403);
        assert.equal((await request(app).get('/api/shop/reports/sales')).status, 400);   // no shop header: refused before anything else
    });
});