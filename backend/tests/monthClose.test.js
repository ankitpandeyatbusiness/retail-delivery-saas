require('./helpers/env');
// Money tab: the month closed, the next 30 days, and the one Excel for the CA.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const SubscriptionInvoice = require('../src/models/SubscriptionInvoice');
const Expense = require('../src/models/Expense');

let token;
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); token = (await f.makeSuperAdmin('root@test.com')).token; });
const auth = () => ({ Authorization: 'Bearer ' + token });
const bin = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };

describe('month close', () => {
    test('summary of the month against the last, GST, what is owed; bad month refused', async () => {
        const w = await f.makeWorld('mc-' + Date.now().toString(36));
        await SubscriptionInvoice.create({ tenantId: w.tenant._id, kind: 'custom', invoiceNo: 'MC/1', issueDate: new Date(), dueDate: new Date(Date.now() + 5 * 86400000), baseAmount: 1000, gstPercent: 18, gstAmount: 180, total: 1180, status: 'paid', paidAt: new Date() });
        await SubscriptionInvoice.create({ tenantId: w.tenant._id, kind: 'custom', invoiceNo: 'MC/2', issueDate: new Date(), dueDate: new Date(Date.now() - 2 * 86400000), baseAmount: 500, gstPercent: 18, gstAmount: 90, total: 590, status: 'pending' });
        await Expense.create({ date: new Date(), category: Expense.schema.path('category').enumValues[0], amountPaise: 30000 });

        const r = await request(app).get('/api/admin/finance/month').set(auth());
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.current.billedPaise, 177000);
        assert.equal(r.body.current.collectedPaise, 118000);
        assert.equal(r.body.current.costsPaise, 30000);
        assert.equal(r.body.gst.toPay, 270);
        assert.equal(r.body.gst.onUnpaidBills, 90);
        assert.equal(r.body.owed.overduePaise, 59000);
        assert.equal(r.body.verdict, 'profit');
        assert.equal((await request(app).get('/api/admin/finance/month?month=nope').set(auth())).status, 400);
    });

    test('next 30 days: rent due soon counted, overdue kept apart', async () => {
        const w = await f.makeWorld('mn-' + Date.now().toString(36));
        await SubscriptionInvoice.create({ tenantId: w.tenant._id, kind: 'custom', invoiceNo: 'MN/1', issueDate: new Date(), dueDate: new Date(Date.now() + 10 * 86400000), baseAmount: 1000, gstPercent: 18, gstAmount: 180, total: 1180, status: 'pending' });
        await SubscriptionInvoice.create({ tenantId: w.tenant._id, kind: 'custom', invoiceNo: 'MN/2', issueDate: new Date(), dueDate: new Date(Date.now() - 4 * 86400000), baseAmount: 500, gstPercent: 18, gstAmount: 90, total: 590, status: 'pending' });
        const r = await request(app).get('/api/admin/finance/next30').set(auth());
        assert.equal(r.status, 200);
        assert.equal(r.body.dueSoon.paise, 118000);
        assert.equal(r.body.dueSoon.bills, 1);
        assert.equal(r.body.overdue.paise, 59000);
        assert.ok(typeof r.body.netEstimatePaise === 'number');
    });

    test('the CA Excel has a sheet each for the summary, bills, SMS top-ups, GST register and expenses', async () => {
        const w = await f.makeWorld('mx-' + Date.now().toString(36));
        await SubscriptionInvoice.create({ tenantId: w.tenant._id, kind: 'custom', invoiceNo: 'MX/1', issueDate: new Date(), dueDate: new Date(Date.now() + 5 * 86400000), baseAmount: 1000, gstPercent: 18, gstAmount: 180, total: 1180, status: 'pending' });
        const x = await request(app).get('/api/admin/finance/month/export').set(auth()).buffer(true).parse(bin);
        assert.equal(x.status, 200);
        assert.match(x.headers['content-type'], /spreadsheetml/);
        const ExcelJS = require('exceljs');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(x.body);
        assert.deepEqual(wb.worksheets.map((s) => s.name), ['Summary', 'Bills issued', 'SMS top-ups', 'GST register', 'Expenses']);
        const bills = wb.getWorksheet('Bills issued');
        const texts = []; bills.eachRow((row) => texts.push(row.values.join('|')));
        assert.ok(texts.some((t) => t.includes('MX/1')), 'the bill is in the sheet');
        assert.equal((await request(app).get('/api/admin/finance/month/export?month=2026-13').set(auth())).status, 400);
    });
});
