require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');

// Phase 3 of the owner panel: the owner reads the delivery rules he can change.
let w;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('rider-shop');
    tenantRecognizer.invalidateTenant('rider-shop');
});
const api = (m, path, body) => request(app)[m](`/api/shop${path}`).set(w.owner.headers).send(body);

describe('GET /settings', () => {
    test('gives the delivery rules and the cash limit, with defaults filled in', async () => {
        const r = await api('get', '/settings');
        assert.equal(r.status, 200);
        assert.equal(r.body.riders.assignMode, 'automatic');
        assert.equal(r.body.riders.payPerDelivery, 0);
        assert.equal(r.body.riders.maxActiveOrders, 3);
        assert.equal(r.body.orders.codCap.amount, 1000);
    });

    test('shows what the owner saved', async () => {
        const put = await api('put', '/settings', { riders: { assignMode: 'manual', payPerDelivery: 30, maxActiveOrders: 2 }, orders: { codCap: { amount: 500 } } });
        assert.equal(put.status, 200);
        const r = await api('get', '/settings');
        assert.equal(r.body.riders.assignMode, 'manual');
        assert.equal(r.body.riders.payPerDelivery, 30);
        assert.equal(r.body.riders.maxActiveOrders, 2);
        assert.equal(r.body.orders.codCap.amount, 500);
        assert.equal(r.body.orders.codCap.firstOrders, 3, 'what was not sent stays');
    });

    test('a customer cannot read it', async () => {
        const r = await request(app).get('/api/shop/settings').set(w.customer.headers);
        assert.ok([401, 403].includes(r.status));
    });
});
