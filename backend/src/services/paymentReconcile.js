// The safety net for money. Webhooks can be missed and a server can crash half way, so every 2 minutes this job
// asks "is anything out of line?" and fixes it. EVERY step is safe to repeat (fixed keys, conditional updates).
//   1. a payment Razorpay captured that we never heard about (missed webhook)      -> mark the order paid
//   2. a captured payment whose order was not marked paid (crash in between)       -> mark it paid
//   3. a wrong-amount payment whose refund was not made                            -> refund it
//   4. a cancelled / undelivered order whose refund was not made                   -> refund it
//   5. refunds waiting to be sent (network was down)                               -> send them
//   6. refunds Razorpay accepted but never confirmed                               -> ask Razorpay, close them
const Order = require('../models/Order');
const OnlinePayment = require('../models/OnlinePayment');
const OnlineRefund = require('../models/OnlineRefund');
const payments = require('./adapters/payments');
const paymentService = require('./paymentService');
const refundIssuer = require('./refundIssuer');
const { ONLINE } = require('./onlineOrder');

const MIN = 60000;
const DAY = 86400000;
let running = false;
const swallow = (what) => (e) => { console.error(`Reconcile ${what}:`, e.message); return null; };

// 1. Razorpay captured it, but no webhook and no app check ever told us
async function findMissedPayments(now = new Date()) {
    const rows = await OnlinePayment.find({
        status: 'created',
        createdAt: { $lte: new Date(now.getTime() - 5 * MIN), $gte: new Date(now.getTime() - 3 * DAY) },
        $or: [{ nextCheckAt: { $exists: false } }, { nextCheckAt: null }, { nextCheckAt: { $lte: now } }],
    }).sort({ createdAt: 1 }).limit(100);

    let found = 0;
    for (const p of rows) {
        try {
            // young payments are looked at often, old ones rarely (Razorpay is asked less)
            const ageMin = (now.getTime() - p.createdAt.getTime()) / MIN;
            await OnlinePayment.updateOne({ _id: p._id }, { $set: { nextCheckAt: new Date(now.getTime() + (ageMin < 60 ? 10 : 60) * MIN) } });
            const creds = await paymentService.credsFor(p.tenantId);
            if (!creds.keyId || !creds.keySecret) continue;
            const list = await payments.listOrderPayments({ orderId: p.rzpOrderId, credentials: creds });
            const captured = list.find((x) => x.status === 'captured');
            if (!captured) continue;
            const r = await paymentService.confirmCapture({ payment: p, rzp: captured, source: 'reconcile' });
            if (r.paid || r.mismatch) found += 1;
        } catch (e) {
            console.error('Reconcile payment:', String(p._id), e.message);
        }
    }
    return found;
}

// 2 and 3. captured / mismatch payments whose follow-up work was never finished
async function repairPayments(now = new Date()) {
    let repaired = 0;
    const since = new Date(now.getTime() - 7 * DAY);

    const captured = await OnlinePayment.find({ status: 'captured', capturedAt: { $gte: since, $lte: new Date(now.getTime() - 2 * MIN) } })
        .sort({ capturedAt: -1 }).limit(300).select('_id tenantId orderId').lean();
    for (const c of captured) {
        try {
            const unpaid = await Order.exists({ _id: c.orderId, tenantId: c.tenantId, 'payment.status': { $in: ['pending', 'failed'] } });
            if (!unpaid) continue;
            await paymentService.settleOrder(await OnlinePayment.findById(c._id));
            repaired += 1;
        } catch (e) { console.error('Reconcile repair:', String(c._id), e.message); }
    }

    const wrong = await OnlinePayment.find({ status: 'mismatch', capturedAt: { $gte: since } }).limit(100).lean();
    for (const m of wrong) {
        const key = `order:${m.orderId}:mismatch`;
        if (await OnlineRefund.exists({ key })) continue;
        await refundIssuer.issueRefund({ tenantId: m.tenantId, orderId: m.orderId, amountPaise: m.capturedPaise, reason: 'amount_mismatch', key }).catch(swallow('mismatch'));
        repaired += 1;
    }
    return repaired;
}

// 4. the order ended (cancelled / undelivered) but its refund was never made
async function repairOrderRefunds(now = new Date()) {
    const orders = await Order.find({
        status: { $in: ['cancelled', 'undelivered'] }, 'payment.method': { $in: ONLINE }, 'payment.status': 'paid',
        updatedAt: { $gte: new Date(now.getTime() - 14 * DAY) },
    }).sort({ updatedAt: -1 }).limit(300).select('_id tenantId status cancel undelivered').lean();

    let made = 0;
    for (const o of orders) {
        const kind = o.status === 'cancelled' ? 'cancel' : 'undelivered';
        const key = `order:${o._id}:${kind}`;
        if (await OnlineRefund.exists({ key })) continue;
        const pay = await OnlinePayment.findOne({ orderId: o._id, tenantId: o.tenantId, status: 'captured' }).select('capturedPaise').lean();
        if (!pay) continue;   // paid some other way (nothing online to give back)
        const kept = (o.status === 'cancelled' ? o.cancel?.keptPaise : o.undelivered?.keptPaise) || 0;
        const amountPaise = pay.capturedPaise - kept;
        if (amountPaise <= 0) continue;
        const r = await refundIssuer.issueRefund({ tenantId: o.tenantId, orderId: o._id, amountPaise, reason: kind, key }).catch(swallow('order refund'));
        if (r && !r.skipped) made += 1;
    }
    return made;
}

// 6. Razorpay took the refund but we never heard "processed" or "failed"
async function closeOpenRefunds(now = new Date()) {
    const rows = await OnlineRefund.find({
        status: 'processing', external: { $ne: true }, rzpRefundId: { $exists: true },
        updatedAt: { $lte: new Date(now.getTime() - 10 * MIN) },
        $or: [{ checkedAt: { $exists: false } }, { checkedAt: null }, { checkedAt: { $lte: new Date(now.getTime() - 60 * MIN) } }],
    }).sort({ updatedAt: 1 }).limit(100);

    let closed = 0;
    for (const r of rows) {
        try {
            await OnlineRefund.updateOne({ _id: r._id }, { $set: { checkedAt: now } });
            const creds = await paymentService.credsFor(r.tenantId);
            const list = await payments.listRefunds({ paymentId: r.rzpPaymentId, credentials: creds });
            const hit = list.find((x) => x.id === r.rzpRefundId);
            if (!hit || !['processed', 'failed'].includes(hit.status)) continue;
            await refundIssuer.onRefundEvent({
                account: String(r.tenantId), name: `refund.${hit.status}`,
                entity: { id: hit.id, payment_id: r.rzpPaymentId, amount: hit.amountPaise, notes: hit.notes },
            });
            closed += 1;
        } catch (e) { console.error('Reconcile refund:', String(r._id), e.message); }
    }
    return closed;
}

async function runPaymentReconcile(now = new Date()) {
    const missed = await findMissedPayments(now);
    const repaired = await repairPayments(now);
    const orderRefunds = await repairOrderRefunds(now);
    const retried = (await refundIssuer.retryPending()).length;
    const closed = await closeOpenRefunds(now);
    return { missed, repaired, orderRefunds, retried, closed };
}

// Starts half a minute after boot, then every 2 minutes. Safe on several servers: every step is repeatable.
function startPaymentReconcileScheduler() {
    const run = async () => {
        if (running) return;
        running = true;
        try {
            const r = await runPaymentReconcile();
            if (Object.values(r).some(Boolean)) console.log('Payment reconcile:', JSON.stringify(r));
        } catch (e) {
            console.error('Payment reconcile error:', e.message);
        } finally {
            running = false;
        }
    };
    setTimeout(run, 30 * 1000).unref?.();
    setInterval(run, 2 * MIN).unref?.();
}

module.exports = {
    runPaymentReconcile, startPaymentReconcileScheduler, findMissedPayments, repairPayments, repairOrderRefunds, closeOpenRefunds,
};