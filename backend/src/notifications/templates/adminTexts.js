// The words of every alert to the superadmin. Change the wording HERE only.
// sms = a very short text for the SMS (at most 30 characters, it is the one {#var#} of the DLT template).
const T = {
    admin_bill_issued: (v) => ({
        title: 'Bill issued', body: `${v.shop}: invoice ${v.invoiceNo || ''} of Rs ${v.amount ?? ''} was issued.`, sms: `Bill issued: ${v.shop}`,
    }),
    admin_bill_paid: (v) => ({
        title: 'Bill paid', body: `${v.shop} paid invoice ${v.invoiceNo || ''}.`, sms: `Bill paid: ${v.shop}`,
    }),
    admin_shop_paused: (v) => ({
        title: 'Shop paused',
        body: `${v.shop} is paused because ${v.invoiceNo ? `invoice ${v.invoiceNo}` : 'a bill'} is unpaid.`,
        sms: `Shop paused: ${v.shop}`,
    }),
    admin_shop_unpaused: (v) => ({
        title: 'Shop open again', body: `${v.shop} can take orders again.`, sms: `Shop open: ${v.shop}`,
    }),
    admin_grace_ending: (v) => ({
        title: 'Grace ending soon',
        body: `${v.shop}: invoice ${v.invoiceNo || ''} is unpaid. New orders stop on ${v.graceDate || 'soon'}.`,
        sms: `Grace ending: ${v.shop}`,
    }),
    admin_free_ending: (v) => ({
        title: 'Free period ending', body: `${v.shop}: ${v.summary || 'the free period is almost over'}.`, sms: `Free ending: ${v.shop}`,
    }),
    admin_free_ended: (v) => ({
        title: 'Free period ended', body: `${v.shop}: the free period ended. Rent applies from now.`, sms: `Free ended: ${v.shop}`,
    }),
    admin_sms_low: (v) => ({
        title: 'SMS balance low', body: `${v.shop} needs an SMS top-up soon.`, sms: `SMS low: ${v.shop}`,
    }),
    admin_sms_zero: (v) => ({
        title: 'SMS balance finished', body: `${v.shop} has no SMS balance. Customers cannot log in.`, sms: `SMS zero: ${v.shop}`,
    }),
    admin_sms_topup_done: (v) => ({
        title: 'SMS top-up done', body: `${v.shop} added Rs ${v.amount ?? ''} to the SMS balance.`, sms: `Top-up done: ${v.shop}`,
    }),
    admin_shop_first_order: (v) => ({
        title: 'First order', body: `${v.shop} got its first order.`, sms: `First order: ${v.shop}`,
    }),
    admin_shop_inactive: (v) => ({
        title: 'Shop is quiet', body: `${v.shop} had no order for ${v.days || 14} days.`, sms: `No orders: ${v.shop}`,
    }),
    admin_settlement_due: (v) => ({
        title: v.title || 'A payment arrived', body: v.body || '', sms: v.title || 'A payment arrived',
    }),
    admin_support_new: (v) => ({
        title: `Support request #${v.number}`, body: `${v.shop}: ${v.subject || 'needs help'}`, sms: `Support: ${v.shop}`,
    }),
    admin_support_reply: (v) => ({
        title: `Shop replied on #${v.number}`, body: `${v.shop} wrote again: ${v.subject || ''}`, sms: `Support reply: ${v.shop}`,
    }),
    admin_webhook_failed: (v) => ({
        title: 'Payment webhook failed', body: `${v.shop}: ${v.detail || 'a payment webhook could not be processed'}.`, sms: `Webhook failed: ${v.shop}`,
    }),
    admin_sms_provider_failing: (v) => ({
        title: 'SMS provider failing', body: `${v.detail || 'SMS sending fails again and again'}.`, sms: 'SMS provider failing',
    }),
    admin_refund_failed: (v) => ({
        title: 'Refund failed', body: `${v.shop}: the refund for order #${v.orderNo || ''} failed.`, sms: `Refund failed: ${v.shop}`,
    }),
};

// returns { title, body, sms } or null for an unknown alert
function build(eventKey, vars = {}) {
    const t = T[eventKey];
    if (!t) return null;
    const out = t(vars);
    return { ...out, sms: String(out.sms).slice(0, 30) };
}

module.exports = { build, TEXTS: T };