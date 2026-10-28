require('./helpers/env');
// The owner's Orders board: "On the table" (served dishes of open tables, not paid) and "History" (every order of the last 24 hours).
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Order = require('../src/models/Order');
const TableSession = require('../src/models/TableSession');
const tableBill = require('../src/services/tableBill');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');

let w;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('board-shop');
    tenantRecognizer.invalidateTenant('board-shop');
});
const list = (view) => request(app).get(`/api/shop/orders?view=${view}`).set(w.owner.headers);

describe('On the table', () => {
    test('only served, unpaid dishes of an open table; a paid one leaves, a closed table is gone', async () => {
        const s = await TableSession.create({ tenantId: w.tenant._id, table: '5', customers: [w.customer.user._id], status: 'open' });
        const mk = (o) => f.makeOrder(w.tenant, w.customer.user, { orderType: 'dine_in', tableNo: '5', tableSessionId: s._id, ...o });
        const served = await mk({ status: 'delivered' });
        await mk({ status: 'preparing' });          // still in the kitchen: not on the table yet
        await mk({ status: 'delivered', payment: { method: 'cod', status: 'paid' } });   // paid: gone
        const r = await list('table');
        assert.equal(r.status, 200);
        assert.deepEqual(r.body.items.map((o) => String(o.id)), [String(served._id)]);
        assert.equal(r.body.tableCount, 1);

        await Order.updateOne({ _id: served._id }, { $set: { 'payment.status': 'paid' } });
        assert.equal((await list('table')).body.items.length, 0, 'paid: it leaves the list');

        await Order.updateOne({ _id: served._id }, { $set: { 'payment.status': 'pending' } });
        await TableSession.updateOne({ _id: s._id }, { $set: { status: 'closed' } });
        assert.equal((await list('table')).body.items.length, 0, 'a closed table has nothing on it');
    });

    test('a table payment tells the owner board to reload', async () => {
        const realtime = require('../src/services/realtime');
        const { mock } = require('node:test');
        const spy = mock.method(realtime, 'toOwner', () => { });
        const s = await TableSession.create({ tenantId: w.tenant._id, table: '6', customers: [w.customer.user._id], status: 'open' });
        await f.makeOrder(w.tenant, w.customer.user, { orderType: 'dine_in', tableNo: '6', tableSessionId: s._id, status: 'delivered' });
        await tableBill.settle({ tenantId: w.tenant._id, sessionId: s._id, method: 'cash', by: { type: 'owner' } });
        assert.ok(spy.mock.calls.some((c) => c.arguments[1] === 'order:update' && c.arguments[2]?.kind === 'table_paid'));
        spy.mock.restore();
    });
});

describe('History', () => {
    test('every order of the last 24 hours, of every status; older ones are gone from it', async () => {
        const a = await f.makeOrder(w.tenant, w.customer.user, { status: 'delivered' });
        const b = await f.makeOrder(w.tenant, w.customer.user, { status: 'cancelled' });
        const old = await f.makeOrder(w.tenant, w.customer.user, { status: 'delivered' });
        await Order.collection.updateOne({ _id: old._id }, { $set: { createdAt: new Date(Date.now() - 25 * 3600000) } });
        const ids = (await list('history')).body.items.map((o) => String(o.id));
        assert.ok(ids.includes(String(a._id)) && ids.includes(String(b._id)));
        assert.ok(!ids.includes(String(old._id)), 'older than a day: removed');
    });
});
