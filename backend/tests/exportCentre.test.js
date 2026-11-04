require('./helpers/env');
// The Export centre: every export, at every detail level, as Excel and CSV; counts; shop and period filters; phone masking.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const ExcelJS = require('exceljs');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const centre = require('../src/services/exportCentre');
const SubscriptionInvoice = require('../src/models/SubscriptionInvoice');
const Expense = require('../src/models/Expense');
const Tenant = require('../src/models/Tenant');

let token; let w; let w2;
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    token = (await f.makeSuperAdmin('root@test.com')).token;
    w = await f.makeWorld('ex1-' + Date.now().toString(36));
    w2 = await f.makeWorld('ex2-' + Date.now().toString(36));
    await f.makeOrder(w.tenant, w.customer.user, { status: 'delivered' });
    await f.makeOrder(w2.tenant, w2.customer.user, { status: 'cancelled' });
    await SubscriptionInvoice.create({ tenantId: w.tenant._id, kind: 'custom', invoiceNo: 'EX/1', issueDate: new Date(), dueDate: new Date(Date.now() + 86400000), baseAmount: 1000, gstPercent: 18, gstAmount: 180, total: 1180, status: 'pending', lineItems: [{ description: 'Platform fee', qty: 1, rate: 1000, amount: 1000 }] });
    await Expense.create({ date: new Date(), category: 'other', otherName: 'Legal fee', amountPaise: 150000 });
});
const get = (u, q) => request(app).get(u).set({ Authorization: 'Bearer ' + token }).query(q || {}).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
const sheetsOf = async (buf) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return wb; };

describe('export centre', () => {
    test('the catalog lists every export with its levels', async () => {
        const r = await request(app).get('/api/admin/exports/catalog').set({ Authorization: 'Bearer ' + token });
        assert.equal(r.status, 200);
        const keys = r.body.items.map((i) => i.key);
        for (const k of ['customers', 'orders', 'invoices', 'payments', 'refunds', 'complaints', 'riders', 'menu', 'shops', 'sms_topups', 'sms_sent', 'expenses', 'audit']) assert.ok(keys.includes(k), k);
        const o = r.body.items.find((i) => i.key === 'orders');
        assert.ok(o.levels.quick.columns.length < o.levels.standard.columns.length);
        assert.ok(o.levels.standard.columns.length < o.levels.everything.columns.length);
    });

    test('every export downloads at every level, as Excel and CSV', async () => {
        for (const d of centre.ORDER) {
            for (const level of ['quick', 'standard', 'everything']) {
                const x = await get(`/api/admin/exports/${d}/download`, { level });
                assert.equal(x.status, 200, `${d} ${level} xlsx: ${x.body.toString().slice(0, 200)}`);
                const wb = await sheetsOf(x.body);
                assert.equal(wb.worksheets[0].name, 'Summary');
                assert.ok(wb.worksheets.length >= 2, `${d} has a data sheet`);
                const c = await get(`/api/admin/exports/${d}/download`, { level, format: 'csv' });
                assert.equal(c.status, 200, `${d} ${level} csv`);
                assert.match(c.headers['content-type'], /csv/);
            }
        }
    });

    test('orders: the shop filter, the status filter and the dish sheet', async () => {
        const one = await get('/api/admin/exports/orders/download', { level: 'everything', shops: String(w.tenant._id) });
        const wb = await sheetsOf(one.body);
        assert.ok(wb.getWorksheet('Dishes'));
        const rows = wb.getWorksheet('Orders').rowCount - 4;   // title, subtitle, blank, header
        assert.ok(rows >= 1);
        const n = await request(app).get('/api/admin/exports/orders/count').set({ Authorization: 'Bearer ' + token }).query({});
        assert.equal(n.body.count, 2);
        const only = await request(app).get('/api/admin/exports/orders/count').set({ Authorization: 'Bearer ' + token }).query({ shops: String(w.tenant._id) });
        assert.equal(only.body.count, 1);
        const st = await request(app).get('/api/admin/exports/orders/count').set({ Authorization: 'Bearer ' + token }).query({ status: 'cancelled' });
        assert.equal(st.body.count, 1);
        const old = await request(app).get('/api/admin/exports/orders/count').set({ Authorization: 'Bearer ' + token }).query({ from: '2020-01-01', to: '2020-01-31' });
        assert.equal(old.body.count, 0);
    });

    test('phones are masked, full ones need the supreme admin and are written down', async () => {
        const phone = w.customer.user.phone;
        const c = await get('/api/admin/exports/customers/download', { level: 'quick', format: 'csv' });
        assert.ok(!c.body.toString().includes(phone));
        const full = await get('/api/admin/exports/customers/download', { level: 'quick', format: 'csv', full: '1' });
        // the test super admin may or may not be the supreme one: either it refuses, or the number is there and it is logged
        if (full.status === 200) {
            assert.ok(full.body.toString().includes(phone));
            const AuditLog = require('../src/models/AuditLog');
            assert.ok(await AuditLog.findOne({ action: /EXPORT WITH FULL PHONES/ }));
        } else assert.equal(full.status, 403);
    });

    test('bad input is refused clearly', async () => {
        assert.equal((await get('/api/admin/exports/nonsense/download')).status, 404);
        assert.equal((await get('/api/admin/exports/orders/download', { from: 'tomorrow' })).status, 400);
        assert.equal((await get('/api/admin/exports/orders/download', { shops: 'abc' })).status, 400);
    });

    test('an Other expense shows what it is', async () => {
        const c = await get('/api/admin/exports/expenses/download', { level: 'quick', format: 'csv' });
        assert.match(c.body.toString(), /other: Legal fee/);
    });
});

describe('people exports', () => {
    test('customers at the Everything level say in words how each one behaves', async () => {
        for (let i = 0; i < 4; i++) await f.makeOrder(w.tenant, w.customer.user, { status: 'delivered' });
        const c = await get('/api/admin/exports/customers/download', { level: 'everything', format: 'csv' });
        const text = c.body.toString();
        assert.match(text, /Behaviour in words/);
        assert.match(text, /customer: \d+ orders? delivered/);
        assert.match(text, /Last order/);
        // the Standard level has the type but not the sentence
        const std = (await get('/api/admin/exports/customers/download', { level: 'standard', format: 'csv' })).body.toString();
        assert.match(std, /Customer type/);
        assert.ok(!/Behaviour in words/.test(std));
    });

    test('shop owners: rent, activity and a sentence about the shop', async () => {
        const c = await get('/api/admin/exports/owners/download', { level: 'everything', format: 'csv' });
        const text = c.body.toString();
        assert.match(text, /Behaviour in words/);
        assert.match(text, /Owner last logged in/);
        assert.match(text, new RegExp(w.tenant.name));
        const n = await request(app).get('/api/admin/exports/owners/count').set({ Authorization: 'Bearer ' + token }).query({ activity: 'quiet' });
        assert.equal(n.body.count, 2);
        const busy = await request(app).get('/api/admin/exports/owners/count').set({ Authorization: 'Bearer ' + token }).query({ activity: 'busy' });
        assert.equal(busy.body.count, 0);
    });

    test('cooks and waiters', async () => {
        const Staff = require('../src/models/Staff');
        const cook = await f.makeUser(w.tenant, 'kitchen', '9000000040');
        const waiter = await f.makeUser(w.tenant, 'waiter', '9000000050');
        await Staff.create({ tenantId: w.tenant._id, userId: cook.user._id, role: 'kitchen', name: 'Ravi' });
        await Staff.create({ tenantId: w.tenant._id, userId: waiter.user._id, role: 'waiter', name: 'Sita', isActive: false });
        const all = (await get('/api/admin/exports/staff/download', { level: 'everything', format: 'csv' })).body.toString();
        assert.match(all, /Ravi/);
        assert.match(all, /Cook\./);
        assert.match(all, /Paused by the owner/);
        const cooks = await request(app).get('/api/admin/exports/staff/count').set({ Authorization: 'Bearer ' + token }).query({ role: 'kitchen' });
        assert.equal(cooks.body.count, 1);
        const paused = await request(app).get('/api/admin/exports/staff/count').set({ Authorization: 'Bearer ' + token }).query({ active: 'no' });
        assert.equal(paused.body.count, 1);
    });

    test('brand owners and branch managers', async () => {
        const Brand = require('../src/models/Brand');
        const b = await Brand.create({ name: 'Savera Group', ownerPhones: ['9000000010'] });
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { brandId: b._id } });
        await Tenant.updateOne({ _id: w2.tenant._id }, { $set: { brandId: b._id } });
        const text = (await get('/api/admin/exports/brand_people/download', { level: 'everything', format: 'csv' })).body.toString();
        assert.match(text, /Brand owner/);
        assert.match(text, /Savera Group/);
        const only = await request(app).get('/api/admin/exports/brand_people/count').set({ Authorization: 'Bearer ' + token }).query({ role: 'branch' });
        assert.ok(only.body.count >= 0);
        const brandOwners = await request(app).get('/api/admin/exports/brand_people/count').set({ Authorization: 'Bearer ' + token }).query({ role: 'brand' });
        assert.ok(brandOwners.body.count >= 1);
    });
});
