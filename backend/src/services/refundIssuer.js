// Sends money back to the customer. Rules:
//  - the OnlineRefund row is saved first, with one fixed key, so the same refund can never exist twice
//  - total refunded can never go above what was captured (one atomic update on the payment)
//  - a retry first asks Razorpay "did this one already go out?" before sending again
//  - a network problem keeps the refund "pending" for the retry job. A clear "no" from Razorpay marks it failed and alerts the superadmin.
const Order = require('../models/Order');
const OnlinePayment = require('../models/OnlinePayment');
const OnlineRefund = require('../models/OnlineRefund');
const payments = require('./adapters/payments');
const alert = require('./paymentAlerts');

const LOCK_MS = 60 * 1000;
const MAX_ATTEMPTS = 12;
const money = (paise) => (paise / 100).toFixed(2);

const credsFor = (tenantId) => require('./paymentService').credsFor(tenantId);

async function issueRefund({ tenantId, orderId, amountPaise, reason, complaintId, key }) {
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) return { ok: true, skipped: 'nothing_to_refund' };
    const pay = await OnlinePayment.findOne({ tenantId, orderId });
    if (!pay || !['captured', 'mismatch'].includes(pay.status)) return { ok: true, skipped: 'not_paid_online' };   // COD, or never paid
    const refundKey = key || (complaintId ? `complaint:${complaintId}` : `order:${orderId}:${reason}`);

    let r;
    try {
        r = await OnlineRefund.create({
            tenantId, orderId, paymentId: pay._id, rzpPaymentId: pay.rzpPaymentId, amountPaise,
            reason, complaintId: complaintId || undefined, key: refundKey,
        });
    } catch (e) {
        if (e.code !== 11000) throw e;
        r = await OnlineRefund.findOne({ key: refundKey });
        if (r.status === 'failed') return { ok: false, error: 'This refund failed earlier', refund: r };
        if (r.status !== 'pending') return { ok: true, duplicate: true, refund: r };   // already sent
        // still pending (a crash or a network problem before): go on and try again, it is safe
    }

    if (!(await reserve(pay._id, r))) {
        await OnlineRefund.updateOne({ _id: r._id, status: 'pending' }, { $set: { status: 'failed', lastError: 'More than the money paid' } });
        await alert('admin_refund_failed', { tenantId, vars: { orderId: String(orderId), amount: money(amountPaise), reason: 'Refund is more than the money received' } });
        return { ok: false, error: 'The refund is more than the money received for this order' };
    }
    return send(r._id);
}

// one atomic step: "paid - already refunded >= this refund" and "this refund not counted yet"
async function reserve(paymentId, r) {
    const res = await OnlinePayment.updateOne(
        {
            _id: paymentId, refundIds: { $ne: r._id },
            $expr: { $gte: [{ $subtract: ['$capturedPaise', '$refundedPaise'] }, r.amountPaise] },
        },
        { $inc: { refundedPaise: r.amountPaise }, $push: { refundIds: r._id } },
    );
    if (res.modifiedCount === 1) return true;
    return !!(await OnlinePayment.exists({ _id: paymentId, refundIds: r._id }));   // counted by an earlier try
}

const release = (r) => OnlinePayment.updateOne(
    { _id: r.paymentId, refundIds: r._id },
    { $inc: { refundedPaise: -r.amountPaise }, $pull: { refundIds: r._id } },
);

async function send(refundId) {
    const now = new Date();
    const r = await OnlineRefund.findOneAndUpdate(
        { _id: refundId, status: 'pending', $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: null }, { lockedUntil: { $lt: now } }] },
        { $set: { lockedUntil: new Date(now.getTime() + LOCK_MS), lastTryAt: now }, $inc: { attempts: 1 } },
        { returnDocument: 'after' },
    );
    if (!r) return { ok: true, busy: true };   // another worker has it, or it is done

    try {
        const creds = await credsFor(r.tenantId);
        let out = null;
        if (r.attempts > 1) {   // an earlier try may have reached Razorpay even though we never saw the answer
            const list = await payments.listRefunds({ paymentId: r.rzpPaymentId, credentials: creds });
            const hit = list.find((x) => x.notes?.refundKey === r.key);
            if (hit) out = { refundId: hit.id, status: hit.status };
        }
        if (!out) {
            out = await payments.refund({
                paymentId: r.rzpPaymentId, amountPaise: r.amountPaise, receipt: String(r._id),
                notes: { refundKey: r.key, orderId: String(r.orderId) }, credentials: creds,
            });
        }
        const processed = out.status === 'processed';
        const set = { rzpRefundId: out.refundId, status: processed ? 'processed' : 'processing' };
        if (processed) set.processedAt = new Date();
        await OnlineRefund.updateOne({ _id: r._id }, { $set: set, $unset: { lockedUntil: 1, lastError: 1 } });
        if (processed) await afterProcessed(r);
        return { ok: true, status: set.status, refundId: out.refundId };
    } catch (e) {
        const clearNo = e.razorpay && e.status >= 400 && e.status < 500 && e.status !== 429;
        if (clearNo) {
            await OnlineRefund.updateOne({ _id: r._id }, { $set: { status: 'failed', lastError: String(e.message).slice(0, 200) }, $unset: { lockedUntil: 1 } });
            await release(r);
            await alert('admin_refund_failed', { tenantId: r.tenantId, vars: { orderId: String(r.orderId), amount: money(r.amountPaise), reason: e.message } });
            return { ok: false, error: e.message };
        }
        // network, timeout or Razorpay problem: keep it pending, the retry job tries again
        await OnlineRefund.updateOne({ _id: r._id }, { $set: { lastError: String(e.message).slice(0, 200) }, $unset: { lockedUntil: 1 } });
        if (r.attempts >= MAX_ATTEMPTS) {
            await alert('admin_refund_failed', { tenantId: r.tenantId, vars: { orderId: String(r.orderId), amount: money(r.amountPaise), reason: 'Still not sent after many tries' } });
        }
        return { ok: true, pending: true };
    }
}

// when every paisa is back, the order shows "refunded"
async function afterProcessed(r) {
    const pay = await OnlinePayment.findById(r.paymentId).select('capturedPaise orderId tenantId').lean();
    if (!pay) return;
    const [agg] = await OnlineRefund.aggregate([
        { $match: { paymentId: r.paymentId, status: 'processed' } },
        { $group: { _id: null, total: { $sum: '$amountPaise' } } },
    ]);
    if ((agg?.total || 0) >= pay.capturedPaise) {
        await Order.updateOne({ _id: pay.orderId, tenantId: pay.tenantId, 'payment.status': 'paid' }, { $set: { 'payment.status': 'refunded' } });
    }
}

// refund.processed / refund.failed from the webhook
async function onRefundEvent({ account, name, entity }) {
    const scope = account === 'platform' ? {} : { tenantId: account };
    let r = await OnlineRefund.findOne({ ...scope, rzpRefundId: entity.id });
    if (!r && entity.notes?.refundKey) r = await OnlineRefund.findOne({ ...scope, key: entity.notes.refundKey });

    if (!r) {   // made outside the system (Razorpay dashboard): still count it so the totals stay true
        const pay = await OnlinePayment.findOne({ ...scope, rzpPaymentId: entity.payment_id });
        if (!pay) return { ignored: 'unknown_payment' };
        if (name !== 'refund.processed') return { ignored: 'external_not_processed' };
        try {
            r = await OnlineRefund.create({
                tenantId: pay.tenantId, orderId: pay.orderId, paymentId: pay._id, rzpPaymentId: pay.rzpPaymentId,
                amountPaise: entity.amount, reason: 'external', key: `ext:${entity.id}`, status: 'processed',
                rzpRefundId: entity.id, external: true, processedAt: new Date(),
            });
        } catch (e) {
            if (e.code === 11000) return { duplicate: true };
            throw e;
        }
        await OnlinePayment.updateOne({ _id: pay._id, refundIds: { $ne: r._id } }, { $inc: { refundedPaise: r.amountPaise }, $push: { refundIds: r._id } });
        await afterProcessed(r);
        return { external: true };
    }

    if (name === 'refund.processed') {
        await OnlineRefund.updateOne(
            { _id: r._id, status: { $ne: 'processed' } },
            { $set: { status: 'processed', processedAt: new Date(), rzpRefundId: entity.id }, $unset: { lockedUntil: 1, lastError: 1 } },
        );
        await afterProcessed(r);
        return { refund: 'processed' };
    }
    if (name === 'refund.failed') {
        const res = await OnlineRefund.updateOne(
            { _id: r._id, status: { $ne: 'failed' } },
            { $set: { status: 'failed', lastError: 'Razorpay marked the refund as failed' }, $unset: { lockedUntil: 1 } },
        );
        if (res.modifiedCount) {
            await release(r);
            await alert('admin_refund_failed', { tenantId: r.tenantId, vars: { orderId: String(r.orderId), amount: money(r.amountPaise), reason: 'Razorpay marked the refund as failed' } });
        }
        return { refund: 'failed' };
    }
    return { ignored: name };
}

// for the retry job (J3): sends refunds that are still waiting
async function retryPending({ limit = 50 } = {}) {
    const before = new Date(Date.now() - 3 * 60 * 1000);
    const rows = await OnlineRefund.find({
        status: 'pending', attempts: { $lt: MAX_ATTEMPTS + 8 }, $or: [{ lastTryAt: { $lt: before } }, { lastTryAt: { $exists: false } }],
    }).select('_id').limit(limit).lean();
    const out = [];
    for (const row of rows) out.push(await send(row._id));   // one by one, gently
    return out;
}

module.exports = { issueRefund, send, onRefundEvent, retryPending, afterProcessed };