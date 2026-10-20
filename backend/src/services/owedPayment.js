// Pays online the bill a customer left unpaid at a table. Same money rules as an order payment (paymentService):
//  - the server decides the amount, never the app
//  - the debt is cleared in ONE place (confirm). The app check and the webhook both end there, and it is safe to run twice
//  - the keys are the shop's own; with no keys the answer is "not available" and the customer calls the shop
const TableSession = require('../models/TableSession');
const OwedPayment = require('../models/OwedPayment');
const payments = require('./adapters/payments');
const accounts = require('./paymentAccounts');
const { credsFor } = require('./paymentService');
const { httpError } = require('../middlewares/apiErrors');
const alert = require('./paymentAlerts');

const owedRows = (tenantId, userId) => TableSession.find({ tenantId, customers: userId, walkout: true, owedClearedAt: { $exists: false }, owedPaise: { $gt: 0 } });

// can this shop take online payments right now (the popup shows the Pay button only then)
async function available(tenantId) {
    try { return !!(await accounts.canTakePayments(tenantId)).ok; } catch (e) { return false; }
}

// The app wants to pay: make (or reuse) the Razorpay order for exactly what he owes. Safe to call again.
async function start({ tenantId, userId }) {
    const rows = await owedRows(tenantId, userId);
    if (!rows.length) throw httpError(404, 'You have nothing to pay');
    const amountPaise = rows.reduce((n, r) => n + r.owedPaise, 0);
    if (amountPaise < 100) throw httpError(400, 'The amount is too small for an online payment');
    const can = await accounts.canTakePayments(tenantId);
    if (!can.ok) throw httpError(503, can.reason ? 'Online payment is not available right now. Please call the shop.' : 'Online payment is not available right now');
    const creds = await credsFor(tenantId);
    if (!creds.keyId || !creds.keySecret) throw httpError(503, 'Online payment is not available right now. Please call the shop.');

    const ids = rows.map((r) => String(r._id)).sort();
    const sessionKey = ids.join(',');
    let p = await OwedPayment.findOne({ tenantId, userId, sessionKey, amountPaise, status: 'created' });
    if (!p) {
        const ro = await payments.createOrder({
            amountPaise, receipt: `owed-${String(userId).slice(-8)}-${Date.now().toString(36)}`.slice(0, 40),
            notes: { kind: 'owed', tenantId: String(tenantId), userId: String(userId) }, credentials: creds,
        });
        p = await OwedPayment.create({ tenantId, userId, sessionIds: rows.map((r) => r._id), sessionKey, mode: creds.mode || 'test', rzpOrderId: ro.id, amountPaise });
    }
    return { keyId: creds.keyId, rzpOrderId: p.rzpOrderId, amountPaise: p.amountPaise, currency: 'INR' };
}

// THE one place where the money is recorded and the debt is cleared. Safe to repeat.
async function confirm(p, rzp, source) {
    if (rzp.orderId !== p.rzpOrderId) return { ok: false, ignored: 'wrong_order' };
    if (rzp.status !== 'captured') return { ok: true, paid: false, status: rzp.status };
    if (rzp.amountPaise !== p.amountPaise) {
        await alert('admin_refund_failed', { tenantId: p.tenantId, vars: { orderId: 'unpaid table bill', amount: ((rzp.amountPaise || 0) / 100).toFixed(2), reason: 'Amount did not match what the customer owed. Check it in Razorpay and refund or credit by hand.' } });
        return { ok: true, paid: false, mismatch: true };
    }
    await OwedPayment.updateOne({ _id: p._id, status: 'created' }, { $set: { status: 'captured', rzpPaymentId: rzp.id, capturedAt: new Date() } });
    const tableBill = require('./tableBill');
    let cleared = 0;
    for (const sid of p.sessionIds) {
        try { await tableBill.clearDebt({ tenantId: p.tenantId, sessionId: sid, method: 'online' }); cleared += 1; } catch (e) { /* already cleared (at the counter, or by an earlier run) */ }
    }
    if (!cleared && source !== 'repeat') {
        const had = await TableSession.countDocuments({ _id: { $in: p.sessionIds }, owedClearedAt: { $exists: true }, owedVia: { $ne: 'online' } });
        if (had) await alert('admin_refund_failed', { tenantId: p.tenantId, vars: { orderId: 'unpaid table bill', amount: (p.amountPaise / 100).toFixed(2), reason: 'The bill was already settled at the counter when this online payment came in. Refund it from Razorpay.' } });
    }
    return { ok: true, paid: true };
}

// the app says "paid": check the proof, then ask Razorpay what really happened
async function verify({ tenantId, userId, rzpOrderId, rzpPaymentId, signature }) {
    const p = await OwedPayment.findOne({ tenantId, userId, rzpOrderId });
    if (!p) throw httpError(400, 'This payment does not belong to you');
    const creds = await credsFor(tenantId);
    if (!payments.verifyPaymentSignature({ orderId: rzpOrderId, paymentId: rzpPaymentId, signature, secret: creds.keySecret })) throw httpError(400, 'The payment proof is not valid');
    const rzp = await payments.fetchPayment({ paymentId: rzpPaymentId, credentials: creds });
    return confirm(p, rzp, 'app');
}

// "Did it get paid?" answered by Razorpay itself (no webhook needed)
async function check({ tenantId, userId }) {
    const p = await OwedPayment.findOne({ tenantId, userId, status: 'created' }).sort({ createdAt: -1 });
    if (!p) return { paid: !(await owedRows(tenantId, userId)).length, status: 'none' };
    const creds = await credsFor(tenantId);
    const list = await payments.listOrderPayments({ orderId: p.rzpOrderId, credentials: creds });
    const captured = list.find((x) => x.status === 'captured');
    if (!captured) return { paid: false, status: list[0]?.status || 'created' };
    const r = await confirm(p, captured, 'app-check');
    return { paid: !!r.paid, status: 'captured' };
}

// a payment.captured webhook for a Razorpay order that is not an order of ours: it may be one of these
async function onWebhook({ account, rzp }) {
    if (!rzp.orderId) return null;
    const p = await OwedPayment.findOne({ tenantId: account, rzpOrderId: rzp.orderId });
    if (!p) return null;
    return confirm(p, rzp, 'webhook');
}

module.exports = { available, start, verify, check, onWebhook };
