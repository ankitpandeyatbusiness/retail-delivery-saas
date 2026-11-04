require('./helpers/env');
// Superadmin: customers of every shop in one list (with what they did), the Excel of it, and full phone numbers for the supreme admin only.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Order = require('../src/models/Order');
const AuditLog = require('../src/models/AuditLog');
const User = require('../src/models/User');

let token;
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); token = (await f.makeSuperAdmin('root@test.com')).token; });
const auth = (t = token) => ({ Authorization: 'Bearer ' + t });

describe('admin customers', () => {
    test('lists every shop\'s customers with their numbers, filters, sorts and masks the phone', async () => {
        const a = await f.makeWorld('ca-' + Date.now().toString(36));
        const b = await f.makeWorld('cb-' + Date.now().toString(36));
        const o1 = await f.makeOrder(a.tenant, a.customer.user, {});
        const o2 = await f.makeOrder(a.tenant, a.customer.user, {});
        await Order.collection.updateOne({ _id: o1._id }, { $set: { status: 'delivered', 'pricing.total': 500 } });
        await Order.collection.updateOne({ _id: o2._id }, { $set: { status: 'cancelled', cancelledBy: 'customer' } });

        let r = await request(app).get('/api/admin/customers').set(auth());
        assert.equal(r.status, 200);
        assert.equal(r.body.total, 2);
        assert.equal(r.body.items[0].spent, 500, 'biggest spender first');
        assert.equal(r.body.items[0].orders, 2);
        assert.equal(r.body.items[0].cancelled, 1);
        assert.match(r.body.items[0].phone, /^\d{2}X+\d{2}$/, 'masked');
        assert.equal(r.body.fullPhones, false);
        const never = r.body.items.find((x) => x.orders === 0);
        assert.ok(never, 'a customer who never ordered is listed too');

        r = await request(app).get('/api/admin/customers?tenantId=' + b.tenant._id).set(auth());
        assert.equal(r.body.total, 1);
        assert.equal(r.body.items[0].shopName, b.tenant.name);
        r = await request(app).get('/api/admin/customers?sort=joined').set(auth());
        assert.equal(r.status, 200);
        assert.equal((await request(app).get('/api/admin/customers?tenantId=nope').set(auth())).status, 400);
    });

    test('full phones: supreme admin only, and every look and download is written down', async () => {
        const a = await f.makeWorld('cf-' + Date.now().toString(36));
        const ordinary = (await f.makeSuperAdmin('other@test.com', { phones: [] })).token;
        const phone = (await User.findOne({ _id: a.customer.user._id }).lean()).phone;

        let r = await request(app).get('/api/admin/customers?full=1').set(auth(ordinary));
        assert.equal(r.status, 403);
        r = await request(app).get('/api/admin/customers/export?full=1').set(auth(ordinary));
        assert.equal(r.status, 403);

        r = await request(app).get('/api/admin/customers?full=1').set(auth());
        assert.equal(r.status, 200);
        assert.equal(r.body.fullPhones, true);
        assert.ok(r.body.items.some((x) => x.phone === phone));
        await new Promise((ok) => setTimeout(ok, 200));
        assert.equal(await AuditLog.countDocuments({ action: 'SEE FULL CUSTOMER PHONES' }), 1);

        const x = await request(app).get('/api/admin/customers/export?full=1').set(auth()).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
        assert.equal(x.status, 200);
        assert.match(x.headers['content-type'], /spreadsheetml/);
        assert.ok(x.body.length > 1000);
        await new Promise((ok) => setTimeout(ok, 200));
        assert.equal(await AuditLog.countDocuments({ action: 'DOWNLOAD CUSTOMERS WITH FULL PHONES' }), 1);

        const masked = await request(app).get('/api/admin/customers/export').set(auth(ordinary)).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
        assert.equal(masked.status, 200, 'anyone may download the masked list');
    });
});
