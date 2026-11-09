// A guest at a table pays what he has ordered so far, online, without calling the waiter (the shop's own Razorpay keys). Same money rules as
// owedPayment: the server decides the amount, and the money is recorded in ONE place (confirm), which the app check and the webhook both end in.
// The visit stays open: the paid rounds show as paid, and whatever he orders next is a new, unpaid round.
const Order = require('../models/Order');
const TableSession = require('../models/TableSession');
const TablePayment = require('../models/TablePayment');
const payments = require('./adapters/payments');
const accounts = require('./paymentAccounts');
const { credsFor } = require('./paymentService');
const { HIDE_UNPAID } = require('./onlineOrder');
const { httpError } = require('../middlewares/apiErrors');
const alert = require('./paymentAlerts');

const DEAD = ['cancelled', 'undelivered'];

async function available(tenantId) {
    try { return !!(await accounts.canTakePayments(tenantId)).ok; } catch (e) { return false; }
}

// the rounds of this visit that nobody has paid yet
const unpaidOf = (tenantId, sessionId, userId) => Order.find({ tenantId, tableSessionId: sessionId, ...(userId ? { userId } : {}), status: { $nin: DEAD }, 'payment.status': { $ne: 'paid' }, ...HIDE_UNPAID }).select('pricing.total orderNo').lean();

// The guest wants to pay: make (or reuse) the Razorpay order for exactly what is unpaid on his bill. Safe to call again.
// scope 'mine': only the rounds he ordered himself (his share); he leaves the bill when it is paid
async function start({ tenantId, userId, scope }) {
    const mineOnly = scope === 'mine';
    const s = await require('./tableBill').openFor(tenantId, userId);
    if (!s) throw httpError(404, 'You have no open bill');
    const rows = await unpaidOf(tenantId, s._id, mineOnly ? userId : null);
    if (mineOnly && (await require('./tableShares').mine(s, userId)).busy) throw httpError(409, 'Your dishes are still being made. Pay after they are served.');
    const grossPaise = Math.round(rows.reduce((n, o) => n + (o.pricing?.total || 0), 0) * 100);
    if (!rows.length || grossPaise <= 0) throw httpError(409, 'Everything on your bill is already paid');
    // the table booking amount he paid earlier comes off the whole bill (not off a single share)
    const creditPaise = !mineOnly && s.credit?.bookingId && !s.credit.used ? Math.min(Math.round((s.credit.amount || 0) * 100), grossPaise) : 0;
    const amountPaise = grossPaise - creditPaise;
    if (amountPaise === 0) return settleByCredit({ tenantId, userId, s, rows, creditPaise });
    if (amountPaise < 100) throw httpError(400, 'The amount is too small for an online payment');
    const can = await accounts.canTakePayments(tenantId);
    if (!can.ok) throw httpError(503, 'Online payment is not available right now. Please ask the waiter.');
    const creds = await credsFor(tenantId);
    if (!creds.keyId || !creds.keySecret) throw httpError(503, 'Online payment is not available right now. Please ask the waiter.');

    const orderKey = rows.map((o) => String(o._id)).sort().join(',');
    let p = await TablePayment.findOne({ tenantId, userId, sessionId: s._id, orderKey, amountPaise, status: 'created', scope: mineOnly ? 'mine' : 'all' });
    if (!p) {
        const ro = await payments.createOrder({
            amountPaise, receipt: `tbl-${String(userId).slice(-8)}-${Date.now().toString(36)}`.slice(0, 40),
            notes: { kind: 'table_bill', tenantId: String(tenantId), userId: String(userId), table: String(s.table) }, credentials: creds,
        });
        p = await TablePayment.create({ tenantId, userId, sessionId: s._id, orderIds: rows.map((o) => o._id), orderKey, scope: mineOnly ? 'mine' : 'all', table: s.table, mode: creds.mode || 'test', rzpOrderId: ro.id, amountPaise, grossPaise, creditPaise });
    }
    return { keyId: creds.keyId, rzpOrderId: p.rzpOrderId, amountPaise: p.amountPaise, currency: 'INR' };
}

// The deposit paid when he booked covers the whole bill: nothing to pay online, the rounds are settled by it.
async function settleByCredit({ tenantId, userId, s, rows, creditPaise }) {
    const now = new Date();
    const orders = await Order.find({ _id: { $in: rows.map((o) => o._id) }, 'payment.status': { $ne: 'paid' } }).lean();
    await Order.updateMany({ _id: { $in: orders.map((o) => o._id) } }, { $set: { 'payment.status': 'paid', 'payment.paidAt': now, 'payment.settledAt': now, 'payment.settledVia': 'deposit', 'payment.paidBy': userId } });
    await require('./bookingCredit').consume(s._id, creditPaise / 100);
    const loyalty = require('./loyaltyService');
    for (const o of orders) loyalty.onDelivered({ ...o, payment: { ...(o.payment || {}), status: 'paid' }, deliveredAt: now }).catch((e) => console.error('Points error:', e.message));
    for (const o of orders) require('./partnerWalletService').chargeOrder({ ...(o.toObject ? o.toObject() : o), payment: { status: 'paid' } }).catch((e) => console.error('Partner fee error:', e.message));   // the Partner plan's per-order fee, now that the bill is paid
    try { require('./realtime').toOwner(tenantId, 'order:update', { kind: 'table_paid' }); } catch (e) { /* the screens refresh on their own */ }
    return { settled: true };
}

// THE one place where the money is recorded. Safe to repeat: only the run that flips created -> captured marks the rounds and tells people.
async function confirm(p, rzp) {
    if (rzp.orderId !== p.rzpOrderId) return { ok: false, ignored: 'wrong_order' };
    if (rzp.status !== 'captured') return { ok: true, paid: false, status: rzp.status };
    if (rzp.amountPaise !== p.amountPaise) {
        await require('./mismatchRefund').refundWrongAmount({ Model: TablePayment, row: p, rzp, creds: await credsFor(p.tenantId), label: `table ${p.table} bill` });   // the whole payment goes back; nothing is marked paid
        return { ok: true, paid: false, mismatch: true };
    }
    const first = (await TablePayment.updateOne({ _id: p._id, status: 'created' }, { $set: { status: 'captured', rzpPaymentId: rzp.id, capturedAt: new Date(), settleStartedAt: new Date() } })).modifiedCount === 1;
    if (!first) {
        // a repeat. If the first run died half way (no settledAt), this finishes the work instead of just saying "fine"
        await resume(p._id).catch((e) => console.error('Table payment resume:', e.message));
        return { ok: true, paid: true, repeat: true };
    }
    await settle(p);
    return { ok: true, paid: true };
}

// Takes up a captured payment whose follow-up work never finished (a crash between "captured" and "rounds paid").
// The claim moves settleStartedAt forward, so two runs never work on it at once. Every step inside settle() is safe to repeat.
async function resume(id, now = new Date()) {
    const p = await TablePayment.findOneAndUpdate(
        { _id: id, status: 'captured', settledAt: { $exists: false }, settleStartedAt: { $exists: true, $lt: new Date(now.getTime() - 2 * 60000) } },
        { $set: { settleStartedAt: now } },
        { returnDocument: 'after' },
    );
    if (!p) return false;
    await settle(p, { resumed: true });
    return true;
}

// reconcile job: finish every captured table payment that was left half done (rows from before this field existed have no settleStartedAt and are left alone)
async function repairUnsettled(now = new Date()) {
    const rows = await TablePayment.find({
        status: 'captured', settledAt: { $exists: false }, settleStartedAt: { $exists: true, $lt: new Date(now.getTime() - 2 * 60000), $gte: new Date(now.getTime() - 7 * 86400000) },
    }).select('_id').limit(100).lean();
    let n = 0;
    for (const r of rows) {
        try { if (await resume(r._id, now)) n += 1; } catch (e) { console.error('Table payment repair:', String(r._id), e.message); }
    }
    return n;
}

// The work after the money is recorded: the rounds turn paid, the guest leaves his share, people are told.
async function settle(p, { resumed = false } = {}) {
    const now = new Date();
    if (p.creditPaise > 0) await require('./bookingCredit').consume(p.sessionId, p.creditPaise / 100);   // the booking amount paid earlier is used up by this bill
    const orders = await Order.find({ _id: { $in: p.orderIds }, 'payment.status': { $ne: 'paid' } }).lean();
    if (orders.length) await Order.updateMany({ _id: { $in: orders.map((o) => o._id) } }, { $set: { 'payment.status': 'paid', 'payment.paidAt': now, 'payment.settledAt': now, 'payment.settledVia': 'online', 'payment.paidBy': p.userId } }); require('./realtime').toOwner(p.tenantId, 'order:update', { kind: 'table_paid' });   // the owner's "On the table" list drops what was paid
    if (orders.length < p.orderIds.length && !resumed) {
        await alert('admin_refund_failed', { tenantId: p.tenantId, vars: { orderId: `table ${p.table} bill`, amount: (p.amountPaise / 100).toFixed(2), reason: 'Some rounds were already paid at the counter when this online payment came in. Refund the extra from Razorpay.' } });
    }
    const loyalty = require('./loyaltyService');
    for (const o of orders) loyalty.onDelivered({ ...o, payment: { ...(o.payment || {}), status: 'paid' }, deliveredAt: now }).catch((e) => console.error('Points error:', e.message));
    for (const o of orders) require('./partnerWalletService').chargeOrder({ ...(o.toObject ? o.toObject() : o), payment: { status: 'paid' } }).catch((e) => console.error('Partner fee error:', e.message));   // the Partner plan's per-order fee, now that the bill is paid

    const s = await TableSession.findById(p.sessionId).select('table customers').lean();
    const table = s?.table || p.table;
    const amount = p.amountPaise / 100;
    const payer = await require('../models/User').findById(p.userId).select('name').lean();
    const payerName = String(payer?.name || '').trim() || 'A guest';
    // his share is paid online: he leaves the bill (the rest of the table carries on), exactly as when the waiter takes his share
    if (p.scope === 'mine') {
        const sess = await TableSession.findOne({ _id: p.sessionId, status: { $in: ['open', 'bill_asked'] } });
        if (sess && sess.customers.some((c) => String(c) === String(p.userId))) {
            await require('./tableShares').finishLeave({ s: sess, tenantId: p.tenantId, userId: p.userId, paidPaise: p.amountPaise, via: 'online', by: 'online', now });
        }
    }
    Promise.resolve().then(() => require('../notifications/center').notify('table_paid_online', { tenantId: p.tenantId, vars: { table, amount, name: payerName }, data: { kind: 'table_paid_online', sessionId: String(p.sessionId), table } })).catch((e) => console.error('Notification error:', e.message));
    require('./waiterAlerts').paidOnline(p.tenantId, { table, amount, name: payerName });
    await TablePayment.updateOne({ _id: p._id }, { $set: { settledAt: new Date() } });
}

async function verify({ tenantId, userId, rzpOrderId, rzpPaymentId, signature }) {
    const p = await TablePayment.findOne({ tenantId, userId, rzpOrderId });
    if (!p) throw httpError(400, 'This payment does not belong to you');
    const creds = await credsFor(tenantId);
    if (!payments.verifyPaymentSignature({ orderId: rzpOrderId, paymentId: rzpPaymentId, signature, secret: creds.keySecret })) throw httpError(400, 'The payment proof is not valid');
    const rzp = await payments.fetchPayment({ paymentId: rzpPaymentId, credentials: creds });
    return confirm(p, rzp);
}

// "Did it get paid?" answered by Razorpay itself (no webhook needed)
async function check({ tenantId, userId }) {
    const p = await TablePayment.findOne({ tenantId, userId, status: 'created' }).sort({ createdAt: -1 });
    if (!p) return { paid: true, status: 'none' };
    const creds = await credsFor(tenantId);
    const list = await payments.listOrderPayments({ orderId: p.rzpOrderId, credentials: creds });
    const captured = list.find((x) => x.status === 'captured');
    if (!captured) return { paid: false, status: list[0]?.status || 'created' };
    const r = await confirm(p, captured);
    return { paid: !!r.paid, status: 'captured' };
}

async function onWebhook({ account, rzp }) {
    if (!rzp.orderId) return null;
    const p = await TablePayment.findOne({ tenantId: account, rzpOrderId: rzp.orderId });
    return p ? confirm(p, rzp) : null;
}

module.exports = { available, start, verify, check, onWebhook, resume, repairUnsettled };
