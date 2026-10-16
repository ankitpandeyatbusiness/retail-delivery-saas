// Paying the PLATFORM (rent bills and SMS top-ups) from the app with any UPI app or a card, the same way a customer pays an
// order: the server makes a Razorpay order on the platform account, the app pays it with Razorpay's checkout, and then the
// server checks the proof and asks Razorpay itself before anything is marked paid. (The UPI QR still works as before.)
//
//   startRent / startTopup     -> { keyId, rzpOrderId, amountPaise, currency, description }
//   verifyRent / verifyTopup   -> { paid: true } once Razorpay says the money is captured, else { paid: false, status }
//   onPlatformPayment          -> the webhook's safety net: the app may die right after paying
const mongoose = require('mongoose');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const SmsTopup = require('../models/SmsTopup');
const payments = require('./adapters/payments');
const rentPayments = require('./rentPaymentService');
const smsTopups = require('./smsTopupService');
const auditTrail = require('../middlewares/auditTrail');

const MOCK_SECRET = 'mock_key_secret';   // only used when PAYMENTS_MOCK=true
const bad = (status, message) => Object.assign(new Error(message), { status });
const toPaise = (rupees) => Math.round((Number(rupees) + Number.EPSILON) * 100);
const TOPUP_WINDOW_MS = 30 * 60 * 1000;

function creds() {
    if (payments.isMock()) return { keyId: 'rzp_test_mock', keySecret: MOCK_SECRET };
    const c = payments.platformCredentials();
    if (!c) throw bad(503, 'Online payment is not available right now. Please try again later or contact support.');
    return c;
}

const proofOk = (proof, rzpOrderId) => {
    if (!proof || proof.razorpay_order_id !== rzpOrderId) throw bad(400, 'This payment does not belong to this bill');
    const ok = payments.verifyPaymentSignature({
        orderId: proof.razorpay_order_id, paymentId: proof.razorpay_payment_id, signature: proof.razorpay_signature, secret: creds().keySecret,
    });
    if (!ok) throw bad(400, 'The payment proof is not valid');
};

const startView = (c, order, amountPaise, description) => ({ keyId: c.keyId, rzpOrderId: order, amountPaise, currency: 'INR', description });

async function makeOrder({ amountPaise, receipt, notes }) {
    try {
        return await payments.createOrder({ amountPaise, receipt: receipt.slice(0, 40), notes });
    } catch (e) {
        console.error('Platform checkout order error:', e.message);
        throw bad(503, 'Online payment is not available right now. Please try again later or contact support.');
    }
}

/* ------------------------------ rent ------------------------------ */
async function startRent({ tenantId, invoiceId }) {
    if (!mongoose.isValidObjectId(invoiceId)) throw bad(404, 'Invoice not found');
    const inv = await SubscriptionInvoice.findOne({ _id: invoiceId, tenantId });
    if (!inv) throw bad(404, 'Invoice not found');
    if (inv.status === 'paid') throw bad(409, 'This bill is already paid');
    if (inv.status === 'void') throw bad(409, 'This bill was cancelled');
    const amountPaise = toPaise(inv.total);
    if (!(amountPaise >= 100)) throw bad(400, 'This bill is too small to pay online. Contact support.');
    const c = creds();
    const desc = `Bill ${inv.invoiceNo}`;

    if (inv.payOrder?.rzpOrderId && inv.payOrder.amountPaise === amountPaise) return startView(c, inv.payOrder.rzpOrderId, amountPaise, desc);   // same order again
    const o = await makeOrder({ amountPaise, receipt: `rent_${inv._id}`, notes: { purpose: 'rent', referenceId: String(inv._id), tenantId: String(tenantId) } });
    const r = await SubscriptionInvoice.updateOne({ _id: inv._id, status: 'pending' }, { $set: { payOrder: { rzpOrderId: o.id, amountPaise, createdAt: new Date() } } });
    if (!r.matchedCount) throw bad(409, 'This bill was just paid or cancelled');
    return startView(c, o.id, amountPaise, desc);
}

async function verifyRent({ tenantId, invoiceId, proof }) {
    if (!mongoose.isValidObjectId(invoiceId)) throw bad(404, 'Invoice not found');
    const inv = await SubscriptionInvoice.findOne({ _id: invoiceId, tenantId }).lean();
    if (!inv) throw bad(404, 'Invoice not found');
    if (inv.status === 'paid') return { paid: true };
    if (!inv.payOrder?.rzpOrderId) throw bad(400, 'Start the payment first');
    proofOk(proof, inv.payOrder.rzpOrderId);
    const pay = await payments.fetchPayment({ paymentId: proof.razorpay_payment_id, credentials: payments.isMock() ? undefined : creds() });
    if (pay.orderId !== inv.payOrder.rzpOrderId) throw bad(400, 'This payment does not belong to this bill');
    if (pay.status !== 'captured') return { paid: false, status: pay.status };
    const r = await rentPayments.settle({ invoiceId: inv._id, pay, via: { path: '/api/shop/subscription/invoices/:id/pay/verify', method: 'APP' } });
    return { paid: r.rent === 'paid' || r.rent === 'already_paid' };
}

/* ------------------------------ SMS top-up ------------------------------ */
async function startTopup({ tenantId, amountPaise, actor }) {
    const o = await smsTopups.options();
    if (!Number.isInteger(amountPaise) || amountPaise < o.minPaise || amountPaise > o.maxPaise) throw bad(400, `Amount must be between ${o.minPaise} and ${o.maxPaise} paise`);
    const open = await SmsTopup.countDocuments({ tenantId, status: 'pending', expiresAt: { $gt: new Date() } });
    if (open >= 5) throw bad(429, 'Too many open top-ups. Pay one or wait a few minutes.');

    const c = creds();
    const cost = smsTopups.price(amountPaise, o.gstPercent);
    const topup = new SmsTopup({ tenantId, ...cost, createdBy: actor, expiresAt: new Date(Date.now() + TOPUP_WINDOW_MS) });
    const order = await makeOrder({ amountPaise: cost.payablePaise, receipt: `topup_${topup._id}`, notes: { purpose: 'sms_topup', referenceId: String(topup._id), tenantId: String(tenantId) } });
    topup.rzpOrderId = order.id;
    await topup.save();
    return { topupId: topup._id, ...startView(c, order.id, cost.payablePaise, 'SMS balance'), creditPaise: amountPaise, gstPaise: cost.gstPaise, gstPercent: cost.gstPercent };
}

async function verifyTopup({ tenantId, topupId, proof }) {
    if (!mongoose.isValidObjectId(topupId)) throw bad(404, 'Top-up not found');
    const t = await SmsTopup.findOne({ _id: topupId, tenantId }).lean();
    if (!t) throw bad(404, 'Top-up not found');
    if (t.status === 'paid') return { paid: true };
    if (!t.rzpOrderId) throw bad(400, 'Start the payment first');
    proofOk(proof, t.rzpOrderId);
    const pay = await payments.fetchPayment({ paymentId: proof.razorpay_payment_id, credentials: payments.isMock() ? undefined : creds() });
    if (pay.orderId !== t.rzpOrderId) throw bad(400, 'This payment does not belong to this top-up');
    if (pay.status !== 'captured') return { paid: false, status: pay.status };
    await creditTopup(t, pay, { path: '/api/shop/sms/topup/:id/verify', method: 'APP' });
    return { paid: true };
}

// a captured payment for a top-up: check the amount, credit once (the wallet credit key makes a repeat harmless)
async function creditTopup(t, pay, via) {
    if (pay.amountPaise !== smsTopups.payable(t)) throw bad(409, 'The amount paid does not match this top-up. Please contact support.');
    const done = await smsTopups.complete({ topupId: t._id, tenantId: t.tenantId, paymentId: pay.id, actor: { type: 'system' } });
    if (!done.duplicate) {
        await auditTrail.record({
            actorType: 'system', actorLabel: 'razorpay', tenantId: t.tenantId, action: 'SMS_TOPUP_PAID_ONLINE', method: via.method, path: via.path, status: 200,
            params: { topupId: String(t._id), amountPaise: t.amountPaise, paymentId: pay.id, rzpOrderId: t.rzpOrderId },
        });
    }
    return done;
}

/* ------------------------------ webhook safety net ------------------------------ */
// payment.captured on the platform account for one of the orders made above
async function onPlatformPayment(pay) {
    if (!pay.orderId || pay.status !== 'captured') return { ignored: 'not_captured' };
    const inv = await SubscriptionInvoice.findOne({ 'payOrder.rzpOrderId': pay.orderId }).select('_id').lean();
    if (inv) return rentPayments.settle({ invoiceId: inv._id, pay, via: { path: '/api/webhooks/razorpay/platform', method: 'WEBHOOK' } });
    const t = await SmsTopup.findOne({ rzpOrderId: pay.orderId }).lean();
    if (t) {
        await creditTopup(t, pay, { path: '/api/webhooks/razorpay/platform', method: 'WEBHOOK' });
        return { topup: 'credited' };
    }
    return { ignored: 'unknown_order' };
}

module.exports = { startRent, verifyRent, startTopup, verifyTopup, onPlatformPayment, MOCK_SECRET };
