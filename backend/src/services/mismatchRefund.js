// A payment whose amount is not what we asked for (table booking deposit, table bill, unpaid table bill) goes back in full,
// the same rule an order payment already has. Nothing is marked paid. Rules:
//  - one claim per row (mismatchRefund.status), so two webhooks never send it twice
//  - before sending, Razorpay is asked whether a refund for that payment already exists (a crash or a timeout may have hidden it)
//  - a failure is kept as "failed" and the superadmin is told; the next repeat of the same webhook tries again
const payments = require('./adapters/payments');
const alert = require('./paymentAlerts');

const STALE_MS = 2 * 60 * 1000;

// Model = the Mongoose model of the row, row = the row, rzp = the normalized captured payment, creds = the shop keys, label = words for the alert
async function refundWrongAmount({ Model, row, rzp, creds, label }) {
    const now = new Date();
    const claimed = await Model.findOneAndUpdate(
        {
            _id: row._id,
            $or: [
                { 'mismatchRefund.status': { $exists: false } }, { 'mismatchRefund.status': 'failed' },
                { 'mismatchRefund.status': 'sending', 'mismatchRefund.at': { $lt: new Date(now.getTime() - STALE_MS) } },
            ],
        },
        { $set: { 'mismatchRefund.status': 'sending', 'mismatchRefund.at': now } },
        { returnDocument: 'after' },
    );
    if (!claimed) return { skipped: true };   // done already, or another run has it

    const money = ((rzp.amountPaise || 0) / 100).toFixed(2);
    try {
        const old = (await payments.listRefunds({ paymentId: rzp.id, credentials: creds }) || []).find((x) => x.status !== 'failed');
        const out = old
            ? { refundId: old.id || old.refundId }
            : await payments.refund({ paymentId: rzp.id, amountPaise: rzp.amountPaise, credentials: creds, notes: { kind: 'amount_mismatch', rowId: String(row._id) }, receipt: `mm-${String(row._id).slice(-12)}` });
        await Model.updateOne({ _id: row._id }, { $set: { 'mismatchRefund.status': 'refunded', 'mismatchRefund.refundId': out.refundId, 'mismatchRefund.at': new Date() } });
        await alert('admin_refund_failed', { tenantId: row.tenantId, vars: { orderId: label, amount: money, reason: 'The amount paid did not match what was asked, so the whole payment was sent back. Nothing was marked paid.' } });
        return { refunded: true, refundId: out.refundId };
    } catch (e) {
        await Model.updateOne({ _id: row._id }, { $set: { 'mismatchRefund.status': 'failed', 'mismatchRefund.at': new Date() } });
        await alert('admin_refund_failed', { tenantId: row.tenantId, vars: { orderId: label, amount: money, reason: `The amount paid did not match, and sending it back failed (${String(e.message).slice(0, 120)}). Refund it from Razorpay.` } });
        return { failed: true };
    }
}

module.exports = { refundWrongAmount };
