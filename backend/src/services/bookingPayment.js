// The deposit of a table booking: take it online (the shop's own Razorpay keys), confirm the booking when it arrives, let go of an
// unpaid hold, and send the money back by the shop's rule. Same money rules as tablePayment: the server decides the amount, and the
// money is recorded in ONE place (confirm), which the app check, the poll and the webhook all end in.
//   held -> (paid) -> confirmed -> seated | no_show        held -> expired        held/confirmed -> cancelled
const TableBooking = require('../models/TableBooking');
const payments = require('./adapters/payments');
const accounts = require('./paymentAccounts');
const { credsFor } = require('./paymentService');
const alert = require('./paymentAlerts');
const tb = require('./tableBooking');
const { httpError } = require('../middlewares/apiErrors');

const tell = (event, ctx) => Promise.resolve().then(() => require('../notifications/center').notify(event, ctx)).catch((e) => console.error('Notification error:', e.message));
const HOUR = 3600000;

async function available(tenantId) {
    try { return !!(await accounts.canTakePayments(tenantId)).ok; } catch (e) { return false; }
}

// The guest pays: make (or reuse) the Razorpay order for exactly the deposit. Safe to call again.
async function start(booking) {
    if (booking.status !== 'held') throw httpError(409, 'This booking is not waiting for payment');
    if (booking.holdUntil.getTime() <= Date.now()) throw httpError(409, 'The time to pay has run out. Please book again.');
    const can = await accounts.canTakePayments(booking.tenantId);
    if (!can.ok) throw httpError(503, 'Online payment is not available right now. Please try later.');
    const creds = await credsFor(booking.tenantId);
    if (!creds.keyId || !creds.keySecret) throw httpError(503, 'Online payment is not available right now. Please try later.');
    const amountPaise = Math.round(booking.deposit.amount * 100);
    if (amountPaise < 100) throw httpError(400, 'The deposit is too small for an online payment');
    let orderId = booking.payment?.rzpOrderId;
    if (!orderId) {
        const ro = await payments.createOrder({
            amountPaise, receipt: `bk-${booking.code}-${Date.now().toString(36)}`.slice(0, 40),
            notes: { kind: 'table_booking', tenantId: String(booking.tenantId), bookingId: String(booking._id) }, credentials: creds,
        });
        orderId = ro.id;
        await TableBooking.updateOne({ _id: booking._id }, { $set: { 'payment.rzpOrderId': orderId, 'payment.amountPaise': amountPaise } });
    }
    return { keyId: creds.keyId, rzpOrderId: orderId, amountPaise: booking.payment?.amountPaise || amountPaise, currency: 'INR', holdUntil: booking.holdUntil };
}

// Sends the deposit back. The booking is claimed first (paid -> refunding), so a repeat can never send it twice.
async function refundDeposit(id, reason, { instant = false } = {}) {
    const b = await TableBooking.findOneAndUpdate({ _id: id, 'deposit.status': { $in: ['paid', 'refund_failed'] } }, { $set: { 'deposit.status': 'refunding' } }, { returnDocument: 'after' });
    if (!b) return { skipped: true };
    try {
        const r = await payments.refund({
            paymentId: b.payment.rzpPaymentId, amountPaise: b.payment.amountPaise, credentials: await credsFor(b.tenantId),
            notes: { kind: 'table_booking', bookingId: String(b._id), reason }, receipt: `bkr-${b.code}`, instant,
        });
        await TableBooking.updateOne({ _id: b._id }, { $set: { 'deposit.status': 'refunded', 'deposit.refundId': r.refundId, 'deposit.refundedAt': new Date() }, $unset: { 'deposit.refundError': '' } });
        return { ok: true };
    } catch (e) {
        await TableBooking.updateOne({ _id: b._id }, { $set: { 'deposit.status': 'refund_failed', 'deposit.refundError': String(e.message || e).slice(0, 200) } });
        alert('admin_refund_failed', { tenantId: b.tenantId, vars: { orderId: `table booking ${b.code}`, amount: (b.payment.amountPaise / 100).toFixed(2), reason: 'The deposit could not be sent back. It will be tried again by itself.' } });
        return { ok: false };
    }
}

// THE one place where the deposit is recorded.
async function confirm(booking, rzp) {
    if (rzp.orderId !== booking.payment?.rzpOrderId) return { ok: false, ignored: 'wrong_order' };
    if (rzp.status !== 'captured') return { ok: true, paid: false, status: rzp.status };
    if (rzp.amountPaise !== booking.payment.amountPaise) {
        await alert('admin_refund_failed', { tenantId: booking.tenantId, vars: { orderId: `table booking ${booking.code}`, amount: ((rzp.amountPaise || 0) / 100).toFixed(2), reason: 'The deposit paid did not match what was asked. Check it in Razorpay and refund by hand if needed.' } });
        return { ok: true, paid: false, mismatch: true };
    }
    const shop = await require('../models/Tenant').findById(booking.tenantId).select('name business.legalName business.gstin business.fssai').lean();
    const paid = {
        'deposit.status': 'paid', 'payment.rzpPaymentId': rzp.id, 'payment.paidAt': new Date(),
        seller: { name: shop?.business?.legalName || shop?.name, gstin: shop?.business?.gstin, fssai: shop?.business?.fssai },
    };
    let done = await TableBooking.findOneAndUpdate({ _id: booking._id, status: 'held' }, { $set: { ...paid, status: 'confirmed' } }, { returnDocument: 'after' });

    if (!done) {
        const cur = await TableBooking.findById(booking._id);
        if (cur.deposit.status !== 'unpaid') return { ok: true, paid: true, repeat: true };   // already recorded
        // The money arrived after the hold ran out (or after a cancel). Honour the booking if the seats are still free, else send it back.
        if (cur.status === 'expired' && cur.startsAt.getTime() > Date.now()) {
            if ((await tb.relock(cur)) === 'ok') {
                done = await TableBooking.findOneAndUpdate({ _id: cur._id, status: 'expired' }, { $set: { ...paid, status: 'confirmed' } }, { returnDocument: 'after' });
                if (!done) await tb.release(cur);
            }
        }
        if (!done) {
            await TableBooking.updateOne({ _id: cur._id, 'deposit.status': 'unpaid' }, { $set: { ...paid, ...(cur.status === 'expired' ? { status: 'cancelled', cancelledBy: 'system', cancelledAt: new Date() } : {}) } });
            await refundDeposit(cur._id, 'paid after the booking was gone');
            return { ok: true, paid: false, refunded: true };
        }
    }
    tell('booking_new', { tenantId: done.tenantId, vars: { name: done.name, party: done.party, date: done.date, time: done.time, table: done.table }, data: { kind: 'booking', bookingId: String(done._id) } });
    if ((await tb.getConfig(done.tenantId)).autoAllow) await allow({ _id: done._id, shopName: shop?.name || '' });   // the owner chose to allow paid bookings by themselves
    tell('booking_paid', { tenantId: done.tenantId, userId: done.userId, vars: { shop: shop?.name || '', date: done.date, time: done.time, amount: done.deposit.amount, code: done.code, table: done.table }, data: { kind: 'booking', bookingId: String(done._id) } });
    return { ok: true, paid: true };
}

async function verify({ booking, rzpOrderId, rzpPaymentId, signature }) {
    if (rzpOrderId !== booking.payment?.rzpOrderId) throw httpError(400, 'This payment does not belong to this booking');
    const creds = await credsFor(booking.tenantId);
    if (!payments.verifyPaymentSignature({ orderId: rzpOrderId, paymentId: rzpPaymentId, signature, secret: creds.keySecret })) throw httpError(400, 'The payment proof is not valid');
    return confirm(booking, await payments.fetchPayment({ paymentId: rzpPaymentId, credentials: creds }));
}

// "Did it get paid?" answered by Razorpay itself (no webhook needed)
async function check(booking) {
    if (booking.deposit.status !== 'unpaid') return { paid: true };
    if (!booking.payment?.rzpOrderId) return { paid: false, status: 'created' };
    const list = await payments.listOrderPayments({ orderId: booking.payment.rzpOrderId, credentials: await credsFor(booking.tenantId) });
    const captured = list.find((x) => x.status === 'captured');
    if (!captured) return { paid: false, status: list[0]?.status || 'created' };
    return { paid: !!(await confirm(booking, captured)).paid, status: 'captured' };
}

async function onWebhook({ account, rzp }) {
    if (!rzp.orderId) return null;
    const b = await TableBooking.findOne({ tenantId: account, 'payment.rzpOrderId': rzp.orderId });
    return b ? confirm(b, rzp) : null;
}

// Cancel by the guest or the owner, and settle the deposit: back to the guest when the owner cancels or the guest cancels early
// enough (the rule the guest saw when he booked), otherwise the shop keeps it.
// message: what the owner wrote when he denied the booking (optional). A denial sends the whole deposit back at once (the instant refund
// where the bank allows it, else the normal way).
async function cancelBooking(booking, by, { message } = {}) {
    const done = await tb.cancel(booking, by);
    if (!done) return null;
    if (message) await TableBooking.updateOne({ _id: done._id }, { $set: { cancelNote: String(message).trim().slice(0, 300) } });
    if (done.deposit.status === 'paid') {
        const early = by === 'owner' || done.startsAt.getTime() - Date.now() >= (done.rules?.refundHours ?? 0) * HOUR;
        if (early) await refundDeposit(done._id, `${by} cancelled`, { instant: by === 'owner' });
        else await TableBooking.updateOne({ _id: done._id }, { $set: { 'deposit.status': 'kept' } });
    }
    return TableBooking.findById(done._id).lean();
}

// The owner taps Allow: the guest is told the restaurant confirmed his table.
async function allow(booking) {
    const done = await TableBooking.findOneAndUpdate({ _id: booking._id, status: 'confirmed', approvedAt: { $exists: false } }, { $set: { approvedAt: new Date() } }, { returnDocument: 'after' });
    if (done) tell('booking_allowed', { tenantId: done.tenantId, userId: done.userId, vars: { shop: booking.shopName || '', date: done.date, time: done.time, code: done.code, table: done.table }, data: { kind: 'booking', bookingId: String(done._id) } });
    return done;
}

// The guest arrived (seated) or did not (no-show). Adjust mode: the deposit waits to be taken off his table bill; keep mode: the shop keeps it.
async function seated(booking) {
    const adjust = booking.rules?.depositMode !== 'keep';
    await TableBooking.updateOne({ _id: booking._id, 'deposit.status': 'paid' }, { $set: adjust ? { 'deposit.credit': 'pending' } : { 'deposit.status': 'kept' } });
}
// The waiter took the deposit off the guest's table bill (adjust mode, after the guest was seated)
const adjusted = (booking) => TableBooking.updateOne({ _id: booking._id, status: 'seated', 'deposit.status': 'paid', 'deposit.credit': 'pending' }, { $set: { 'deposit.status': 'adjusted', 'deposit.credit': 'applied' } });
const noShow = (booking) => TableBooking.updateOne({ _id: booking._id, 'deposit.status': 'paid' }, { $set: { 'deposit.status': 'kept' } });

// Half an hour before the slot, once, the guest and the owner are both reminded. A booking made inside that half hour is not reminded
// (they both just heard of it). The booking is claimed first, so two runs or two servers never send it twice.
const REMIND_MIN = 30;
async function remind(now = Date.now()) {
    const soon = await TableBooking.find({ status: 'confirmed', remindedAt: { $exists: false }, startsAt: { $gt: new Date(now), $lte: new Date(now + REMIND_MIN * 60000) } }).limit(100);
    let sent = 0;
    for (const b of soon) {
        if (b.startsAt.getTime() - b.createdAt.getTime() < REMIND_MIN * 60000) continue;
        const claimed = await TableBooking.findOneAndUpdate({ _id: b._id, status: 'confirmed', remindedAt: { $exists: false } }, { $set: { remindedAt: new Date(now) } }, { returnDocument: 'after' });
        if (!claimed) continue;
        const data = { kind: 'booking', bookingId: String(b._id) };
        const shop = (await require('../models/Tenant').findById(b.tenantId).select('name').lean())?.name || '';
        tell('booking_reminder', { tenantId: b.tenantId, vars: { name: b.name, party: b.party, time: b.time, code: b.code, table: b.table }, data });
        require('./waiterAlerts').bookingSoon(b.tenantId, { table: b.table, party: b.party, time: b.time, name: b.name });
        tell('booking_reminder_customer', { tenantId: b.tenantId, userId: b.userId, vars: { shop, party: b.party, time: b.time, code: b.code, table: b.table }, data });
        sent += 1;
    }
    return sent;
}

// Run every minute: let go of holds that were not paid in time (asking Razorpay first, in case the money did arrive), and retry refunds that did not go out.
async function sweep(now = Date.now()) {
    const stale = await TableBooking.find({ status: 'held', holdUntil: { $lte: new Date(now) } }).limit(50);
    for (const b of stale) {
        try {
            if ((await check(b)).paid) continue;
        } catch (e) { /* Razorpay could not be asked right now: the hold is still let go below, a late payment is handled in confirm() */ }
        const gone = await TableBooking.findOneAndUpdate({ _id: b._id, status: 'held' }, { $set: { status: 'expired' } }, { returnDocument: 'after' });
        if (gone) await tb.release(gone);
    }
    await tb.freeFinished(new Date(now));   // seated guests whose table visit is over give their table back for the rest of the slot
    await require('./bookingWaitlist').expireOld(now);
    const stuck = await TableBooking.find({ $or: [{ 'deposit.status': 'refund_failed' }, { 'deposit.status': 'refunding', updatedAt: { $lte: new Date(now - 15 * 60000) } }] }).limit(20);
    for (const b of stuck) {
        if (b.deposit.status === 'refunding') {
            // a refund that was started and never finished: ask Razorpay before sending again
            try {
                const done = (await payments.listRefunds({ paymentId: b.payment.rzpPaymentId, credentials: await credsFor(b.tenantId) }))?.[0];
                if (done) { await TableBooking.updateOne({ _id: b._id }, { $set: { 'deposit.status': 'refunded', 'deposit.refundId': done.id || done.refundId, 'deposit.refundedAt': new Date() } }); continue; }
            } catch (e) { continue; }
            await TableBooking.updateOne({ _id: b._id, 'deposit.status': 'refunding' }, { $set: { 'deposit.status': 'refund_failed' } });
        }
        await refundDeposit(b._id, 'retry');
    }
    return { held: stale.length, refunds: stuck.length };
}

let timer = null;
function startBookingHolds() {
    if (timer) return;
    timer = setInterval(() => { sweep().catch((e) => console.error('Booking holds error:', e.message)); remind().catch((e) => console.error('Booking reminder error:', e.message)); require('./inquiryReminders').sweep().catch((e) => console.error('Inquiry reminder error:', e.message)); }, 60000);
    timer.unref?.();
}

module.exports = { available, start, confirm, verify, check, onWebhook, refundDeposit, cancelBooking, allow, seated, adjusted, noShow, sweep, remind, startBookingHolds };
