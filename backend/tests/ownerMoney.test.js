require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const ExcelJS = require('exceljs');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');

// Phase 4 of the owner panel: the sales Excel file.
let w;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('money-shop');
    tenantRecognizer.invalidateTenant('money-shop');
});

const binary = (res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); };
const get = (path, headers = w.owner.headers) => request(app).get(`/api/shop${path}`).set(headers).buffer(true).parse(binary);

describe('GET /reports/export', () => {
    test('gives an Excel file with orders, days and items', async () => {
        await f.makeOrder(w.tenant, w.customer.user, { status: 'delivered', deliveredAt: new Date(), pricing: { subtotal: 200, discount: 20, packagingCharge: 10, total: 190 } });
        await f.makeOrder(w.tenant, w.customer.user, { status: 'cancelled' });
        const r = await get('/reports/export');
        assert.equal(r.status, 200);
        assert.match(r.headers['content-type'], /spreadsheetml/);
        assert.match(r.headers['content-disposition'], /sales-\d{4}-\d{2}-\d{2}-to-/);

        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(r.body);
        assert.deepEqual(wb.worksheets.map((s) => s.name), ['Orders', 'Sales by day', 'Items sold']);
        assert.equal(wb.getWorksheet('Orders').rowCount, 3, 'header + 2 orders');
        const days = wb.getWorksheet('Sales by day');
        assert.equal(days.getRow(2).getCell(2).value, 1, 'only the delivered one counts as sales');
        assert.equal(days.getRow(2).getCell(3).value, 190);
        assert.equal(wb.getWorksheet('Items sold').getRow(2).getCell(1).value, 'Test item');
    });

    test('keeps spreadsheet formulas out of cells and another shop out of the file', async () => {
        await f.makeOrder(w.tenant, w.customer.user, { customer: { name: '=HYPERLINK("x")', phone: '9000000030' } });
        const other = await f.makeWorld('money-other');
        await f.makeOrder(other.tenant, other.customer.user);
        const r = await get('/reports/export');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(r.body);
        const orders = wb.getWorksheet('Orders');
        assert.equal(orders.rowCount, 2);
        assert.equal(orders.getRow(2).getCell(6).value, "'=HYPERLINK(\"x\")");
    });

    test('a bad date is refused and a customer cannot download it', async () => {
        assert.equal((await get('/reports/export?from=nope')).status, 400);
        assert.ok([401, 403].includes((await get('/reports/export', w.customer.headers)).status));
    });
});
