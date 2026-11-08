require('./helpers/env');
// A pickup customer says "I can't come" and the owner gives a full refund: the owner is NOT then told that the order was cancelled "because it was not accepted".
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const f = require('./helpers/factory');
const Notification = require('../src/models/Notification');
const Order = require('../src/models/Order');
const pushChannel = require('../src/notifications/channels/push');
const notificationService = require('../src/services/notificationService');
const { runPickupReminders } = require('../src/jobs/pickupReminders');
const { problemOf } = require('../src/services/orderAttention');

let w;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
    w = await f.makeWorld(`cantcome-${Date.now()}`);
});
afterEach(() => mock.restoreAll());

describe('"I can\'t come" and a full refund', () => {
    test('the owner is told nothing about "not accepted in time"', async () => {
        const o = await f.makeOrder(w.tenant, w.customer.user, {
            orderType: 'pickup', status: 'ready', scheduledFor: new Date(Date.now() - 60000), pickupUntil: new Date(Date.now() + 3600000),
            payment: { method: 'upi', status: 'paid', paidAt: new Date(Date.now() - 3600000), paymentId: 'pay_cc1' }, pricing: { subtotal: 300, total: 300 },
            statusHistory: [{ status: 'placed' }, { status: 'accepted' }, { status: 'ready' }],
        });
        const said = await request(app).post(`/api/orders/${o._id}/pickup-answer`).set(w.customer.headers).send({ answer: 'not_wanted' });
        assert.equal(said.status, 200, JSON.stringify(said.body));
        await Notification.deleteMany({});   // only what comes after the owner's answer counts
        const done = await request(app).post(`/api/shop/customer-asks/${o._id}/answer`).set(w.owner.headers).send({ refundPct: 100 });
        assert.equal(done.status, 200, JSON.stringify(done.body));
        assert.equal((await Order.findById(o._id).lean()).status, 'cancelled');
        await f.sleep(400);
        const all = await Notification.find({}).lean();
        const cancelAlerts = all.filter((n) => n.type === 'order_cancelled');
        console.log('notifications after the owner answered:', all.map((n) => `${n.role || 'user'}:${n.type}`).join(', '));
        for (const n of cancelAlerts) assert.doesNotMatch(`${n.title} ${n.body} ${n.data?.speech || ''}`, /not accepted|accept/i, 'the cancel alert must not blame "not accepted": ' + JSON.stringify([n.title, n.body, n.data?.speech]));
    });

    test('an automatic cancel is explained by its real reason, never "not accepted" by default', async () => {
        const told = async (reasonCode, cancelReason, actor = { type: 'system' }) => {
            await Notification.deleteMany({});
            const o = await f.makeOrder(w.tenant, w.customer.user, { orderType: 'pickup', status: 'cancelled', payment: { method: 'cod', status: 'pending' }, cancelReason, cancel: { by: actor.type === 'owner' ? 'shop' : 'system', reasonCode, refundPaise: 0, keptPaise: 0 } });
            notificationService.orderStatusChanged(o, 'cancelled', actor);
            await f.sleep(400);
            return (await Notification.find({ type: 'order_cancelled', role: 'owner' }).lean()).map((n) => `${n.body} | ${n.data?.speech || ''}`).join(' || ');
        };
        assert.match(await told('not_accepted', 'The shop did not respond in time'), /not accepted in time/, 'a real time-out says so');
        assert.match(await told('late_delivery', 'It was more than an hour late'), /more than an hour late/);
        const other = await told('some_other_reason', 'Closed for the day');
        assert.match(other, /was cancelled/);
        assert.doesNotMatch(other, /accept/i, 'another automatic reason must not blame "not accepted": ' + other);
        assert.equal(await told('customer_asked', 'Refunded in full', { type: 'owner' }), '', 'a cancel by the shop is not announced back to the shop');
    });

    test('once the customer said he cannot come (or that he collected it), the reminders stop saying he has not collected it', async () => {
        const mk = (claim) => f.makeOrder(w.tenant, w.customer.user, { orderType: 'pickup', status: 'ready', pickupUntil: new Date(Date.now() - 3 * 3600000), payment: { method: 'upi', status: 'paid', paidAt: new Date(), paymentId: 'pay_pr' + Math.random() }, ...(claim ? { pickupClaim: { kind: claim, at: new Date() } } : {}) });
        await mk('not_wanted'); await mk('collected');
        await Notification.deleteMany({});
        await runPickupReminders();
        await f.sleep(300);
        assert.equal(await Notification.countDocuments({ type: { $in: ['pickup_no_show', 'pickup_waiting'] } }), 0, 'nothing is said to the owner or the customer while the shop decides');
        await mk(null);   // an order nobody has answered for still gets its reminder
        await runPickupReminders();
        await f.sleep(300);
        assert.ok(await Notification.countDocuments({ type: 'pickup_no_show' }) >= 1, 'a customer who said nothing is still reported as not collected');
    });

    test('a paid order the shop cancelled and kept the money for is not shown as a refund due', async () => {
        const base = { orderType: 'pickup', status: 'cancelled', payment: { method: 'upi', status: 'paid' }, pricing: { total: 300 } };
        const now = Date.now();
        assert.equal(problemOf({ ...base, cancel: { refundPaise: 0, keptPaise: 30000 } }, now), null, 'all of it kept: nothing is owed');
        assert.equal(problemOf({ ...base, cancel: { refundPaise: 15000, keptPaise: 15000 } }, now), null, 'part given back, part kept');
        assert.equal(problemOf({ ...base, cancel: { refundPaise: 0, keptPaise: 0 } }, now)?.code, 'refund_due', 'nothing refunded and nothing kept: it is still owed');
    });
});
