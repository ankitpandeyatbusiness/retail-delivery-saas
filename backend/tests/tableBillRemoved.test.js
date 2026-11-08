require('./helpers/env');
// A round the shop removes from a table bill is not charged, but the guest is told: what was removed, who did it, when and why.
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const db = require('./helpers/db');
require('../src/server/app');   // all the models are registered
const f = require('./helpers/factory');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const Tenant = require('../src/models/Tenant');
const TableSession = require('../src/models/TableSession');
const pushChannel = require('../src/notifications/channels/push');
const tableBill = require('../src/services/tableBill');

let w; let n = 0;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
    const slug = `removed-${++n}`;
    w = await f.makeWorld(slug);
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.dineIn': { enabled: true, tableCount: 10 } } });
    tenantRecognizer.invalidateTenant(slug);
});
afterEach(() => mock.restoreAll());

describe('a round removed from the table bill', () => {
    test('is not in the total, but is listed as removed with its dishes, who removed it, and why', async () => {
        const g = await f.makeUser(w.tenant, 'customer', '9000000061');
        const s = await tableBill.joinOrOpen({ tenantId: w.tenant._id, table: '4', userId: g.user._id });
        const line = (name, quantity, unit) => ({ productId: new (require('mongoose').Types.ObjectId)(), name, quantity, unitPrice: unit, lineTotal: quantity * unit });
        const base = { orderType: 'dine_in', tableNo: '4', tableSessionId: s._id };
        await f.makeOrder(w.tenant, g.user, { ...base, status: 'accepted', items: [line('Dal Tadka', 1, 180)], pricing: { subtotal: 180, total: 180 } });
        const gone = await f.makeOrder(w.tenant, g.user, {
            ...base, status: 'cancelled', cancelledBy: 'shop', cancelReason: 'out_of_stock', items: [line('Paneer Tikka', 2, 200)], pricing: { subtotal: 400, total: 400 },
            statusHistory: [{ status: 'placed', at: new Date(Date.now() - 600000) }, { status: 'cancelled', at: new Date(Date.now() - 300000) }],
        });
        const mine = await f.makeOrder(w.tenant, g.user, { ...base, status: 'cancelled', cancelledBy: 'customer', items: [line('Lassi', 1, 90)], pricing: { subtotal: 90, total: 90 } });

        const bill = await tableBill.billOf(await TableSession.findById(s._id));
        assert.equal(bill.rounds.length, 1, 'the live round only');
        assert.equal(bill.total, 180, 'what was removed is not charged');
        assert.equal(bill.due, 180);

        assert.equal(bill.removed.length, 2);
        const byShop = bill.removed.find((r) => String(r.id) === String(gone._id));
        assert.equal(byShop.removedBy, 'shop');
        assert.equal(byShop.reason, 'out of stock');
        assert.equal(byShop.total, 400);
        assert.deepEqual(byShop.items.map((i) => [i.name, i.quantity, i.total]), [['Paneer Tikka', 2, 400]]);
        assert.ok(new Date(byShop.removedAt).getTime() < Date.now() - 200000, 'the time it was removed, not the time it was ordered');
        const byGuest = bill.removed.find((r) => String(r.id) === String(mine._id));
        assert.equal(byGuest.removedBy, 'guest', 'a round the guest cancelled himself says so');
        assert.equal(String(byGuest.by.id), String(g.user._id));
    });
});
