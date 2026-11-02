require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeWorld, makeUser, waitFor } = require('./helpers/factory');
const Category = require('../src/models/Category');
const Product = require('../src/models/Product');
const BulkOrder = require('../src/models/BulkOrder');
const BulkPayment = require('../src/models/BulkPayment');
const Notification = require('../src/models/Notification');
const pushChannel = require('../src/notifications/channels/push');
const adminAlerts = require('../src/services/adminAlerts');
const notificationService = require('../src/services/notificationService');
const payments = require('../src/services/adapters/payments');
const paymentService = require('../src/services/paymentService');
const bulkPayment = require('../src/services/bulkPayment');
const bulkOrders = require('../src/services/bulkOrders');
const Order = require('../src/models/Order');
const billable = require('../src/services/billableService');
const bulkKitchen = require('../src/services/bulkKitchen');
const f2 = require('./helpers/factory');
const reconcile = require('../src/services/paymentReconcile');
const razorpayWebhook = require('../src/services/razorpayWebhook');

// The advance of a bulk order: a quote of Rs 10000, 50 % advance = Rs 5000 (500000 paise).
const sign = (orderId, paymentId) => crypto.createHmac('sha256', paymentService.MOCK_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
const days = (n) => new Date(Date.now() + n * 86400000).toISOString();
const ADVANCE = 500000;
let n = 0; let payN = 0;

describe('a paid bulk order gets a work ticket for the kitchen and the rider', () => {
    let w; let id; let alerts;
    const owner = (m, p, b) => request(app)[m](`/api/shop/bulk${p}`).set(w.owner.headers).send(b);
    const cust = (m, p, b, h = w.customer.headers) => request(app)[m](`/api/bulk${p}`).set(h).send(b);

    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(async () => {
        await db.clear();
        payments._mock.reset();
        mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
        alerts = [];
        mock.method(adminAlerts, 'alert', async (key, opts) => { alerts.push({ key, ...opts }); });
        w = await makeWorld(`bulkpay-${++n}`);
        const cat = await Category.create({ tenantId: w.tenant._id, name: 'Main', isActive: true });
        const dish = await Product.create({ tenantId: w.tenant._id, categoryId: cat._id, name: 'Dal', price: 100, isVeg: true, isActive: true });
        await owner('put', '/settings', { enabled: true, noticeHours: 1, advancePercent: 50, fullRefundHours: 48 });
        const r = await cust('post', '/', { fulfilment: 'pickup', when: days(5), items: [{ productId: String(dish._id), quantity: 100 }], contact: { name: 'Raj', phone: '9000000051' } });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        id = r.body.id;
        await quote();
    });
    afterEach(() => mock.restoreAll());

    async function quote() {
        const o = (await owner('get', `/${id}`)).body;
        const q = await owner('post', `/${id}/quote`, { lines: o.lines.map((l) => ({ id: l.id, unitPrice: l.unitPrice })) });
        assert.equal(q.status, 200, JSON.stringify(q.body));
        assert.equal(q.body.quote.advancePaise, ADVANCE);
        return q.body;
    }
    const start = async () => { const r = await cust('post', `/${id}/pay`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
    const capture = (pay, amountPaise = pay.amountPaise) => {
        const pid = `pay_bulk_${++payN}`;
        payments._mock.setPayment({ id: pid, orderId: pay.rzpOrderId, status: 'captured', amountPaise, capturedPaise: amountPaise, refundedPaise: 0, method: 'upi', notes: {} });
        return pid;
    };
    const verify = (pay, pid, h = w.customer.headers) => cust('post', `/${id}/verify`, { razorpay_order_id: pay.rzpOrderId, razorpay_payment_id: pid, razorpay_signature: sign(pay.rzpOrderId, pid) }, h);
    const row = () => BulkOrder.findById(id).lean();
    const payRow = (extra = {}) => BulkPayment.findOne({ bulkId: id, ...extra }).lean();
    const paid = async () => { const pay = await start(); const pid = capture(pay); const r = await verify(pay, pid); assert.equal(r.body.paid, true, JSON.stringify(r.body)); return { pay, pid }; };

    test('paying the advance makes ONE hidden Order: accepted, the dishes, and only the balance to collect (cash)', async () => {
        assert.equal(await Order.countDocuments({ tenantId: w.tenant._id }), 0);
        await paid();
        const b = await row();
        const orders = await Order.find({ tenantId: w.tenant._id }).lean();
        assert.equal(orders.length, 1);
        const o = orders[0];
        assert.equal(String(b.orderId), String(o._id));
        assert.equal(String(o.bulkId), String(b._id));
        assert.deepEqual([o.status, o.orderType, o.payment.method, o.payment.status], ['accepted', 'pickup', 'cod', 'pending']);
        assert.equal(o.pricing.total, 5000);   // Rs 10000 quote - Rs 5000 advance = the balance
        assert.equal(o.items[0].name, 'Dal');
        assert.equal(o.items[0].quantity, 100);
        assert.equal(o.customer.phone, '9000000051');
    });

    test('making the ticket again changes nothing (a repeat, a repair run, two at once)', async () => {
        await paid();
        const first = await Order.findOne({ tenantId: w.tenant._id }).lean();
        await Promise.all([bulkKitchen.ensureLinkedOrder(id), bulkKitchen.ensureLinkedOrder(id), bulkKitchen.ensureLinkedOrder(id)]);
        assert.equal(await Order.countDocuments({ tenantId: w.tenant._id }), 1);
        assert.equal(String((await row()).orderId), String(first._id));
    });

    test('nothing is made before the advance is paid', async () => {
        assert.equal(await bulkKitchen.ensureLinkedOrder(id), null);
        assert.equal(await Order.countDocuments({ tenantId: w.tenant._id }), 0);
    });

    test('the customer does not see the ticket in his orders, and it never counts for rent', async () => {
        await paid();
        const list = await request(app).get('/api/orders').set(w.customer.headers);
        assert.equal(list.status, 200);
        assert.equal(list.body.items.length, 0);
        const o = await Order.findOne({ tenantId: w.tenant._id }).lean();
        const r = await billable.markBillable(o, 'delivered');
        assert.deepEqual([r.marked, r.why], [false, 'bulk_ticket']);
    });

    /* ------------------------------ the ticket and the bulk order follow each other ------------------------------ */
    const orderStatus = require('../src/services/orderStatusService');
    const cook = { type: 'staff', role: 'kitchen', id: '65f0000000000000000000aa', label: 'Cook' };
    const stage = (to) => owner('post', `/${id}/stage`, { to });
    const ticket = () => Order.findOne({ tenantId: w.tenant._id });
    const bulkStatus = async () => (await row()).status;

    test('the cook starts and packs the ticket: the bulk order says preparing, then ready', async () => {
        await paid();
        let t = await ticket();
        await orderStatus.change({ order: t, status: 'preparing', actor: cook });
        await waitFor(async () => (await bulkStatus()) === 'preparing');
        t = await ticket();
        await orderStatus.change({ order: t, status: 'ready', actor: cook });
        await waitFor(async () => (await bulkStatus()) === 'ready');
        assert.equal(await bulkStatus(), 'ready');
    });

    test('the owner moves the bulk order: the ticket follows; handing over does not count as the money', async () => {
        await paid();
        assert.equal((await stage('preparing')).status, 200);
        assert.equal((await ticket()).status, 'preparing');
        assert.equal((await stage('ready')).status, 200);
        assert.equal((await ticket()).status, 'ready');
        assert.equal((await stage('delivered')).status, 200);
        const t = await ticket();
        assert.deepEqual([t.status, t.payment.status], ['delivered', 'pending']);   // the cash is written down by "balance received", not by the hand over
        assert.equal((await owner('post', `/${id}/cash-received`)).status, 200);
        assert.equal(await bulkStatus(), 'completed');
    });

    test('the balance paid some other way is marked on the ticket, so the rider is not asked for it', async () => {
        await paid();
        await stage('preparing'); await stage('ready');
        assert.equal((await owner('post', `/${id}/cash-received`)).status, 200);
        const t = await ticket();
        assert.deepEqual([t.payment.method, t.payment.status, t.pricing.total], ['cod', 'paid', 0]);   // nothing left for the rider to collect
    });

    test('cancelling the bulk order (customer or shop) closes the ticket', async () => {
        await paid();
        const r = await cust('post', `/${id}/cancel`);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal((await ticket()).status, 'cancelled');
    });

    test('the owner cancels the ticket from the Orders screen: that is the shop cancelling the bulk order, and the customer gets everything back', async () => {
        await paid();
        const t = await ticket();
        await orderStatus.change({ order: t, status: 'cancelled', actor: { type: 'owner', id: String(w.owner.user._id), label: 'Owner' }, reasonCode: 'other', note: 'Cook is ill' });
        const b = await row();
        assert.deepEqual([b.status, b.cancelledBy, b.cancelReason], ['cancelled', 'owner', 'Cook is ill']);
        assert.equal(b.payment.refundDuePaise, ADVANCE);   // the whole advance goes back
        assert.equal((await ticket()).status, 'cancelled');
    });

    test('a rider, the system and the customer cannot cancel the ticket', async () => {
        await paid();
        const t = await ticket();
        for (const actor of [{ type: 'system', label: 'auto' }, { type: 'rider', id: w.rider.user._id }]) {
            await assert.rejects(() => orderStatus.change({ order: t, status: 'cancelled', actor, reasonCode: 'not_accepted' }), /bulk order/i);
        }
        assert.equal((await ticket()).status, 'accepted');
    });

    test('the ticket is not a sale: the history and sales leave it out, the cook still sees it', async () => {
        await paid();
        const { HIDE_BULK_TICKET } = require('../src/services/onlineOrder');
        assert.equal(await Order.countDocuments({ tenantId: w.tenant._id, ...HIDE_BULK_TICKET }), 0);
        assert.equal(await Order.countDocuments({ tenantId: w.tenant._id }), 1);
        const kitchen = require('../src/services/kitchenService');
        const q = await kitchen.queue(w.tenant);
        assert.ok(JSON.stringify(q).includes('Dal'), 'the cook sees the dishes');
    });

    test('the cook hears it is a BULK order and for which day, not just "new order"', () => {
        const speech = require('../src/utils/orderSpeech');
        const o = { bulkId: '65f000000000000000000001', orderType: 'delivery', scheduledFor: new Date('2026-11-07T06:30:00Z'), items: [{ name: 'Dal', quantity: 100 }] };
        assert.match(speech.kitchenSpeech(o), /^New bulk order. Wanted on 7 November at 12:00 pm. Delivery./);
        assert.match(speech.kitchenSpeech(o, true), /^नया बल्क ऑर्डर, 7 नवंबर, दोपहर 12:00 बजे के लिए, डिलीवरी।/);
        assert.match(speech.kitchenSpeech({ ...o, bulkId: undefined }), /^New delivery order./);
    });

    test('a delivery: packed -> the rider is asked/assigned -> he collects ONLY the balance -> the bulk order is delivered, paid and completed', async () => {
        const Rider = require('../src/models/Rider');
        const CodSettlement = require('../src/models/CodSettlement');
        const assignment = require('../src/services/assignmentService');
        await BulkOrder.updateOne({ _id: id }, { $set: { fulfilment: 'delivery', address: { label: 'Office', line1: '5 MG Road', city: 'Pune', pincode: '411001', name: 'Meera', phone: '9000000041' } } });
        await Rider.updateOne({ tenantId: w.tenant._id, userId: w.rider.user._id }, { $set: { isActive: true, isOnline: true, activeOrderCount: 0 } });
        await paid();
        let t = await ticket();
        assert.equal(t.orderType, 'delivery');
        assert.equal(t.address.line1, '5 MG Road');
        await orderStatus.change({ order: t, status: 'preparing', actor: cook });
        const kitchen = require('../src/services/kitchenService');
        await kitchen.ready({ tenant: w.tenant, orderId: t._id, staff: { id: cook.id, name: 'Cook' } });
        await waitFor(async () => (await bulkStatus()) === 'ready');
        // the owner assigns by hand (works in every assign mode)
        const a = await assignment.assign({ orderId: t._id, tenantId: w.tenant._id, riderUserId: w.rider.user._id, reason: 'test', actor: { type: 'owner', id: String(w.owner.user._id) } });
        assert.ok(a);
        const rider = { type: 'rider', id: w.rider.user._id, label: 'Rider' };
        t = await ticket();
        assert.equal(t.delivery.riderId.toString(), w.rider.user._id.toString());
        t = await orderStatus.change({ order: t, status: 'out_for_delivery', actor: rider });
        await waitFor(async () => (await bulkStatus()) === 'out_for_delivery');
        t = await orderStatus.change({ order: t, status: 'delivered', actor: rider });
        await waitFor(async () => (await bulkStatus()) === 'completed');
        const b = await row();
        assert.deepEqual([b.payment.balancePaid, b.payment.balanceVia, b.payment.balancePaise], [true, 'cash', 500000]);
        const cash = await CodSettlement.find({ tenantId: w.tenant._id, orderId: t._id, type: 'collect' }).lean();
        assert.deepEqual(cash.map((c) => c.amountPaise), [500000]);   // the balance only, never the whole Rs 10000
    });

    test('the reports show what the bulk orders added to the sales, inside the totals (not apart from them)', async () => {
        const businessReport = require('../src/services/businessReport');
        const closingReport = require('../src/services/closingReport');
        await paid();
        for (const to of ['preparing', 'ready', 'delivered']) assert.equal((await stage(to)).status, 200);
        assert.equal((await owner('post', `/${id}/cash-received`)).status, 200);
        assert.equal(await bulkStatus(), 'completed');
        const r = await businessReport.build({ tenantId: w.tenant._id, range: '7' });
        assert.equal(r.bulk.orders, 1);
        assert.equal(r.bulk.revenue, 10000);
        assert.equal(r.bulk.sharePct, 100);               // the only sale of the week
        assert.equal(r.totals.orders, 1);                  // it is counted in the totals, once (its hidden ticket is not a second sale)
        assert.equal(r.totals.revenue, 10000);
        assert.equal(r.series.points.reduce((a, p) => a + p.revenue, 0), 10000);
        const c = await closingReport.build({ tenantId: w.tenant._id });
        assert.deepEqual([c.sales.bulk.orders, c.sales.bulk.revenue, c.sales.revenue, c.sales.orders], [1, 10000, 10000, 1]);
    });

    /* ------------------------------ the cook's Bulk tab ------------------------------ */
    const kitchenSvc = require('../src/services/kitchenService');
    const kitchenAlerts = require('../src/services/kitchenAlerts');
    const bulkJob = require('../src/jobs/bulkCookAlerts');
    const staff = { id: '65f0000000000000000000bb', name: 'Cook' };
    const setWhen = async (hours) => { const when = new Date(Date.now() + hours * 3600000); await BulkOrder.updateOne({ _id: id }, { $set: { when } }); await Order.updateMany({ tenantId: w.tenant._id }, { $set: { scheduledFor: when } }); };

    test('payment: the cooks are told at once (loud), whatever the day; a bulk order due soon is called "to make"', async () => {
        const calls = [];
        mock.method(kitchenAlerts, 'onStatus', async (a) => { calls.push({ due: !!a.updated.kitchen?.dueAlertAt, bulk: !!a.updated.bulkId, status: a.status }); });
        await paid();                       // wanted in 5 days
        assert.deepEqual(calls, [{ due: false, bulk: true, status: 'accepted' }]);
    });

    test('a bulk order for a day that is close is called "to make" at payment', async () => {
        const calls = [];
        mock.method(kitchenAlerts, 'onStatus', async (a) => { calls.push({ due: !!a.updated.kitchen?.dueAlertAt }); });
        await setWhen(10);
        await paid();
        assert.deepEqual(calls, [{ due: true }]);
    });

    test('the Bulk tab holds the order; 24 hours before the day it is called again and comes to the top of To make, once', async () => {
        const calls = [];
        mock.method(kitchenAlerts, 'onStatus', async (a) => { calls.push({ due: !!a.updated.kitchen?.dueAlertAt }); });
        await paid();
        let q = await kitchenSvc.queue(w.tenant);
        assert.equal(q.items.length, 0, 'not in To make yet');
        assert.equal(q.bulk.length, 1);
        assert.deepEqual([q.bulk[0].bulk, q.bulk[0].upcoming, q.counts.bulk, q.counts.new], [true, true, 1, 0]);
        assert.ok(q.bulk[0].queueAt && new Date(q.bulk[0].queueAt) < new Date(q.bulk[0].scheduledFor));
        // a normal order is already waiting; then the bulk order's day comes within 24 hours
        const normal = await f2.makeOrder(w.tenant, w.customer.user, { orderNo: 5000, status: 'accepted', orderType: 'pickup', payment: { method: 'cod', status: 'pending' } });
        await setWhen(20);
        assert.deepEqual(await bulkJob.runBulkCookAlerts(), { called: 1, asked: 0 });
        assert.deepEqual(await bulkJob.runBulkCookAlerts(), { called: 0, asked: 0 });   // once
        assert.deepEqual(calls.map((c) => c.due), [false, true]);
        q = await kitchenSvc.queue(w.tenant);
        assert.equal(q.items[0].bulk, true, 'the bulk order is first');
        assert.equal(q.items[0].upcoming, false);
        assert.equal(q.items[0].late, false);
        assert.ok(q.items.some((o) => o.id === String(normal._id)));
        assert.equal(q.counts.bulk, 1);
    });

    test('the cook marks a bulk order made in advance Ready from the Bulk tab; the bulk order is ready, the customer is told', async () => {
        await paid();
        const t = await ticket();
        const r = await kitchenSvc.ready({ tenant: w.tenant, orderId: t._id, staff });
        assert.equal(r.already, false);
        await waitFor(async () => (await bulkStatus()) === 'ready');
        const q = await kitchenSvc.queue(w.tenant);
        assert.equal(q.bulk.length, 1);
        assert.equal(q.bulk[0].stage, 'ready');   // it still waits for its day in the Bulk tab
        assert.equal(q.counts.bulk, 0);           // nothing left to make
    });

    test('a delivery packed early is offered to riders only 2 hours before its time (once)', async () => {
        const assignment = require('../src/services/assignmentService');
        const asks = [];
        mock.method(assignment, 'startBroadcast', async (a) => { asks.push(String(a.orderId)); return null; });
        await BulkOrder.updateOne({ _id: id }, { $set: { fulfilment: 'delivery', address: { label: 'Office', line1: '5 MG Road', city: 'Pune', pincode: '411001', name: 'Meera', phone: '9000000041' } } });
        await paid();
        const t = await ticket();
        await kitchenSvc.ready({ tenant: w.tenant, orderId: t._id, staff });
        await waitFor(async () => (await bulkStatus()) === 'ready');
        assert.equal(asks.length, 0, 'packed 5 days early: no rider is asked now');
        assert.deepEqual(await bulkJob.runBulkCookAlerts(), { called: 0, asked: 0 });
        await setWhen(1);
        const done = await bulkJob.runBulkCookAlerts();
        assert.equal(done.asked, 1);
        assert.equal(asks.length, 1);
        assert.equal((await bulkJob.runBulkCookAlerts()).asked, 0);   // once
    });

    test('the cook tells the owner about a problem; the owner answers and the customer hears it on the bulk order', async () => {
        await paid();
        const t = await ticket();
        const r = await kitchenSvc.problem({ tenant: w.tenant, orderId: t._id, staff, kind: 'cannot_make', note: 'No gas' });
        assert.equal(r.ok, true);
        const order = await ticket();
        assert.equal(order.kitchen.problem.kind, 'cannot_make');
        await kitchenSvc.resolve({ tenant: w.tenant, order, action: 'tell', actor: { type: 'owner', id: String(w.owner.user._id), label: 'Owner' } });
        const Notification = require('../src/models/Notification');
        const n = await Notification.findOne({ userId: w.customer.user._id, type: 'order_shop_note' }).lean();
        assert.ok(n, 'the customer was told');
        assert.equal(n.data.kind, 'bulk');
        assert.equal(String(n.data.bulkId), String(id));
    });
});
