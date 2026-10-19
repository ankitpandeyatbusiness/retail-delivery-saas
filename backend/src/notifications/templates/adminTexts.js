// The words of every alert to the superadmin. Change the wording HERE only.
// Each one says WHO (the shop in the title), WHAT happened, and what to do about it, in about two lines.
// sms = a very short text for the SMS (at most 30 characters, it is the one {#var#} of the DLT template).
const rs = (n) => (n === undefined || n === null || n === '' ? '' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
const inv = (v) => (v.invoiceNo ? `invoice ${v.invoiceNo}` : 'the bill');

const T = {
    admin_bill_issued: (v) => ({
        title: `Bill issued · ${v.shop}`, body: `${inv(v)}${v.amount !== undefined ? ` for ${rs(v.amount)}` : ''} was sent. The owner has been told.`, sms: `Bill issued: ${v.shop}`,
    }),
    admin_bill_paid: (v) => ({
        title: `Bill paid · ${v.shop}`, body: `${v.shop} paid ${inv(v)}${v.amount !== undefined ? ` (${rs(v.amount)})` : ''}. Nothing to do.`, sms: `Bill paid: ${v.shop}`,
    }),
    admin_shop_paused: (v) => ({
        title: `${v.shop} is paused`,
        body: `${inv(v)} is unpaid, so customers cannot order. Call the owner to get it paid.`,
        sms: `Shop paused: ${v.shop}`,
    }),
    admin_shop_unpaused: (v) => ({
        title: `${v.shop} is open again`, body: 'The bill is cleared. Customers can order again.', sms: `Shop open: ${v.shop}`,
    }),
    admin_grace_ending: (v) => ({
        title: `${v.shop}: grace ends ${v.graceDate || 'soon'}`,
        body: `${inv(v)} is still unpaid. New orders stop on ${v.graceDate || 'that day'}. A reminder call helps.`,
        sms: `Grace ending: ${v.shop}`,
    }),
    admin_free_ending: (v) => ({
        title: `${v.shop}: free period ending`, body: `${v.summary || 'The free period is almost over'}. Rent starts after it.`, sms: `Free ending: ${v.shop}`,
    }),
    admin_free_ended: (v) => ({
        title: `${v.shop}: rent starts now`, body: 'The free period is over. The first bill follows the usual cycle.', sms: `Free ended: ${v.shop}`,
    }),
    admin_sms_low: (v) => ({
        title: `${v.shop}: SMS balance low`, body: 'Ask the owner to top up soon, or customer login codes will stop.', sms: `SMS low: ${v.shop}`,
    }),
    admin_sms_zero: (v) => ({
        title: `${v.shop}: no SMS left`, body: 'Customers cannot log in until the owner tops up. Call the owner now.', sms: `SMS zero: ${v.shop}`,
    }),
    admin_sms_topup_done: (v) => ({
        title: `${v.shop} topped up${v.amount !== undefined ? ` ${rs(v.amount)}` : ''}`, body: 'The SMS balance is back. Customers can log in.', sms: `Top-up done: ${v.shop}`,
    }),
    admin_shop_first_order: (v) => ({
        title: `${v.shop} got its first order`, body: 'The shop is live and working. A good moment to say well done.', sms: `First order: ${v.shop}`,
    }),
    admin_shop_inactive: (v) => ({
        title: `${v.shop} is quiet`, body: `No orders for ${v.days || 14} days. Check if its menu, hours or delivery area need help.`, sms: `No orders: ${v.shop}`,
    }),
    admin_settlement_due: (v) => ({
        title: v.title || 'A payment arrived', body: v.body || '', sms: v.title || 'A payment arrived',
    }),
    admin_support_new: (v) => ({
        title: `Support #${v.number} · ${v.shop}`, body: v.subject ? `"${String(v.subject).slice(0, 90)}". Open it to reply.` : 'The shop needs help. Open it to reply.', sms: `Support: ${v.shop}`,
    }),
    admin_support_reply: (v) => ({
        title: `${v.shop} replied on #${v.number}`, body: v.subject ? `About "${String(v.subject).slice(0, 90)}". Open it to answer.` : 'The shop wrote again. Open it to answer.', sms: `Support reply: ${v.shop}`,
    }),
    admin_webhook_failed: (v) => ({
        title: `Payment webhook failed · ${v.shop}`, body: `${v.detail || 'A payment could not be processed'}. The money may not be marked paid. Check Payments.`, sms: `Webhook failed: ${v.shop}`,
    }),
    admin_sms_provider_failing: (v) => ({
        title: 'SMS provider is failing', body: `${v.detail || 'Sending keeps failing'}. Login codes may not reach customers. Check the provider.`, sms: 'SMS provider failing',
    }),
    admin_refund_failed: (v) => ({
        title: `Refund failed · ${v.shop}`, body: `Order #${v.orderNo || ''}: the customer's refund did not go through. Retry it from Payments.`, sms: `Refund failed: ${v.shop}`,
    }),
};

// returns { title, body, sms } or null for an unknown alert
function build(eventKey, vars = {}) {
    const t = T[eventKey];
    if (!t) return null;
    const out = t(vars);
    const body = String(out.body || '');
    return { ...out, body: body.charAt(0).toUpperCase() + body.slice(1), sms: String(out.sms).slice(0, 30) };
}

module.exports = { build, TEXTS: T };
