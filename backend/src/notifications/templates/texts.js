// The words of every in-app message and push. Change the wording of a message HERE only.
const PROBLEM = {
    cannot_reach: 'cannot reach the customer',
    customer_not_answering: 'customer is not answering',
    wrong_address: 'says the address looks wrong',
    other: 'reported a problem',
    released: 'cannot do this delivery any more and gave the order back',
};

function statusText(v) {
    const no = v.orderNo;
    switch (v.status) {
        case 'accepted': return { title: 'Order accepted', body: `The shop accepted your order #${no}.` };
        case 'preparing': return { title: 'Being prepared', body: `Your order #${no} is being prepared.` };
        case 'ready':
            return v.orderType === 'pickup'
                ? { title: 'Ready for pickup', body: `Your order #${no} is ready for pickup.` }
                : { title: 'Order ready', body: `Your order #${no} is ready.` };
        case 'out_for_delivery': return { title: 'On the way', body: `Your order #${no} is on the way.` };
        case 'delivered': return { title: 'Delivered', body: `Your order #${no} was delivered. Enjoy!` };
        case 'undelivered':
            return {
                title: 'Order not delivered',
                body: v.reasonCode === 'customer'
                    ? `We could not deliver your order #${no} because the delivery partner could not reach you.`
                    : `We could not deliver your order #${no}. We are sorry. If you paid online you get a full refund.`,
            };
        case 'cancelled':
            return { title: 'Order cancelled', body: `Your order #${no} was cancelled.${v.cancelReason ? ` Reason: ${v.cancelReason}` : ''}` };
        default: return null;
    }
}

const TEXTS = {
    order_new: (v) => ({
        title: 'New order',
        body: `Order #${v.orderNo} - Rs ${v.total ?? ''} - ${String(v.orderType || '').replace('_', '-')}`,
    }),
    order_status: statusText,
    order_unaccepted_reminder: (v) => ({
        title: v.minutes >= 6 ? 'Please accept the order' : 'Order is waiting',
        body: `Order #${v.orderNo} is waiting for you. It will be cancelled in ${v.left} minutes if you do not accept it.`,
    }),
    order_cancelled: (v) => ({
        title: v.undelivered ? 'Order not delivered' : 'Order cancelled',
        body: v.audience === 'rider'
            ? (v.undelivered ? `Order #${v.orderNo} was marked as not delivered.` : `Order #${v.orderNo} was cancelled.`)
            : `Order #${v.orderNo} was cancelled${v.bySystem ? ' (not accepted in time)' : ' by the customer'}.`,
    }),
    rider_offer: (v) => ({
        title: 'New delivery request',
        body: `Order #${v.orderNo}${v.items ? ` (${v.items} item${v.items > 1 ? 's' : ''}${v.collect ? `, collect Rs ${v.collect}` : ''})` : ''}. Please accept within ${v.secs} seconds.`,
    }),
    rider_assigned: (v) => ({ title: 'Delivery partner assigned', body: `${v.riderName} will deliver your order #${v.orderNo}.` }),
    rider_accepted: (v) => ({ title: 'Rider accepted', body: `${v.riderName} accepted order #${v.orderNo}.` }),
    rider_rejected: (v) => ({ title: 'Rider said no', body: `${v.riderName} rejected order #${v.orderNo ?? ''}.` }),
    rider_none: (v) => ({ title: 'No rider available', body: `Order #${v.orderNo} needs a rider. Please assign one by hand.` }),
    rider_removed: (v) => ({ title: 'Order taken back', body: `Order #${v.orderNo} was given to someone else.` }),
    rider_off_duty: () => ({ title: 'You are off duty', body: 'You were put off duty.' }),
    rider_sos: (v) => ({ title: 'Rider needs help', body: `${v.riderName} pressed the help button${v.orderNo ? ` (order #${v.orderNo})` : ''}. Call him now: ${v.phone}.` }),
    rider_problem: (v) => ({
        title: 'Delivery problem',
        body: `${v.riderName} ${PROBLEM[v.reason] || 'reported a problem'} (order #${v.orderNo}).${v.note ? ` Note: ${v.note}` : ''}`,
    }),
    delivery_low_rating: (v) => ({
        title: 'Low delivery rating',
        body: `Order #${v.orderNo}: ${v.rating} star(s) for ${v.riderName}.${v.comment ? ` "${String(v.comment).slice(0, 100)}"` : ''}`,
    }),
};

// returns { title, body }, or null if this event has no built-in text
const build = (eventKey, vars = {}) => (TEXTS[eventKey] ? TEXTS[eventKey](vars) : null);

module.exports = { build, TEXTS };