// The SMS texts. Every one must be REGISTERED and approved on DLT before real SMS works.
// {#var#} is the DLT variable. The order of `vars` is the order of the {#var#} in the text.
// Rule: change a text here AND on DLT, or the SMS is blocked.
const TEMPLATES = {
    order_new: {
        purpose: 'order', vars: ['orderNo', 'total', 'shop'],
        text: 'New order #{#var#} (Rs {#var#}) at {#var#}. Please open the app to accept it.',
    },
    order_accepted: {
        purpose: 'order', vars: ['orderNo', 'shop'],
        text: 'Your order #{#var#} from {#var#} was accepted.',
    },
    order_out_for_delivery: {
        purpose: 'order', vars: ['orderNo', 'shop'],
        text: 'Your order #{#var#} from {#var#} is on the way.',
    },
    order_delivered: {
        purpose: 'order', vars: ['orderNo', 'shop'],
        text: 'Your order #{#var#} from {#var#} was delivered. Thank you!',
    },
    order_cancelled: {
        purpose: 'order', vars: ['orderNo', 'shop'],
        text: 'Your order #{#var#} from {#var#} was cancelled.',
    },
    order_unaccepted_reminder: {
        purpose: 'order', vars: ['orderNo', 'shop'],
        text: 'Order #{#var#} at {#var#} is still waiting to be accepted. Please open the app now.',
    },
    bill_issued: {
        purpose: 'alert', vars: ['invoiceNo', 'amount', 'shop', 'date'],
        text: 'New bill {#var#} of Rs {#var#} for {#var#}. Please pay by {#var#} to keep taking orders.',
    },
    delivery_pin: {
        purpose: 'order', vars: ['orderNo', 'pin', 'shop'],
        text: 'Your delivery PIN for order #{#var#} is {#var#}. Tell it to the delivery partner at your door. {#var#}',
    },
    rider_sos: {
        purpose: 'alert', vars: ['riderName', 'phone'],
        text: 'Rider {#var#} pressed the help button. Call him now on {#var#}.',
    },
    bill_overdue: {
        purpose: 'alert', vars: ['amount', 'shop'],
        text: 'Rs {#var#} is overdue for {#var#}. Pay now in the app to stop the late fee from growing.',
    },
    shop_paused: {
        purpose: 'alert', vars: ['shop'],
        text: 'Your shop {#var#} is paused because a bill is unpaid. Pay now to start taking orders again.',
    },
};

// the customer status messages share one event ("order_status"): pick the text by the status
const keyFor = (eventKey, vars) => (eventKey === 'order_status' ? `order_${vars.status}` : eventKey);

function build(eventKey, vars = {}) {
    const key = keyFor(eventKey, vars);
    const t = TEMPLATES[key];
    if (!t) return null;
    let i = 0;
    const text = t.text.replace(/\{#var#\}/g, () => String(vars[t.vars[i++]] ?? '').slice(0, 30));
    return { key, purpose: t.purpose, text, templateId: process.env[`DLT_TEMPLATE_${key.toUpperCase()}`] || null };
}

module.exports = { TEMPLATES, build };