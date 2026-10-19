// WHAT HAPPENS when an order is cancelled or marked undelivered. PURE: no database.
//   keptPaise / refundPaise  money the shop keeps / gives back (online orders only; COD has no money to refund)
//   billable                 the shop earned money, so the order counts for the rent
//   strike                   a strike on the customer's phone (2 strikes block Cash on delivery)
//   couponReturn             the coupon use goes back (only when the customer got a FULL refund)
const { calcRefund, toPaise } = require('./refundService');

const OWNER_CANCEL_REASONS = ['busy', 'out_of_stock', 'shop_fault', 'customer_asked', 'other'];
const ADMIN_CANCEL_REASONS = ['platform', 'shop_fault', 'customer_fault'];
const SYSTEM_CANCEL_REASONS = ['not_accepted', 'payment_timeout', 'late_delivery'];   // late_delivery: over an hour past the delivery time, full refund
const UNDELIVERED_REASONS = ['customer', 'shop', 'rider'];
// the reasons a rider can pick when he cancels a delivery he is carrying (his cancel is treated as the rider's fault)
const RIDER_CANCEL_REASONS = ['not_answering', 'wrong_address', 'vehicle_problem', 'emergency', 'order_damaged'];
const PENALTY_STATUSES = ['preparing', 'ready', 'out_for_delivery'];   // a COD customer who cancels from here costs the shop food

function acceptedAtOf(order) {
    const history = order.statusHistory || [];
    for (let i = history.length - 1; i >= 0; i -= 1) {
        if (history[i].status === 'accepted') return history[i].at ? new Date(history[i].at) : undefined;
    }
    return undefined;
}

// stored reason code + the reason the refund maths understands
function reasonsOf({ kind, actorType, reasonCode, frozen }) {
    if (kind === 'undelivered') {
        const refundReason = { customer: 'undelivered_customer', shop: 'shop_fault', rider: 'rider_fault' }[reasonCode];
        if (!refundReason) throw new Error('Unknown undelivered reason');
        return { code: reasonCode, refundReason };
    }
    if (actorType === 'customer') {
        // a shop that is frozen (suspended, maintenance, blocked) must never cost the customer anything
        return frozen ? { code: 'platform', refundReason: 'platform' } : { code: 'customer_cancel', refundReason: 'customer_cancel' };
    }
    if (actorType === 'owner') {
        if (!OWNER_CANCEL_REASONS.includes(reasonCode)) throw new Error('Unknown cancel reason');
        return { code: reasonCode, refundReason: reasonCode === 'customer_asked' ? 'customer_asked' : 'shop_fault' };
    }
    if (actorType === 'superadmin') {
        const code = reasonCode || 'platform';
        if (!ADMIN_CANCEL_REASONS.includes(code)) throw new Error('Unknown cancel reason');
        return { code, refundReason: { platform: 'platform', shop_fault: 'shop_fault', customer_fault: 'customer_asked' }[code] };
    }
    if (actorType === 'rider') {
        if (!RIDER_CANCEL_REASONS.includes(reasonCode)) throw new Error('Unknown cancel reason');
        // the customer must never pay for it: full refund on an online order, nothing to collect on cash, no strike, the coupon goes back
        return { code: reasonCode, refundReason: 'rider_fault' };
    }
    if (actorType === 'system') {
        const code = reasonCode || 'not_accepted';
        if (!SYSTEM_CANCEL_REASONS.includes(code)) throw new Error('Unknown cancel reason');
        return { code, refundReason: code };
    }
    throw new Error('This actor cannot cancel an order');
}

// kind: 'cancel' | 'undelivered'.  order needs: status, payment, pricing, statusHistory
function outcomeFor({ order, kind, actorType, reasonCode, frozen = false, now = new Date() }) {
    const { code, refundReason } = reasonsOf({ kind, actorType, reasonCode, frozen });
    const cod = !order.payment?.method || order.payment.method === 'cod';
    const strikeByRule = kind === 'undelivered' && code === 'customer';

    if (!cod) {
        const paid = order.payment?.status === 'paid';
        const paidPaise = paid ? toPaise(order.pricing?.total) : 0;
        const tipPaise = paid ? Math.min(toPaise(order.pricing?.tip), paidPaise) : 0;
        const r = calcRefund({ paidPaise, tipPaise, reason: refundReason, status: order.status, acceptedAt: acceptedAtOf(order), now });
        return {
            reasonCode: code, refundReason, keptPaise: r.keptPaise, refundPaise: r.refundPaise, pct: r.pct,
            billable: r.keptPaise > 0, strike: strikeByRule, couponReturn: r.keptPaise === 0, cod: false,
        };
    }

    // Cash on delivery: no money to give back. The customer only "pays" when the food was already being made or was on the way.
    const penalty = kind === 'undelivered'
        ? code === 'customer'
        : ['customer_cancel', 'customer_asked'].includes(refundReason) && PENALTY_STATUSES.includes(order.status);
    return {
        reasonCode: code, refundReason, keptPaise: 0, refundPaise: 0, pct: penalty ? 100 : 0,
        billable: penalty, strike: penalty, couponReturn: !penalty, cod: true,
    };
}

module.exports = { outcomeFor, RIDER_CANCEL_REASONS, OWNER_CANCEL_REASONS, ADMIN_CANCEL_REASONS, SYSTEM_CANCEL_REASONS, UNDELIVERED_REASONS, PENALTY_STATUSES };