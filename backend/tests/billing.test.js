require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { DEFAULT_TIERS, feeForCount, freeStatus } = require('../src/utils/billingRules');
const billable = require('../src/services/billableService');
const orderStatus = require('../src/services/orderStatusService');
const { generateForPeriod, syncFreeState } = require('../src/services/subscriptionService');
const { runAlerts } = require('../src/services/billingAlerts');
const wallet = require('../src/services/smsWalletService');
const smsChannel = require('../src/notifications/channels/sms');
const { runInactiveShops } = require('../src/jobs/inactiveShops');
const { migrate } = require('../scripts/migrateBillableCount');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const Notification = require('../src/models/Notification');
const SubscriptionInvoice = require('../src/models/SubscriptionInvoice');
const PlatformSettings = require('../src/models/PlatformSettings');
const { makeTenant, makeUser, makeOrder, makeSuperAdmin, waitFor, sleep } = require('./helpers/factory');

const DAY = 86400000;
const live = (extra = {}) => ({ billing: { state: 'free', isLive: true, goLiveAt: new Date(Date.now() - 60000), ...extra } });
const adminCount = (type, tenantId) => Notification.countDocuments({ role: 'superadmin', type, ...(tenantId && { tenantId }) });
const billingOf = async (t) => (await Tenant.findById(t._id).lean()).billing;
const deliver = async (order, actor = { type: 'superadmin', label: 'test' }) =>
    orderStatus.change({ order: await Order.findById(order._id), status: 'delivered', actor });

let bulkSeq = 500000;
const bulk = (t, user, n, at, extra = {}) => Order.insertMany(Array.from({ length: n }, () => ({
    tenantId: t._id, userId: user._id, orderNo: ++bulkSeq, status: 'delivered', orderType: 'delivery',
    items: [{ productId: new mongoose.Types.ObjectId(), name: 'Item', quantity: 1, unitPrice: 100, lineTotal: 100 }],
    pricing: { subtotal: 100, total: 100 }, payment: { method: 'cod' },
    billing: { billable: true, at }, ...extra,
})));

let invoiceSeq = 0;
const makeInvoice = (tenant, o = {}) => SubscriptionInvoice.create({
    tenantId: tenant._id, kind: 'custom', invoiceNo: `SUB/2026-27/${String(++invoiceSeq + 300).padStart(4, '0')}`,
    issueDate: new Date(), dueDate: new Date(Date.now() + 7 * DAY), graceEndsAt: new Date(Date.now() + 5 * DAY),
    description: 'Setup', lineItems: [{ description: 'Setup', qty: 1, rate: 1000, amount: 1000 }],
    baseAmount: 1000, gstPercent: 0, gstAmount: 0, total: 1000,
    seller: { legalName: 'Acme Pvt Ltd' }, buyer: { legalName: tenant.name }, ...o,
});

describe('billing rules (no database)', () => {
    test('D11: the tiers change exactly at 305, 306, 1005 and 1006', () => {
        const at = (n) => feeForCount(DEFAULT_TIERS, n);
        assert.deepEqual([at(0).fee, at(305).fee, at(306).fee, at(1005).fee, at(1006).fee], [3000, 3000, 6000, 6000, 10000]);
        assert.equal(at(305).label, '0 to 305 orders');
        assert.equal(at(306).label, '306 to 1005 orders');
        assert.equal(at(1005).label, '306 to 1005 orders');
        assert.equal(at(1006).label, '1006+ orders');
    });

    test('B9: a shop that is not live is free for ever, even with an old creation date', () => {
        const shop = { createdAt: new Date('2024-01-01'), billing: { state: 'active', billableCount: 500 } };
        const f = freeStatus(shop, null);
        assert.equal(f.free, true);
        assert.equal(f.live, false);
        assert.equal(f.endsAt, null);
    });

    test('a live shop is free until 100 billable orders or 2 months after go-live, and the old deliveredCount is ignored', () => {
        const at = (billing) => freeStatus({ billing: { isLive: true, goLiveAt: new Date(Date.now() - DAY), ...billing } }, null).free;
        assert.equal(at({ billableCount: 99 }), true);
        assert.equal(at({ billableCount: 100 }), false);
        assert.equal(at({ billableCount: 3, deliveredCount: 900 }), true);
        assert.equal(at({ billableCount: 5, goLiveAt: new Date(Date.now() - 70 * DAY) }), false);
        assert.equal(at({ billableCount: 100, freeOrdersOverride: 200 }), true);   // a raised limit reopens free service
    });
});

describe('billable orders', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(() => { mock.method(smsChannel, 'send', async () => ({ sent: false })); });
    afterEach(() => mock.restoreAll());

    test('a delivered order becomes billable once, and the shop counter goes up with it', async () => {
        const t = await makeTenant('bl-basic', live());
        const c = await makeUser(t, 'customer', '9000000001');
        const order = await makeOrder(t, c.user, { status: 'preparing' });
        await deliver(order);
        const o = await Order.findById(order._id);
        assert.equal(o.billing.billable, true);
        assert.equal(o.billing.reason, 'delivered');
        assert.ok(o.billing.at);
        assert.equal((await billingOf(t)).billableCount, 1);
    });

    test('delivered by the owner (pickup order) counts too', async () => {
        const t = await makeTenant('bl-owner', live());
        const owner = await makeUser(t, 'admin', '9000000010');
        const c = await makeUser(t, 'customer', '9000000001');
        const order = await makeOrder(t, c.user, { status: 'ready', orderType: 'pickup' });
        await deliver(order, { type: 'owner', id: owner.user._id, label: owner.user.phone });
        assert.equal((await Order.findById(order._id)).billing.billable, true);
        assert.equal((await billingOf(t)).billableCount, 1);
    });

    test('an order bought by the shop owner (a test order) is never billable', async () => {
        const t = await makeTenant('bl-test-order', live());
        const owner = await makeUser(t, 'admin', '9000000010');
        const order = await makeOrder(t, owner.user, { status: 'preparing' });
        await deliver(order);
        assert.notEqual((await Order.findById(order._id)).billing?.billable, true);
        assert.equal((await billingOf(t)).billableCount, 0);
    });

    test('an order placed before go-live is never billable, even if delivered after it', async () => {
        const t = await makeTenant('bl-before', live());
        const c = await makeUser(t, 'customer', '9000000001');
        const order = await makeOrder(t, c.user, { status: 'preparing', createdAt: new Date(Date.now() - 3600000) });
        await deliver(order);
        assert.notEqual((await Order.findById(order._id)).billing?.billable, true);
        assert.equal((await billingOf(t)).billableCount, 0);
    });

    test('a shop that is not live yet counts nothing', async () => {
        const t = await makeTenant('bl-notlive');
        const c = await makeUser(t, 'customer', '9000000001');
        const order = await makeOrder(t, c.user, { status: 'preparing' });
        await deliver(order);
        assert.notEqual((await Order.findById(order._id)).billing?.billable, true);
        assert.equal((await billingOf(t)).billableCount, 0);
    });

    test('five calls at the same moment count the order exactly once', async () => {
        const t = await makeTenant('bl-parallel', live());
        const c = await makeUser(t, 'customer', '9000000001');
        const order = await Order.findById((await makeOrder(t, c.user, { status: 'delivered' }))._id);
        const results = await Promise.all(Array.from({ length: 5 }, () => billable.markBillable(order, 'delivered')));
        assert.equal(results.filter((r) => r.marked).length, 1);
        assert.equal((await billingOf(t)).billableCount, 1);
    });

    test('the superadmin hears about the first billable order, once', async () => {
        const t = await makeTenant('bl-first', live());
        const c = await makeUser(t, 'customer', '9000000001');
        await deliver(await makeOrder(t, c.user, { status: 'preparing' }));
        assert.ok(await waitFor(async () => (await adminCount('admin_shop_first_order', t._id)) === 1));
        await deliver(await makeOrder(t, c.user, { status: 'preparing' }));
        await sleep(500);
        assert.equal(await adminCount('admin_shop_first_order', t._id), 1);
        assert.equal((await billingOf(t)).billableCount, 2);
    });

    test('D10: the month is the Indian calendar month the order became billable, and only billable orders count', async () => {
        const t = await makeTenant('bl-month', live());
        const c = await makeUser(t, 'customer', '9000000001');
        const mk = (at, billing) => makeOrder(t, c.user, { status: 'delivered', billing });
        await mk(null, { billable: true, at: new Date('2026-09-30T20:00:00Z') });   // 1 Oct, 01:30 in India
        await mk(null, { billable: true, at: new Date('2026-10-31T17:00:00Z') });   // 31 Oct, 22:30 in India
        await mk(null, { billable: true, at: new Date('2026-10-31T18:45:00Z') });   // 1 Nov, 23:30 in India
        await mk(null, { billable: false, at: new Date('2026-10-15T10:00:00Z') });   // delivered but did not earn money
        await makeOrder(t, c.user, { status: 'delivered' });                          // delivered, never flagged
        assert.equal(await billable.countInPeriod(t._id, '2026-09'), 0);
        assert.equal(await billable.countInPeriod(t._id, '2026-10'), 2);
        assert.equal(await billable.countInPeriod(t._id, '2026-11'), 1);
        await assert.rejects(() => billable.countInPeriod(t._id, 'nonsense'), (e) => e.status === 400);
    });

    test('the monthly bill counts billable orders, and ignores delivered orders that earned nothing', async () => {
        const t = await makeTenant('bl-invoice', live({
            goLiveAt: new Date('2025-01-10T00:00:00Z'), billableCount: 500, state: 'active',
        }));
        const c = await makeUser(t, 'customer', '9000000001');
        await PlatformSettings.findByIdAndUpdate('main', { $set: { 'business.legalName': 'Acme Pvt Ltd' } }, { upsert: true });
        try {
            await bulk(t, c.user, 306, new Date('2025-06-15T10:00:00Z'));             // 306 orders in June 2025
            await bulk(t, c.user, 5, new Date('2025-06-16T10:00:00Z'), { billing: { billable: false } });
            await bulk(t, c.user, 1, new Date('2025-07-02T10:00:00Z'));               // a July order
            const r = await generateForPeriod({ period: '2025-06', tenantId: t._id });
            assert.equal(r.created, 1);
            const inv = await SubscriptionInvoice.findOne({ tenantId: t._id, period: '2025-06' }).lean();
            assert.equal(inv.orderCount, 306);
            assert.equal(inv.baseAmount, 6000);
            assert.equal(inv.tierLabel, '306 to 1005 orders');
            assert.ok(inv.lineItems[0].description.includes('306 orders'));
        } finally {
            await PlatformSettings.deleteMany({});
        }
    });

    test('B9: a shop that is not live gets no rent bill, however old it is', async () => {
        const t = await makeTenant('bl-old-notlive', { createdAt: new Date('2024-01-01T00:00:00Z') });
        await PlatformSettings.findByIdAndUpdate('main', { $set: { 'business.legalName': 'Acme Pvt Ltd' } }, { upsert: true });
        try {
            const r = await generateForPeriod({ period: '2025-06', tenantId: t._id });
            assert.equal(r.created, 0);
            assert.equal(r.skipped.in_free_service, 1);
        } finally {
            await PlatformSettings.deleteMany({});
        }
    });

    test('the free period ends at the order limit, and the superadmin hears it once', async () => {
        const t = await makeTenant('bl-free-end', live({ billableCount: 99 }));
        const c = await makeUser(t, 'customer', '9000000001');
        const fresh = () => Tenant.findById(t._id).select('createdAt billing').lean();

        assert.equal(await syncFreeState(await fresh(), null), 'free');
        await deliver(await makeOrder(t, c.user, { status: 'preparing' }));          // the 100th order
        assert.equal((await billingOf(t)).billableCount, 100);
        assert.equal(await syncFreeState(await fresh(), null), 'active');
        assert.ok(await waitFor(async () => (await adminCount('admin_free_ended', t._id)) === 1));
        assert.ok((await billingOf(t)).freeEndedAt);

        await syncFreeState(await fresh(), null);                                    // up to date: nothing more
        await sleep(400);
        assert.equal(await adminCount('admin_free_ended', t._id), 1);
    });
});

describe('go live', () => {
    let auth;
    before(async () => {
        await db.connect();
        auth = { Authorization: `Bearer ${(await makeSuperAdmin('golive@example.com')).token}` };
    });
    after(() => db.disconnect());
    beforeEach(() => { mock.method(smsChannel, 'send', async () => ({ sent: false })); });
    afterEach(() => mock.restoreAll());

    const goLive = (t, body) => request(app).post(`/api/admin/tenants/${t._id}/billing/go-live`).set(auth).send(body);

    test('only a superadmin can press it, and bad input is refused', async () => {
        const t = await makeTenant('gl-auth');
        assert.equal((await request(app).post(`/api/admin/tenants/${t._id}/billing/go-live`).send({})).status, 401);
        assert.equal((await request(app).post(`/api/admin/tenants/${new mongoose.Types.ObjectId()}/billing/go-live`).set(auth).send({})).status, 404);
        assert.equal((await goLive(t, { force: 'yes' })).status, 400);
        assert.equal((await billingOf(t)).isLive, false);
    });

    test('it starts the free period now, and a second press needs force', async () => {
        const t = await makeTenant('gl-basic');
        const before = Date.now();
        const first = await goLive(t, {});
        assert.equal(first.status, 200);
        const b = await billingOf(t);
        assert.equal(b.isLive, true);
        assert.equal(b.state, 'free');
        assert.equal(b.billableCount, 0);
        assert.ok(new Date(b.goLiveAt).getTime() >= before - 1000);

        assert.equal((await goLive(t, {})).status, 409);                             // already live
        await Tenant.updateOne({ _id: t._id }, { $set: { 'billing.billableCount': 40 } });
        assert.equal((await goLive(t, { force: true })).status, 200);
        assert.equal((await billingOf(t)).billableCount, 0);                         // the free period starts again
    });

    test('it clears an old "free ended" and grace state', async () => {
        const t = await makeTenant('gl-clear', {
            billing: { state: 'active', billableCount: 50, freeEndedAt: new Date(Date.now() - 30 * DAY), graceEndsAt: new Date() },
        });
        assert.equal((await goLive(t, {})).status, 200);
        const b = await billingOf(t);
        assert.equal(b.state, 'free');
        assert.equal(b.billableCount, 0);
        assert.equal(b.freeEndedAt, undefined);
        assert.equal(b.graceEndsAt, undefined);
    });

    test('an unpaid bill is still enforced after a forced go-live', async () => {
        const t = await makeTenant('gl-owing', { billing: { state: 'paused' } });
        await makeInvoice(t, { graceEndsAt: new Date(Date.now() - DAY) });
        assert.equal((await goLive(t, {})).status, 200);
        assert.equal((await billingOf(t)).state, 'paused');
    });

    test('orders placed before go-live never count, orders placed after it do', async () => {
        const t = await makeTenant('gl-orders');
        const c = await makeUser(t, 'customer', '9000000001');
        const older = await makeOrder(t, c.user, { status: 'preparing', createdAt: new Date(Date.now() - 3600000) });
        assert.equal((await goLive(t, {})).status, 200);
        const newer = await makeOrder(t, c.user, { status: 'preparing' });
        await deliver(older);
        await deliver(newer);
        assert.notEqual((await Order.findById(older._id)).billing?.billable, true);
        assert.equal((await Order.findById(newer._id)).billing.billable, true);
        assert.equal((await billingOf(t)).billableCount, 1);
    });
});

describe('billing alerts, quiet shops and the migration', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(() => { mock.method(smsChannel, 'send', async () => ({ sent: false })); });
    afterEach(() => mock.restoreAll());

    test('B10: a shop that is not live gets no SMS balance alerts, a live one does', async () => {
        process.env.SMS_WALLET_IN_MOCK = 'true';
        try {
            const notLive = await makeTenant('al-notlive');
            const liveShop = await makeTenant('al-live', live());
            await wallet.getWallet(notLive._id);
            await wallet.getWallet(liveShop._id);          // both wallets are empty
            await runAlerts();
            assert.ok(await waitFor(async () => (await Notification.countDocuments({ tenantId: liveShop._id, role: 'owner', type: 'sms_zero' })) === 1));
            assert.ok(await waitFor(async () => (await adminCount('admin_sms_zero', liveShop._id)) === 1));
            await sleep(500);
            assert.equal(await Notification.countDocuments({ tenantId: notLive._id, type: 'sms_zero' }), 0);
            assert.equal(await adminCount('admin_sms_zero', notLive._id), 0);
        } finally {
            delete process.env.SMS_WALLET_IN_MOCK;
        }
    });

    test('a live shop with no billable order for 14 days alerts the superadmin once per quiet spell', async () => {
        await db.clear();
        const old = new Date(Date.now() - 20 * DAY);
        const quiet = await makeTenant('in-quiet', live({ goLiveAt: old }));
        const busy = await makeTenant('in-busy', live({ goLiveAt: old }));
        const fresh = await makeTenant('in-fresh', live({ goLiveAt: new Date(Date.now() - 3 * DAY) }));
        const notLive = await makeTenant('in-notlive');
        const c = await makeUser(busy, 'customer', '9000000001');
        await makeOrder(busy, c.user, { status: 'delivered', billing: { billable: true, at: new Date(Date.now() - 2 * DAY) } });

        assert.equal(await runInactiveShops(), 1);
        assert.equal(await adminCount('admin_shop_inactive', quiet._id), 1);
        for (const t of [busy, fresh, notLive]) assert.equal(await adminCount('admin_shop_inactive', t._id), 0);
        assert.equal(await runInactiveShops(), 0);                                     // not twice for the same spell

        // an order ends the quiet spell. 20 days later he is quiet again, so he is told again.
        const quietUser = await makeUser(quiet, 'customer', '9000000002');
        await makeOrder(quiet, quietUser.user, { status: 'delivered', billing: { billable: true, at: new Date(Date.now() + DAY) } });
        assert.equal(await runInactiveShops(new Date(Date.now() + 20 * DAY)), 3);
        assert.equal(await adminCount('admin_shop_inactive', quiet._id), 2);    });

    test('the migration moves old counts, marks delivered orders and running shops, and is safe to run twice', async () => {
        await db.clear();
        const created = new Date('2025-01-01T00:00:00Z');
        const old = await Tenant.collection.insertOne({
            slug: 'old-shop', name: 'Old shop', createdAt: created, updatedAt: created, settings: {},
            billing: { state: 'active', deliveredCount: 7 },
        });
        const fresh = await Tenant.collection.insertOne({
            slug: 'new-shop', name: 'New shop', createdAt: new Date(), updatedAt: new Date(), settings: {},
            billing: { state: 'free', deliveredCount: 0 },
        });
        const userId = new mongoose.Types.ObjectId();
        const delivered = new Date('2025-02-03T10:00:00Z');
        const base = { userId, orderType: 'delivery', items: [], pricing: { total: 1 }, payment: { method: 'cod' } };
        await Order.collection.insertOne({ ...base, tenantId: old.insertedId, orderNo: 1, status: 'delivered', deliveredAt: delivered });
        await Order.collection.insertOne({ ...base, tenantId: old.insertedId, orderNo: 2, status: 'cancelled' });

        assert.deepEqual(await migrate({ apply: false }), { tenants: 2, orders: 1, live: 1 });
        assert.equal((await Tenant.findById(old.insertedId).lean()).billing.billableCount, undefined);   // a dry run changes nothing

        await migrate({ apply: true });
        const o = (await Tenant.findById(old.insertedId).lean()).billing;
        assert.equal(o.billableCount, 7);
        assert.equal(o.isLive, true);
        assert.equal(new Date(o.goLiveAt).getTime(), created.getTime());
        const f = (await Tenant.findById(fresh.insertedId).lean()).billing;
        assert.equal(f.billableCount, 0);
        assert.notEqual(f.isLive, true);                                               // not running yet: stays free until Go live
        const doneOrder = await Order.findOne({ tenantId: old.insertedId, orderNo: 1 }).lean();
        assert.equal(doneOrder.billing.billable, true);
        assert.equal(new Date(doneOrder.billing.at).getTime(), delivered.getTime());
        assert.equal((await Order.findOne({ tenantId: old.insertedId, orderNo: 2 }).lean()).billing, undefined);

        assert.deepEqual(await migrate({ apply: true }), { tenants: 0, orders: 0, live: 0 });
        assert.equal(await billable.countInPeriod(old.insertedId, '2025-02'), 1);      // the old month still counts
    });
});