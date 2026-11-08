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
    const stage = (to) => owner('post', `/${id}/stage`, { to, ...(to === 'delivered' ? { skipCode: true } : {}) });
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
        assert.deepEqual(await bulkJob.runBulkCookAlerts(), { called: 1, asked: 0, warned: 0 });
        assert.deepEqual(await bulkJob.runBulkCookAlerts(), { called: 0, asked: 0, warned: 0 });   // once
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
        assert.equal(q.bulk.length, 0, 'ready: it leaves the Bulk tab');
        assert.equal(q.counts.bulk, 0);
        const row = q.items.find((o) => o.id === String(t._id));
        assert.ok(row && row.stage === 'ready' && row.bulk, 'and it is in the Ready list, like any order');
        assert.equal(q.counts.ready, 1);
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
        assert.deepEqual(await bulkJob.runBulkCookAlerts(), { called: 0, asked: 0, warned: 0 });
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

    /* ------------------------------ Phase 1: what the rider and the cook are told ------------------------------ */
    test('a bulk delivery packed by the cook is offered to the online rider: the rider gets the offer and sees it on his panel', async () => {
        const Tenant = require('../src/models/Tenant');
        const Rider = require('../src/models/Rider');
        const Notification = require('../src/models/Notification');
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.riders.assignMode': 'automatic' } });
        await Rider.updateOne({ tenantId: w.tenant._id, userId: w.rider.user._id }, { $set: { isActive: true, isOnline: true, activeOrderCount: 0 } });
        await BulkOrder.updateOne({ _id: id }, { $set: { fulfilment: 'delivery', address: { label: 'Office', line1: '5 MG Road', city: 'Pune', pincode: '411001', name: 'Meera', phone: '9000000041', latitude: 18.52, longitude: 73.85 } } });
        await setWhen(1);
        await paid();
        const t = await ticket();
        await kitchenSvc.ready({ tenant: w.tenant, orderId: t._id, staff });
        await waitFor(async () => (await bulkStatus()) === 'ready');
        await waitFor(async () => !!(await Notification.findOne({ userId: w.rider.user._id, type: 'rider_offer' })), 5000);
        const offer = await Notification.findOne({ userId: w.rider.user._id, type: 'rider_offer' }).lean();
        assert.ok(offer, 'the rider got an offer');
        assert.equal(String(offer.data.orderId), String(t._id));
        const list = await request(app).get('/api/rider/orders?tab=offered').set(w.rider.headers);
        assert.equal(list.status, 200);
        assert.ok(list.body.items.some((o) => String(o.id) === String(t._id)), 'it is on his panel');
    });

    test('words: the owner hears "New Bulk Order Request"; a long change request is cut with ...; the shop note comes with the quote', async () => {
        const Notification = require('../src/models/Notification');
        const ownerNote = async (type) => Notification.findOne({ type }).sort({ createdAt: -1 }).lean();
        // the request was sent in beforeEach (pickup); the owner's notification:
        const n = await ownerNote('bulk_new');
        assert.equal(n?.title, 'New Bulk Order Request');
        // the customer asks for a change, with a very long text
        const long = 'please change this '.repeat(30);
        const r = await cust('post', `/${id}/change`, { note: long });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const c = await ownerNote('bulk_change');
        assert.ok(c.body.includes('“') && c.body.includes('…'), c.body);
        assert.ok(c.body.length < 260, 'cut short');
        // the owner answers with a note
        const o = (await owner('get', `/${id}`)).body;
        const q = await owner('post', `/${id}/quote`, { lines: o.lines.map((l) => ({ id: l.id, unitPrice: l.unitPrice })), note: 'Done as asked, thank you' });
        assert.equal(q.status, 200, JSON.stringify(q.body));
        const qn = await ownerNote('bulk_quoted');
        assert.match(qn.body, /The shop says: “Done as asked, thank you”/);
    });

    test('no offers on a bulk order: telling the customer about a kitchen problem ignores the offer percent', async () => {
        await paid();
        const t = await ticket();
        await kitchenSvc.problem({ tenant: w.tenant, orderId: t._id, staff, kind: 'cannot_make', note: 'No gas' });
        const order = await ticket();
        const r = await kitchenSvc.resolve({ tenant: w.tenant, order, action: 'tell', offerPercent: 10, actor: { type: 'owner', id: String(w.owner.user._id), label: 'Owner' } });
        assert.equal(r.offer, null);
    });

    test('the first word to the cook about a bulk order is a one-time "bulk" alert; the 24-hour call is the repeating "new" one; a bulk order is never auto-queued early', async () => {
        const alerts = [];
        const realtime = require('../src/services/realtime');
        const Tenant = require('../src/models/Tenant');
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.staff.kitchenOn': true } });
        mock.method(require('../src/services/staffDuty'), 'peopleOnDuty', async () => [{ userId: staff.id, prefs: {} }]);
        mock.method(realtime, 'toKitchen', (tenantId, ev, p) => { if (p?.alert) alerts.push(p.alert.kind); });
        await paid();
        await waitFor(async () => alerts.length > 0);
        assert.deepEqual(alerts, ['bulk']);
        const kitchenQueue = require('../src/jobs/kitchenQueue');
        await kitchenQueue.runKitchenQueue(new Date(Date.now() + 5 * 60000));
        assert.equal((await ticket()).kitchen?.queuedAt, undefined, 'not queued before it is called');
        await setWhen(20);
        await bulkJob.runBulkCookAlerts();
        await waitFor(async () => alerts.length > 1);
        assert.deepEqual(alerts, ['bulk', 'new']);
    });

    test('a rider who is already assigned hears that the BULK order is packed (its own loud message, not the soft normal one)', async () => {
        const Rider = require('../src/models/Rider');
        const Notification = require('../src/models/Notification');
        const assignment = require('../src/services/assignmentService');
        await Rider.updateOne({ tenantId: w.tenant._id, userId: w.rider.user._id }, { $set: { isActive: true, isOnline: true, activeOrderCount: 0 } });
        await BulkOrder.updateOne({ _id: id }, { $set: { fulfilment: 'delivery', address: { label: 'Office', line1: '5 MG Road', city: 'Pune', pincode: '411001', name: 'Meera', phone: '9000000041' } } });
        await paid();
        const t = await ticket();
        await assignment.assign({ orderId: t._id, tenantId: w.tenant._id, riderUserId: w.rider.user._id, reason: 'test', actor: { type: 'owner', id: String(w.owner.user._id) } });
        await kitchenSvc.ready({ tenant: w.tenant, orderId: t._id, staff });
        await waitFor(async () => !!(await Notification.findOne({ userId: w.rider.user._id, type: 'rider_bulk_packed' })), 5000);
        const n = await Notification.findOne({ userId: w.rider.user._id, type: 'rider_bulk_packed' }).lean();
        assert.equal(n.title, 'Bulk order is packed');
        assert.equal(String(n.data.orderId), String(t._id));
        assert.equal(await Notification.countDocuments({ userId: w.rider.user._id, type: 'food_packed_rider' }), 0);
    });

    test('a bulk delivery has a rider to itself: he gets nothing else, and a bulk order only goes to a rider with an empty bag', async () => {
        const Rider = require('../src/models/Rider');
        const assignment = require('../src/services/assignmentService');
        const actor = { type: 'owner', id: String(w.owner.user._id) };
        await Rider.updateOne({ tenantId: w.tenant._id, userId: w.rider.user._id }, { $set: { isActive: true, isOnline: true, activeOrderCount: 0 } });
        await BulkOrder.updateOne({ _id: id }, { $set: { fulfilment: 'delivery', address: { label: 'Office', line1: '5 MG Road', city: 'Pune', pincode: '411001', name: 'Meera', phone: '9000000041' } } });
        await paid();
        const t = await ticket();
        const normal = await f2.makeOrder(w.tenant, w.customer.user, { status: 'accepted' });
        // a rider with a normal order in his bag cannot be given the bulk delivery
        await assignment.assign({ orderId: normal._id, tenantId: w.tenant._id, riderUserId: w.rider.user._id, reason: 'test', actor });
        await assert.rejects(() => assignment.assign({ orderId: t._id, tenantId: w.tenant._id, riderUserId: w.rider.user._id, reason: 'test', actor }), /no other order/);
        // free again: he takes the bulk delivery, and now a normal order is refused for him
        await Order.updateOne({ _id: normal._id }, { $unset: { 'delivery.riderId': 1, 'delivery.status': 1 } });
        await Rider.updateOne({ tenantId: w.tenant._id, userId: w.rider.user._id }, { $set: { activeOrderCount: 0 } });
        await assignment.assign({ orderId: t._id, tenantId: w.tenant._id, riderUserId: w.rider.user._id, reason: 'test', actor });
        await Rider.updateOne({ tenantId: w.tenant._id, userId: w.rider.user._id }, { $set: { activeOrderCount: 1 } });   // (the limit would not stop him: only the bulk rule does)
        await assert.rejects(() => assignment.assign({ orderId: normal._id, tenantId: w.tenant._id, riderUserId: w.rider.user._id, reason: 'test', actor }), /carrying a bulk order/);
    });

    test('a packed bulk delivery nobody takes: the owner is warned after 15 minutes, once per 15 minutes, until a rider has it', async () => {
        const center = require('../src/notifications/center');
        const told = [];
        mock.method(center, 'notify', async (key, ctx) => { told.push({ key, ctx }); });
        await BulkOrder.updateOne({ _id: id }, { $set: { fulfilment: 'delivery', address: { label: 'Office', line1: '5 MG Road', city: 'Pune', pincode: '411001', name: 'Meera', phone: '9000000041' } } });
        await paid();
        const t = await ticket();
        await Order.updateOne({ _id: t._id }, { $set: { status: 'preparing', 'kitchen.readyAt': new Date(Date.now() - 20 * 60000) } });
        assert.equal((await bulkJob.runBulkCookAlerts()).warned, 1);
        assert.equal(told.filter((x) => x.key === 'bulk_no_rider').length, 1);
        assert.match(told.find((x) => x.key === 'bulk_no_rider').ctx.data.speech, /no rider has taken it/);
        assert.equal((await bulkJob.runBulkCookAlerts()).warned, 0, 'not again at once');
        await Order.updateOne({ _id: t._id }, { $set: { 'kitchen.bulkNoRiderAt': new Date(Date.now() - 16 * 60000) } });
        assert.equal((await bulkJob.runBulkCookAlerts()).warned, 1, 'again after 15 minutes');
        await Order.updateOne({ _id: t._id }, { $set: { 'delivery.riderId': w.rider.user._id, 'delivery.status': 'accepted', 'kitchen.bulkNoRiderAt': new Date(Date.now() - 16 * 60000) } });
        assert.equal((await bulkJob.runBulkCookAlerts()).warned, 0, 'a rider has it: no more warnings');
    });

    test('a bulk message carries the words a tap can read out: English and Hindi (so the voice comes when the notification is tapped)', async () => {
        const Notification = require('../src/models/Notification');
        const n = await Notification.findOne({ type: 'bulk_new' }).lean();
        assert.ok(n.data.speech.startsWith('New bulk order received'), n.data.speech);   // the owner hears "New bulk order received", like "New order received" for a normal order
        assert.ok(n.data.speechHi && /[ऀ-ॿ]/.test(n.data.speechHi));
        assert.equal(n.data.kind, 'bulk');
        assert.equal(String(n.data.bulkId), String(id));
    });

    /* ------------------------------ Phase 2: live screens and the queue ------------------------------ */
    test('every change of the bulk order is sent live to the owner and the customer, so their screens reload by themselves', async () => {
        const realtime = require('../src/services/realtime');
        const sent = [];
        mock.method(realtime, 'toOwner', (t, ev, p) => { if (ev === 'bulk:update') sent.push(['owner', p.status]); });
        mock.method(realtime, 'toUser', (t, u, ev, p) => { if (ev === 'bulk:update') sent.push(['customer', p.status]); });
        await paid();                                   // confirmed
        const t = await ticket();
        await orderStatus.change({ order: t, status: 'preparing', actor: cook });   // the cook starts
        await waitFor(async () => sent.some((x) => x[1] === 'preparing'));
        assert.ok(sent.some((x) => x[0] === 'owner' && x[1] === 'confirmed'), 'owner told: confirmed');
        assert.ok(sent.some((x) => x[0] === 'owner' && x[1] === 'preparing'), 'owner told: the cook started');
        assert.ok(sent.some((x) => x[0] === 'customer' && x[1] === 'preparing'), 'customer told too');
    });

    test('the queue counts from the 24-hour call: not queued the moment it is called, queued about a minute later', async () => {
        const Tenant = require('../src/models/Tenant');
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.staff.kitchenOn': true } });
        const kitchenQueue = require('../src/jobs/kitchenQueue');
        await paid();
        await setWhen(20);
        await bulkJob.runBulkCookAlerts();              // called "to make" now
        await kitchenQueue.runKitchenQueue(new Date(Date.now() + 5000));
        assert.equal((await ticket()).kitchen?.queuedAt, undefined, '5 seconds after the call: not queued');
        await kitchenQueue.runKitchenQueue(new Date(Date.now() + 5 * 60000));
        assert.ok((await ticket()).kitchen?.queuedAt, 'a few minutes after the call, untouched: queued');
    });

    /* ------------------------------ Phase 3: the instructions from the bulk cart ------------------------------ */
    test('the food instructions go to the cook and the delivery instruction to the rider; a pickup has no delivery instruction', async () => {
        const dish2 = await Product.findOne({ tenantId: w.tenant._id });
        const post = (extra) => cust('post', '/', { fulfilment: 'pickup', when: days(5), items: [{ productId: String(dish2._id), quantity: 100 }], contact: { name: 'Raj', phone: '9000000061' }, foodNote: 'Less spicy, no onion', deliveryNote: 'Leave at door', ...extra });
        const r = await post({});
        assert.equal(r.status, 201, JSON.stringify(r.body));
        const saved = await BulkOrder.findById(r.body.id).lean();
        assert.equal(saved.foodNote, 'Less spicy, no onion');
        assert.equal(saved.deliveryNote, undefined, 'a pickup has no delivery note');
        // a delivery order keeps both, and the work ticket carries them to the cook and the rider
        await BulkOrder.updateOne({ _id: id }, { $set: { fulfilment: 'delivery', foodNote: 'Extra crispy', deliveryNote: 'Ring the bell twice', address: { label: 'Office', line1: '5 MG Road', city: 'Pune', pincode: '411001', name: 'Meera', phone: '9000000041' } } });
        await paid();
        const t = await ticket();
        assert.match(t.foodNote, /^Extra crispy/);
        assert.match(t.note, /^Bulk order .+. Ring the bell twice$/);
        const q = await kitchenSvc.queue(w.tenant);
        const row = q.bulk[0];
        assert.ok(row.bulkCode && !/s/.test(row.bulkCode), 'the code alone: ' + row.bulkCode);
        assert.match(row.note, /^Extra crispy/);
    });

    /* ------------------------------ Phase 5: the owner's quote, the pickup code, the History ------------------------------ */
    test('a percent discount on the quote: the customer sees the percent and the rupees it came to', async () => {
        const o = (await owner('get', `/${id}`)).body;
        // (beforeEach already quoted it once with no discount: ask for a change, then quote again with 5%)
        await BulkOrder.updateOne({ _id: id }, { $set: { status: 'requested' } });
        const q = await owner('post', `/${id}/quote`, { lines: o.lines.map((l) => ({ id: l.id, unitPrice: l.unitPrice })), discountPercent: 5 });
        assert.equal(q.status, 200, JSON.stringify(q.body));
        assert.equal(q.body.quote.pricing.discountPercent, 5);
        assert.equal(q.body.quote.pricing.discount, 500);                 // 5% of Rs 10000
        assert.equal(q.body.quote.pricing.total, 9500);
        const mine = (await cust('get', `/${id}`)).body;
        assert.deepEqual([mine.quote.pricing.discountPercent, mine.quote.pricing.discount, mine.quote.pricing.total], [5, 500, 9500]);
        assert.equal((await owner('post', `/${id}/quote`, { lines: [], discountPercent: 5 })).status, 409, 'already quoted');
    });

    test('the time to make it: the owner puts it on the quote, the customer sees it, the cook card carries it', async () => {
        const o = (await owner('get', `/${id}`)).body;
        await BulkOrder.updateOne({ _id: id }, { $set: { status: 'requested' } });
        const lines = o.lines.map((l) => ({ id: l.id, unitPrice: l.unitPrice }));
        assert.equal((await owner('post', `/${id}/quote`, { lines, prepHours: 0 })).status, 400, 'zero is not a time');
        const q = await owner('post', `/${id}/quote`, { lines, prepHours: 5.3 });
        assert.equal(q.status, 200, JSON.stringify(q.body));
        assert.equal(q.body.quote.prepHours, 5.5, 'to the nearest half hour');
        assert.equal((await cust('get', `/${id}`)).body.quote.prepHours, 5.5);
        await paid();
        const row = (await require('../src/services/kitchenService').queue(w.tenant)).bulk[0];
        assert.equal(row.bulkPrepHours, 5.5);
    });

    test('the pickup code: the customer sees it; handing the pickup over asks for it (the wrong one is refused, he cannot show it is written down)', async () => {
        await paid();
        const page = (await cust('get', `/${id}`)).body;
        assert.match(page.pickupCode, /^[0-9]{4}$/);
        const t = await ticket();
        assert.equal(page.pickupCode, require('../src/services/deliveryPinService').pinFor(t));
        await owner('post', `/${id}/stage`, { to: 'preparing' }); await owner('post', `/${id}/stage`, { to: 'ready' });
        const bare = await owner('post', `/${id}/stage`, { to: 'delivered' });
        assert.equal(bare.status, 400);
        assert.match(bare.body.error, /pickup code/);
        const wrong = await owner('post', `/${id}/stage`, { to: 'delivered', pickupCode: page.pickupCode === '1234' ? '4321' : '1234' });
        assert.equal(wrong.status, 400);
        assert.equal((await bulkStatus()), 'ready');
        const right = await owner('post', `/${id}/stage`, { to: 'delivered', pickupCode: page.pickupCode });
        assert.equal(right.status, 200, JSON.stringify(right.body));
    });

    test('handed over without the code is allowed once the owner says so, and it is written down', async () => {
        await paid();
        await owner('post', `/${id}/stage`, { to: 'preparing' }); await owner('post', `/${id}/stage`, { to: 'ready' });
        assert.equal((await owner('post', `/${id}/stage`, { to: 'delivered', skipCode: true })).status, 200);
        const b = await row();
        assert.ok(b.history.some((h) => /without the pickup code/.test(h.note || '')));
    });

    test('History: a bulk order is one card with its code and its real total, and the Normal / Bulk filter works', async () => {
        await paid();
        await owner('post', `/${id}/stage`, { to: 'preparing' }); await owner('post', `/${id}/stage`, { to: 'ready' }); await stage('delivered');
        await f2.makeOrder(w.tenant, w.customer.user, { orderNo: 7000, status: 'delivered', pricing: { subtotal: 200, total: 200 }, payment: { method: 'cod', status: 'paid' } });
        const all = (await request(app).get('/api/shop/order-history?range=week').set(w.owner.headers)).body;
        const bulkCard = all.items.find((c) => c.bulk);
        assert.ok(bulkCard, 'the bulk order is in History');
        assert.equal(bulkCard.bulk.code.length > 3, true);
        assert.equal(bulkCard.total, 10000);                                  // not the Rs 5000 balance
        assert.equal(all.summary.sales, 10200);                               // 10000 + 200
        const onlyBulk = (await request(app).get('/api/shop/order-history?range=week&kind=bulk').set(w.owner.headers)).body;
        assert.deepEqual(onlyBulk.items.map((c) => !!c.bulk), [true]);
        const normal = (await request(app).get('/api/shop/order-history?range=week&kind=normal').set(w.owner.headers)).body;
        assert.deepEqual(normal.items.map((c) => !!c.bulk), [false]);
        assert.equal(normal.summary.sales, 200);
    });

    /* ------------------------------ Phase 6: the balance by QR, and the pickup reminders ------------------------------ */
    test('the owner QR for the balance: made from the shop UPI ID, none without one; UPI received completes the order', async () => {
        const Tenant = require('../src/models/Tenant');
        await paid();
        await owner('post', `/${id}/stage`, { to: 'preparing' }); await owner('post', `/${id}/stage`, { to: 'ready' });
        const none = await owner('get', `/${id}/pay-qr`);
        assert.equal(none.status, 200);
        assert.deepEqual([none.body.available, none.body.reason], [false, 'no_upi']);
        assert.equal((await owner('get', '/settings')).body.upiReady, false);
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.dineIn.upiId': 'myshop@okbank' } });
        require('../src/middlewares/tenantRecognizer').invalidateTenant(w.tenant.slug);   // the shop is read from a short memory
        const qr = await owner('get', `/${id}/pay-qr`);
        assert.equal(qr.body.available, true, JSON.stringify(qr.body));
        assert.equal(qr.body.payable, 5000);                                  // the BALANCE only
        assert.ok(qr.body.upiString.startsWith('upi://pay?pa=myshop%40okbank&'), qr.body.upiString);
        assert.ok(qr.body.upiString.includes('am=5000.00'), qr.body.upiString);
        assert.ok(qr.body.image.startsWith('data:image/png;base64,'));
        assert.equal((await owner('get', '/settings')).body.upiReady, true);
        const got = await owner('post', `/${id}/cash-received`, { via: 'upi' });
        assert.equal(got.status, 200, JSON.stringify(got.body));
        assert.equal((await row()).payment.balanceVia, 'upi');
        await stage('delivered');
        assert.equal(await bulkStatus(), 'completed');
        assert.equal((await owner('get', `/${id}/pay-qr`)).status, 409, 'nothing left to collect');
    });

    test('the rider Razorpay door QR pays the bulk balance (and the order completes)', async () => {
        const Rider = require('../src/models/Rider');
        const assignment = require('../src/services/assignmentService');
        const door = require('../src/services/doorPayment');
        await Rider.updateOne({ tenantId: w.tenant._id, userId: w.rider.user._id }, { $set: { isActive: true, isOnline: true, activeOrderCount: 0 } });
        await BulkOrder.updateOne({ _id: id }, { $set: { fulfilment: 'delivery', address: { label: 'Office', line1: '5 MG Road', city: 'Pune', pincode: '411001', name: 'Meera', phone: '9000000041' } } });
        await paid();
        let t = await ticket();
        await orderStatus.change({ order: t, status: 'preparing', actor: cook });
        await kitchenSvc.ready({ tenant: w.tenant, orderId: t._id, staff });
        await assignment.assign({ orderId: t._id, tenantId: w.tenant._id, riderUserId: w.rider.user._id, reason: 'test', actor: { type: 'owner', id: String(w.owner.user._id) } });
        t = await ticket();
        t = await orderStatus.change({ order: t, status: 'out_for_delivery', actor: { type: 'rider', id: w.rider.user._id, label: 'Rider' } });
        // the customer scans the rider's QR for the balance (the webhook calls credit)
        await Order.updateOne({ _id: t._id }, { $set: { 'delivery.doorQr': { qrId: 'qr_door_1', amountPaise: 500000, expiresAt: new Date(Date.now() + 3600000), createdAt: new Date() } } });
        const r = await door.credit({ account: w.tenant._id, qr: { id: 'qr_door_1', notes: { purpose: 'door_cod', referenceId: String(t._id) } }, pay: { id: 'pay_door_1', status: 'captured', amountPaise: 500000, method: 'upi' } });
        assert.equal(r.door, 'paid', JSON.stringify(r));
        const b = await row();
        assert.deepEqual([b.payment.balancePaid, b.payment.balanceVia, b.payment.balancePaise], [true, 'door', 500000]);
        t = await ticket();
        await orderStatus.change({ order: t, status: 'delivered', actor: { type: 'rider', id: w.rider.user._id, label: 'Rider' } });
        await waitFor(async () => (await bulkStatus()) === 'completed');
        const CodSettlement = require('../src/models/CodSettlement');
        assert.equal(await CodSettlement.countDocuments({ tenantId: w.tenant._id, type: 'collect' }), 0, 'the rider holds no cash: the customer paid online');
    });

    test('a ready bulk pickup reminds the customer 30 minutes before the time, and the reminder opens the bulk order', async () => {
        const { runPickupReminders } = require('../src/jobs/pickupReminders');
        const Notification = require('../src/models/Notification');
        await paid();
        const t = await ticket();
        assert.ok(t.pickupUntil && Math.abs(new Date(t.pickupUntil) - new Date(t.scheduledFor)) < 1000, 'the window ends at the time he chose');
        await owner('post', `/${id}/stage`, { to: 'preparing' }); await owner('post', `/${id}/stage`, { to: 'ready' });
        const when = new Date(t.scheduledFor).getTime();
        assert.deepEqual(await runPickupReminders(new Date(when - 3 * 3600000)), { sent: 0 }, 'too early');
        assert.deepEqual(await runPickupReminders(new Date(when - 20 * 60000)), { sent: 1 });
        assert.deepEqual(await runPickupReminders(new Date(when - 10 * 60000)), { sent: 0 }, 'once');
        const n = await Notification.findOne({ userId: w.customer.user._id, type: 'pickup_waiting' }).lean();
        assert.ok(n, 'the customer was reminded');
        assert.equal(n.data.kind, 'bulk');
        assert.equal(String(n.data.bulkId), String(id));
    });

    test('a bulk delivery waiting for its day does not stop the customer ordering a normal delivery or pickup', async () => {
        const orderMix = require('../src/services/orderMix');
        const { resolveConfig } = require('../src/services/tenantConfigService');
        const Tenant = require('../src/models/Tenant');
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.mixRules.deliveryOpenMax': 1, 'settings.orders.pickupRules.openMax': 1 } });
        const tenant = await Tenant.findById(w.tenant._id).lean();
        await BulkOrder.updateOne({ _id: id }, { $set: { fulfilment: 'delivery', address: { label: 'Office', line1: '5 MG Road', city: 'Pune', pincode: '411001', name: 'Meera', phone: '9000000041' } } });
        await paid();                                                    // the work ticket is open: a delivery, accepted, cash balance 5000
        assert.equal((await ticket()).orderType, 'delivery');
        const ask = (type) => orderMix.check({ tenant, config: resolveConfig(tenant), userId: w.customer.user._id, priced: { orderType: type, pricing: { total: 300 } }, body: { paymentMethod: 'cod' } });
        assert.equal(await ask('delivery'), null, 'the ticket does not count as a delivery on the way');
        // a REAL open delivery order does count (the rule still works)
        await f2.makeOrder(w.tenant, w.customer.user, { orderNo: 8001, orderType: 'delivery', status: 'accepted', payment: { method: 'cod', status: 'pending' } });
        const blocked = await ask('delivery');
        assert.equal(blocked?.status, 409);
        assert.match(blocked.message, /already have 1 delivery order/);
    });

    test('after delivery the customer can rate the food and send a complaint; a refund on a bulk order is only written down (no money goes out by itself)', async () => {
        const Complaint = require('../src/models/Complaint');
        const Review = require('../src/models/Review');
        await paid();
        assert.equal((await cust('get', `/${id}`)).body.feedbackOrderId, undefined, 'not before it is delivered');
        for (const to of ['preparing', 'ready', 'delivered']) assert.equal((await stage(to)).status, 200);
        const page = (await cust('get', `/${id}`)).body;
        const tid = page.feedbackOrderId;
        assert.ok(tid, 'the ticket to rate');
        const ticket = await Order.findById(tid).lean();
        const dish = ticket.items[0];
        const rate = await request(app).post(`/api/orders/${tid}/rating`).set(w.customer.headers).send({ ratings: [{ productId: String(dish.productId), rating: 5, comment: 'Lovely' }] });
        assert.equal(rate.status, 200, JSON.stringify(rate.body));
        assert.equal(await Review.countDocuments({ orderId: tid, rating: 5 }), 1);
        const c = await request(app).post(`/api/orders/${tid}/complaints`).set(w.customer.headers).send({ type: 'late', text: 'It came late' });
        assert.equal(c.status, 201, JSON.stringify(c.body));
        assert.match(c.body.bulkCode, /^[A-Z0-9]{6}$/);
        const list = (await request(app).get('/api/shop/complaints').set(w.owner.headers)).body;
        assert.equal(list.items[0].bulkCode, c.body.bulkCode);
        assert.deepEqual([list.items[0].bulkTotal, !!list.items[0].bulkId], [10000, true]);
        // the owner returns Rs 1000 of Rs 10000: written down only, and cannot be more than the whole bulk order
        const tooMuch = await request(app).patch(`/api/shop/complaints/${c.body.id}`).set(w.owner.headers).send({ resolution: 'refund_partial', refundPaise: 1000001 });
        assert.equal(tooMuch.status, 400);
        const ok = await request(app).patch(`/api/shop/complaints/${c.body.id}`).set(w.owner.headers).send({ resolution: 'refund_partial', refundPaise: 100000, ownerReply: 'Sorry' });
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
        assert.deepEqual([ok.body.refundPaise, ok.body.refundStatus], [100000, 'noted']);
        const OnlineRefund = require('../src/models/OnlineRefund');
        assert.equal(await OnlineRefund.countDocuments({ orderId: tid }), 0, 'nothing was sent to the payment gateway');
    });
});
