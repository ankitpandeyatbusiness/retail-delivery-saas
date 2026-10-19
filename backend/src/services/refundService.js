// Refund maths. PURE: no database, no network. All amounts are WHOLE PAISE.
// Money really moving back to a customer (issueRefund, the Refund record) comes in Phase 4. COD has no refund at all.
//
// paidPaise   what the customer paid online (tip included)
// tipPaise    part of it that was a tip (the tip is always refunded unless the order was delivered)
// reason      payment_timeout | not_accepted | shop_reject | shop_fault | platform | rider_fault | duplicate  -> full refund
//             undelivered_customer                                                                           -> shop keeps the whole base
//             customer_cancel | customer_asked                                                               -> free until accepted + 2 minutes, then a share
// status      the order status at the moment of the cancel
// acceptedAt  when the owner accepted (Date), for the 2 minute free window
const SHARE = { placed: 0, accepted: 20, preparing: 50, ready: 50, out_for_delivery: 100 };
const FULL = ['payment_timeout', 'not_accepted', 'late_delivery', 'shop_reject', 'shop_fault', 'platform', 'rider_fault', 'duplicate'];

function calcRefund({ paidPaise, tipPaise = 0, reason, status, acceptedAt, now = new Date() }) {
    if (!Number.isInteger(paidPaise) || paidPaise < 0) throw new Error('paidPaise must be whole paise');
    const base = paidPaise - tipPaise;
    let pct;
    if (FULL.includes(reason)) pct = 0;
    else if (reason === 'undelivered_customer') pct = 100;
    else if (reason === 'customer_cancel' || reason === 'customer_asked') {
        const inGrace = status === 'placed' || (status === 'accepted' && acceptedAt && now - acceptedAt <= 2 * 60 * 1000);
        pct = inGrace ? 0 : (SHARE[status] ?? 100);
    } else throw new Error('Unknown refund reason');
    const keptPaise = Math.round((base * pct) / 100);
    return { keptPaise, refundPaise: paidPaise - keptPaise, pct, couponReturn: keptPaise === 0, billable: keptPaise > 0 };
}

// rupees (with up to 2 decimals) -> whole paise
const toPaise = (rupees) => Math.round((Number(rupees) || 0) * 100);

// money really moving back (lazy require keeps the maths above pure)
const issueRefund = (args) => require('./refundIssuer').issueRefund(args);

module.exports = { calcRefund, toPaise, SHARE, FULL, issueRefund };