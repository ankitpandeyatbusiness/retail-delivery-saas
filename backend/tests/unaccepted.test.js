require('./helpers/env'); 
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const db = require('./helpers/db');
const timeouts = require('../src/services/orderTimeout');
const presence = require('../src/notifications/presence');
const inapp = require('../src/notifications/channels/inapp');
const pushChannel = require('../src/notifications/channels/push');
const smsChannel = require('../src/notifications/channels/sms');
const rules = require('../src/notifications/rules');
const smsTemplates = require('../src/notifications/templates/sms');
const texts = require('../src/notifications/templates/texts');
const { EVENTS } = require('../src/notifications/events');
const smsAdapter = require('../src/services/adapters/sms');
const Order = require('../src/models/Order');
const Notification = require('../src/models/Notification');
const NotificationRule = require('../src/models/NotificationRule');
const { makeTenant, makeUser, makeWorld, makeOrder, waitFor, sleep } = require('./helpers/factory');

const { runOrderTimeout, cancelUnacceptedOrders, REMINDER_MINUTES, TIMEOUT_MIN } = timeouts;
const MIN = 60000;
const minutesAgo = (m) => new Date(Date.now() - m * MIN);
const minutesAhead = (m) => new Date(Date.now() + m * MIN);
const waiting = (w, minutes, extra = {}) => makeOrder(w.tenant, w.customer.user, { status: 'placed', createdAt: minutesAgo(minutes), ...extra });
const reminders = (w) => Notification.find({ tenantId: w.tenant._id, role: 'owner', type: 'order_unaccepted_reminder' }).sort({ createdAt: 1 }).lean();
const reminderCount = async (w) => (await reminders(w)).length;
const cancelNotes = (w) => Notification.countDocuments({ tenantId: w.tenant._id, role: 'owner', type: 'order_cancelled' });

// replaces the real channels with recorders, so no test sends anything
function fakes({ online = false, push = { sent: 0, tokens: 0 }, sms = { sent: true } } = {}) {
    const calls = { live: [], push: [], sms: [] };
    mock.method(presence, 'isOnline', () => online);
    mock.method(presence, 'ownerOnline', () => online);
    mock.method(inapp, 'live', (a) => { calls.live.push(a); });
    mock.method(pushChannel, 'send', async (a) => { calls.push.push(a); return push; });
    mock.method(smsChannel, 'send', async (a) => { calls.sms.push(a); return sms; });
    return calls;
}

describe('order not accepted: reminders and auto cancel', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    // the job looks at every shop, so each test starts with no orders and no messages left over from the one before
    beforeEach(async () => { await Order.deleteMany({}); await Notification.deleteMany({}); });
    afterEach(() => mock.restoreAll());

    test('the reminders come at 3 and 6 minutes and the cancel at 10', () => {
        assert.deepEqual(REMINDER_MINUTES, [3, 6]);
        assert.equal(TIMEOUT_MIN, 10);
    });

    test('the first reminder comes at 3 minutes, once, with the right words, and only for the right shop', async () => {
        const w = await makeWorld('un-first');
        const other = await makeWorld('un-first-other');
        fakes();
        const o = await waiting(w, 3.5);
        await waiting(other, 1);                                          // another shop, only 1 minute old

        assert.deepEqual(await runOrderTimeout(), { reminded: 1, cancelled: 0 });
        assert.ok(await waitFor(async () => (await reminderCount(w)) === 1));
        const [r] = await reminders(w);
        assert.equal(r.title, 'Order is waiting');
        assert.equal(r.body, `Order #${o.orderNo} is waiting for you. It will be cancelled in 7 minutes if you do not accept it.`);
        assert.equal(r.data.minutes, 3);
        assert.equal(r.data.orderNo, o.orderNo);
        assert.equal(String(r.data.orderId), String(o._id));
        assert.deepEqual([...(await Order.findById(o._id)).unacceptedReminders], [3]);
        assert.equal(await reminderCount(other), 0);

        assert.deepEqual(await runOrderTimeout(), { reminded: 0, cancelled: 0 });   // never twice
        await sleep(300);
        assert.equal(await reminderCount(w), 1);
        const json = (await Order.findById(o._id)).toJSON();
        assert.equal(json.unacceptedReminders, undefined);                          // an internal field, never sent to an app
    });

    test('the second reminder comes at 6 minutes, and at 10 minutes the system cancels with "not accepted"', async () => {
        const w = await makeWorld('un-steps');
        fakes();
        const o = await waiting(w, 3.5);
        const t0 = Date.now();

        await runOrderTimeout(new Date(t0));
        assert.ok(await waitFor(async () => (await reminderCount(w)) === 1));

        assert.deepEqual(await runOrderTimeout(new Date(t0 + 3 * MIN)), { reminded: 1, cancelled: 0 });   // 6.5 minutes
        assert.ok(await waitFor(async () => (await reminderCount(w)) === 2));
        const [, second] = await reminders(w);
        assert.equal(second.title, 'Please accept the order');
        assert.match(second.body, /cancelled in 4 minutes/);
        assert.deepEqual([...(await Order.findById(o._id)).unacceptedReminders], [3, 6]);
        assert.equal((await Order.findById(o._id)).status, 'placed');

        assert.deepEqual(await runOrderTimeout(new Date(t0 + 7 * MIN)), { reminded: 0, cancelled: 1 });   // 10.5 minutes
        const done = await Order.findById(o._id);
        assert.equal(done.status, 'cancelled');
        assert.equal(done.cancel.reasonCode, 'not_accepted');
        assert.equal(done.cancel.by, 'system');
        assert.equal(done.cancelReason, 'The shop did not respond in time');
        assert.ok(await waitFor(async () => (await cancelNotes(w)) === 1));
        assert.equal(await reminderCount(w), 2);                                   // no third reminder
    });

    test('a server that was off: both reminders are overdue, ONE message is sent (the latest) and both are marked', async () => {
        const w = await makeWorld('un-overdue');
        fakes();
        const o = await waiting(w, 7);
        assert.deepEqual(await runOrderTimeout(), { reminded: 1, cancelled: 0 });
        assert.ok(await waitFor(async () => (await reminderCount(w)) === 1));
        const [r] = await reminders(w);
        assert.equal(r.title, 'Please accept the order');
        assert.match(r.body, /cancelled in 4 minutes/);
        assert.deepEqual([...(await Order.findById(o._id)).unacceptedReminders].sort(), [3, 6]);
        assert.deepEqual(await runOrderTimeout(), { reminded: 0, cancelled: 0 });
    });

    test('an accepted order, a fresh order and a finished order get nothing', async () => {
        const w = await makeWorld('un-quiet');
        fakes();
        await waiting(w, 5, { status: 'accepted' });
        await waiting(w, 5, { status: 'preparing' });
        await waiting(w, 5, { status: 'delivered' });
        await waiting(w, 2);                                                       // placed, but only 2 minutes
        assert.deepEqual(await runOrderTimeout(), { reminded: 0, cancelled: 0 });
        await sleep(300);
        assert.equal(await reminderCount(w), 0);
        assert.equal(await Notification.countDocuments({ tenantId: w.tenant._id }), 0);
    });

    test('an order older than 10 minutes is cancelled and does not get a late reminder', async () => {
        const w = await makeWorld('un-late');
        fakes();
        const o = await waiting(w, 11);
        assert.deepEqual(await runOrderTimeout(), { reminded: 0, cancelled: 1 });
        assert.equal((await Order.findById(o._id)).status, 'cancelled');
        assert.ok(await waitFor(async () => (await cancelNotes(w)) === 1));
        assert.equal(await reminderCount(w), 0);
        assert.equal(await cancelUnacceptedOrders(), 0);                           // nothing is left to cancel
    });

    test('scheduled orders: far away = left alone, close = reminders, too late = cancelled (the same moment as before)', async () => {
        const w = await makeWorld('un-scheduled');
        fakes();
        const far = await waiting(w, 60, { scheduledFor: minutesAhead(180) });
        const close = await waiting(w, 60, { scheduledFor: minutesAhead(15) });    // the shop's wait started 5 minutes ago
        const late = await waiting(w, 60, { scheduledFor: minutesAhead(4) });      // the wait started 16 minutes ago

        assert.deepEqual(await runOrderTimeout(), { reminded: 1, cancelled: 1 });
        assert.equal((await Order.findById(far._id)).status, 'placed');
        assert.equal((await Order.findById(far._id)).unacceptedReminders, undefined);
        assert.equal((await Order.findById(close._id)).status, 'placed');
        assert.deepEqual([...(await Order.findById(close._id)).unacceptedReminders], [3]);
        assert.equal((await Order.findById(late._id)).status, 'cancelled');
        assert.ok(await waitFor(async () => (await reminderCount(w)) === 1));
        const [r] = await reminders(w);
        assert.equal(r.data.orderNo, close.orderNo);
    });

    test('channels: an online owner gets a live message AND a push (no SMS)', async () => {
        const w = await makeWorld('un-online');
        const calls = fakes({ online: true, push: { sent: 1, tokens: 1 } });
        await waiting(w, 3.5);
        await runOrderTimeout();
        assert.ok(await waitFor(() => calls.live.length === 1 && calls.push.length === 1));
        await sleep(200);
        assert.equal(calls.sms.length, 0);
        assert.equal(calls.push[0].data.type, 'order_unaccepted_reminder');
        assert.match(calls.push[0].body, /is waiting for you/);
    });

    test('channels: an offline owner with no phone token gets an SMS, and the message is marked as texted', async () => {
        const w = await makeWorld('un-offline');
        const calls = fakes({ online: false, push: { sent: 0, tokens: 0 } });
        await waiting(w, 3.5);
        await runOrderTimeout();
        assert.ok(await waitFor(() => calls.sms.length === 1));
        assert.equal(calls.sms[0].eventKey, 'order_unaccepted_reminder');
        assert.equal(calls.live.length, 0);
        assert.ok(await waitFor(async () => !!(await reminders(w))[0]?.smsSentAt));
    });

    test('the reminder SMS text, and its DLT variables', async () => {
        assert.equal(
            smsTemplates.build('order_unaccepted_reminder', { orderNo: 7, shop: 'Savera' }).text,
            'Order #7 at Savera is still waiting to be accepted. Please open the app now.',
        );
        assert.ok(EVENTS.order_unaccepted_reminder.key);
        const t = await makeTenant('un-sms');
        await makeUser(t, 'admin', '9000000010');
        const spy = mock.method(smsAdapter, 'send', async () => ({}));
        const r = await smsChannel.send({
            eventKey: 'order_unaccepted_reminder', def: EVENTS.order_unaccepted_reminder, ctx: { tenantId: t._id, data: { orderNo: 5 } },
        });
        assert.equal(r.sent, true);
        assert.equal(spy.mock.calls[0].arguments[0].text, 'Order #5 at Shop un-sms is still waiting to be accepted. Please open the app now.');
        assert.equal(spy.mock.calls[0].arguments[0].to, '9000000010');
    });

    test('two servers at the same moment send ONE reminder', async () => {
        const w = await makeWorld('un-parallel');
        fakes();
        await waiting(w, 3.5);
        const [a, b] = await Promise.all([runOrderTimeout(), runOrderTimeout()]);
        assert.equal(a.reminded + b.reminded, 1);
        assert.ok(await waitFor(async () => (await reminderCount(w)) === 1));
        await sleep(400);
        assert.equal(await reminderCount(w), 1);
    });

    test('a rule from the database can switch the reminder off', async () => {
        const w = await makeWorld('un-rule');
        fakes();
        try {
            await NotificationRule.create({ eventKey: 'order_unaccepted_reminder', tenantId: w.tenant._id, enabled: false });
            rules.invalidate();
            await waiting(w, 3.5);
            assert.deepEqual(await runOrderTimeout(), { reminded: 1, cancelled: 0 });   // it is counted and marked...
            await sleep(500);
            assert.equal(await reminderCount(w), 0);                                    // ...but nothing is sent
        } finally {
            await NotificationRule.deleteMany({});
            rules.invalidate();
        }
    });

    test('the words of the reminder', () => {
        assert.deepEqual(texts.build('order_unaccepted_reminder', { orderNo: 9, minutes: 3, left: 7 }), {
            title: 'Order is waiting',
            body: 'Order #9 is waiting for you. It will be cancelled in 7 minutes if you do not accept it.',
        });
        assert.equal(texts.build('order_unaccepted_reminder', { orderNo: 9, minutes: 6, left: 4 }).title, 'Please accept the order');
    });
});