require('./helpers/env');
process.env.SECRETS_KEY = process.env.SECRETS_KEY || require('crypto').randomBytes(32).toString('base64');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const db = require('./helpers/db');
const f = require('./helpers/factory');
require('../src/server/app');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const TableBooking = require('../src/models/TableBooking');
const TablePayment = require('../src/models/TablePayment');
const OwedPayment = require('../src/models/OwedPayment');
const OnlinePayment = require('../src/models/OnlinePayment');
const OnlineRefund = require('../src/models/OnlineRefund');
const pushChannel = require('../src/notifications/channels/push');
const tableBill = require('../src/services/tableBill');
const tablePayment = require('../src/services/tablePayment');
const bookingPayment = require('../src/services/bookingPayment');
const owedPayment = require('../src/services/owedPayment');
const doorPayment = require('../src/services/doorPayment');
const paymentService = require('../src/services/paymentService');
const refundIssuer = require('../src/services/refundIssuer');
const notificationService = require('../src/services/notificationService');
const accounts = require('../src/services/paymentAccounts');
const secretBox = require('../src/utils/secretBox');
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
    const slug = `gaps2-${++n}`;
    w = await f.makeWorld(slug);
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.dineIn': { enabled: true, tableCount: 10 } } });
    tenantRecognizer.invalidateTenant(slug);
});
afterEach(() => mock.restoreAll());

describe('gap 5: a payment of the wrong amount goes back in full', () => {
    const wrong = (orderId, amountPaise, id = 'pay_wrong') => ({ id, orderId, status: 'captured', amountPaise, method: 'upi', notes: {} });
    const refundAlerts = () => alerts.filter((a) => a.key === 'admin_refund_failed');

    test('table booking deposit: refunded once, the booking stays unpaid, a repeat sends nothing more', async () => {
        const b = await TableBooking.create({
            tenantId: w.tenant._id, userId: w.customer.user._id, code: 'MMMMM', name: 'Anil', phone: '9000000030', date: '2030-01-01', time: '20:00',
            startsAt: new Date(Date.now() + 86400000), holdUntil: new Date(Date.now() + 600000), party: 2, status: 'held', rules: { refundHours: 2 },
            deposit: { amount: 400, status: 'unpaid' }, payment: { rzpOrderId: 'order_m', amountPaise: 40000 },
        });
        const send = mock.method(payments, 'refund', async () => ({ refundId: 'rfnd_m', status: 'processed', amountPaise: 30000 }));
        const r = await bookingPayment.confirm(b, wrong('order_m', 30000));
        assert.deepEqual([r.paid, r.mismatch], [false, true]);
        assert.equal(send.mock.callCount(), 1);
        assert.equal(send.mock.calls[0].arguments[0].amountPaise, 30000);   // what was really taken, not what was asked
        const row = await TableBooking.findById(b._id).lean();
        assert.deepEqual([row.status, row.deposit.status, row.mismatchRefund.status, row.mismatchRefund.refundId], ['held', 'unpaid', 'refunded', 'rfnd_m']);
        await bookingPayment.confirm(row, wrong('order_m', 30000));   // the webhook comes again
        assert.equal(send.mock.callCount(), 1);
        assert.equal(refundAlerts().length, 1);
    });

    test('table bill: refunded, rounds stay unpaid; a refund that failed is tried again by the next repeat', async () => {
        const g = w.customer;
        const s = await tableBill.joinOrOpen({ tenantId: w.tenant._id, table: '4', userId: g.user._id });
        await f.makeOrder(w.tenant, g.user, { orderType: 'dine_in', tableNo: s.table, tableSessionId: s._id, status: 'delivered', pricing: { subtotal: 500, total: 500 } });
        const start = await tablePayment.start({ tenantId: w.tenant._id, userId: g.user._id });
        payments._mock.setPayment({ id: 'pay_tw', orderId: start.rzpOrderId, status: 'captured', amountPaise: 40000 });
        let fail = true;
        const send = mock.method(payments, 'refund', async () => { if (fail) throw new Error('bank busy'); return { refundId: 'rfnd_t', status: 'processed', amountPaise: 40000 }; });
        const verify = () => tablePayment.verify({ tenantId: w.tenant._id, userId: g.user._id, rzpOrderId: start.rzpOrderId, rzpPaymentId: 'pay_tw', signature: sign(start.rzpOrderId, 'pay_tw') });

        assert.equal((await verify()).mismatch, true);
        assert.equal((await TablePayment.findOne({ rzpOrderId: start.rzpOrderId }).lean()).mismatchRefund.status, 'failed');
        assert.equal((await Order.find({ tableSessionId: s._id }).lean()).some((o) => o.payment.status === 'paid'), false);
        assert.equal(refundAlerts().length, 1);   // told that it failed

        fail = false;
        await verify();   // the repeat
        const row = await TablePayment.findOne({ rzpOrderId: start.rzpOrderId }).lean();
        assert.deepEqual([row.mismatchRefund.status, row.status], ['refunded', 'created']);
        assert.equal(send.mock.callCount(), 2);
        await verify();
        assert.equal(send.mock.callCount(), 2);   // and never again
    });

    test('unpaid table bill: if Razorpay already has the refund, none is sent', async () => {
        const o = await OwedPayment.create({ tenantId: w.tenant._id, userId: w.customer.user._id, sessionIds: [], sessionKey: 'k1', rzpOrderId: 'order_o', amountPaise: 30000 });
        payments._mock.setRefunds('pay_o', [{ id: 'rfnd_old', paymentId: 'pay_o', amountPaise: 20000, status: 'processed' }]);
        const send = mock.method(payments, 'refund', async () => { throw new Error('must not be called'); });
        const r = await owedPayment.onWebhook({ account: w.tenant._id, rzp: wrong('order_o', 20000, 'pay_o') });
        assert.equal(r.mismatch, true);
        assert.equal(send.mock.callCount(), 0);
        const row = await OwedPayment.findById(o._id).lean();
        assert.deepEqual([row.status, row.mismatchRefund.status, row.mismatchRefund.refundId], ['created', 'refunded', 'rfnd_old']);
    });

    test('a payment of the right amount is not refunded', async () => {
        await OwedPayment.create({ tenantId: w.tenant._id, userId: w.customer.user._id, sessionIds: [], sessionKey: 'k2', rzpOrderId: 'order_ok', amountPaise: 30000 });
        const send = mock.method(payments, 'refund', async () => ({ refundId: 'x', status: 'processed', amountPaise: 30000 }));
        await owedPayment.onWebhook({ account: w.tenant._id, rzp: wrong('order_ok', 30000, 'pay_ok') });
        assert.equal(send.mock.callCount(), 0);
    });
});

describe('gap 7: a payment at the door made with test keys is a test payment', () => {
    test('the payment row takes the mode of the shop keys', async () => {
        mock.method(paymentService, 'credsFor', async () => ({ keyId: 'rzp_test_x', keySecret: 'y', mode: 'test' }));
        const order = await f.makeOrder(w.tenant, w.customer.user, {
            status: 'out_for_delivery', payment: { method: 'cod', status: 'pending' },
            pricing: { subtotal: 300, total: 300 }, delivery: { status: 'picked_up', doorQr: { qrId: 'qr_1', amountPaise: 30000, expiresAt: new Date(Date.now() + 600000) } },
        });
        const r = await doorPayment.credit({ account: w.tenant._id, qr: { id: 'qr_1', notes: { purpose: 'door_cod', referenceId: String(order._id) } }, pay: { id: 'pay_door', status: 'captured', amountPaise: 30000, method: 'upi' } });
        assert.equal(r.door, 'paid', JSON.stringify(r));
        assert.equal((await OnlinePayment.findOne({ orderId: order._id }).lean()).mode, 'test');
    });
});

describe('gap 8: low balance and lost SECRETS_KEY are noticed', () => {
    test('a refund waiting for balance tells the owner, once', async () => {
        const order = await f.makeOrder(w.tenant, w.customer.user, { status: 'cancelled', payment: { method: 'upi', status: 'paid' }, pricing: { subtotal: 200, total: 200 } });
        await OnlinePayment.create({ tenantId: w.tenant._id, orderId: order._id, mode: 'mock', rzpOrderId: 'order_lb', rzpPaymentId: 'pay_lb', amountPaise: 20000, status: 'captured', capturedPaise: 20000, capturedAt: new Date() });
        const told = [];
        mock.method(notificationService, 'toOwner', (tenantId, p) => { told.push(p); });
        mock.method(payments, 'refund', async () => { throw Object.assign(new Error('Your account does not have enough balance to carry out the refund operation.'), { razorpay: true, status: 400 }); });
        const r = await refundIssuer.issueRefund({ tenantId: w.tenant._id, orderId: order._id, amountPaise: 20000, reason: 'cancelled', key: `order:${order._id}:cancel` });
        assert.equal(r.pending, true);   // it waits, it is not lost
        assert.equal(told.length, 1);
        assert.match(told[0].body, /balance/i);
        assert.equal((await OnlineRefund.findOne({ orderId: order._id }).lean()).status, 'pending');
        await OnlineRefund.updateOne({ orderId: order._id }, { $set: { lastTryAt: new Date(Date.now() - 600000) } });
        await refundIssuer.retryPending({ limit: 5 });   // the retry job later: no second message
        assert.equal(told.length, 1);
    });

    test('keys that can no longer be decrypted are reported at startup and on the shop status', async () => {
        await Tenant.collection.updateOne({ _id: w.tenant._id }, { $set: { 'payments.keyId': 'rzp_test_abc123456', 'payments.keySecretEnc': 'v1:AAAA:BBBB:CCCC' } });
        const bad = await accounts.unreadableKeys();
        assert.deepEqual(bad.map((b) => b.id), [String(w.tenant._id)]);
        const st = await accounts.statusFor(w.tenant._id, 'http://x');
        assert.ok(st.warnings.some((x) => /cannot be read/.test(x)));

        mock.method(payments, 'isMock', () => false);
        const found = await accounts.checkKeysReadable();
        assert.equal(found.length, 1);
        assert.ok(alerts.some((a) => a.key === 'admin_webhook_failed' && /SECRETS_KEY/.test(a.vars.error)));
    });

    test('readable keys raise no alarm', async () => {
        await Tenant.collection.updateOne({ _id: w.tenant._id }, { $set: { 'payments.keyId': 'rzp_test_abc123456', 'payments.keySecretEnc': secretBox.encrypt('shhhhhhhhhhhh') } });
        mock.method(payments, 'isMock', () => false);
        assert.deepEqual(await accounts.checkKeysReadable(), []);
        assert.equal(alerts.length, 0);
    });
});
