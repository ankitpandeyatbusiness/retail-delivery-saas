require('./helpers/env');
// Sales report: busy hours, order types, new against returning customers, cash still with riders.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Order = require('../src/models/Order');
const CodSettlement = require('../src/models/CodSettlement');

let token;
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); token = (await f.makeSuperAdmin('root@test.com')).token; });
const auth = () => ({ Authorization: 'Bearer ' + token });
const daysAgo = (d) => new Date(Date.now() - d * 86400000);
const range = () => ({ from: daysAgo(10).toISOString(), to: new Date(Date.now() + 60000).toISOString() });

describe('sales patterns', () => {
    test('hours, types, new against returning customers and cash with riders', async () => {
        const w = await f.makeWorld('sp-' + Date.now().toString(36));
        const old = await f.makeOrder(w.tenant, w.customer.user, {});          // he ordered 30 days ago: returning
        await Order.collection.updateOne({ _id: old._id }, { $set: { status: 'delivered', deliveredAt: daysAgo(30) } });
        const a = await f.makeOrder(w.tenant, w.customer.user, {});
        const b = await f.makeOrder(w.tenant, w.customer.user, {});
        const at = new Date(Date.now() - 2 * 86400000); at.setUTCHours(7, 0, 0, 0);   // 12:30 in India
        at.setUTCMinutes(30);
        await Order.collection.updateOne({ _id: a._id }, { $set: { status: 'delivered', deliveredAt: at, orderType: 'delivery', 'pricing.subtotal': 300, 'pricing.packagingCharge': 0, 'pricing.discount': 0 } });
        await Order.collection.updateOne({ _id: b._id }, { $set: { status: 'delivered', deliveredAt: at, orderType: 'pickup', 'pricing.subtotal': 100, 'pricing.packagingCharge': 0, 'pricing.discount': 0 } });
        await CodSettlement.create({ tenantId: w.tenant._id, riderId: w.rider.user._id, type: 'collect', amountPaise: 30000, orderId: a._id });
        await CodSettlement.create({ tenantId: w.tenant._id, riderId: w.rider.user._id, type: 'handover', amountPaise: -10000 });

        const r = await request(app).get('/api/admin/reports/patterns').query(range()).set(auth());
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.hours.length, 24);
        assert.equal(r.body.days.length, 7);
        assert.equal(r.body.peakHour, 13, '07:30 UTC is 13:00 in India');
        assert.equal(r.body.hours[13].orders, 2);
        assert.deepEqual(r.body.types.map((t) => t.type).sort(), ['delivery', 'pickup']);
        assert.equal(r.body.customers.total, 1);
        assert.equal(r.body.customers.returning, 1, 'his first order was 30 days ago');
        assert.equal(r.body.customers.new, 0);
        assert.equal(r.body.cash.paise, 20000);
        assert.equal(r.body.cash.riders, 1);
        assert.equal(r.body.cash.top[0].shopName, w.tenant.name);
        assert.equal((await request(app).get('/api/admin/reports/patterns').query({ tenantId: 'x' }).set(auth())).status, 400);
    });
});
