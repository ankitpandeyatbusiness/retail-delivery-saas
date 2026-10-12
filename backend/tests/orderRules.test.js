require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const orderStatus = require('../src/services/orderStatusService');
const { cancelUnacceptedOrders } = require('../src/services/orderTimeout');
const { salesReport } = require('../src/services/reportService');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const smsChannel = require('../src/notifications/channels/sms');
const pushChannel = require('../src/notifications/channels/push');
const { hashPhone } = require('../src/utils/phoneHash');
const Order = require('../src/models/Order');
const Tenant = require('../src/models/Tenant');
const Rider = require('../src/models/Rider');
const Coupon = require('../src/models/Coupon');
const CustomerRisk = require('../src/models/CustomerRisk');
const Notification = require('../src/models/Notification');
const { makeTenant, makeUser, makeOrder, makeSuperAdmin, waitFor } = require('./helpers/factory');

// a LIVE shop (only live shops count billable orders), an owner, a rider, a customer and a coupon used 5 times
const LIVE = () => ({ billing: { state: 'free', isLive: true, goLiveAt: new Date(Date.now() - 60000) } });
async function shop(slug) {
    const tenant = await makeTenant(slug, LIVE());
    const owner = await makeUser(tenant, 'admin', '9000000010');
    const rider = await makeUser(tenant, 'rider', '9000000020');
    const customer = await makeUser(tenant, 'customer', '9000000030');
    const coupon = await Coupon.create({ tenantId: tenant._id, code: 'OFF10', discountType: 'flat', discountValue: 10, usedCount: 5 });
    return { tenant, owner, rider, customer, coupon };
}
const codOrder = (s, status, extra = {}) => makeOrder(s.tenant, s.customer.user, { status, couponId: s.coupon._id, ...extra });
const onlineOrder = (s, status, extra = {}) => makeOrder(s.tenant, s.customer.user, {
    status, couponId: s.coupon._id,
    payment: { method: 'upi', status: 'paid' },
    pricing: { subtotal: 500, tip: 20, total: 520 },
    statusHistory: [{ status: 'placed' }, { status: 'accepted', at: new Date(Date.now() - 10 * 60000) }],
    ...extra,
});
// a delivery order with the rider on his way and a problem reported `minutes` ago (null = no problem)
const stuck = (s, minutes, extra = {}) => codOrder(s, 'out_for_delivery', {
    delivery: {
        riderId: s.rider.user._id, status: 'picked_up',
        problems: minutes === null ? [] : [{ at: new Date(Date.now() - minutes * 60000), reason: 'cannot_reach' }],
    },
    ...extra,
});

const fresh = (o) => Order.findById(o._id);
const couponUsed = async (s) => (await Coupon.findById(s.coupon._id)).usedCount;
const risk = (s) => CustomerRisk.findOne({ tenantId: s.tenant._id, phoneHash: hashPhone(s.tenant._id, '9000000030') }).lean();
const billableCount = async (s) => (await Tenant.findById(s.tenant._id).lean()).billing.billableCount;
const customerActor = (s) => ({ type: 'customer', id: s.customer.user._id, label: '9000000030' });
const ownerActor = (s) => ({ type: 'owner', id: s.owner.user._id, label: '9000000010' });
const ownerPatch = (s, o, b) => request(app).patch(`/api/shop/orders/${o._id}/status`).set(s.owner.headers).send(b);
const customerCancel = async (s, o) => orderStatus.change({
    order: await fresh(o), status: 'cancelled', actor: customerActor(s), tenant: s.tenant,
});
const cancelOf = (o) => ({ by: o.cancel.by, code: o.cancel.reasonCode, kept: o.cancel.keptPaise, refund: o.cancel.refundPaise });

describe('cancel rules', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(() => {
        mock.method(smsChannel, 'send', async () => ({ sent: false }));
        mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
    });
    afterEach(() => mock.restoreAll());

    test('COD: a customer cancels for free while the order is placed or accepted, and the coupon use comes back', async () => {
        const s = await shop('or-cod-free');
        for (const status of ['placed', 'accepted']) {
            const o = await codOrder(s, status);
            const done = await orderStatus.change({ order: await fresh(o), status: 'cancelled', actor: customerActor(s), note: 'changed my mind', tenant: s.tenant });
            assert.equal(done.status, 'cancelled');
            assert.deepEqual(cancelOf(done), { by: 'customer', code: 'customer_cancel', kept: 0, refund: 0 });
            assert.equal(done.cancelReason, 'changed my mind');
            assert.notEqual((await fresh(o)).billing?.billable, true);
        }
        assert.equal(await couponUsed(s), 3);              // both uses came back
        assert.equal(await risk(s), null);                 // no strike
        assert.equal(await billableCount(s), 0);
    });

    test('COD: a customer cannot cancel once the shop is preparing, and the app is told (canCancel)', async () => {
        const s = await shop('or-cod-late');
        const late = await codOrder(s, 'preparing');
        const view = await request(app).get(`/api/orders/${late._id}`).set(s.customer.headers);
        assert.equal(view.body.canCancel, false);
        const res = await request(app).post(`/api/orders/${late._id}/cancel`).set(s.customer.headers).send({});
        assert.equal(res.status, 409);
        assert.match(res.body.error, /until the shop starts preparing/);
        assert.equal((await fresh(late)).status, 'preparing');

        const early = await codOrder(s, 'accepted');
        assert.equal((await request(app).get(`/api/orders/${early._id}`).set(s.customer.headers)).body.canCancel, true);
        const ok = await request(app).post(`/api/orders/${early._id}/cancel`).set(s.customer.headers).send({ reason: 'oops' });
        assert.equal(ok.status, 200);
        assert.equal(ok.body.status, 'cancelled');
        assert.equal(ok.body.canCancel, false);
    });

    test('online: a customer cancel while preparing: the shop keeps 50% of the food, the tip comes back, the order is billable, the coupon is NOT returned', async () => {
        const s = await shop('or-online-share');
        const o = await onlineOrder(s, 'preparing');
        const done = await customerCancel(s, o);
        assert.deepEqual(cancelOf(done), { by: 'customer', code: 'customer_cancel', kept: 25000, refund: 27000 });
        const saved = await fresh(o);
        assert.equal(saved.billing.billable, true);
        assert.equal(saved.billing.reason, 'cancel_kept');
        assert.equal(await billableCount(s), 1);
        assert.equal(await couponUsed(s), 5);
        assert.equal(await risk(s), null);                 // an online customer gets no strike
    });

    test('online: free while placed (everything back, coupon back), and 100% of the food once it is out for delivery', async () => {
        const s = await shop('or-online-steps');
        const placed = await onlineOrder(s, 'placed');
        assert.deepEqual(cancelOf(await customerCancel(s, placed)), { by: 'customer', code: 'customer_cancel', kept: 0, refund: 52000 });
        assert.equal(await couponUsed(s), 4);
        assert.notEqual((await fresh(placed)).billing?.billable, true);

        const out = await onlineOrder(s, 'out_for_delivery');
        assert.deepEqual(cancelOf(await customerCancel(s, out)), { by: 'customer', code: 'customer_cancel', kept: 50000, refund: 2000 });
        assert.equal(await couponUsed(s), 4);
        assert.equal((await fresh(out)).billing.billable, true);
    });

    test('a frozen shop: the customer cancels at "preparing" with no cost, no strike and the coupon back', async () => {
        const s = await shop('or-frozen');
        const o = await codOrder(s, 'preparing');
        await Tenant.updateOne({ _id: s.tenant._id }, { $set: { status: 'suspended' } });
        tenantRecognizer.invalidateTenant(s.tenant.slug);
        const res = await request(app).post(`/api/orders/${o._id}/cancel`).set(s.customer.headers).send({});
        assert.equal(res.status, 200);
        const saved = await fresh(o);
        assert.equal(saved.cancel.reasonCode, 'platform');
        assert.notEqual(saved.billing?.billable, true);
        assert.equal(await couponUsed(s), 4);
        assert.equal(await risk(s), null);
    });

    test('the owner must send a reason code to cancel; "other" also needs a note', async () => {
        const s = await shop('or-owner-input');
        const o = await codOrder(s, 'preparing');
        const bad = async (b) => (await ownerPatch(s, o, b)).status;
        assert.equal(await bad({ status: 'cancelled' }), 400);
        assert.equal(await bad({ status: 'cancelled', note: 'only a note' }), 400);
        assert.equal(await bad({ status: 'cancelled', reasonCode: 'bogus' }), 400);
        assert.equal(await bad({ status: 'cancelled', reasonCode: 'other' }), 400);
        assert.equal((await fresh(o)).status, 'preparing');

        const ok = await ownerPatch(s, o, { status: 'cancelled', reasonCode: 'other', note: 'water leak in the kitchen' });
        assert.equal(ok.status, 200);
        const saved = await fresh(o);
        assert.equal(saved.cancelReason, 'water leak in the kitchen');
        assert.deepEqual(cancelOf(saved), { by: 'shop', code: 'other', kept: 0, refund: 0 });
        assert.equal((await ownerPatch(s, o, { status: 'cancelled', reasonCode: 'busy' })).status, 409);   // already cancelled
    });

    test('R6: the owner cancels because he is busy or out of stock: everything back, not billable, coupon back', async () => {
        const s = await shop('or-owner-busy');
        const cash = await codOrder(s, 'preparing');
        const res = await ownerPatch(s, cash, { status: 'cancelled', reasonCode: 'busy' });
        assert.equal(res.status, 200);
        const saved = await fresh(cash);
        assert.equal(saved.cancelReason, 'The shop is too busy right now');
        assert.deepEqual(cancelOf(saved), { by: 'shop', code: 'busy', kept: 0, refund: 0 });
        assert.notEqual(saved.billing?.billable, true);
        assert.equal(await couponUsed(s), 4);
        assert.equal(await risk(s), null);

        const paid = await onlineOrder(s, 'preparing');
        assert.equal((await ownerPatch(s, paid, { status: 'cancelled', reasonCode: 'out_of_stock' })).status, 200);
        assert.deepEqual(cancelOf(await fresh(paid)), { by: 'shop', code: 'out_of_stock', kept: 0, refund: 52000 });
        assert.equal(await couponUsed(s), 3);
        assert.equal(await billableCount(s), 0);
    });

    test('R7: the owner cancels because the customer asked: free before preparing; after it a cash order is billable and gives a strike, and 2 strikes block cash', async () => {
        const s = await shop('or-owner-asked');
        const early = await codOrder(s, 'accepted');
        assert.equal((await ownerPatch(s, early, { status: 'cancelled', reasonCode: 'customer_asked' })).status, 200);
        assert.notEqual((await fresh(early)).billing?.billable, true);
        assert.equal(await couponUsed(s), 4);
        assert.equal(await risk(s), null);

        const first = await codOrder(s, 'preparing');
        assert.equal((await ownerPatch(s, first, { status: 'cancelled', reasonCode: 'customer_asked' })).status, 200);
        assert.equal((await fresh(first)).billing.billable, true);
        assert.equal(await couponUsed(s), 4);                                  // not returned
        const one = await risk(s);
        assert.equal(one.strikes, 1);
        assert.ok(!one.codBlocked);

        const second = await codOrder(s, 'preparing');
        assert.equal((await ownerPatch(s, second, { status: 'cancelled', reasonCode: 'customer_asked' })).status, 200);
        const two = await risk(s);
        assert.equal(two.strikes, 2);
        assert.equal(two.codBlocked, true);
        assert.ok(two.codBlockedAt);
        assert.equal(await billableCount(s), 2);
    });

    test('R7 online: customer asked after preparing follows the share, with no strike', async () => {
        const s = await shop('or-owner-asked-online');
        const o = await onlineOrder(s, 'preparing');
        assert.equal((await ownerPatch(s, o, { status: 'cancelled', reasonCode: 'customer_asked' })).status, 200);
        assert.deepEqual(cancelOf(await fresh(o)), { by: 'shop', code: 'customer_asked', kept: 25000, refund: 27000 });
        assert.equal((await fresh(o)).billing.billable, true);
        assert.equal(await risk(s), null);
    });

    test('R11: the superadmin force cancel: platform is the default, shop fault is free, customer fault follows the customer rule', async () => {
        const s = await shop('or-admin');
        const { token } = await makeSuperAdmin('or-admin@example.com');
        const patch = (o, b) => request(app).patch(`/api/admin/orders/${o._id}/status`).set('Authorization', `Bearer ${token}`).send(b);

        const a = await codOrder(s, 'preparing');
        assert.equal((await patch(a, { status: 'cancelled', note: 'platform problem' })).status, 200);
        assert.deepEqual(cancelOf(await fresh(a)), { by: 'admin', code: 'platform', kept: 0, refund: 0 });
        assert.notEqual((await fresh(a)).billing?.billable, true);

        const b = await onlineOrder(s, 'preparing');
        assert.equal((await patch(b, { status: 'cancelled', reasonCode: 'shop_fault' })).status, 200);
        assert.deepEqual(cancelOf(await fresh(b)), { by: 'admin', code: 'shop_fault', kept: 0, refund: 52000 });

        const c = await codOrder(s, 'preparing');
        assert.equal((await patch(c, { status: 'cancelled', reasonCode: 'customer_fault' })).status, 200);
        assert.equal((await fresh(c)).billing.billable, true);
        assert.equal((await risk(s)).strikes, 1);

        const d = await codOrder(s, 'preparing');
        assert.equal((await patch(d, { status: 'cancelled', reasonCode: 'bogus' })).status, 400);
        assert.equal((await patch(d, { status: 'cancelled', reasonCode: 'busy' })).status, 400);
        assert.equal((await fresh(d)).status, 'preparing');
    });

    test('D5: the shop never accepted, the system cancels: no penalty, coupon back', async () => {
        const s = await shop('or-system');
        const o = await codOrder(s, 'placed', { createdAt: new Date(Date.now() - 11 * 60000) });
        assert.equal(await cancelUnacceptedOrders(), 1);
        const saved = await fresh(o);
        assert.equal(saved.status, 'cancelled');
        assert.deepEqual(cancelOf(saved), { by: 'system', code: 'not_accepted', kept: 0, refund: 0 });
        assert.equal(saved.cancelReason, 'The shop did not respond in time');
        assert.notEqual(saved.billing?.billable, true);
        assert.equal(await couponUsed(s), 4);
        assert.equal(await risk(s), null);
    });
});

describe('undelivered orders', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(() => {
        mock.method(smsChannel, 'send', async () => ({ sent: false }));
        mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
    });
    afterEach(() => mock.restoreAll());

    const markUndelivered = (s, o, reasonCode = 'customer', note) =>
        ownerPatch(s, o, { status: 'undelivered', reasonCode, ...(note && { note }) });

    test('N3: it needs a rider problem and 15 minutes after the first one, and the buttons show it', async () => {
        const s = await shop('ud-rules');
        const none = await stuck(s, null);
        const noProblem = await markUndelivered(s, none);
        assert.equal(noProblem.status, 409);
        assert.match(noProblem.body.error, /report a delivery problem/);

        const early = await stuck(s, 5);
        const tooEarly = await markUndelivered(s, early);
        assert.equal(tooEarly.status, 409);
        assert.match(tooEarly.body.error, /wait 10 more minute/);
        assert.equal((await fresh(early)).status, 'out_for_delivery');

        const ready = await stuck(s, 16);
        const buttons = (o) => request(app).get(`/api/shop/orders/${o._id}`).set(s.owner.headers);
        assert.ok((await buttons(ready)).body.allowedNext.includes('undelivered'));
        assert.ok(!(await buttons(early)).body.allowedNext.includes('undelivered'));
        assert.ok(!(await buttons(none)).body.allowedNext.includes('undelivered'));
        assert.equal((await markUndelivered(s, ready)).status, 200);
    });

    test('N3: customer fault: no refund, billable, 1 strike, coupon NOT returned, the rider is released, the customer and the rider are told', async () => {
        const s = await shop('ud-customer');
        await Rider.updateOne({ userId: s.rider.user._id }, { $set: { activeOrderCount: 1 } });
        const o = await stuck(s, 16);
        const res = await markUndelivered(s, o, 'customer', 'door was locked');
        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'undelivered');

        const saved = await fresh(o);
        assert.equal(saved.status, 'undelivered');
        assert.equal(saved.undelivered.reasonCode, 'customer');
        assert.equal(saved.undelivered.note, 'door was locked');
        assert.equal(saved.undelivered.keptPaise, 0);                      // cash order: no money moves
        assert.ok(saved.undelivered.at);
        assert.equal(saved.statusHistory.at(-1).status, 'undelivered');
        assert.equal(saved.billing.billable, true);
        assert.equal(saved.billing.reason, 'undelivered_customer');
        assert.equal(await billableCount(s), 1);
        assert.equal((await risk(s)).strikes, 1);
        assert.equal(await couponUsed(s), 5);
        assert.equal((await Rider.findOne({ userId: s.rider.user._id })).activeOrderCount, 0);

        assert.ok(await waitFor(async () => !!(await Notification.findOne({ userId: s.customer.user._id, type: 'order_status', title: 'Order not delivered' }))));
        assert.ok(await waitFor(async () => !!(await Notification.findOne({ userId: s.rider.user._id, type: 'order_cancelled', body: /not delivered/ }))));
        assert.equal((await markUndelivered(s, o)).status, 409);           // it is final now
    });

    test('N3: shop or rider fault: full refund for an online order, not billable, no strike, coupon back', async () => {
        const s = await shop('ud-fault');
        const mkOnline = (minutes) => onlineOrder(s, 'out_for_delivery', {
            delivery: { riderId: s.rider.user._id, status: 'picked_up', problems: [{ at: new Date(Date.now() - minutes * 60000), reason: 'wrong_address' }] },
        });
        const a = await mkOnline(20);
        assert.equal((await markUndelivered(s, a, 'shop')).status, 200);
        assert.equal((await fresh(a)).undelivered.keptPaise, 0);
        assert.equal((await fresh(a)).undelivered.refundPaise, 52000);
        assert.equal(await couponUsed(s), 4);

        const b = await mkOnline(30);
        assert.equal((await markUndelivered(s, b, 'rider')).status, 200);
        assert.equal((await fresh(b)).undelivered.refundPaise, 52000);
        assert.equal(await couponUsed(s), 3);
        for (const o of [a, b]) assert.notEqual((await fresh(o)).billing?.billable, true);
        assert.equal(await risk(s), null);
        assert.equal(await billableCount(s), 0);

        const c = await mkOnline(25);                                       // customer fault online: the shop keeps the food, the tip comes back
        assert.equal((await markUndelivered(s, c, 'customer')).status, 200);
        assert.equal((await fresh(c)).undelivered.keptPaise, 50000);
        assert.equal((await fresh(c)).undelivered.refundPaise, 2000);
        assert.equal((await fresh(c)).billing.billable, true);
        assert.equal((await risk(s)).strikes, 1);
    });

    test('two customer-fault undelivered orders block cash for that phone', async () => {
        const s = await shop('ud-two-strikes');
        for (let i = 0; i < 2; i += 1) {
            const o = await stuck(s, 16);
            assert.equal((await markUndelivered(s, o)).status, 200);
        }
        const row = await risk(s);
        assert.equal(row.strikes, 2);
        assert.equal(row.codBlocked, true);
        assert.ok(row.codBlockedAt);
        // the owner can lift it again
        const lift = await request(app).patch(`/api/shop/customers/${s.customer.user._id}/cod-block`).set(s.owner.headers).send({ blocked: false });
        assert.equal(lift.status, 200);
        assert.equal((await risk(s)).codBlocked, false);
    });

    test('N3: wrong or missing reason is refused, and only the owner can do it', async () => {
        const s = await shop('ud-who');
        const o = await stuck(s, 20);
        assert.equal((await ownerPatch(s, o, { status: 'undelivered' })).status, 400);
        assert.equal((await ownerPatch(s, o, { status: 'undelivered', reasonCode: 'weather' })).status, 400);
        assert.equal((await fresh(o)).status, 'out_for_delivery');

        await assert.rejects(
            async () => orderStatus.change({ order: await fresh(o), status: 'undelivered', actor: customerActor(s), tenant: s.tenant, reasonCode: 'customer' }),
            (e) => e.status === 403,
        );
        const riderActor = { type: 'rider', id: s.rider.user._id, label: '9000000020' };
        await assert.rejects(
            async () => orderStatus.change({ order: await fresh(o), status: 'undelivered', actor: riderActor, reasonCode: 'customer' }),
            (e) => e.status === 403,
        );
        const { token } = await makeSuperAdmin('ud-admin@example.com');
        const admin = await request(app).patch(`/api/admin/orders/${o._id}/status`).set('Authorization', `Bearer ${token}`)
            .send({ status: 'undelivered', reasonCode: 'customer' });
        assert.equal(admin.status, 400);
        assert.equal((await fresh(o)).status, 'out_for_delivery');
        assert.equal((await request(app).patch(`/api/shop/orders/${o._id}/status`).set(s.rider.headers).send({ status: 'undelivered', reasonCode: 'customer' })).status, 403);
    });

    test('an undelivered order shows in the rider history tab and the customer tracking says "undelivered"', async () => {
        const s = await shop('ud-views');
        const o = await stuck(s, 20);
        await Rider.updateOne({ userId: s.rider.user._id }, { $set: { activeOrderCount: 1 } });
        assert.equal((await markUndelivered(s, o, 'shop')).status, 200);

        const history = await request(app).get('/api/rider/orders?tab=history').set(s.rider.headers);
        assert.equal(history.status, 200);
        assert.ok(history.body.items.some((i) => String(i.id) === String(o._id)));
        const active = await request(app).get('/api/rider/orders?tab=active').set(s.rider.headers);
        assert.equal(active.body.items.length, 0);

        const tracking = await request(app).get(`/api/orders/${o._id}/tracking`).set(s.customer.headers);
        assert.equal(tracking.status, 200);
        assert.equal(tracking.body.state, 'undelivered');
        assert.equal(tracking.body.etaAt, null);
    });

    test('the sales report shows undelivered on its own line, and it is never revenue', async () => {
        const s = await shop('ud-report');
        await makeOrder(s.tenant, s.customer.user, { status: 'delivered', deliveredAt: new Date() });
        const o = await stuck(s, 20);
        assert.equal((await markUndelivered(s, o, 'customer')).status, 200);

        const report = await salesReport({
            tenantId: s.tenant._id, from: new Date(Date.now() - 86400000), to: new Date(Date.now() + 86400000),
        });
        assert.equal(report.undelivered, 1);
        assert.equal(report.statuses.undelivered, 1);
        assert.equal(report.totals.orders, 1);             // only the delivered order
        assert.equal(report.totals.revenue, 100);
    });
});