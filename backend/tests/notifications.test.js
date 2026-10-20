require('./helpers/env');
const { describe, test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: connect } = require('socket.io-client');
const db = require('./helpers/db');
const center = require('../src/notifications/center');
const rules = require('../src/notifications/rules');
const presence = require('../src/notifications/presence');
const inapp = require('../src/notifications/channels/inapp');
const pushChannel = require('../src/notifications/channels/push');
const smsChannel = require('../src/notifications/channels/sms');
const { EVENTS } = require('../src/notifications/events');
const smsTemplates = require('../src/notifications/templates/sms');
const { runEscalation } = require('../src/jobs/notificationEscalation');
const notify = require('../src/services/notificationService');
const smsAdapter = require('../src/services/adapters/sms');
const wallet = require('../src/services/smsWalletService');
const realtime = require('../src/services/realtime');
const Notification = require('../src/models/Notification');
const NotificationRule = require('../src/models/NotificationRule');
const SmsWallet = require('../src/models/SmsWallet');
const SmsLog = require('../src/models/SmsLog');
const { makeTenant, makeUser, makeWorld, makeOrder, waitFor } = require('./helpers/factory');

// Replaces the real channels with recorders, so each test can see exactly what was tried
function fakes({ online = false, push = { sent: 0, tokens: 0 }, sms = { sent: true } } = {}) {
    const calls = { live: [], push: [], sms: [] };
    mock.method(presence, 'isOnline', () => online);
    mock.method(presence, 'ownerOnline', () => online);
    mock.method(inapp, 'live', (a) => { calls.live.push(a); });
    mock.method(pushChannel, 'send', async (a) => { calls.push.push(a); return push; });
    mock.method(smsChannel, 'send', async (a) => { calls.sms.push(a); return sms; });
    return calls;
}
const count = (q) => Notification.countDocuments(q);

describe('notification waterfall', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    afterEach(() => mock.restoreAll());

    const statusCtx = (w, status) => ({
        tenantId: w.tenant._id, userId: w.customer.user._id,
        vars: { orderNo: 7, status, orderType: 'delivery' }, data: { orderId: 'a', orderNo: 7, status },
    });

    test('online: live message AND a push, no SMS, and the inbox row is saved', async () => {
        const w = await makeWorld('wf-online');
        const calls = fakes({ online: true });
        const doc = await center.notify('order_status', statusCtx(w, 'accepted'));
        assert.equal(calls.live.length, 1);
        assert.equal(String(calls.live[0].userId), String(w.customer.user._id));
        assert.equal(calls.push.length, 1, 'the phone is always buzzed as well as the live message');
        assert.equal(calls.sms.length, 0);
        assert.match(doc.title, /accepted/);
        assert.equal(await count({ tenantId: w.tenant._id, userId: w.customer.user._id }), 1);
    });

    test('offline with a phone token: push only', async () => {
        const w = await makeWorld('wf-push');
        const calls = fakes({ online: false, push: { sent: 1, tokens: 1 } });
        await center.notify('order_status', statusCtx(w, 'accepted'));
        assert.equal(calls.live.length, 0);
        assert.equal(calls.push.length, 1);
        assert.equal(calls.sms.length, 0);
        assert.equal(await count({ tenantId: w.tenant._id }), 1);
    });

    test('offline with no phone token: an SMS for a key event, and it is marked sent', async () => {
        const w = await makeWorld('wf-sms');
        const calls = fakes({ online: false, push: { sent: 0, tokens: 0 }, sms: { sent: true } });
        const doc = await center.notify('order_status', statusCtx(w, 'out_for_delivery'));
        assert.equal(calls.push.length, 1);
        assert.equal(calls.sms.length, 1);
        assert.equal(calls.sms[0].eventKey, 'order_status');
        assert.ok((await Notification.findById(doc._id)).smsSentAt);
    });

    test('offline with no token but NOT a key event: no SMS, the inbox row is still saved', async () => {
        const w = await makeWorld('wf-notkey');
        const calls = fakes({ online: false });
        await center.notify('order_status', statusCtx(w, 'preparing'));
        assert.equal(calls.sms.length, 0);
        assert.equal(await count({ tenantId: w.tenant._id }), 1);
    });

    test('a rider never gets an SMS', async () => {
        const w = await makeWorld('wf-rider');
        const calls = fakes({ online: false });
        await center.notify('rider_offer', {
            tenantId: w.tenant._id, userId: w.rider.user._id, vars: { orderNo: 3, secs: 120 }, data: { orderNo: 3 },
        });
        assert.equal(calls.sms.length, 0);
        assert.equal(await count({ tenantId: w.tenant._id, userId: w.rider.user._id }), 1);
    });

    test('alsoPush: a new order reaches an online owner by live message AND push', async () => {
        const w = await makeWorld('wf-alsopush');
        const calls = fakes({ online: true, push: { sent: 1, tokens: 1 } });
        const doc = await center.notify('order_new', {
            tenantId: w.tenant._id, vars: { orderNo: 5, total: 100, orderType: 'delivery' }, data: { orderNo: 5, total: 100 },
        });
        assert.equal(calls.live.length, 1);
        assert.equal(calls.push.length, 1);
        assert.equal(calls.sms.length, 0);
        assert.ok((await Notification.findById(doc._id)).escalateAt);   // the SMS follows if he never reads it
    });

    test('a rule from the database can change the channels, and a rule can switch an event off', async () => {
        const w = await makeWorld('wf-rules');
        try {
            await NotificationRule.create({ eventKey: 'order_status', channels: ['inapp', 'push'] });   // no SMS for anybody
            rules.invalidate();
            const calls = fakes({ online: false });
            await center.notify('order_status', statusCtx(w, 'accepted'));
            assert.equal(calls.sms.length, 0);

            await NotificationRule.deleteMany({});
            await NotificationRule.create({ eventKey: 'order_status', tenantId: w.tenant._id, enabled: false });   // this shop only
            rules.invalidate();
            const off = await center.notify('order_status', statusCtx(w, 'accepted'));
            assert.equal(off, null);
            assert.equal(await count({ tenantId: w.tenant._id }), 1);   // only the first one was saved
        } finally {
            await NotificationRule.deleteMany({});
            rules.invalidate();
        }
    });

    test('an unread message gets its SMS after the wait, once, and a read one never does', async () => {
        await Notification.deleteMany({});   // the job looks at every shop, so start clean (an earlier test left an unread new-order row)
        const w = await makeWorld('wf-escalate');
        const calls = fakes({ online: true, push: { sent: 1, tokens: 1 } });
        const mk = (orderNo) => center.notify('order_new', {
            tenantId: w.tenant._id, vars: { orderNo, total: 100, orderType: 'delivery' }, data: { orderNo, total: 100 },
        });
        const unread = await mk(11);
        const read = await mk(12);
        await Notification.updateOne({ _id: read._id }, { $set: { readAt: new Date() } });
        assert.equal(calls.sms.length, 0);

        assert.equal(await runEscalation(new Date(Date.now() + 10 * 1000)), 0);       // too early
        assert.equal(await runEscalation(new Date(Date.now() + 181 * 1000)), 1);      // 3 minutes later: only the unread one
        assert.equal(calls.sms.length, 1);
        assert.equal(await runEscalation(new Date(Date.now() + 400 * 1000)), 0);      // never twice
        assert.equal(calls.sms.length, 1);
        assert.ok((await Notification.findById(unread._id)).smsSentAt);
    });

    test('the owner switch: smsAlerts false means no key-event SMS', async () => {
        const t = await makeTenant('wf-switch', { settings: { notifications: { smsAlerts: false } } });
        await makeUser(t, 'admin', '9000000010');
        const r = await smsChannel.send({ eventKey: 'order_new', ctx: { tenantId: t._id, data: { orderNo: 5, total: 100 } } });
        assert.equal(r.sent, false);
        assert.equal(r.reason, 'switched_off');
    });

    test('the SMS is paid from the shop wallet, with the right text, and a failed SMS is refunded', async () => {
        const t = await makeTenant('wf-wallet');
        const owner = await makeUser(t, 'admin', '9000000010');
        process.env.SMS_WALLET_IN_MOCK = 'true';   // make the wallet really charge, even in mock SMS mode
        try {
            await wallet.credit({ tenantId: t._id, amountPaise: 100, type: 'adjust', note: 'test', actor: { type: 'system' } });

            const spy = mock.method(smsAdapter, 'send', async () => ({ providerMessageId: 'x' }));
            const ok = await smsChannel.send({ eventKey: 'order_new', ctx: { tenantId: t._id, data: { orderNo: 5, total: 100 } } });
            assert.equal(ok.sent, true);
            assert.equal(spy.mock.calls.length, 1);
            const arg = spy.mock.calls[0].arguments[0];
            assert.equal(arg.to, owner.user.phone);
            assert.equal(arg.text, 'New order #5 (Rs 100) at Shop wf-wallet. Please open the app to accept it.');
            assert.equal((await SmsWallet.findOne({ tenantId: t._id })).balancePaise, 70);
            assert.equal(await SmsLog.countDocuments({ tenantId: t._id, purpose: 'order', status: 'mock' }), 1);

            mock.restoreAll();
            mock.method(smsAdapter, 'send', async () => { throw new Error('provider down'); });
            const failed = await smsChannel.send({ eventKey: 'order_new', ctx: { tenantId: t._id, data: { orderNo: 6, total: 100 } } });
            assert.equal(failed.sent, false);
            assert.equal((await SmsWallet.findOne({ tenantId: t._id })).balancePaise, 70);   // given back
            assert.equal((await wallet.reconcileWallet(t._id)).differencePaise, 0);
            assert.equal(await SmsLog.countDocuments({ tenantId: t._id, status: 'failed' }), 1);
        } finally {
            delete process.env.SMS_WALLET_IN_MOCK;
        }
    });

    test('no SMS when the shop wallet is empty (the inbox row is still saved)', async () => {
        const t = await makeTenant('wf-empty');
        await makeUser(t, 'admin', '9000000010');
        process.env.SMS_WALLET_IN_MOCK = 'true';
        try {
            const spy = mock.method(smsAdapter, 'send', async () => ({}));
            const r = await smsChannel.send({ eventKey: 'order_new', ctx: { tenantId: t._id, data: { orderNo: 5, total: 100 } } });
            assert.equal(r.sent, false);
            assert.equal(spy.mock.calls.length, 0);
        } finally {
            delete process.env.SMS_WALLET_IN_MOCK;
        }
    });

    test('the SMS text fits its DLT template: the right number of variables', () => {
        for (const [key, t] of Object.entries(smsTemplates.TEMPLATES)) {
            assert.equal((t.text.match(/\{#var#\}/g) || []).length, t.vars.length, `${key}: variables do not match`);
        }
        assert.equal(smsTemplates.build('order_status', { status: 'delivered', orderNo: 9, shop: 'Savera' }).text,
            'Your order #9 from Savera was delivered. Thank you!');
        assert.equal(smsTemplates.build('order_status', { status: 'preparing' }), null);   // no SMS text for this step
        for (const key of Object.keys(EVENTS)) assert.ok(EVENTS[key].channels.length >= 1, key);
    });

    test('the old helpers still work and keep their names', async () => {
        const w = await makeWorld('wf-wrappers');
        const calls = fakes({ online: false });

        const a = await notify.toOwner(w.tenant._id, { type: 'platform_message', title: 'Hello', body: 'From the platform' });
        assert.equal(a.title, 'Hello');
        assert.equal(a.role, 'owner');
        const b = await notify.toUser(w.tenant._id, w.customer.user._id, { type: 'platform_message', title: 'Hi you' });
        assert.equal(String(b.userId), String(w.customer.user._id));
        const c = await notify.send({ tenantId: w.tenant._id, role: 'superadmin', type: 'order_escalated', title: 'X' });
        assert.equal(c.role, 'superadmin');
        assert.equal(calls.live.length + calls.push.length + calls.sms.length, 2);   // only the first two travelled (push each)

        const order = await makeOrder(w.tenant, w.customer.user);
        notify.orderPlaced(order);
        assert.ok(await waitFor(async () => (await count({ tenantId: w.tenant._id, type: 'order_new' })) === 1));
        const row = await Notification.findOne({ tenantId: w.tenant._id, type: 'order_new' });
        assert.equal(row.body, `Test item · Delivery · Cash on delivery`);   // the dishes, the kind of order and how it is paid

        notify.orderStatusChanged(order, 'accepted', { type: 'owner' });
        assert.ok(await waitFor(async () => (await count({ tenantId: w.tenant._id, type: 'order_status' })) === 1));
        const st = await Notification.findOne({ tenantId: w.tenant._id, type: 'order_status' });
        assert.match(st.title, /accepted/);
        assert.match(st.body, /getting started/);
        assert.equal(String(st.userId), String(w.customer.user._id));
    });

    test('presence follows real connections', async () => {
        const w = await makeWorld('wf-presence');
        const server = http.createServer();
        realtime.init(server);
        await new Promise((resolve) => server.listen(0, resolve));
        const client = connect(`http://localhost:${server.address().port}`, {
            auth: { token: w.owner.accessToken, tenant: w.tenant.slug }, transports: ['websocket'],
        });
        try {
            await new Promise((resolve, reject) => { client.on('connect', resolve); client.on('connect_error', reject); });
            assert.equal(presence.isOnline(w.tenant._id, w.owner.user._id), true);
            assert.equal(presence.ownerOnline(w.tenant._id), true);
            assert.equal(presence.isOnline(w.tenant._id, w.customer.user._id), false);   // another person
            client.close();
            assert.ok(await waitFor(() => !presence.isOnline(w.tenant._id, w.owner.user._id)));
            assert.equal(presence.ownerOnline(w.tenant._id), false);
        } finally {
            client.close();
            server.closeAllConnections?.();
            server.close();
        }
    });
});