// A customer who chose Cash on delivery decides at the door to pay online instead. The rider shows a UPI QR for the exact
// amount (on the SHOP's own Razorpay account); when it is paid the order becomes a normal paid online order:
//   - payment.method turns to "upi", payment.status "paid", payment.paidAtDoor true, so no cash is expected from the rider
//   - an OnlinePayment row is made, so a later refund works like for any online order
//   - the QR is single use and for a fixed amount, so a wrong amount cannot be paid; if the rider takes cash instead the QR is closed
//
//   start({ order, tenant })   -> { amountPaise, imageUrl, upiString, expiresAt }   makes (or reuses) the QR
//   credit({ account, qr, pay }) the money arrived (the qr_code.credited webhook); safe to repeat
//   check({ order, tenant })   -> { paid }    asks Razorpay now, so a late webhook never leaves the rider waiting
const mongoose = require('mongoose');
const Order = require('../models/Order');
const OnlinePayment = require('../models/OnlinePayment');
const payments = require('./adapters/payments');
const accounts = require('./paymentAccounts');
const paymentService = require('./paymentService');
const { toPaise } = require('./refundService');
const alert = require('./paymentAlerts');
const liveFeed = require('./liveFeed');
const { httpError } = require('../middlewares/apiErrors');

const PURPOSE = 'door_cod';

const qrView = (q) => (q ? { amountPaise: q.amountPaise, imageUrl: q.imageUrl || null, upiString: q.upiString || null, expiresAt: q.expiresAt } : null);
const isOpen = (q, now = new Date()) => !!q?.qrId && !q.closedAt && !q.paidAt && new Date(q.expiresAt).getTime() > now.getTime() + 60000;

async function start({ order, tenant }) {
    if (order.payment?.method !== 'cod' || order.payment?.status === 'paid') throw httpError(409, 'This order does not need a payment');
    if (order.delivery?.status !== 'picked_up' || order.status !== 'out_for_delivery') throw httpError(409, 'The order is not on its way yet');
    const can = await accounts.canTakePayments(tenant._id);
    if (!can.ok) throw httpError(409, 'Online payment is not available at this shop right now. Collect the cash.');
    const amountPaise = toPaise(order.pricing?.total);
    if (!(amountPaise >= 100)) throw httpError(400, 'This amount is too small to pay online. Collect the cash.');

    const old = order.delivery?.doorQr;
    if (isOpen(old) && old.amountPaise === amountPaise) return qrView(old);   // the same QR again

    const creds = await paymentService.credsFor(tenant._id);
    let r;
    try {
        r = await payments.createQr({ amountPaise, purpose: PURPOSE, referenceId: String(order._id), credentials: creds });
    } catch (e) {
        console.error('Door QR error:', e.message);
        throw httpError(503, 'Could not make the QR. Collect the cash.');
    }
    const doorQr = { qrId: r.qrId, imageUrl: r.imageUrl || undefined, upiString: r.upiString || undefined, amountPaise, expiresAt: r.expiresAt, createdAt: new Date() };
    const set = await Order.updateOne(
        { _id: order._id, tenantId: tenant._id, 'payment.method': 'cod', 'payment.status': { $ne: 'paid' } },
        { $set: { 'delivery.doorQr': doorQr } },
    );
    if (!set.matchedCount) throw httpError(409, 'This order was just paid or changed');
    if (old?.qrId && !old.closedAt) payments.closeQr({ qrId: old.qrId, credentials: creds }).catch(() => { });   // only one QR stays open
    return qrView(doorQr);
}

// the rider takes cash after all: the QR must not stay open (a late payment would be a second payment)
async function closeOpen({ order, tenantId }) {
    const q = order.delivery?.doorQr;
    if (!q?.qrId || q.closedAt || q.paidAt) return;
    try {
        await payments.closeQr({ qrId: q.qrId, credentials: await paymentService.credsFor(tenantId) });
    } catch (e) { /* it expires by itself in 15 minutes */ }
    await Order.updateOne({ _id: order._id, tenantId }, { $set: { 'delivery.doorQr.closedAt': new Date() } });
}

async function ensureRow({ order, qrId, pay }) {
    try {
        return await OnlinePayment.create({
            tenantId: order.tenantId, orderId: order._id, mode: payments.isMock() ? 'mock' : 'live',
            rzpOrderId: `qr:${qrId}`, rzpPaymentId: pay.id, amountPaise: pay.amountPaise, status: 'captured',
            capturedPaise: pay.amountPaise, capturedAt: new Date(), method: pay.method || 'upi', source: 'door_qr',
        });
    } catch (e) {
        if (e.code !== 11000) throw e;
        return OnlinePayment.findOne({ orderId: order._id });
    }
}

async function credit({ account, qr, pay }) {
    if (qr?.notes?.purpose !== PURPOSE) return { ignored: 'other_purpose' };
    const orderId = qr.notes.referenceId;
    const order = mongoose.isValidObjectId(orderId) ? await Order.findOne({ _id: orderId, tenantId: account }) : null;
    const door = order?.delivery?.doorQr;
    const problem = !order ? 'Order not found'
        : door?.qrId !== qr.id ? 'The QR does not belong to this order'
            : pay.status !== 'captured' ? 'Payment is not captured'
                : pay.amountPaise !== door.amountPaise ? 'Amount does not match the QR' : null;
    if (problem) {
        await alert('admin_webhook_failed', { tenantId: account, vars: { event: 'qr_code.credited (payment at the door)', error: `${problem} (payment ${pay.id}). Check Razorpay.` } });
        return { ignored: 'check_failed' };
    }

    const now = new Date();
    const claimed = await Order.updateOne(
        { _id: order._id, tenantId: order.tenantId, 'payment.method': 'cod', 'payment.status': { $ne: 'paid' } },
        { $set: { 'payment.method': 'upi', 'payment.status': 'paid', 'payment.paidAt': now, 'payment.paymentId': pay.id, 'payment.paidAtDoor': true, 'delivery.doorQr.paidAt': now } },
    );
    if (!claimed.modifiedCount) {
        // a repeat of the same payment (or a crash after the claim): make sure the payment row exists and say fine
        if (order.payment?.paymentId === pay.id && order.payment?.paidAtDoor) { await ensureRow({ order, qrId: qr.id, pay }); return { door: 'already_paid' }; }
        await alert('admin_refund_failed', {
            tenantId: account, vars: { orderId: String(order._id), amount: (pay.amountPaise / 100).toFixed(2), reason: 'The customer paid by QR at the door but the order was already paid. Refund it from Razorpay.' },
        });
        return { ignored: 'already_paid' };
    }
    const row = await ensureRow({ order, qrId: qr.id, pay });
    liveFeed.emit(order.tenantId, 'orders', { type: 'order.paid_at_door', orderId: String(order._id), orderNo: order.orderNo, total: order.pricing?.total });
    if (order.status === 'cancelled' && row) await paymentService.settleOrder(row);   // paid after the order was cancelled: the money goes back
    return { door: 'paid' };
}

async function check({ order, tenant }) {
    const fresh = await Order.findOne({ _id: order._id, tenantId: tenant._id }).lean();
    if (fresh?.payment?.paidAtDoor) return { paid: true };
    const q = fresh?.delivery?.doorQr;
    if (!q?.qrId || q.closedAt) return { paid: false };
    let list = [];
    try {
        list = await payments.listQrPayments({ qrId: q.qrId, credentials: await paymentService.credsFor(tenant._id) });
    } catch (e) { return { paid: false }; }
    const hit = list.find((p) => p.status === 'captured');
    if (!hit) return { paid: false };
    await credit({ account: tenant._id, qr: { id: q.qrId, notes: { purpose: PURPOSE, referenceId: String(order._id) } }, pay: hit });
    return { paid: !!(await Order.exists({ _id: order._id, 'payment.paidAtDoor': true })) };
}

module.exports = { start, credit, check, closeOpen, qrView, isOpen };
