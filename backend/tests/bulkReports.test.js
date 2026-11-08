require('./helpers/env');
// Bulk orders must be inside the reports, the money lists, the Excel files and the searches, not only inside their own screens.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeWorld } = require('./helpers/factory');
const BulkOrder = require('../src/models/BulkOrder');
const BulkPayment = require('../src/models/BulkPayment');
const { salesReport } = require('../src/services/reportService');
const ledger = require('../src/services/moneyLedger');
const exportCentre = require('../src/services/exportCentre');
const salesExport = require('../src/services/salesExport');
const moneySearch = require('../src/services/moneySearch');
const shopMoney = require('../src/services/shopMoney');

const oid = () => new mongoose.Types.ObjectId();

describe('bulk orders are in the reports, the money lists, the exports and the searches', () => {
    let w; let bulk; let pay; let advanceAt; let deliveredAt;
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(async () => {
        await db.clear();
        w = await makeWorld(`bulkrep-${Date.now()}`);
        advanceAt = new Date(Date.now() - 3 * 3600000);
        deliveredAt = new Date(Date.now() - 3600000);
        const line = { productId: oid(), name: 'Dal', quantity: 100, unitPrice: 100, lineTotal: 10000 };
        const pricing = { subtotal: 10000, discount: 0, deliveryFee: 0, packagingCharge: 0, tax: 0, total: 10000 };
        pay = await BulkPayment.create({
            tenantId: w.tenant._id, userId: w.customer.user._id, bulkId: oid(), kind: 'advance', quoteVersion: 1, mode: 'test', rzpOrderId: `order_${Date.now()}`, rzpPaymentId: 'pay_bulkrep_1',
            amountPaise: 500000, status: 'captured', capturedAt: advanceAt,
        });
        bulk = await BulkOrder.create({
            _id: pay.bulkId, tenantId: w.tenant._id, userId: w.customer.user._id, code: 'B7K2QX', fulfilment: 'pickup', when: new Date(Date.now() + 86400000),
            contact: { name: 'Raj', phone: '9000000051' }, lines: [line], pricing, status: 'delivered',
            quote: { version: 1, lines: [line], pricing, advancePercent: 50, advancePaise: 500000, balancePaise: 500000 },
            payment: { advancePaise: 500000, advancePaymentId: pay._id, paidAt: advanceAt, balancePaid: true, balancePaise: 500000, balanceVia: 'cash' },
            stageAt: { delivered: deliveredAt },
        });
    });

    test('the sales report counts a delivered bulk order, and says how much of the sales is bulk', async () => {
        const r = await salesReport({ tenantId: w.tenant._id, from: new Date(Date.now() - 86400000), to: new Date() });
        assert.equal(r.totals.orders, 1);
        assert.equal(r.totals.revenue, 10000);
        assert.deepEqual([r.bulk.orders, r.bulk.revenue, r.bulk.sharePct], [1, 10000, 100]);
        assert.equal(r.series.reduce((n, d) => n + d.revenue, 0), 10000, 'and its day shows it');
    });

    test('the money list has the advance (and a refund) of a bulk order, with its code', async () => {
        const f = ledger.parseQuery({}, { view: 'shop' });
        let r = await ledger.list({ view: 'shop', tenantId: w.tenant._id, filter: f });
        const row = r.items.find((i) => i.ref === 'pay_bulkrep_1');
        assert.ok(row, 'the advance is in the list');
        assert.deepEqual([row.direction, row.amountPaise, row.bulk?.code], ['in', 500000, 'B7K2QX']);
        assert.equal(r.totals.inPaise, 500000);
        await BulkPayment.updateOne({ _id: pay._id }, { $set: { refund: { status: 'refunded', amountPaise: 200000, refundId: 'rfnd_1', at: new Date() } } });
        r = await ledger.list({ view: 'shop', tenantId: w.tenant._id, filter: f });
        assert.equal(r.items.find((i) => i.ref === 'rfnd_1')?.bulk?.code, 'B7K2QX');
        assert.equal(r.totals.netPaise, 300000);
    });

    test('the Transactions tab lists the bulk advance and its refund with the bulk code, and finds them by that code', async () => {
        let r = await shopMoney.list({ tenantId: w.tenant._id, filter: shopMoney.parseQuery({}) });
        const row = r.items.find((i) => i.ref === 'pay_bulkrep_1');
        assert.ok(row, 'the advance is in the list');
        assert.deepEqual([row.category, row.direction, row.amountPaise, row.bulk?.code, row.note], ['online', 'in', 500000, 'B7K2QX', 'Advance']);
        await BulkPayment.updateOne({ _id: pay._id }, { $set: { refund: { status: 'refunded', amountPaise: 150000, refundId: 'rfnd_3', at: new Date() } } });
        r = await shopMoney.list({ tenantId: w.tenant._id, filter: shopMoney.parseQuery({ q: 'b7k2qx' }) });
        assert.deepEqual(r.items.map((i) => [i.category, i.amountPaise, i.bulk.code]).sort(), [['online', 500000, 'B7K2QX'], ['refund_online', 150000, 'B7K2QX']]);
        assert.equal(r.totals.netPaise, 350000);
        r = await shopMoney.list({ tenantId: w.tenant._id, filter: shopMoney.parseQuery({ q: 'ZZZZZZ' }) });
        assert.equal(r.items.length, 0, 'another code finds nothing');
    });

    test('the online payments report of the owner includes the bulk advance and its refund', async () => {
        await BulkPayment.updateOne({ _id: pay._id }, { $set: { refund: { status: 'refunded', amountPaise: 100000, refundId: 'rfnd_2', at: new Date() } } });
        const res = await request(app).get('/api/shop/payments/report').set(w.owner.headers);
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.captured.paise, 500000);
        assert.equal(res.body.refunded.paise, 100000);
        assert.equal(res.body.netPaise, 400000);
        assert.equal(res.body.bulk.captured.paise, 500000);
    });

    test('the shop refunds list has the refund of a bulk order, with its code and the right status', async () => {
        await BulkPayment.updateOne({ _id: pay._id }, { $set: { refund: { status: 'refunded', amountPaise: 120000, refundId: 'rfnd_4', reason: 'bulk_cancelled', at: new Date() } } });
        const all = await request(app).get('/api/shop/payments/refunds').set(w.owner.headers);
        assert.equal(all.status, 200, JSON.stringify(all.body));
        assert.deepEqual(all.body.items.map((i) => [i.bulk?.code, i.amountPaise, i.status]), [['B7K2QX', 120000, 'processed']]);
        const failed = await request(app).get('/api/shop/payments/refunds?status=failed').set(w.owner.headers);
        assert.equal(failed.body.items.length, 0, 'a done refund is not in the failed list');
        const done = await request(app).get('/api/shop/payments/refunds?status=processed').set(w.owner.headers);
        assert.equal(done.body.items.length, 1);
    });

    test('the Excel exports have a Bulk orders sheet, and the sales file lists the bulk order and counts it in its day', async () => {
        const q = { shops: String(w.tenant._id), level: 'everything' };
        const rows = await exportCentre.csv('bulk_orders', q);
        assert.equal(rows.rows, 1);
        assert.match(rows.text, /B7K2QX/);
        assert.match(rows.text, /pay_bulkrep_1/);
        const { workbook, bulkOrders } = await salesExport.build({ tenantId: w.tenant._id, from: new Date(Date.now() - 86400000), to: new Date() });
        assert.equal(bulkOrders, 1);
        assert.equal(workbook.getWorksheet('Bulk orders').rowCount, 2);
        const days = workbook.getWorksheet('Sales by day');
        assert.equal(days.getRow(days.rowCount).getCell(3).value, 10000, 'the total row includes the bulk sale');
    });

    test('the money search finds a bulk payment by its bulk code and by its Razorpay id', async () => {
        for (const q of ['B7K2QX', 'pay_bulkrep_1']) {
            const r = await moneySearch.search(q);
            const g = r.groups.find((x) => x.key === 'bulkPayments');
            assert.ok(g && g.items.length === 1, `found by ${q}`);
            assert.equal(g.items[0].paise, 500000);
        }
    });
});
