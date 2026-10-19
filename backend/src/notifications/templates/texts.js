// The words of every in-app message and push. Change the wording of a message HERE only.
const PROBLEM = {
    cannot_reach: 'cannot reach the customer',
    customer_not_answering: 'customer is not answering',
    wrong_address: 'says the address looks wrong',
    other: 'reported a problem',
    released: 'cannot do this delivery any more and gave the order back',
};

// what is in the order, for the second line: "2× Butter Naan, Paneer Butter Masala +1 more · ₹540"
const about = (v) => [v.brief, v.total ? `₹${Math.round(v.total)}` : ''].filter(Boolean).join(' · ');

function statusText(v) {
    const no = v.orderNo;
    const a = about(v);
    switch (v.status) {
        case 'accepted': return { title: `Order #${no} accepted`, body: a ? `${a}. The shop is getting started.` : 'The shop is getting started.' };
        case 'preparing': return { title: 'Being prepared', body: v.brief ? `${v.brief} is on the stove.` : `Your order #${no} is on the stove.` };
        case 'ready':
            return v.orderType === 'pickup'
                ? { title: 'Ready for pickup', body: v.brief ? `${v.brief} is packed. Come and collect it.` : `Your order #${no} is ready for pickup.` }
                : { title: 'Order is ready', body: v.brief ? `${v.brief} is packed and waiting for the delivery partner.` : `Your order #${no} is ready.` };
        case 'out_for_delivery': return { title: 'On the way', body: v.brief ? `${v.brief} is on its way to you. Keep your phone close.` : `Your order #${no} is on the way.` };
        case 'delivered': return { title: 'Delivered. Enjoy!', body: `${v.brief || `Order #${no}`} has reached you. Hungry again? Order anytime.` };
        case 'undelivered':
            return {
                title: 'Order not delivered',
                body: v.reasonCode === 'customer'
                    ? `Order #${no}${v.brief ? ` (${v.brief})` : ''}: the delivery partner could not reach you.`
                    : `Order #${no}${v.brief ? ` (${v.brief})` : ''} could not be delivered. Sorry! Paid online? You get a full refund.`,
            };
        case 'cancelled':
            return { title: `Order #${no} cancelled`, body: `${v.brief ? `${v.brief}. ` : ''}${v.cancelReason ? `Reason: ${v.cancelReason}` : 'If you paid online, the refund is on its way.'}` };
        default: return null;
    }
}

const TEXTS = {
    order_new: (v) => ({
        title: `New order #${v.orderNo}${v.total ? ` · ₹${Math.round(v.total)}` : ''}`,
        body: [v.brief, v.orderType === 'pickup' ? 'Pickup' : v.orderType === 'dine_in' ? 'Dine-in' : 'Delivery', v.pay].filter(Boolean).join(' · '),
    }),
    order_status: statusText,
    order_unaccepted_reminder: (v) => ({
        title: v.minutes >= 6 ? 'Please accept the order' : 'Order is waiting',
        body: `${v.brief ? `${v.brief} (#${v.orderNo}). ` : `Order #${v.orderNo}. `}Accept within ${v.left} min or it is cancelled.`,
    }),
    order_cancelled: (v) => ({
        title: v.undelivered ? 'Order not delivered' : 'Order cancelled',
        body: v.audience === 'rider'
            ? (v.undelivered ? `Order #${v.orderNo} was marked as not delivered.` : `Order #${v.orderNo} was cancelled${v.lateDelivery ? ' because it was more than an hour late' : ''}.`)
            : v.byRider
                ? `Order #${v.orderNo} was cancelled by the delivery partner${v.reason ? `: ${v.reason}` : ''}.`
                : v.lateDelivery
                    ? `Order #${v.orderNo} was cancelled: the delivery was more than an hour late. The customer is refunded in full.`
                    : `Order #${v.orderNo} was cancelled${v.bySystem ? ' (not accepted in time)' : ' by the customer'}.`,
    }),
    delivery_late_warning: (v) => ({ title: 'Delivery is very late', body: `Order #${v.orderNo} is ${v.late} min late. It is cancelled and fully refunded in ${v.left} min if it is not delivered.` }),
    delivery_late_warning_rider: (v) => ({ title: `Order #${v.orderNo} is ${v.late} min late`, body: `Deliver it now. It is cancelled in ${v.left} min if it is not delivered.` }),
    order_delivered_shop: (v) => ({ title: `Delivered #${v.orderNo}`, body: `${v.brief ? `${v.brief}${v.total ? ` · ₹${Math.round(v.total)}` : ''}. ` : ''}Reached the customer.` }),
    delivery_done_rider: (v) => ({ title: 'Delivery complete', body: `Order #${v.orderNo}${v.brief ? ` (${v.brief})` : ''} is done. Great work, thank you!` }),
    rider_offer: (v) => ({
        title: 'New delivery request',
        body: [v.brief || `Order #${v.orderNo}`, v.area, v.collect ? `Collect ₹${v.collect}` : v.items ? `${v.items} item${v.items > 1 ? 's' : ''}` : '', `accept in ${v.secs}s`].filter(Boolean).join(' · '),
    }),
    rider_assigned: (v) => ({ title: 'Delivery partner assigned', body: `${v.riderName} will deliver your order #${v.orderNo}.` }),
    rider_arrived_shop: (v) => ({ title: 'Delivery partner has arrived', body: `${v.riderName} reached the customer for order #${v.orderNo}.` }),
    rider_accepted: (v) => ({ title: 'Rider accepted', body: `${v.riderName} accepted order #${v.orderNo}.` }),
    rider_rejected: (v) => ({ title: 'Rider said no', body: `${v.riderName} rejected order #${v.orderNo ?? ''}.` }),
    rider_none: (v) => ({ title: 'No rider available', body: `Order #${v.orderNo} needs a rider. Please assign one by hand.` }),
    rider_removed: (v) => ({ title: 'Order taken back', body: `Order #${v.orderNo} was given to another delivery partner. You do not need to do anything.` }),
    rider_off_duty: () => ({ title: 'You are off duty', body: 'You will not get new orders until you go on duty again.' }),
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