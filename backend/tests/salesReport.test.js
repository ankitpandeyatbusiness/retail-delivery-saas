require('./helpers/env');
// Sales report: this period against the one right before it, and each shop marked growing, falling, quiet or new.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Order = require('../src/models/Order');

let token;
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); token = (await f.makeSuperAdmin('root@test.com')).token; });
const auth = () => ({ Authorization: 'Bearer ' + token });
const daysAgo = (d) => new Date(Date.now() - d * 86400000);

async function sold(world, when, amount = 500) {
    const o = await f.makeOrder(world.tenant, world.customer.user, {});
    await Order.collection.updateOne({ _id: o._id }, { $set: { status: 'delivered', deliveredAt: when, 'pricing.subtotal': amount, 'pricing.packagingCharge': 0, 'pricing.discount': 0 } });
}

describe('sales report compare', () => {
    test('previous period, change in percent and the trend of each shop', async () => {
        const a = await f.makeWorld('sa-' + Date.now().toString(36));
        const b = await f.makeWorld('sb-' + Date.now().toString(36));
        const c = await f.makeWorld('sc-' + Date.now().toString(36));
        await sold(a, daysAgo(2)); await sold(a, daysAgo(3));     // now: 1000
        await sold(a, daysAgo(14));                                // before: 500  -> up 100%, growing
        await sold(b, daysAgo(15));                                // before only -> quiet
        await sold(c, daysAgo(1));                                 // now only -> new

        const from = daysAgo(10).toISOString();
        const r = await request(app).get('/api/admin/reports/sales').query({ from, to: new Date().toISOString() }).set(auth());
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.totals.revenue, 1500);
        assert.equal(r.body.previous.totals.revenue, 1000);
        assert.equal(r.body.previous.change.revenue, 50);
        assert.equal(r.body.previous.change.orders, 50);
        const by = new Map(r.body.shops.map((s) => [s.name, s]));
        assert.equal(by.get(a.tenant.name).trend, 'growing');
        assert.equal(by.get(a.tenant.name).changePct, 100);
        assert.equal(by.get(b.tenant.name).trend, 'quiet');
        assert.equal(by.get(b.tenant.name).revenue, 0);
        assert.equal(by.get(c.tenant.name).trend, 'new');
        assert.equal(by.get(c.tenant.name).changePct, null);

        const one = await request(app).get('/api/admin/reports/sales').query({ from, to: new Date().toISOString(), tenantId: String(a.tenant._id) }).set(auth());
        assert.equal(one.body.previous.change.revenue, 100);
    });

    test('the whole report downloads as one Excel file with a sheet each', async () => {
        const a = await f.makeWorld('sx-' + Date.now().toString(36));
        await sold(a, daysAgo(2));
        const from = daysAgo(10).toISOString();
        const x = await request(app).get('/api/admin/reports/sales/export').query({ from, to: new Date().toISOString() }).set(auth()).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
        assert.equal(x.status, 200);
        assert.match(x.headers['content-type'], /spreadsheetml/);
        const ExcelJS = require('exceljs');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(x.body);
        assert.deepEqual(wb.worksheets.map((w) => w.name), ['Summary', 'By day', 'By shop', 'Best items', 'Sales lost', 'By hour', 'By weekday']);
        const one = await request(app).get('/api/admin/reports/sales/export').query({ from, to: new Date().toISOString(), tenantId: String(a.tenant._id) }).set(auth()).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
        const wb2 = new ExcelJS.Workbook();
        await wb2.xlsx.load(one.body);
        assert.ok(!wb2.worksheets.some((w) => w.name === 'By shop'), 'one shop has no by-shop sheet');
    });
});
