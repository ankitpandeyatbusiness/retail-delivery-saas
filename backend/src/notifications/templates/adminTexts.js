// The words of every alert to the superadmin. Change the wording HERE only.
// Each one says WHO (the shop in the title), WHAT happened, and what to do about it, in about two lines.
// sms = a very short text for the SMS (at most 30 characters, it is the one {#var#} of the DLT template).
const rs = (n) => (n === undefined || n === null || n === '' ? '' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);

const T = {
    admin_order_stuck: (v) => ({
        title: `Order #${v.orderNo} is stuck · ${v.shop}`,
        body: `${{ not_accepted: 'The shop has not accepted it', not_started: 'Accepted but not started', slow_prep: 'Still being prepared', no_rider: 'Still has no rider', on_the_way_long: 'Still on the way' }[v.stage] || 'Waiting'} for ${v.minutes} min. Open the order to step in.`,
    }),
    admin_daily_summary: (v) => ({
        title: v.orders ? `Yesterday: ${v.orders} order${v.orders === 1 ? '' : 's'}, ₹${Math.round(v.sales).toLocaleString('en-IN')}` : 'Yesterday: no orders',
        body: `${v.change === null || v.change === undefined ? (v.beforeOrders ? '' : 'Nothing the day before to compare. ') : (v.change === 0 ? 'Same as the day before. ' : (v.change > 0 ? 'Up ' : 'Down ') + Math.abs(v.change) + '% on the day before. ')}${v.attention ? v.attention + ' order' + (v.attention === 1 ? '' : 's') + ' need attention. ' : 'Nothing is stuck. '}${v.refunds ? v.refunds + ' refund' + (v.refunds === 1 ? '' : 's') + ' not finished. ' : ''}${v.collected ? 'Rent and top-ups collected: ₹' + Number(v.collected).toLocaleString('en-IN') + '. ' : ''}${v.overdue ? '₹' + Number(v.overdue).toLocaleString('en-IN') + ' rent overdue. ' : ''}${v.moneyBad ? v.moneyBad + ' money problem' + (v.moneyBad === 1 ? '' : 's') + ' to look at.' : ''}`.trim(),
    }),
    admin_sms_provider_low: (v) => ({
        title: 'SMS balance is getting low',
        body: `About ${v.amount} left at your SMS provider${v.estimate ? ' (an estimate)' : ''}. Add money before it reaches ${v.reserve}.`,
        sms: 'SMS balance low',
    }),
    admin_sms_provider_empty: (v) => ({
        title: 'SMS balance almost empty',
        body: `About ${v.amount} left at your SMS provider${v.estimate ? ' (an estimate)' : ''}. ${v.protectOtp ? 'Shop messages are paused so login OTPs keep working.' : 'Messages may start failing.'} Add money now.`,
        sms: 'SMS balance almost empty: add money',
    }),
    admin_plan_ending: (v) => ({ title: `${v.shop}: plan ending`, body: `${v.summary || 'The paid time is almost over'}. A reminder call helps.`, sms: `Plan ending: ${v.shop}` }),
    admin_plan_ended: (v) => ({ title: `${v.shop}: plan ended`, body: `${v.summary || 'The paid time is over'}. Grace days have started.`, sms: `Plan ended: ${v.shop}` }),
    admin_plan_changed: (v) => ({ title: `${v.shop}: plan changed`, body: v.summary || 'The plan was changed.', sms: `Plan changed: ${v.shop}` }),
    admin_plan_paused: (v) => ({ title: `${v.shop}: paused, plan not renewed`, body: 'The grace days are over. New orders have stopped until the plan is paid.', sms: `Paused (plan): ${v.shop}` }),
    admin_wallet_low: (v) => ({ title: `${v.shop}: wallet low`, body: v.summary || 'The Partner wallet is running low.', sms: `Wallet low: ${v.shop}` }),
    admin_wallet_empty: (v) => ({ title: `${v.shop}: wallet finished`, body: v.summary || 'The Partner wallet is finished. New orders stop when the overdraft is used up.', sms: `Wallet empty: ${v.shop}` }),
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
    admin_shop_close_due: (v) => ({
        title: `${v.shop} may need closing`, body: `Rent unpaid for ${v.months || 6} months (Rs ${v.amount}). Open Shops to close and decide. Nothing closes without your tap.`, sms: `May need closing: ${v.shop}`,
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
    admin_platform_red: (v) => ({
        title: `Platform: ${v.title || 'a problem'} is red${v.again ? ' again' : ''}`, body: `${v.detail || 'Open Platform health to see what is wrong.'}`, sms: `Platform red: ${v.title || ''}`,
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
