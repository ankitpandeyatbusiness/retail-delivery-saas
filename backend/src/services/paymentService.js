// Online payment of an order. Money rules:
//  - the server decides the amount, never the app
//  - an order becomes "paid" in ONE place (confirmCapture). The app check and the webhook both end here, and it is safe to run twice
//  - what Razorpay says it captured must equal what we asked for, else the money goes back
//  - money that arrives for an order that is already cancelled goes back (late payment)
const Order = require('../models/Order');
const OnlinePayment = require('../models/OnlinePayment');
const payments = require('./adapters/payments');
const accounts = require('./paymentAccounts');
const { toPaise } = require('./refundService');
const { httpError } = require('../middlewares/apiErrors');
const alert = require('./paymentAlerts');

const ONLINE = ['upi', 'card', 'wallet'];
const MOCK_SECRET = 'mock_key_secret';   // only used when PAYMENTS_MOCK=true

const fromEntity = (e = {}) => ({
    id: e.id,
    orderId: e.order_id || null,
    status: e.status,
    amountPaise: e.amount,
    capturedPaise: e.captured ? e.amount : 0,
    refundedPaise: e.amount_refunded || 0,
    method: e.method || null,
    notes: e.notes || {},
});

// the keys of the shop that owns the order
async function credsFor(tenantId) {
    if (payments.isMock()) return { keyId: 'rzp_test_mock', keySecret: MOCK_SECRET, mode: 'mock' };
    const c = await accounts.forTenant(tenantId);
    return { keyId: c.keyId, keySecret: c.keySecret, mode: c.mode };
}

// The app wants to pay this order: make (or reuse) the Razorpay order. Safe to call again.
async function startForOrder({ order }) {
    if (!order || !ONLINE.includes(order.payment?.method)) throw httpError(400, 'This order is not an online order');
    if (order.payment.status === 'paid') throw httpError(409, 'This order is already paid');
    if (order.status !== 'placed') throw httpError(409, 'This order can no longer be paid');
    const can = await accounts.canTakePayments(order.tenantId);
    if (!can.ok) throw httpError(503, can.reason || 'Online payment is not available right now');
    const creds = await credsFor(order.tenantId);
    if (!creds.keyId || !creds.keySecret) throw httpError(503, 'Online payment is not available right now');

    let p = await OnlinePayment.findOne({ orderId: order._id, tenantId: order.tenantId });
    if (!p) {
        const amountPaise = toPaise(order.pricing?.total);
        if (amountPaise < 100) throw httpError(400, 'The amount is too small for an online payment');
        const ro = await payments.createOrder({
            amountPaise,
            receipt: `o${order.orderNo}-${String(order._id).slice(-10)}`,
            notes: { orderId: String(order._id), tenantId: String(order.tenantId) },
            credentials: creds,
        });
        try {
            p = await OnlinePayment.create({
                tenantId: order.tenantId, orderId: order._id, mode: creds.mode || 'test',
                rzpOrderId: ro.id, amountPaise,
            });
        } catch (e) {
            if (e.code !== 11000) throw e;   // two taps at once: use the first one
            p = await OnlinePayment.findOne({ orderId: order._id, tenantId: order.tenantId });
        }
    }
    return { keyId: creds.keyId, rzpOrderId: p.rzpOrderId, amountPaise: p.amountPaise, currency: 'INR', orderId: String(order._id) };
}

// "Did it get paid?" answered by Razorpay itself, right now. The app calls this after it came back from the
// payment app without a usable proof (or when it is unsure), so it never depends on a webhook arriving in time.
// Safe to repeat. -> { paid, status }
async function checkWithRazorpay({ order }) {
    if (order.payment?.status === 'paid') return { paid: true, status: 'captured' };
    const p = await OnlinePayment.findOne({ orderId: order._id, tenantId: order.tenantId });
    if (!p) return { paid: false, status: 'none' };
    const creds = await credsFor(order.tenantId);
    const list = await payments.listOrderPayments({ orderId: p.rzpOrderId, credentials: creds });
    const captured = list.find((x) => x.status === 'captured');
    if (!captured) return { paid: false, status: list[0]?.status || 'created' };
    const r = await confirmCapture({ payment: p, rzp: captured, source: 'app-check' });
    return { paid: !!r.paid, status: 'captured' };
}

// The app says "paid". We do NOT trust that: check the proof, then ask Razorpay what really happened.
async function verifyFromApp({ order, rzpOrderId, rzpPaymentId, signature }) {
    const p = await OnlinePayment.findOne({ orderId: order._id, tenantId: order.tenantId });
    if (!p || p.rzpOrderId !== rzpOrderId) throw httpError(400, 'This payment does not belong to this order');
    const creds = await credsFor(order.tenantId);
    const ok = payments.verifyPaymentSignature({ orderId: rzpOrderId, paymentId: rzpPaymentId, signature, secret: creds.keySecret });
    if (!ok) throw httpError(400, 'The payment proof is not valid');
    const rzp = await payments.fetchPayment({ paymentId: rzpPaymentId, credentials: creds });
    return confirmCapture({ payment: p, rzp, source: 'app' });
}

// THE one place where money becoming ours is recorded. `rzp` is a normalized payment (see fromEntity / the adapter).
async function confirmCapture({ payment, rzp, source }) {
    if (rzp.orderId !== payment.rzpOrderId) {
        await alert('admin_webhook_failed', { tenantId: payment.tenantId, vars: { event: 'payment', error: 'Payment is for another Razorpay order' } });
        return { ok: false, ignored: 'wrong_order' };
    }
    if (rzp.status !== 'captured') return { ok: true, paid: false, status: rzp.status };

    const now = new Date();
    const same = Number.isInteger(rzp.amountPaise) && rzp.amountPaise === payment.amountPaise;
    const first = await OnlinePayment.findOneAndUpdate(
        { _id: payment._id, status: 'created' },
        {
            $set: {
                status: same ? 'captured' : 'mismatch', rzpPaymentId: rzp.id, capturedPaise: rzp.amountPaise || 0,
                capturedAt: now, method: rzp.method || undefined, source,
            },
        },
        { returnDocument: 'after' },
    );
    const cur = first || await OnlinePayment.findById(payment._id);

    if (cur.rzpPaymentId && cur.rzpPaymentId !== rzp.id) {   // a second, different payment for the same order
        await alert('admin_refund_failed', {
            tenantId: cur.tenantId, vars: { orderId: String(cur.orderId), amount: (rzp.amountPaise / 100).toFixed(2), reason: 'Second payment for the same order. Refund it from Razorpay.' },
        });
        return { ok: false, ignored: 'second_payment' };
    }

    if (cur.status === 'mismatch') {   // wrong amount: the whole payment goes back, the order stays unpaid
        if (first) {
            await alert('admin_refund_failed', {
                tenantId: cur.tenantId, vars: { orderId: String(cur.orderId), amount: (cur.capturedPaise / 100).toFixed(2), reason: 'Amount did not match. Refunding it.' },
            });
        }
        await require('./refundIssuer').issueRefund({
            tenantId: cur.tenantId, orderId: cur.orderId, amountPaise: cur.capturedPaise, reason: 'amount_mismatch', key: `order:${cur.orderId}:mismatch`,
        });
        return { ok: true, paid: false, mismatch: true };
    }

    await settleOrder(cur);   // safe to repeat: also repairs a crash between "captured" and "order paid"
    return { ok: true, paid: true, duplicate: !first };
}

async function settleOrder(pay) {
    const now = new Date();
    const res = await Order.updateOne(
        { _id: pay.orderId, tenantId: pay.tenantId, 'payment.status': { $in: ['pending', 'failed'] } },
        { $set: { 'payment.status': 'paid', 'payment.paidAt': now, 'payment.paymentId': pay.rzpPaymentId } },
    );
    // read AFTER marking paid: a cancel that happened before this moment is seen here, a cancel after it sees the paid payment
    const order = await Order.findOne({ _id: pay.orderId, tenantId: pay.tenantId }).select('tenantId status cancel orderNo orderType pricing').lean();
    if (!order) {
        await alert('admin_webhook_failed', { tenantId: pay.tenantId, vars: { event: 'payment.captured', error: 'Paid order not found' } });
        return;
    }
    if (order.status === 'cancelled') {   // late payment: give back everything the shop is not keeping
        const amountPaise = pay.capturedPaise - (order.cancel?.keptPaise || 0);
        if (amountPaise > 0) {
            await require('./refundIssuer').issueRefund({
                tenantId: pay.tenantId, orderId: pay.orderId, amountPaise, reason: 'late_payment', key: `order:${pay.orderId}:cancel`,
            });
        }
        return;
    }
    // the shop hears about an online order only now, once, when the money is here
    if (res.modifiedCount === 1) require('./autoAccept').afterPlaced(order);
}

// payment.failed: remember why. The customer may try again on the same Razorpay order, so nothing else changes.
async function markFailed({ payment, reason }) {
    await OnlinePayment.updateOne({ _id: payment._id, status: 'created' }, { $set: { lastFailure: { at: new Date(), reason: String(reason || '').slice(0, 200) } } });
    return { ok: true };
}

module.exports = { ONLINE, MOCK_SECRET, fromEntity, credsFor, startForOrder, checkWithRazorpay, verifyFromApp, confirmCapture, settleOrder, markFailed };