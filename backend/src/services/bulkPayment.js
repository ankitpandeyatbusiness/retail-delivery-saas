// Paying the ADVANCE of a bulk order (on the shop's own Razorpay keys) and sending it back by the rules. Same money rules as the table booking deposit:
//  - the server decides the amount (the quote's advance), never the app
//  - the money is recorded in ONE place (confirm). The app's proof, the app's "did it get paid?", the webhook and the repair job all end there, and it is safe to repeat
//  - a payment of the wrong amount goes back in full (services/mismatchRefund.js)
//  - a payment that arrives when the order can no longer take it (cancelled, declined, a newer quote) goes back in full
//  - a refund is claimed once, Razorpay is ASKED before anything is sent, and a failed one is retried by the repair job
const BulkOrder = require('../models/BulkOrder');
const BulkPayment = require('../models/BulkPayment');
const payments = require('./adapters/payments');
const accounts = require('./paymentAccounts');
const { credsFor } = require('./paymentService');
const mismatchRefund = require('./mismatchRefund');
const alert = require('./paymentAlerts');
const { httpError } = require('../middlewares/apiErrors');

const STALE_MS = 2 * 60 * 1000;
const MAX_REFUND_TRIES = 12;
const rupees = (paise) => +(paise / 100).toFixed(2);
const tell = (event, ctx) => Promise.resolve().then(() => require('../notifications/center').notify(event, ctx)).catch((e) => console.error('Notification error:', e.message));

/* ------------------------------ paying ------------------------------ */
// The customer taps "Accept and pay": make (or reuse) the Razorpay order for exactly the quote's advance. Safe to call again.
async function startAdvance({ tenant, userId, id }) {
    const o = await require('./bulkOrders').mine({ tenant, userId, id });
    if (o.status !== 'quoted') throw httpError(409, o.status === 'confirmed' ? 'This order is already confirmed' : 'There is no open quote to pay');
    if (!o.quote?.validUntil || new Date(o.quote.validUntil) < new Date()) throw httpError(409, 'This quote has run out. Ask the shop for a new one.');
    const can = await accounts.canTakePayments(tenant._id);
    if (!can.ok) throw httpError(503, 'Online payment is not available at this shop right now. Please try later.');
    const creds = await credsFor(tenant._id);
    if (!creds.keyId || !creds.keySecret) throw httpError(503, 'Online payment is not available at this shop right now. Please try later.');
    const amountPaise = o.quote.advancePaise;
    if (!Number.isInteger(amountPaise) || amountPaise < 100) throw httpError(400, 'The advance is too small for an online payment');

    const find = () => BulkPayment.findOne({ bulkId: o._id, kind: 'advance', quoteVersion: o.quote.version, status: 'created', amountPaise });
    let p = await find();
    if (!p) {
        const ro = await payments.createOrder({
            amountPaise, receipt: `bk${o.code}-${o.quote.version}`.slice(0, 40),
            notes: { kind: 'bulk_advance', tenantId: String(tenant._id), bulkId: String(o._id), version: String(o.quote.version) }, credentials: creds,
        });
        try {
            p = await BulkPayment.create({ tenantId: tenant._id, userId, bulkId: o._id, kind: 'advance', quoteVersion: o.quote.version, mode: creds.mode || 'test', rzpOrderId: ro.id, amountPaise });
        } catch (e) {
            if (e.code !== 11000) throw e;
            p = await find();   // two taps at once: use the first one
        }
    }
    return { keyId: creds.keyId, rzpOrderId: p.rzpOrderId, amountPaise: p.amountPaise, currency: 'INR', bulkId: String(o._id) };
}

async function verifyAdvance({ tenant, userId, id, rzpOrderId, rzpPaymentId, signature }) {
    const o = await require('./bulkOrders').mine({ tenant, userId, id });
    const p = await BulkPayment.findOne({ bulkId: o._id, tenantId: tenant._id, rzpOrderId });
    if (!p) throw httpError(400, 'This payment does not belong to this order');
    const creds = await credsFor(tenant._id);
    if (!payments.verifyPaymentSignature({ orderId: rzpOrderId, paymentId: rzpPaymentId, signature, secret: creds.keySecret })) throw httpError(400, 'The payment proof is not valid');
    return confirm(p, await payments.fetchPayment({ paymentId: rzpPaymentId, credentials: creds }), 'app');
}

// "Did it get paid?" answered by Razorpay itself (no webhook needed)
async function checkAdvance({ tenant, userId, id }) {
    const o = await require('./bulkOrders').mine({ tenant, userId, id });
    if (o.payment?.advancePaymentId) return { paid: true };
    const p = await BulkPayment.findOne({ bulkId: o._id, tenantId: tenant._id, kind: 'advance' }).sort({ createdAt: -1 });
    if (!p) return { paid: false, status: 'none' };
    const list = await payments.listOrderPayments({ orderId: p.rzpOrderId, credentials: await credsFor(tenant._id) });
    const captured = list.find((x) => x.status === 'captured');
    if (!captured) return { paid: false, status: list[0]?.status || 'created' };
    return { paid: !!(await confirm(p, captured, 'app-check')).paid, status: 'captured' };
}

async function onWebhook({ account, rzp }) {
    if (!rzp.orderId) return null;
    const p = await BulkPayment.findOne({ tenantId: account, rzpOrderId: rzp.orderId });
    return p ? confirm(p, rzp, 'webhook') : null;
}

// THE one place where the advance is recorded.
async function confirm(p, rzp, source) {
    if (rzp.orderId !== p.rzpOrderId) return { ok: false, ignored: 'wrong_order' };
    if (rzp.status !== 'captured') return { ok: true, paid: false, status: rzp.status };
    if (rzp.amountPaise !== p.amountPaise) {
        await mismatchRefund.refundWrongAmount({ Model: BulkPayment, row: p, rzp, creds: await credsFor(p.tenantId), label: 'bulk order advance' });
        return { ok: true, paid: false, mismatch: true };
    }
    const first = (await BulkPayment.updateOne({ _id: p._id, status: 'created' }, { $set: { status: 'captured', rzpPaymentId: rzp.id, capturedAt: new Date(), settleStartedAt: new Date() } })).modifiedCount === 1;
    if (!first) {   // a repeat. If the first run died half way, finish it now
        await resume(p._id).catch((e) => console.error('Bulk payment resume:', e.message));
        return { ok: true, paid: true, repeat: true };
    }
    const done = await settle(await BulkPayment.findById(p._id), source);
    return { ok: true, paid: done.honoured, ...(done.honoured ? {} : { refunded: true }) };
}

// The order becomes confirmed, if it can still take this payment. If not, the whole advance goes back. Safe to repeat.
async function settle(p, source) {
    const now = new Date();
    const taken = await BulkOrder.findOneAndUpdate(
        { _id: p.bulkId, tenantId: p.tenantId, status: { $in: ['quoted', 'expired'] }, 'quote.version': p.quoteVersion },
        {
            $set: { status: 'confirmed', confirmedAt: now, 'payment.advancePaise': p.amountPaise, 'payment.advancePaymentId': p._id, 'payment.paidAt': now },
            $push: { history: { status: 'confirmed', by: 'customer', note: `advance paid (${source || 'repair'})` } },
        },
        { returnDocument: 'after' },
    ).lean();
    let honoured = !!taken;
    if (!taken) {
        const cur = await BulkOrder.findById(p.bulkId).select('payment').lean();
        honoured = String(cur?.payment?.advancePaymentId) === String(p._id);   // an earlier run of this very payment already confirmed it
        if (!honoured) await refund(p._id, { reason: 'late_payment' });        // cancelled, declined, or a newer quote in between
    } else {
        tell('bulk_paid', { tenantId: taken.tenantId, vars: { code: taken.code, name: taken.contact?.name, amount: rupees(p.amountPaise) }, data: { kind: 'bulk', bulkId: String(taken._id) } });
        tell('bulk_confirmed', { tenantId: taken.tenantId, userId: taken.userId, vars: { code: taken.code, amount: rupees(p.amountPaise) }, data: { kind: 'bulk', bulkId: String(taken._id) } });
    }
    await BulkPayment.updateOne({ _id: p._id }, { $set: { settledAt: new Date() } });
    return { honoured };
}

// takes up a captured payment whose follow-up work never finished (a crash). Claimed by moving settleStartedAt forward.
async function resume(id, now = new Date()) {
    const p = await BulkPayment.findOneAndUpdate(
        { _id: id, status: 'captured', settledAt: { $exists: false }, settleStartedAt: { $exists: true, $lt: new Date(now.getTime() - STALE_MS) } },
        { $set: { settleStartedAt: now } }, { returnDocument: 'after' },
    );
    if (!p) return false;
    await settle(p, 'repair');
    return true;
}

/* ------------------------------ sending money back ------------------------------ */
// Sends `amountPaise` (the whole advance when left out) back. One claim per payment; Razorpay is asked first; never sent blind.
async function refund(paymentId, { reason, amountPaise } = {}) {
    const now = new Date();
    const claimed = await BulkPayment.findOneAndUpdate(
        {
            _id: paymentId, status: 'captured',
            $or: [{ 'refund.status': { $exists: false } }, { 'refund.status': 'failed', 'refund.attempts': { $lt: MAX_REFUND_TRIES } }, { 'refund.status': 'sending', 'refund.at': { $lt: new Date(now.getTime() - STALE_MS) } }],
        },
        { $set: { 'refund.status': 'sending', 'refund.at': now, ...(reason ? { 'refund.reason': reason } : {}) }, $inc: { 'refund.attempts': 1 } },
        { returnDocument: 'after' },
    );
    if (!claimed) return { skipped: true };
    const amount = amountPaise ?? claimed.refund.amountPaise ?? claimed.amountPaise;
    const key = `bulk:${claimed.bulkId}:${claimed.kind}`;
    await BulkPayment.updateOne({ _id: claimed._id }, { $set: { 'refund.amountPaise': amount, 'refund.key': key } });
    const order = await BulkOrder.findById(claimed.bulkId).select('code').lean();
    try {
        const creds = await credsFor(claimed.tenantId);
        const list = (await payments.listRefunds({ paymentId: claimed.rzpPaymentId, credentials: creds })) || [];
        const old = list.find((x) => x.notes?.refundKey === key && x.status !== 'failed') || list.find((x) => x.status !== 'failed' && x.amountPaise === amount);
        const out = old
            ? { refundId: old.id || old.refundId }
            : await payments.refund({ paymentId: claimed.rzpPaymentId, amountPaise: amount, credentials: creds, notes: { refundKey: key, bulkId: String(claimed.bulkId) }, receipt: `bkr-${order?.code || claimed._id}`.slice(0, 40) });
        await BulkPayment.updateOne({ _id: claimed._id }, { $set: { 'refund.status': 'refunded', 'refund.refundId': out.refundId, 'refund.at': new Date() }, $unset: { 'refund.lastError': 1 } });
        await BulkOrder.updateOne({ _id: claimed.bulkId }, { $set: { 'payment.refundPaise': amount, 'payment.refundStatus': 'refunded' } });
        tell('bulk_refund', { tenantId: claimed.tenantId, userId: claimed.userId, vars: { code: order?.code, amount: rupees(amount) }, data: { kind: 'bulk', bulkId: String(claimed.bulkId) } });
        return { ok: true, refundId: out.refundId };
    } catch (e) {
        const attempts = claimed.refund.attempts;
        await BulkPayment.updateOne({ _id: claimed._id }, { $set: { 'refund.status': 'failed', 'refund.lastError': String(e.message).slice(0, 200), 'refund.at': new Date() } });
        await BulkOrder.updateOne({ _id: claimed.bulkId }, { $set: { 'payment.refundPaise': amount, 'payment.refundStatus': 'pending' } });
        const shortBalance = e.razorpay && /balance/i.test(e.message || '');
        if (attempts === 1 || attempts === MAX_REFUND_TRIES) {
            await alert('admin_refund_failed', { tenantId: claimed.tenantId, vars: { orderId: `bulk order ${order?.code || ''}`, amount: rupees(amount).toFixed(2), reason: attempts === 1 ? `The refund could not be sent (${String(e.message).slice(0, 100)}). It will be tried again by itself.` : 'Still not sent after many tries' } });
        }
        if (shortBalance && attempts === 1) {
            try {
                require('./notificationService').toOwner(claimed.tenantId, {
                    type: 'platform_message', title: 'Add balance to send a refund',
                    body: `A customer refund of Rs ${rupees(amount)} could not be sent because your Razorpay account has too little balance. Add balance and it goes out by itself.`,
                    data: { bulkId: String(claimed.bulkId) },
                });
            } catch (err) { console.error('Short balance notice error:', err.message); }
        }
        return { ok: false, pending: true };
    }
}

// the advance payment of an order (for cancel: what to refund)
const advanceOf = (bulkId) => BulkPayment.findOne({ bulkId, kind: 'advance', status: 'captured' }).sort({ capturedAt: -1 });

/* ------------------------------ the repair job (every 2 minutes, from paymentReconcile) ------------------------------ */
async function reconcile(now = new Date()) {
    let n = 0;
    // 1. Razorpay captured it but nobody told us (missed webhook, app died)
    const open = await BulkPayment.find({
        status: 'created', createdAt: { $lte: new Date(now.getTime() - 5 * 60000), $gte: new Date(now.getTime() - 3 * 86400000) },
        $or: [{ checkedAt: { $exists: false } }, { checkedAt: { $lte: new Date(now.getTime() - 10 * 60000) } }],
    }).sort({ createdAt: 1 }).limit(100);
    for (const p of open) {
        try {
            await BulkPayment.updateOne({ _id: p._id }, { $set: { checkedAt: now } });
            const list = await payments.listOrderPayments({ orderId: p.rzpOrderId, credentials: await credsFor(p.tenantId) });
            const captured = list.find((x) => x.status === 'captured');
            if (captured) { const r = await confirm(p, captured, 'reconcile'); if (r.paid || r.mismatch || r.refunded) n += 1; }
        } catch (e) { console.error('Bulk reconcile payment:', String(p._id), e.message); }
    }
    // 2. captured, but the order was not confirmed (a crash in between)
    const half = await BulkPayment.find({ status: 'captured', settledAt: { $exists: false }, settleStartedAt: { $exists: true, $lt: new Date(now.getTime() - STALE_MS), $gte: new Date(now.getTime() - 7 * 86400000) } }).select('_id').limit(100).lean();
    for (const r of half) { try { if (await resume(r._id, now)) n += 1; } catch (e) { console.error('Bulk reconcile resume:', String(r._id), e.message); } }
    // 3. refunds that did not go out (Razorpay was busy, the shop had no balance)
    const waiting = await BulkPayment.find({
        status: 'captured',
        $or: [{ 'refund.status': 'failed', 'refund.attempts': { $lt: MAX_REFUND_TRIES }, 'refund.at': { $lt: new Date(now.getTime() - 3 * 60000) } }, { 'refund.status': 'sending', 'refund.at': { $lt: new Date(now.getTime() - STALE_MS) } }],
    }).select('_id').limit(50).lean();
    for (const r of waiting) { try { const out = await refund(r._id); if (out.ok) n += 1; } catch (e) { console.error('Bulk reconcile refund:', String(r._id), e.message); } }
    // 4. a cancelled order owes a refund that was never started (the server stopped right after the cancel)
    const owed = await BulkOrder.find({ status: 'cancelled', 'payment.refundDuePaise': { $gt: 0 }, 'payment.refundStatus': { $exists: false }, updatedAt: { $gte: new Date(now.getTime() - 14 * 86400000), $lte: new Date(now.getTime() - STALE_MS) } }).limit(50).lean();
    for (const o of owed) { try { const out = await require('./bulkOrders').refundDue(o); if (out?.ok) n += 1; } catch (e) { console.error('Bulk reconcile owed refund:', String(o._id), e.message); } }
    // 5. a quote that ran out is marked
    n += await require('./bulkOrders').expireOld(now);
    return n;
}

module.exports = { startAdvance, verifyAdvance, checkAdvance, onWebhook, confirm, settle, resume, refund, advanceOf, reconcile };
