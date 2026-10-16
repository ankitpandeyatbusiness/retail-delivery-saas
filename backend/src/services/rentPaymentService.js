// Paying a monthly bill (rent) online. The shop owner opens a QR on the bill, pays it with any UPI app,
// and Razorpay's "qr_code.credited" webhook marks the bill paid. Money goes to the PLATFORM Razorpay account.
//   createQr()   owner (or superadmin on his behalf) asks for the QR of one bill
//   onCredited() the webhook: checks the money, marks the bill paid, unpauses the shop, writes the audit row
const mongoose = require('mongoose');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const payments = require('./adapters/payments');
const alert = require('./paymentAlerts');
const auditTrail = require('../middlewares/auditTrail');

const bad = (status, message) => Object.assign(new Error(message), { status });
const toPaise = (rupees) => Math.round((Number(rupees) + Number.EPSILON) * 100);
const OPEN_MARGIN_MS = 60 * 1000;   // a QR that closes within a minute is not worth showing

// What the app shows. Never anything secret.
const qrView = (inv) => ({
    invoiceId: inv._id,
    invoiceNo: inv.invoiceNo,
    amountPaise: inv.payQr.amountPaise,
    upiString: inv.payQr.upiString || null,
    imageUrl: inv.payQr.imageUrl || null,
    expiresAt: inv.payQr.expiresAt,
});

async function createQr({ tenantId, invoiceId }) {
    if (!mongoose.isValidObjectId(invoiceId)) throw bad(404, 'Invoice not found');
    const inv = await SubscriptionInvoice.findOne({ _id: invoiceId, tenantId });
    if (!inv) throw bad(404, 'Invoice not found');
    if (inv.status === 'paid') throw bad(409, 'This bill is already paid');
    if (inv.status === 'void') throw bad(409, 'This bill was cancelled');

    const amountPaise = toPaise(inv.total);
    if (!(amountPaise >= 100)) throw bad(400, 'This bill is too small to pay online. Contact support.');

    // still open and for the same amount: show the same QR again
    const q = inv.payQr;
    if (q?.qrId && q.amountPaise === amountPaise && q.expiresAt && q.expiresAt.getTime() > Date.now() + OPEN_MARGIN_MS) {
        return qrView(inv);
    }

    let qr;
    try {
        qr = await payments.createQr({ amountPaise, purpose: 'rent', referenceId: String(inv._id) });
    } catch (e) {
        console.error('Rent QR error:', e.message);
        throw bad(503, 'Online payment is not available right now. Please try again later or contact support.');
    }

    const payQr = {
        qrId: qr.qrId, imageUrl: qr.imageUrl, upiString: qr.upiString,
        amountPaise, expiresAt: qr.expiresAt, createdAt: new Date(),
    };
    const r = await SubscriptionInvoice.updateOne({ _id: inv._id, status: 'pending' }, { $set: { payQr } });
    if (!r.matchedCount) throw bad(409, 'This bill was just paid or cancelled');
    return qrView({ _id: inv._id, invoiceNo: inv.invoiceNo, payQr });
}

// Called by the webhook for a paid QR with purpose "rent". Safe to call twice (Razorpay repeats events).
// Returns a small object for the webhook reply; throws only for real faults, so Razorpay retries those.
async function onCredited({ qr, pay }) {
    return settle({ invoiceId: qr.notes?.referenceId, pay, via: { path: '/api/webhooks/razorpay/platform', method: 'WEBHOOK', qrId: qr.id } });
}

// The one place a bill becomes paid, whichever way the money came (QR webhook, the app's check, the payment webhook).
async function settle({ invoiceId, pay, via }) {
    const inv = mongoose.isValidObjectId(invoiceId) ? await SubscriptionInvoice.findById(invoiceId) : null;
    const where = `(payment ${pay.id})`;

    const problem = !inv ? 'Bill not found'
        : pay.status !== 'captured' ? 'Payment is not captured'
            : pay.amountPaise !== toPaise(inv.total) ? `Amount ${pay.amountPaise} paise does not match the bill ${inv.invoiceNo}`
                : null;
    if (problem) {
        await alert('admin_webhook_failed', {
            tenantId: inv?.tenantId,
            vars: { event: 'rent payment', error: `${problem} ${where}. Check Razorpay, then mark the bill paid by hand if it is real.` },
        });
        return { ignored: 'check_failed' };
    }

    // one winner: only a pending bill can become paid
    const paid = await SubscriptionInvoice.findOneAndUpdate(
        { _id: inv._id, status: 'pending' },
        { $set: { status: 'paid', paidAt: new Date(), paymentMode: 'upi', paymentRef: String(pay.id).slice(0, 60), markedBy: 'razorpay' } },
        { returnDocument: 'after' },
    ).lean();

    if (!paid) {
        const cur = await SubscriptionInvoice.findById(inv._id).select('status paymentRef invoiceNo tenantId').lean();
        if (cur?.status === 'paid' && cur.paymentRef === pay.id) return { rent: 'already_paid' };   // same payment again
        // real money arrived for a bill that was already paid or cancelled
        await alert('admin_webhook_failed', {
            tenantId: inv.tenantId,
            vars: { event: 'rent payment', error: `Bill ${cur?.invoiceNo || inv.invoiceNo} is already ${cur?.status}, but payment ${pay.id} arrived. Refund it from Razorpay.` },
        });
        return { ignored: 'bill_not_pending' };
    }

    require('./settlement').recordInvoicePaid(paid).catch((e) => console.error('Settlement row error:', e.message));

    // paid bill: unpause the shop at once (the "payment received" message is sent by the billing alerts job)
    await require('./billingEnforcement').enforceTenant(paid.tenantId)
        .catch((e) => console.error('Billing enforce error:', e.message));

    await auditTrail.record({
        actorType: 'system',
        actorLabel: 'razorpay',
        tenantId: paid.tenantId,
        action: 'RENT_PAID_ONLINE',
        method: via.method,
        path: via.path,
        status: 200,
        params: { invoiceId: String(paid._id), invoiceNo: paid.invoiceNo, period: paid.period, amountPaise: pay.amountPaise, paymentId: pay.id, qrId: via.qrId },
        before: { status: 'pending' },
    });
    return { rent: 'paid' };
}

module.exports = { createQr, onCredited, settle };
