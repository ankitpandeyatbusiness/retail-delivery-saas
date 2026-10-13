// Razorpay dispute (chargeback) events. Safe to receive twice and in any order:
// an open stage never overwrites a final one, and the owner and superadmin are told once per real change.
const PaymentDispute = require('../models/PaymentDispute');
const OnlinePayment = require('../models/OnlinePayment');
const Order = require('../models/Order');
const notify = require('./notificationService');
const alert = require('./paymentAlerts');

const OPEN = ['created', 'under_review', 'action_required'];
const FINAL = ['won', 'lost', 'closed'];
const TOLD = ['created', 'action_required', 'won', 'lost'];   // the stages that are worth a message
const rupees = (paise) => (paise / 100).toFixed(2);

function words(status, orderNo, amountPaise, respondBy) {
    const no = orderNo ? ` for order #${orderNo}` : '';
    const by = respondBy ? ` Reply by ${respondBy.toISOString().slice(0, 10)}.` : '';
    switch (status) {
        case 'created': return { title: 'Payment dispute', body: `A customer's bank questioned a payment of Rs ${rupees(amountPaise)}${no}.${by} The platform will help you reply.` };
        case 'action_required': return { title: 'Dispute needs a reply', body: `The dispute of Rs ${rupees(amountPaise)}${no} needs a reply.${by}` };
        case 'won': return { title: 'Dispute won', body: `You won the dispute of Rs ${rupees(amountPaise)}${no}. The money stays with you.` };
        default: return { title: 'Dispute lost', body: `The dispute of Rs ${rupees(amountPaise)}${no} was lost. The bank took the money back.` };
    }
}

async function onDisputeEvent({ account, name, entity }) {
    if (account === 'platform') return { ignored: 'platform' };
    if (!entity?.id) return { ignored: 'no_dispute' };
    const status = String(name).split('.').pop();
    if (![...OPEN, ...FINAL].includes(status)) return { ignored: name };

    const pay = await OnlinePayment.findOne({ tenantId: account, rzpPaymentId: entity.payment_id });
    if (!pay) {
        await alert('admin_webhook_failed', { tenantId: account, vars: { event: name, error: `Dispute ${entity.id} is for a payment we do not know. Check Razorpay.` } });
        return { ignored: 'unknown_payment' };
    }
    const now = new Date();
    const fields = {
        amountPaise: Number.isInteger(entity.amount) ? entity.amount : 0,
        reasonCode: entity.reason_code, phase: entity.phase,
        respondBy: entity.respond_by ? new Date(entity.respond_by * 1000) : undefined,
    };

    let changed = false;
    try {
        await PaymentDispute.create({
            tenantId: pay.tenantId, orderId: pay.orderId, paymentId: pay._id, rzpPaymentId: pay.rzpPaymentId,
            rzpDisputeId: entity.id, status, ...fields, history: [{ status, at: now }],
        });
        changed = true;
    } catch (e) {
        if (e.code !== 11000) throw e;
    }
    if (!changed) {
        // only an OPEN dispute can move on, and never to the same stage
        const from = FINAL.includes(status) ? OPEN : OPEN.filter((s) => s !== status);
        const set = { status, ...fields };
        Object.keys(set).forEach((k) => set[k] === undefined && delete set[k]);
        const r = await PaymentDispute.updateOne(
            { rzpDisputeId: entity.id, status: { $in: from } },
            { $set: set, $push: { history: { status, at: now } } },
        );
        changed = r.modifiedCount === 1;
    }
    if (!changed) return { duplicate: true };

    if (TOLD.includes(status)) {
        const order = await Order.findById(pay.orderId).select('orderNo').lean();
        const text = words(status, order?.orderNo, fields.amountPaise, fields.respondBy);
        notify.toOwner(pay.tenantId, {
            type: 'platform_message', title: text.title, body: text.body,
            data: { disputeId: entity.id, orderId: String(pay.orderId), status },
        });
        await alert('admin_webhook_failed', {
            tenantId: pay.tenantId,
            vars: { event: `payment.dispute.${status}`, error: `${text.title}: ${text.body} (dispute ${entity.id}, payment ${pay.rzpPaymentId})` },
        });
    }
    return { dispute: status };
}

module.exports = { onDisputeEvent, OPEN, FINAL };