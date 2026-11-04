require('./helpers/env');
// The owner's own Export screen: his shop only (or his brand's branches), full phones for his own people, nothing of any other shop.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const ExcelJS = require('exceljs');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Tenant = require('../src/models/Tenant');
const Brand = require('../src/models/Brand');
const Staff = require('../src/models/Staff');

let w; let w2;
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('oe1-' + Date.now().toString(36));
    w2 = await f.makeWorld('oe2-' + Date.now().toString(36));
    await f.makeOrder(w.tenant, w.customer.user, { status: 'delivered' });
    await f.makeOrder(w2.tenant, w2.customer.user, { status: 'delivered' });
    await f.makeOrder(w2.tenant, w2.customer.user, { status: 'cancelled' });
});
const bin = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };
const get = (who, u, q) => request(app).get(u).set(who.headers).query(q || {}).buffer(true).parse(bin);
const API = '/api/shop/exports';

describe('owner export', () => {
    test('the catalog is his own list, with no platform exports', async () => {
        const r = await request(app).get(`${API}/catalog`).set(w.owner.headers);
        assert.equal(r.status, 200);
        const keys = r.body.items.map((i) => i.key);
        for (const k of ['customers', 'orders', 'riders', 'staff', 'branches', 'menu', 'complaints', 'invoices']) assert.ok(keys.includes(k), k);
        for (const k of ['owners', 'shops', 'brand_people', 'sms_sent', 'expenses', 'audit', 'payments', 'refunds']) assert.ok(!keys.includes(k), k);
        assert.equal(r.body.shops.length, 1);
        assert.equal(r.body.items.find((i) => i.key === 'invoices').title, 'Rent bills');
    });

    test('he gets only his own shop: customers, orders and phones', async () => {
        const n = await request(app).get(`${API}/orders/count`).set(w.owner.headers);
        assert.equal(n.body.count, 1);                      // the other shop has 2
        const c = await request(app).get(`${API}/customers/count`).set(w.owner.headers);
        assert.equal(c.body.count, 1);
        const csv = (await get(w.owner, `${API}/customers/download`, { level: 'everything', format: 'csv' })).body.toString();
        assert.match(csv, /Behaviour in words/);
        assert.ok(csv.includes(w.customer.user.phone), 'his own customers show full phone numbers');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load((await get(w.owner, `${API}/orders/download`, { level: 'everything' })).body);
        assert.equal(wb.worksheets[0].name, 'Summary');
    });

    test('another shop is refused, and so is anyone who is not the owner', async () => {
        const r = await request(app).get(`${API}/orders/count`).set(w.owner.headers).query({ shops: String(w2.tenant._id) });
        assert.equal(r.status, 403);
        assert.equal((await request(app).get(`${API}/nonsense/count`).set(w.owner.headers)).status, 404);
        assert.equal((await request(app).get(`${API}/owners/count`).set(w.owner.headers)).status, 404);
        const cs = (await request(app).get(`${API}/customers/count`).set(w.customer.headers)).status;
        assert.ok([401, 403].includes(cs), 'customer got ' + cs);
        const anon = (await request(app).get(`${API}/customers/count`)).status;
        assert.ok([400, 401, 403].includes(anon), 'anonymous got ' + anon);
    });

    test('cooks and waiters of his shop only', async () => {
        const cook = await f.makeUser(w.tenant, 'kitchen', '9000000040');
        const cook2 = await f.makeUser(w2.tenant, 'kitchen', '9000000040');
        await Staff.create({ tenantId: w.tenant._id, userId: cook.user._id, role: 'kitchen', name: 'Ravi' });
        await Staff.create({ tenantId: w2.tenant._id, userId: cook2.user._id, role: 'kitchen', name: 'Other cook' });
        const csv = (await get(w.owner, `${API}/staff/download`, { level: 'everything', format: 'csv' })).body.toString();
        assert.match(csv, /Ravi/);
        assert.ok(!/Other cook/.test(csv));
    });

    test('a brand owner picks among his branches; a plain owner has only his shop in "My shops"', async () => {
        const one = (await get(w.owner, `${API}/branches/download`, { level: 'everything', format: 'csv' })).body.toString();
        assert.match(one, new RegExp(w.tenant.name));
        assert.ok(!new RegExp(w2.tenant.name).test(one));

        const b = await Brand.create({ name: 'Savera Group', ownerPhones: ['9000000010'] });
        await Tenant.updateMany({ _id: { $in: [w.tenant._id, w2.tenant._id] } }, { $set: { brandId: b._id } });
        require('../src/middlewares/tenantRecognizer').invalidateTenant(w.tenant.slug);
        const cat = await request(app).get(`${API}/catalog`).set(w.owner.headers);
        assert.equal(cat.body.shops.length, 2);
        assert.equal((await request(app).get(`${API}/orders/count`).set(w.owner.headers)).body.count, 3);   // all branches
        assert.equal((await request(app).get(`${API}/orders/count`).set(w.owner.headers).query({ shops: String(w2.tenant._id) })).body.count, 2);
        const both = (await get(w.owner, `${API}/branches/download`, { level: 'standard', format: 'csv' })).body.toString();
        assert.match(both, new RegExp(w2.tenant.name));
    });
});
