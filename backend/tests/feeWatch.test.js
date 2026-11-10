require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const Tenant = require('../src/models/Tenant');
const Notification = require('../src/models/Notification');
const feeWatch = require('../src/services/feeWatch');

// Partner shops: a drop in orders, or orders that are not completed, tell the superadmin (once a week per shop and kind).
let w; let n = 0;
const DAY = 86400000;
const NOW = new Date();
const mk = (daysAgo, status = 'delivered') => f.makeOrder(w.tenant, w.customer.user, { status, createdAt: new Date(NOW.getTime() - daysAgo * DAY - 3600000) });
const told = (type) => Notification.countDocuments({ role: 'superadmin', type, tenantId: w.tenant._id });

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld(`feew-${++n}`);
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { plan: { id: 'partner' } } });
});

describe('Partner fee watch', () => {
    test('orders fell by more than half: told once, not again within the week', async () => {
        for (let i = 0; i < 90; i += 1) await mk(8 + (i % 27));   // about 3 a day for the 4 weeks before
        for (let i = 0; i < 3; i += 1) await mk(1 + i);            // 3 orders in the last 7 days
        const r = await feeWatch.sweep(NOW);
        assert.equal(r.dropped, 1);
        assert.equal(await told('admin_orders_dropped'), 1);
        const again = await feeWatch.sweep(NOW);
        assert.equal(again.dropped, 0);
        assert.equal(await told('admin_orders_dropped'), 1);
    });

    test('a steady shop is not told', async () => {
        for (let i = 0; i < 90; i += 1) await mk(8 + (i % 27));
        for (let i = 0; i < 21; i += 1) await mk(i % 7);          // 3 a day, the same as before
        const r = await feeWatch.sweep(NOW);
        assert.deepEqual([r.dropped, r.unfinished], [0, 0]);
    });

    test('a quiet shop (under 3 a day before) is not told about a drop', async () => {
        for (let i = 0; i < 20; i += 1) await mk(8 + i);
        const r = await feeWatch.sweep(NOW);
        assert.equal(r.dropped, 0);
    });

    test('many orders placed but under 60% completed: told', async () => {
        for (let i = 0; i < 12; i += 1) await mk(i % 6, i < 4 ? 'delivered' : 'cancelled');
        const r = await feeWatch.sweep(NOW);
        assert.equal(r.unfinished, 1);
        assert.equal(await told('admin_orders_unfinished'), 1);
    });

    test('mostly completed is fine; a shop not on Partner is not watched', async () => {
        for (let i = 0; i < 12; i += 1) await mk(i % 6, i < 10 ? 'delivered' : 'cancelled');
        assert.equal((await feeWatch.sweep(NOW)).unfinished, 0);
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { plan: { id: 'growth' } } });
        for (let i = 0; i < 12; i += 1) await mk(i % 6, 'cancelled');
        assert.equal((await feeWatch.sweep(NOW)).shops, 0);
    });
});
