require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const notify = require('../src/services/notificationService');
const center = require('../src/notifications/center');
const FeedEvent = require('../src/models/FeedEvent');

before(() => db.connect());
after(() => db.disconnect());
beforeEach(() => FeedEvent.deleteMany({}));

const waitCount = (tenantId, n) => f.waitFor(async () => (await FeedEvent.countDocuments({ tenantId })) >= n);
const rows = (tenantId) => FeedEvent.find({ tenantId }).sort({ at: 1 }).lean();
const one = async (tenantId, type) => (await rows(tenantId)).find((r) => r.type === type);

describe('feed lines from the order and rider notifications', () => {
    test('a new order makes an "order.placed" line, without any phone number', async () => {
        const w = await f.makeWorld('hook-placed');
        const order = await f.makeOrder(w.tenant, w.customer.user);
        notify.orderPlaced(order);
        await waitCount(w.tenant._id, 1);
        const row = await one(w.tenant._id, 'order.placed');
        assert.equal(row.category, 'orders');
        assert.equal(row.data.orderNo, order.orderNo);
        assert.equal(typeof row.data.total, 'number');
        assert.ok(!JSON.stringify(row).includes('9000000030'));
    });

    test('no rider free, rider removed and rider problem each make a "riders" line', async () => {
        const w = await f.makeWorld('hook-three');
        const order = await f.makeOrder(w.tenant, w.customer.user);
        const tenantId = w.tenant._id;
        notify.noRiderFree({ tenantId, orderId: order._id, orderNo: order.orderNo });
        notify.riderRemoved({ tenantId, riderUserId: w.rider.user._id, orderId: order._id, orderNo: order.orderNo });
        await notify.riderProblem({ tenantId, orderId: order._id, orderNo: order.orderNo, riderUserId: w.rider.user._id, reason: 'customer_unreachable', note: 'call 9876543210' });
        await waitCount(tenantId, 3);
        const list = await rows(tenantId);
        assert.deepEqual(list.map((r) => r.type).sort(), ['rider.none', 'rider.problem', 'rider.removed']);
        assert.ok(list.every((r) => r.category === 'riders'));
        assert.equal((await one(tenantId, 'rider.problem')).data.reason, 'customer_unreachable');
        assert.ok(!JSON.stringify(list).includes('9876543210'));
    });

    test('a rider who accepts and a rider who says no both make a line', async () => {
        const w = await f.makeWorld('hook-accept');
        const order = await f.makeOrder(w.tenant, w.customer.user);
        const plain = { ...order.toObject(), delivery: { riderId: w.rider.user._id, status: 'accepted' } };
        await notify.riderAccepted(plain);
        await notify.riderRejected({ tenantId: w.tenant._id, orderId: order._id, riderUserId: w.rider.user._id });
        await waitCount(w.tenant._id, 2);
        const accepted = await one(w.tenant._id, 'rider.accepted');
        assert.equal(accepted.data.riderId, String(w.rider.user._id));
        assert.equal(accepted.data.orderNo, order.orderNo);
        assert.ok(await one(w.tenant._id, 'rider.rejected'));
    });

    test('asking all free riders makes one "rider.offered" line with the number of riders', async () => {
        const w = await f.makeWorld('hook-offer');
        const order = await f.makeOrder(w.tenant, w.customer.user);
        const plain = { ...order.toObject(), delivery: { broadcast: { expiresAt: new Date(Date.now() + 120000) } } };
        notify.riderBroadcast(plain, [w.rider.user._id]);
        await waitCount(w.tenant._id, 1);
        const row = await one(w.tenant._id, 'rider.offered');
        assert.equal(row.data.riders, 1);
        assert.equal(row.data.orderNo, order.orderNo);
    });

    test('a low delivery rating makes a line, and the comment is not copied', async () => {
        const w = await f.makeWorld('hook-rating');
        await notify.lowDeliveryRating({
            tenantId: w.tenant._id, orderId: w.tenant._id, orderNo: 5, rating: 1,
            riderUserId: w.rider.user._id, comment: 'call me on 9876543210',
        });
        await waitCount(w.tenant._id, 1);
        const row = await one(w.tenant._id, 'rider.low_rating');
        assert.equal(row.data.rating, 1);
        assert.ok(!JSON.stringify(row).includes('call me'));
    });

    test('a failing feed never breaks the notification', async () => {
        const w = await f.makeWorld('hook-safe');
        const order = await f.makeOrder(w.tenant, w.customer.user);
        // a broken order object must be swallowed by the notification, not thrown
        assert.doesNotThrow(() => notify.orderPlaced({ ...order.toObject(), pricing: null }));
        assert.doesNotThrow(() => notify.noRiderFree({ tenantId: null, orderId: order._id, orderNo: 1 }));
    });
    describe('feed lines from billing, SMS wallet and platform messages', () => {
        test('billing events make "billing" lines', async () => {
            const w = await f.makeWorld('hook-bill');
            await center.notify('bill_issued', { tenantId: w.tenant._id, vars: {}, data: { invoiceNo: 'INV-1' } });
            await center.notify('shop_paused', { tenantId: w.tenant._id, vars: {} });
            await waitCount(w.tenant._id, 2);
            const list = await rows(w.tenant._id);
            assert.deepEqual(list.map((r) => r.type).sort(), ['bill.issued', 'shop.paused']);
            assert.ok(list.every((r) => r.category === 'billing'));
            assert.equal((await one(w.tenant._id, 'bill.issued')).data.invoiceNo, 'INV-1');
        });

        test('SMS wallet events make "sms" lines', async () => {
            const w = await f.makeWorld('hook-smsw');
            await center.notify('sms_low', { tenantId: w.tenant._id, vars: {} });
            await center.notify('sms_zero', { tenantId: w.tenant._id, vars: {} });
            await center.notify('sms_topup_done', { tenantId: w.tenant._id, vars: {} });
            await waitCount(w.tenant._id, 3);
            const list = await rows(w.tenant._id);
            assert.deepEqual(list.map((r) => r.type).sort(), ['sms.low', 'sms.topup', 'sms.zero']);
            assert.ok(list.every((r) => r.category === 'sms'));
        });

        test('a message from the platform makes a "messages" line', async () => {
            const w = await f.makeWorld('hook-msg');
            await center.notify('platform_message', { tenantId: w.tenant._id, title: 'Hello', body: 'Welcome' });
            await waitCount(w.tenant._id, 1);
            assert.equal((await one(w.tenant._id, 'message.platform')).category, 'messages');
        });

        test('messages to a customer or a rider, and unlisted events, make no line here', async () => {
            const w = await f.makeWorld('hook-none');
            await center.notify('sms_zero', { tenantId: w.tenant._id, userId: w.customer.user._id, vars: {} });
            await center.notify('order_new', { tenantId: w.tenant._id, vars: { orderNo: 1, total: 10, orderType: 'delivery' } });
            await f.sleep(250);
            assert.equal(await FeedEvent.countDocuments({ tenantId: w.tenant._id }), 0);
        });
    });
});