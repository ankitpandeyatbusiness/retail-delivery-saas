require('./helpers/env');
// The closing report for a range of days: the same numbers plus hours, order types, new and returning customers, lost sales and a comparison.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Order = require('../src/models/Order');

let w;
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); w = await f.makeWorld('cr-' + Date.now().toString(36)); });
const ist = (ms) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
const deliver = async (user, daysAgo, extra = {}) => {
    const o = await f.makeOrder(w.tenant, user, { status: 'delivered', ...extra });
    const at = new Date(Date.now() - daysAgo * 86400000);
    await Order.collection.updateOne({ _id: o._id }, { $set: { deliveredAt: at, createdAt: at } });
    return o;
};
const report = (q) => request(app).get('/api/shop/closing-report').set(w.owner.headers).query(q);

describe('closing report', () => {
    test('one day still works as before, and carries the new parts', async () => {
        await deliver(w.customer.user, 0);
        const r = await report({});
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.sales.orders, 1);
        assert.equal(r.body.range, false);
        assert.ok(Array.isArray(r.body.hours) && r.body.busiest);
        assert.ok(r.body.customers.total === 1 && r.body.customers.new === 1);
        assert.ok('tax' in r.body.sales && 'discounts' in r.body.sales);
    });

    test('a range adds the days up, counts new against returning customers, and compares with the period before', async () => {
        const c2 = await f.makeUser(w.tenant, 'customer', '9000000099');
        await deliver(w.customer.user, 20);          // before the range: makes this customer a returning one
        await deliver(w.customer.user, 2);
        await deliver(c2.user, 1);
        await deliver(c2.user, 0);
        const r = await report({ from: ist(Date.now() - 6 * 86400000), to: ist(Date.now()) });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.range, true);
        assert.equal(r.body.days, 7);
        assert.equal(r.body.sales.orders, 3);
        assert.equal(r.body.customers.total, 2);
        assert.equal(r.body.customers.returning, 1);
        assert.equal(r.body.customers.new, 1);
        assert.equal(r.body.before.orders, 0);
    });

    test('bad ranges are refused', async () => {
        assert.equal((await report({ from: 'x', to: 'y' })).status, 400);
        assert.equal((await report({ from: '2026-11-10', to: '2026-11-01' })).status, 400);
        assert.equal((await report({ from: '2020-01-01', to: '2026-11-01' })).status, 400);
    });
});
