// "Is money of this shop still moving?" Used before the Razorpay keys of a shop are replaced:
// refunds and late payments need the OLD keys, so they must be finished first.
// Only live money counts. Test payments are not real money.
const OnlinePayment = require('../models/OnlinePayment');
const OnlineRefund = require('../models/OnlineRefund');
const PaymentDispute = require('../models/PaymentDispute');

const DAY = 86400000;
const OPEN_DISPUTE = ['created', 'under_review', 'action_required'];

// returns a sentence (the reason), or null when it is safe
async function openMoney(tenantId, now = new Date()) {
    const since = new Date(now.getTime() - 3 * DAY);
    const recent = await OnlinePayment.exists({
        tenantId, mode: 'live',
        $or: [{ status: 'created', createdAt: { $gte: since } }, { status: { $in: ['captured', 'mismatch'] }, capturedAt: { $gte: since } }],
    });
    if (recent) return 'This shop had live online payments in the last 3 days. Refunds and late payments still need the current keys.';

    const waiting = await OnlineRefund.find({ tenantId, status: { $in: ['pending', 'processing'] } }).select('paymentId').limit(100).lean();
    if (waiting.length && await OnlinePayment.exists({ _id: { $in: waiting.map((r) => r.paymentId) }, mode: 'live' })) {
        return 'Some live refunds of this shop are not finished yet.';
    }
    if (await PaymentDispute.exists({ tenantId, status: { $in: OPEN_DISPUTE } })) return 'This shop has an open payment dispute.';
    return null;
}

module.exports = { openMoney, OPEN_DISPUTE };