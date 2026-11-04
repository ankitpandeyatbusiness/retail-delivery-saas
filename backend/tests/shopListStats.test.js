require('./helpers/env');
// The Shops list: orders today, last order, rent owed, quiet shops and brand names, in one call.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Tenant = require('../src/models/Tenant');
const Brand = require('../src/models/Brand');
const SubscriptionInvoice = require('../src/models/SubscriptionInvoice');

let token;
const day = 86400000;
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); token = (await f.makeSuperAdmin('root@test.com')).token; });

describe('shops list stats', () => {
    test('orders today, owed rent (overdue apart), quiet shops and the brand name', async () => {
        const a = await f.makeWorld('ls-a-' + Date.now().toString(36));
        const b = await f.makeWorld('ls-b-' + Date.now().toString(36));
        const brand = await Brand.create({ name: 'Savera' });
        await Tenant.updateOne({ _id: a.tenant._id }, { $set: { brandId: brand._id, 'billing.isLive': true, 'billing.goLiveAt': new Date(Date.now() - 40 * day) } });
        await Tenant.updateOne({ _id: b.tenant._id }, { $set: { 'billing.isLive': true, 'billing.goLiveAt': new Date(Date.now() - 20 * day) } });
        await f.makeOrder(a.tenant, a.customer.user, {});
        await f.makeOrder(a.tenant, a.customer.user, {});
        await SubscriptionInvoice.create({ tenantId: a.tenant._id, kind: 'custom', invoiceNo: 'LS/1', issueDate: new Date(Date.now() - 10 * day), dueDate: new Date(Date.now() - 3 * day), baseAmount: 1000, gstPercent: 18, gstAmount: 180, total: 1180, status: 'pending' });
        await SubscriptionInvoice.create({ tenantId: a.tenant._id, kind: 'custom', invoiceNo: 'LS/2', issueDate: new Date(), dueDate: new Date(Date.now() + 5 * day), baseAmount: 500, gstPercent: 18, gstAmount: 90, total: 590, status: 'pending' });

        const r = await request(app).get('/api/admin/tenants').set({ Authorization: 'Bearer ' + token });
        assert.equal(r.status, 200);
        const sa = r.body.items.find((x) => String(x._id) === String(a.tenant._id)).stats;
        const sb = r.body.items.find((x) => String(x._id) === String(b.tenant._id)).stats;
        assert.equal(sa.ordersToday, 2);
        assert.ok(sa.lastOrderAt);
        assert.equal(sa.owed, 1770);
        assert.equal(sa.overdue, 1180);
        assert.equal(sa.bills, 2);
        assert.equal(sa.brandName, 'Savera');
        assert.equal(sa.quiet, false, 'it had an order today');
        assert.equal(sb.quiet, true, 'live for 20 days and no order');
        assert.equal(sb.owed, 0);
        assert.equal(sb.brandName, null);
    });
});
