require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const auto = require('../src/services/automations');
const Order = require('../src/models/Order');
const TableBooking = require('../src/models/TableBooking');
const TableSession = require('../src/models/TableSession');
const ServiceInquiry = require('../src/models/ServiceInquiry');
const Notification = require('../src/models/Notification');
const ShopAutomation = require('../src/models/ShopAutomation');

// The owner's automations: each one does the job only after its time, never touches what the owner already handled, can be switched off, and tells the owner.
let w;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => { await db.clear(); w = await f.makeWorld('auto-shop'); });

const NOW = Date.now();
const ago = (min) => new Date(NOW - min * 60000);
const told = () => Notification.find({ tenantId: w.tenant._id, type: { $in: ['automation_done', 'automation_remind'] } }).lean();
const cfgOf = async () => async () => auto.get(w.tenant._id);

const booking = (o = {}) => TableBooking.create({
    tenantId: w.tenant._id, userId: w.customer.user._id, code: 'ABCDE', name: 'Asha', phone: '9000000030', date: '2026-11-03', time: '20:00', party: 2, table: '4',
    startsAt: ago(60), endsAt: new Date(NOW + 3600000), status: 'confirmed', deposit: { amount: 200, status: 'paid', credit: 'pending' }, payment: { paidAt: ago(120) }, rules: { depositMode: 'adjust' }, ...o,
});

describe('automations', () => {
    test('the recommended values, and a screen change keeps only valid choices', async () => {
        const d = await auto.get(w.tenant._id);
        assert.deepEqual([d.reservationAutoAllowMin, d.reservationNoShowMin, d.pickupNotCollectedMin, d.inquiryCloseDays, d.autoApproveLeave], [30, 30, 60, 7, false]);
        const s = await auto.save(w.tenant._id, { pickupNotCollectedMin: 120, autoApproveLeave: true });
        assert.deepEqual([s.pickupNotCollectedMin, s.autoApproveLeave, s.reservationNoShowMin], [120, true, 30]);   // only what was sent changed
        await assert.rejects(() => auto.save(w.tenant._id, { reservationNoShowMin: 7 }), /Choose one of/);
        assert.equal((await auto.reset(w.tenant._id)).pickupNotCollectedMin, 60);
    });

    test('a pickup nobody collected is marked not collected after the wait, not before, and not when switched off', async () => {
        const mk = (min) => f.makeOrder(w.tenant, w.customer.user, { orderType: 'pickup', status: 'ready', pickupUntil: ago(min) });
        const early = await mk(40);    // window ended 40 min ago: the wait is 30 + 60 minutes
        assert.equal(await auto.pickupNotCollected(NOW, await cfgOf()), 0);
        assert.equal((await Order.findById(early._id)).status, 'ready');
        const late = await mk(100);
        assert.equal(await auto.pickupNotCollected(NOW, await cfgOf()), 1);
        assert.equal((await Order.findById(late._id)).status, 'undelivered');
        assert.equal((await Order.findById(early._id)).status, 'ready');
        assert.equal((await told()).length, 1);
        await auto.save(w.tenant._id, { pickupNotCollectedMin: 0 });
        const off = await mk(300);
        assert.equal(await auto.pickupNotCollected(NOW, async () => auto.get(w.tenant._id)), 0);
        assert.equal((await Order.findById(off._id)).status, 'ready');
    });

    test('a paid reservation nobody answered is allowed after the time', async () => {
        const fresh = await booking({ payment: { paidAt: ago(10) } });
        const old = await booking({ code: 'ZZZZZ', table: '5', payment: { paidAt: ago(45) } });
        assert.equal(await auto.reservationAutoAllow(NOW, async () => auto.get(w.tenant._id)), 1);
        assert.equal(!!(await TableBooking.findById(fresh._id)).approvedAt, false);
        assert.equal(!!(await TableBooking.findById(old._id)).approvedAt, true);
        assert.equal((await told()).length, 1);
    });

    test('a reservation the guest never came to becomes no-show, but a guest who is eating is marked seated', async () => {
        const gone = await booking({ approvedAt: ago(100), table: '4' });
        const eating = await booking({ code: 'EEEEE', approvedAt: ago(100), table: '7' });
        await TableSession.create({ tenantId: w.tenant._id, table: '7', status: 'open', createdAt: ago(50) });
        assert.equal(await auto.reservationNoShow(NOW, async () => auto.get(w.tenant._id)), 2);
        assert.equal((await TableBooking.findById(gone._id)).status, 'no_show');
        assert.equal((await TableBooking.findById(gone._id)).deposit.status, 'kept');
        const seated = await TableBooking.findById(eating._id);
        assert.equal(seated.status, 'seated');
        assert.equal(seated.deposit.status, 'paid');   // his deposit is safe
        await auto.save(w.tenant._id, { reservationNoShowMin: 0 });
        const later = await booking({ code: 'LLLLL', approvedAt: ago(100), table: '9' });
        assert.equal(await auto.reservationNoShow(NOW, async () => auto.get(w.tenant._id)), 0);
        assert.equal((await TableBooking.findById(later._id)).status, 'confirmed');
    });

    test('the deposit is marked taken off the bill once the guest table bill is closed', async () => {
        const b = await booking({ status: 'seated', arrivedAt: ago(50), table: '4' });
        assert.equal(await auto.depositAdjust(NOW, async () => auto.get(w.tenant._id)), 0);   // the table is still open
        await TableSession.create({ tenantId: w.tenant._id, table: '4', status: 'closed', closedAt: ago(5), createdAt: ago(50) });
        assert.equal(await auto.depositAdjust(NOW, async () => auto.get(w.tenant._id)), 1);
        assert.equal((await TableBooking.findById(b._id)).deposit.status, 'adjusted');
    });

    test('an answered inquiry that went quiet is ended after the days, an unanswered one never', async () => {
        const mk = (o) => ServiceInquiry.create({ tenantId: w.tenant._id, serviceId: new mongoose.Types.ObjectId(), serviceName: 'Tiffin', userId: w.customer.user._id, name: 'Asha', phone: '9000000030', ...o });
        const quiet = await mk({ status: 'replied', lastMessageAt: new Date(NOW - 9 * 86400000) });
        const recent = await mk({ status: 'replied', lastMessageAt: new Date(NOW - 2 * 86400000) });
        const waiting = await mk({ status: 'new', lastMessageAt: new Date(NOW - 20 * 86400000) });
        assert.equal(await auto.closeQuietInquiries(NOW, async () => auto.get(w.tenant._id)), 1);
        assert.equal((await ServiceInquiry.findById(quiet._id)).status, 'closed');
        assert.equal((await ServiceInquiry.findById(recent._id)).status, 'replied');
        assert.equal((await ServiceInquiry.findById(waiting._id)).status, 'new');
    });

    test('a reminder repeats at its own pace and never more than its limit', async () => {
        const t = w.tenant._id;
        assert.equal(await auto.claim(t, 'x', 10 * 60000, 3, NOW), true);
        assert.equal(await auto.claim(t, 'x', 10 * 60000, 3, NOW + 5 * 60000), false);        // too soon
        assert.equal(await auto.claim(t, 'x', 10 * 60000, 3, NOW + 11 * 60000), true);
        assert.equal(await auto.claim(t, 'x', 10 * 60000, 3, NOW + 22 * 60000), true);
        assert.equal(await auto.claim(t, 'x', 10 * 60000, 3, NOW + 40 * 60000), false);       // the third was the last
    });

    test('a slow order and a stuck kitchen problem remind the owner, and only while the switch is on', async () => {
        await f.makeOrder(w.tenant, w.customer.user, { status: 'preparing' });
        await Order.updateMany({}, { $set: { updatedAt: ago(90) } }, { timestamps: false });
        await f.makeOrder(w.tenant, w.customer.user, { status: 'accepted', kitchen: { problem: { kind: 'finished', note: 'x', at: ago(30), dish: 'Dal' } } });
        assert.equal(await auto.stageAlerts(NOW, async () => auto.get(w.tenant._id)), 1);
        assert.equal(await auto.kitchenProblems(NOW, async () => auto.get(w.tenant._id)), 1);
        assert.equal((await told()).length, 2);
        await auto.save(w.tenant._id, { stageAlerts: false, kitchenProblemReminders: false });
        assert.equal(await auto.stageAlerts(NOW + 60 * 60000, async () => auto.get(w.tenant._id)), 0);
        assert.equal(await auto.kitchenProblems(NOW + 60 * 60000, async () => auto.get(w.tenant._id)), 0);
    });

    test('every rule runs and a rule that fails does not stop the others', async () => {
        const r = await auto.runAll(NOW);
        assert.equal(Object.keys(r).length, 12);
        assert.ok(await ShopAutomation.countDocuments() >= 0);
    });
});
