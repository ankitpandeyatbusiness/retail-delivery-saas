require('./helpers/env');
process.env.SECRETS_KEY = process.env.SECRETS_KEY || require('crypto').randomBytes(32).toString('base64');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const TableBooking = require('../src/models/TableBooking');
const TablePayment = require('../src/models/TablePayment');
const pushChannel = require('../src/notifications/channels/push');
const tableBill = require('../src/services/tableBill');
const tablePayment = require('../src/services/tablePayment');
const bookingPayment = require('../src/services/bookingPayment');
const platformCheckout = require('../src/services/platformCheckout');
const reconcile = require('../src/services/paymentReconcile');
const adminAlerts = require('../src/services/adminAlerts');
const payments = require('../src/services/adapters/payments');

let w; let n = 0; let alerts;
const sign = (orderId, paymentId) => crypto.createHmac('sha256', 'mock_key_secret').update(`${orderId}|${paymentId}`).digest('hex');

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    payments._mock.reset();
    mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
    alerts = [];
    mock.method(adminAlerts, 'alert', async (key, opts) => { alerts.push({ key, ...opts }); });
    const slug = `gaps-${++n}`;
    w = await f.makeWorld(slug);
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.dineIn': { enabled: true, tableCount: 10 } } });
    tenantRecognizer.invalidateTenant(slug);
});
afterEach(() => mock.restoreAll());

describe('gap 2: a booking deposit refund never goes out twice', () => {
    const failedBooking = (extra = {}) => TableBooking.create({
        tenantId: w.tenant._id, userId: w.customer.user._id, code: 'ABCDE', name: 'Anil', phone: '9000000030', date: '2030-01-01', time: '20:00',
        startsAt: new Date(Date.now() + 86400000), party: 2, status: 'cancelled', rules: { refundHours: 2 },
        deposit: { amount: 400, status: 'refund_failed', ...extra }, payment: { rzpOrderId: 'order_b', rzpPaymentId: 'pay_b', amountPaise: 40000 },
    });

    test('a retry first asks Razorpay: the refund already went out, so nothing is sent again', async () => {
        const b = await failedBooking({ refundError: 'timeout' });
        payments._mock.setRefunds('pay_b', [{ id: 'rfnd_1', paymentId: 'pay_b', amountPaise: 40000, status: 'processed' }]);
        const send = mock.method(payments, 'refund', async () => { throw new Error('must not be called'); });
        const r = await bookingPayment.refundDeposit(b._id, 'retry');
        assert.equal(r.already, true);
        assert.equal(send.mock.callCount(), 0);
        const done = await TableBooking.findById(b._id).lean();
        assert.deepEqual([done.deposit.status, done.deposit.refundId], ['refunded', 'rfnd_1']);
        assert.equal(done.deposit.refundError, undefined);
    });

    test('a retry with no refund at Razorpay sends it once', async () => {
        const b = await failedBooking({ refundError: 'timeout' });
        const send = mock.method(payments, 'refund', async () => ({ refundId: 'rfnd_2', status: 'processed', amountPaise: 40000 }));
        assert.equal((await bookingPayment.refundDeposit(b._id, 'retry')).ok, true);
        assert.equal(send.mock.callCount(), 1);
        assert.equal((await bookingPayment.refundDeposit(b._id, 'retry')).skipped, true);   // already refunded: nothing more
        assert.equal(send.mock.callCount(), 1);
    });

    test('if Razorpay cannot be asked, nothing is sent; the first failure alerts, a repeated one does not', async () => {
        const first = await failedBooking();   // no refundError yet: this is the first try
        mock.method(payments, 'refund', async () => { throw new Error('network down'); });
        await bookingPayment.refundDeposit(first._id, 'cancel');
        assert.equal(alerts.filter((a) => a.key === 'admin_refund_failed').length, 1);
        const afterFirst = await TableBooking.findById(first._id).lean();
        assert.deepEqual([afterFirst.deposit.status, !!afterFirst.deposit.refundError], ['refund_failed', true]);

        mock.method(payments, 'listRefunds', async () => { throw new Error('network down'); });
        const send = mock.method(payments, 'refund', async () => ({ refundId: 'x', status: 'processed', amountPaise: 40000 }));
        await bookingPayment.refundDeposit(first._id, 'retry');
        await bookingPayment.refundDeposit(first._id, 'retry');
        assert.equal(send.mock.callCount(), 0);   // could not check, so it did not risk a second refund
        assert.equal(alerts.filter((a) => a.key === 'admin_refund_failed').length, 1);   // no alert every minute
        assert.equal((await TableBooking.findById(first._id).lean()).deposit.status, 'refund_failed');
    });
});

describe('gap 3: money on the platform account that matches nothing is reported', () => {
    test('a captured payment for an unknown Razorpay order alerts the superadmin', async () => {
        const r = await platformCheckout.onPlatformPayment({ id: 'pay_zz', orderId: 'order_unknown', status: 'captured', amountPaise: 123400 });
        assert.equal(r.ignored, 'unknown_order');
        const a = alerts.filter((x) => x.key === 'admin_webhook_failed');
        assert.equal(a.length, 1);
        assert.match(a[0].vars.error, /pay_zz/);
        assert.match(a[0].vars.error, /1234\.00/);
    });
    test('a payment that is not captured stays quiet', async () => {
        await platformCheckout.onPlatformPayment({ id: 'pay_zy', orderId: 'order_unknown', status: 'failed', amountPaise: 1000 });
        assert.equal(alerts.length, 0);
    });
});

describe('gap 4: a table bill paid online whose rounds were not marked paid is finished', () => {
    const setup = async () => {
        const g = w.customer;
        const s = await tableBill.joinOrOpen({ tenantId: w.tenant._id, table: '4', userId: g.user._id });
        await f.makeOrder(w.tenant, g.user, { orderType: 'dine_in', tableNo: s.table, tableSessionId: s._id, status: 'delivered', pricing: { subtotal: 500, total: 500 } });
        const start = await tablePayment.start({ tenantId: w.tenant._id, userId: g.user._id });
        const pid = 'pay_tbl1';
        payments._mock.setPayment({ id: pid, orderId: start.rzpOrderId, status: 'captured', amountPaise: start.amountPaise });
        return { g, s, start, pid };
    };
    const allPaid = async (s) => (await Order.find({ tableSessionId: s._id }).lean()).every((o) => o.payment.status === 'paid');
    const verify = ({ g, start, pid }) => tablePayment.verify({ tenantId: w.tenant._id, userId: g.user._id, rzpOrderId: start.rzpOrderId, rzpPaymentId: pid, signature: sign(start.rzpOrderId, pid) });

    test('a normal payment is marked settled', async () => {
        const x = await setup();
        assert.equal((await verify(x)).paid, true);
        assert.equal(await allPaid(x.s), true);
        const row = await TablePayment.findOne({ rzpOrderId: x.start.rzpOrderId }).lean();
        assert.ok(row.settledAt && row.settleStartedAt);
        assert.equal(await tablePayment.repairUnsettled(new Date(Date.now() + 10 * 60000)), 0);   // nothing to repair
    });

    test('a crash after "captured": a repeat inside 2 minutes waits, the repair job finishes it later, once', async () => {
        const x = await setup();
        mock.method(Order, 'updateMany', async () => { throw new Error('server died'); }, { times: 1 });
        await assert.rejects(verify(x), /server died/);
        assert.equal((await TablePayment.findOne({ rzpOrderId: x.start.rzpOrderId }).lean()).status, 'captured');
        assert.equal(await allPaid(x.s), false);

        assert.equal((await verify(x)).repeat, true);   // too soon: the first run may still be working
        assert.equal(await allPaid(x.s), false);

        const later = new Date(Date.now() + 5 * 60000);
        assert.equal(await tablePayment.repairUnsettled(later), 1);
        assert.equal(await allPaid(x.s), true);
        const row = await TablePayment.findOne({ rzpOrderId: x.start.rzpOrderId }).lean();
        assert.ok(row.settledAt);
        assert.equal(await tablePayment.repairUnsettled(new Date(Date.now() + 10 * 60000)), 0);   // not done twice
        assert.equal(alerts.filter((a) => /already paid at the counter/.test(a.vars?.reason || '')).length, 0);
    });

    test('a repeat webhook after the 2 minutes finishes the work by itself', async () => {
        const x = await setup();
        mock.method(Order, 'updateMany', async () => { throw new Error('server died'); }, { times: 1 });
        await assert.rejects(verify(x), /server died/);
        await TablePayment.updateOne({ rzpOrderId: x.start.rzpOrderId }, { $set: { settleStartedAt: new Date(Date.now() - 5 * 60000) } });
        assert.equal((await verify(x)).repeat, true);
        assert.equal(await allPaid(x.s), true);
    });

    test('old rows from before this change (no settleStartedAt) are never touched, and the reconcile job runs the repair', async () => {
        const x = await setup();
        await verify(x);
        await TablePayment.updateOne({ rzpOrderId: x.start.rzpOrderId }, { $unset: { settledAt: 1, settleStartedAt: 1 } });
        assert.equal(await tablePayment.repairUnsettled(new Date(Date.now() + 10 * 60000)), 0);
        const r = await reconcile.runPaymentReconcile();
        assert.equal(r.tableRepaired, 0);
    });
});

describe('gap 6: the shop webhook setup lists the door QR event', () => {
    test('the events to tick in Razorpay include qr_code.credited', async () => {
        const { token } = await f.makeSuperAdmin('root@test.com');
        const r = await request(app).post(`/api/admin/tenants/${w.tenant._id}/payments/webhook-secret`).set({ Authorization: `Bearer ${token}` }).send({});
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.ok(r.body.events.includes('qr_code.credited'));
        assert.ok(r.body.events.includes('payment.captured'));
    });
});
