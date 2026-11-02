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

    test('nobody can cancel a ticket from the Orders screen: it must go through Bulk orders', async () => {
        await paid();
        const t = await ticket();
        await assert.rejects(() => orderStatus.change({ order: t, status: 'cancelled', actor: { type: 'owner', id: String(w.owner.user._id), label: 'Owner' }, reasonCode: 'other', note: 'x' }), /bulk order/i);
        assert.equal((await ticket()).status, 'accepted');
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
});
