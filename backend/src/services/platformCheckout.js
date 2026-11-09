// Paying the PLATFORM (plans, extra shops, Partner wallet and SMS top-ups) from the app with any UPI app or a card, the same way a customer pays an
// order: the server makes a Razorpay order on the platform account, the app pays it with Razorpay's checkout, and then the
// server checks the proof and asks Razorpay itself before anything is marked paid. (The UPI QR still works as before.)
//
//   startTopup / startPlan     -> { keyId, rzpOrderId, amountPaise, currency, description }
//   verifyTopup / verifyPlan   -> { paid: true } once Razorpay says the money is captured, else { paid: false, status }
//   onPlatformPayment          -> the webhook's safety net: the app may die right after paying
const mongoose = require('mongoose');
const SmsTopup = require('../models/SmsTopup');
const PartnerTopup = require('../models/PartnerTopup');
const partnerTopups = require('./partnerTopupService');
const PlanPayment = require('../models/PlanPayment');
const planBilling = require('./planBilling');
const alert = require('./paymentAlerts');
const payments = require('./adapters/payments');
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

/* ------------------------------ a plan (Growth / Pro) ------------------------------ */
// The price is worked out by planBilling.quote (the same function the preview uses) and stored with the payment; the app never sends an amount.
async function startPlan({ tenant, to, months, branch, coupon, actor }) {
    const { payment, quote, reused } = await planBilling.createPayment(tenant, { to, months, branch: !!branch, coupon }, actor);
    if (quote.free) throw bad(409, 'Nothing to pay: confirm the plan instead');
    const c = creds();
    if (reused) return { paymentId: payment._id, ...startView(c, payment.rzpOrderId, payment.payablePaise, `${quote.kind === 'branch' ? 'Extra shop' : quote.toName + ' plan'}`), quote };
    const order = await makeOrder({ amountPaise: payment.payablePaise, receipt: `plan_${payment._id}`, notes: { purpose: 'plan', referenceId: String(payment._id), tenantId: String(tenant._id) } });
    payment.rzpOrderId = order.id;
    await payment.save();
    return { paymentId: payment._id, ...startView(c, order.id, payment.payablePaise, quote.kind === 'branch' ? 'Extra shop' : `${quote.toName} plan`), quote };
}

async function verifyPlan({ tenantId, paymentId, proof }) {
    if (!mongoose.isValidObjectId(paymentId)) throw bad(404, 'Payment not found');
    const row = await PlanPayment.findOne({ _id: paymentId, tenantId }).lean();
    if (!row) throw bad(404, 'Payment not found');
    if (row.status === 'paid') return { paid: true };
    if (!row.rzpOrderId) throw bad(400, 'Start the payment first');
    proofOk(proof, row.rzpOrderId);
    const pay = await payments.fetchPayment({ paymentId: proof.razorpay_payment_id, credentials: payments.isMock() ? undefined : creds() });
    if (pay.orderId !== row.rzpOrderId) throw bad(400, 'This payment does not belong to this plan');
    if (pay.status !== 'captured') return { paid: false, status: pay.status };
    const r = await planBilling.settle(row._id, { payId: pay.id, amountPaise: pay.amountPaise });
    return { paid: true, held: !!r.held };
}

/* ------------------------------ Partner wallet top-up ------------------------------ */
async function startPartnerTopup({ tenantId, amountPaise, actor }) {
    const o = await partnerTopups.options();
    if (!Number.isInteger(amountPaise) || amountPaise < o.minPaise || amountPaise > o.maxPaise) throw bad(400, `Amount must be between ${o.minPaise} and ${o.maxPaise} paise`);
    const open = await PartnerTopup.countDocuments({ tenantId, status: 'pending', expiresAt: { $gt: new Date() } });
    if (open >= 5) throw bad(429, 'Too many open top-ups. Pay one or wait a few minutes.');
    const c = creds();
    const cost = partnerTopups.price(amountPaise, o.gstPercent);   // the amount is always worked out here, never trusted from the app
    const topup = new PartnerTopup({ tenantId, ...cost, createdBy: actor, expiresAt: new Date(Date.now() + TOPUP_WINDOW_MS) });
    const order = await makeOrder({ amountPaise: cost.payablePaise, receipt: `ptopup_${topup._id}`, notes: { purpose: 'partner_topup', referenceId: String(topup._id), tenantId: String(tenantId) } });
    topup.rzpOrderId = order.id;
    await topup.save();
    return { topupId: topup._id, ...startView(c, order.id, cost.payablePaise, 'Wallet top-up'), creditPaise: amountPaise, gstPaise: cost.gstPaise, gstPercent: cost.gstPercent };
}

async function verifyPartnerTopup({ tenantId, topupId, proof }) {
    if (!mongoose.isValidObjectId(topupId)) throw bad(404, 'Top-up not found');
    const t = await PartnerTopup.findOne({ _id: topupId, tenantId }).lean();
    if (!t) throw bad(404, 'Top-up not found');
    if (t.status === 'paid') return { paid: true };
    if (!t.rzpOrderId) throw bad(400, 'Start the payment first');
    proofOk(proof, t.rzpOrderId);
    const pay = await payments.fetchPayment({ paymentId: proof.razorpay_payment_id, credentials: payments.isMock() ? undefined : creds() });
    if (pay.orderId !== t.rzpOrderId) throw bad(400, 'This payment does not belong to this top-up');
    if (pay.status !== 'captured') return { paid: false, status: pay.status };
    await creditPartnerTopup(t, pay, { path: '/api/shop/wallet/topup/:id/verify', method: 'APP' });
    return { paid: true };
}

// a captured payment for a wallet top-up: check the amount, credit once (the ledger's payment key makes a repeat harmless)
async function creditPartnerTopup(t, pay, via) {
    if (pay.amountPaise !== partnerTopups.payable(t)) {
        await alert('admin_webhook_failed', { tenantId: t.tenantId, vars: { event: 'wallet top-up', error: `Amount ${pay.amountPaise} paise does not match the top-up (${partnerTopups.payable(t)}) (payment ${pay.id}). Check Razorpay.` } });
        throw bad(409, 'The amount paid does not match this top-up. Please contact support.');
    }
    const done = await partnerTopups.complete({ topupId: t._id, tenantId: t.tenantId, paymentId: pay.id, actor: { type: 'system' } });
    if (!done.duplicate) {
        await auditTrail.record({
            actorType: 'system', actorLabel: 'razorpay', tenantId: t.tenantId, action: 'WALLET_TOPUP_PAID_ONLINE', method: via.method, path: via.path, status: 200,
            params: { topupId: String(t._id), amountPaise: t.amountPaise, paymentId: pay.id, rzpOrderId: t.rzpOrderId },
        });
    }
    return done;
}

/* ------------------------------ webhook safety net ------------------------------ */
// payment.captured on the platform account for one of the orders made above
async function onPlatformPayment(pay) {
    if (!pay.orderId || pay.status !== 'captured') return { ignored: 'not_captured' };
    const t = await SmsTopup.findOne({ rzpOrderId: pay.orderId }).lean();
    if (t) {
        await creditTopup(t, pay, { path: '/api/webhooks/razorpay/platform', method: 'WEBHOOK' });
        return { topup: 'credited' };
    }
    const pp = await PlanPayment.findOne({ rzpOrderId: pay.orderId }).select('_id').lean();
    if (pp) { await planBilling.settle(pp._id, { payId: pay.id, amountPaise: pay.amountPaise, via: 'webhook' }); return { plan: 'settled' }; }
    const pt = await PartnerTopup.findOne({ rzpOrderId: pay.orderId }).lean();
    if (pt) {
        await creditPartnerTopup(pt, pay, { path: '/api/webhooks/razorpay/platform', method: 'WEBHOOK' });
        return { topup: 'credited' };
    }
    // Real money reached the platform account for an order no bill or top-up knows (for example a bill whose amount changed
    // after the customer opened the old payment). Nobody must lose track of it.
    await alert('admin_webhook_failed', { vars: { event: 'payment.captured', error: `Payment ${pay.id} of Rs ${((pay.amountPaise || 0) / 100).toFixed(2)} (Razorpay order ${pay.orderId}) matches no payment or top-up. Check Razorpay and refund it or mark the bill paid by hand.` } });
    return { ignored: 'unknown_order' };
}

module.exports = { startTopup, verifyTopup, startPartnerTopup, verifyPartnerTopup, startPlan, verifyPlan, onPlatformPayment, MOCK_SECRET };
