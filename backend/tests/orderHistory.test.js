require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const history = require('../src/services/orderHistory');

// The owner's History: search by anything, the filters, the summary and day totals, the flags, and the Excel file.
let w;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('hist-shop');
});

const item = (name, qty = 1, price = 100) => ({ productId: new mongoose.Types.ObjectId(), name, quantity: qty, unitPrice: price, lineTotal: qty * price });
const mk = (o) => f.makeOrder(w.tenant, w.customer.user, o);
const find = (query) => history.list({ tenantId: w.tenant._id, query });

describe('order history', () => {
    test('one search box finds an order by customer, number, dish, phone or address', async () => {
        const a = await mk({ items: [item('Paneer Tikka', 2, 150)], pricing: { subtotal: 300, total: 300 }, customer: { name: 'Anil Kumar', phone: '9811122233' }, address: { line1: '12 Lake Road', city: 'Lucknow' } });
        await mk({ items: [item('Veg Biryani')], customer: { name: 'Sunita', phone: '9822233344' }, address: { line1: '5 Hill Street' } });
        const ids = async (q) => (await find({ q })).items.map((x) => x.orderNo);
        assert.deepEqual(await ids('anil'), [a.orderNo]);
        assert.deepEqual(await ids(String(a.orderNo)), [a.orderNo]);
        assert.deepEqual(await ids('paneer'), [a.orderNo]);
        assert.deepEqual(await ids('98111'), [a.orderNo]);
        assert.deepEqual(await ids('lake road'), [a.orderNo]);
        assert.equal((await ids('nothing here')).length, 0);
        assert.equal((await ids('(')).length, 0);   // a bracket is only text, never an error
    });

    test('the filters: time, status, type and payment', async () => {
        const now = Date.now();
        await mk({ status: 'delivered' });
        await mk({ status: 'cancelled', cancelReason: 'Customer changed mind' });
        await mk({ orderType: 'pickup', status: 'delivered' });
        await mk({ status: 'delivered', createdAt: new Date(now - 3 * 86400000) });          // three days ago
        await mk({ status: 'delivered', createdAt: new Date(now - 40 * 86400000) });         // more than a month
        assert.equal((await find({})).items.length, 3);                                      // the last 24 hours by default
        assert.equal((await find({ range: 'week' })).items.length, 4);
        assert.equal((await find({ range: 'month' })).items.length, 4);
        assert.equal((await find({ status: 'cancelled' })).items.length, 1);
        assert.equal((await find({ status: 'delivered' })).items.length, 2);
        assert.equal((await find({ type: 'pickup' })).items.length, 1);
        assert.equal((await find({ pay: 'cash' })).items.length, 3);
        const day = new Date(now - 3 * 86400000 + 330 * 60000).toISOString().slice(0, 10);   // that day in India
        assert.equal((await find({ range: 'custom', from: day, to: day })).items.length, 1);
        await assert.rejects(() => find({ range: 'custom', from: 'bad' }));
    });

    test('the summary covers the whole filter, cancelled orders are not sales, and each day has a total', async () => {
        await mk({ status: 'delivered', pricing: { subtotal: 200, total: 200 } });
        await mk({ status: 'delivered', pricing: { subtotal: 100, total: 100 }, payment: { method: 'upi', status: 'paid' } });
        await mk({ status: 'cancelled', pricing: { subtotal: 500, total: 500 } });
        const r = await find({});
        assert.equal(r.summary.orders, 3);
        assert.equal(r.summary.sales, 300);
        assert.equal(r.summary.cancelled, 1);
        assert.equal(r.summary.lost, 500);
        assert.equal(r.summary.cash, 200);
        assert.equal(r.summary.online, 100);
        assert.equal(r.summary.average, 150);
        const days = Object.values(r.byDay);
        assert.equal(days.length, 1);
        assert.deepEqual([days[0].orders, days[0].sales], [3, 300]);
    });

    test('a card carries the flags and the repeat count', async () => {
        await mk({ status: 'delivered' });
        await mk({ status: 'cancelled', cancel: { by: 'shop' } });
        await mk({ status: 'delivered', payment: { method: 'upi', status: 'refunded' } });
        const r = await find({});
        const cancelled = r.items.find((x) => x.status === 'cancelled');
        assert.deepEqual(cancelled.flags, [{ k: 'cancelled', by: 'shop' }]);
        assert.ok(r.items.find((x) => x.payment.status === 'refunded').flags.some((x) => x.k === 'refunded'));
        assert.equal(r.items[0].orders, 3);   // the same customer made three orders here
    });

    test('the Excel file is made and holds the filtered orders', async () => {
        await mk({ status: 'delivered', items: [item('Dal', 2)] });
        const buf = await history.exportBuffer({ tenantId: w.tenant._id, query: {}, shopName: 'Test Shop' });
        assert.equal(buf.slice(0, 2).toString(), 'PK');   // an .xlsx is a zip file
        assert.ok(buf.length > 4000);
    });

    test('a long cancel reason or dish list makes its row taller so nothing is cut', async () => {
        const reason = 'The customer said that he had changed his mind about the whole order because his family decided to eat out tonight instead of at home, so please cancel it and do not charge anything';
        await mk({ status: 'cancelled', cancelReason: reason, items: [item('A very long dish name that goes on and on', 2), item('Another dish with a long name too', 1), item('Third dish for the list', 3)] });
        await mk({ status: 'delivered' });
        const buf = await history.exportBuffer({ tenantId: w.tenant._id, query: {}, shopName: 'Test Shop' });
        const ExcelJS = require('exceljs');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);
        const ws = wb.worksheets[0];
        const heights = [5, 6].map((r) => ws.getRow(r).height);
        assert.ok(Math.max(...heights) > 40, 'the row with the long text is tall: ' + heights.join(','));
        assert.equal(Math.min(...heights), 22);   // a short row stays the normal height
    });
});
