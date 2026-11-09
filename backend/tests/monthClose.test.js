require('./helpers/env');
// Money tab: the month closed, the next 30 days, and the one Excel for the CA.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const { paidPlan } = require('./helpers/planPay');
const Expense = require('../src/models/Expense');

let token;
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); token = (await f.makeSuperAdmin('root@test.com')).token; });
const auth = () => ({ Authorization: 'Bearer ' + token });
const bin = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };

describe('month close', () => {
    test('summary of the month against the last, GST; bad month refused', async () => {
        const w = await f.makeWorld('mc-' + Date.now().toString(36));
        await paidPlan(w.tenant._id, { baseRs: 1000, invoiceNo: 'MC/1' });
        await Expense.create({ date: new Date(), category: Expense.schema.path('category').enumValues[0], amountPaise: 30000 });

        const r = await request(app).get('/api/admin/finance/month').set(auth());
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.current.billedPaise, 118000);
        assert.equal(r.body.current.collectedPaise, 118000);
        assert.equal(r.body.current.costsPaise, 30000);
        assert.equal(r.body.gst.toPay, 180);
        assert.equal(r.body.owed.overduePaise, 0);
        assert.equal(r.body.verdict, 'profit');
        assert.equal((await request(app).get('/api/admin/finance/month?month=nope').set(auth())).status, 400);
    });

    test('next 30 days: everything is prepaid, so nothing falls due and nothing is overdue', async () => {
        const r = await request(app).get('/api/admin/finance/next30').set(auth());
        assert.equal(r.status, 200);
        assert.equal(r.body.dueSoon.paise, 0);
        assert.equal(r.body.overdue.paise, 0);
        assert.ok(typeof r.body.netEstimatePaise === 'number');
    });

    test('the CA Excel has a sheet each for the summary, bills, SMS top-ups, GST register and expenses', async () => {
        const w = await f.makeWorld('mx-' + Date.now().toString(36));
        await paidPlan(w.tenant._id, { baseRs: 1000, invoiceNo: 'MX/1' });
        const x = await request(app).get('/api/admin/finance/month/export').set(auth()).buffer(true).parse(bin);
        assert.equal(x.status, 200);
        assert.match(x.headers['content-type'], /spreadsheetml/);
        const ExcelJS = require('exceljs');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(x.body);
        assert.deepEqual(wb.worksheets.map((s) => s.name), ['Summary', 'Payments received', 'SMS top-ups', 'GST register', 'Expenses']);
        const bills = wb.getWorksheet('Payments received');
        const texts = []; bills.eachRow((row) => texts.push(row.values.join('|')));
        assert.ok(texts.some((t) => t.includes('MX/1')), 'the bill is in the sheet');
        assert.equal((await request(app).get('/api/admin/finance/month/export?month=2026-13').set(auth())).status, 400);
    });
});
