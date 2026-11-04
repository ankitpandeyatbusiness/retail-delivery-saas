require('./helpers/env');
// The superadmin's morning push: once a day after 8:00 India time, yesterday against the day before, and what needs attention.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const Order = require('../src/models/Order');
const Notification = require('../src/models/Notification');
const digest = require('../src/services/dailyDigest');

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); await f.makeSuperAdmin('root@test.com'); });

const IST = 330 * 60000;
// today at the given India time as a real moment
const todayAt = (h, m = 0) => { const d = new Date(Date.now() + IST); d.setUTCHours(h, m, 0, 0); return d.getTime() - IST; };
const told = () => Notification.find({ role: 'superadmin', type: 'admin_daily_summary' }).lean();

describe('daily digest', () => {
    test('sent once after 8:00 with yesterday\'s numbers, never before 8:00, and not on a quiet platform', async () => {
        assert.equal(await digest.sendIfDue(todayAt(9) + 5 * 86400000), false, 'a platform with nothing to say sends nothing');

        const w = await f.makeWorld('dd-' + Date.now().toString(36));
        const o = await f.makeOrder(w.tenant, w.customer.user, {});
        await Order.collection.updateOne({ _id: o._id }, { $set: { status: 'delivered', deliveredAt: new Date(todayAt(9) - 20 * 3600000), 'pricing.subtotal': 700, 'pricing.packagingCharge': 0, 'pricing.discount': 0 } });

        assert.equal(await digest.sendIfDue(todayAt(7)), false, 'too early');
        assert.equal(await digest.sendIfDue(todayAt(9)), true);
        assert.equal(await digest.sendIfDue(todayAt(10)), false, 'only once a day');
        const rows = await told();
        assert.equal(rows.length, 1);
        assert.match(rows[0].title, /Yesterday: 1 order, ₹700/);
        assert.equal(rows[0].data.kind, 'digest');
    });
});
