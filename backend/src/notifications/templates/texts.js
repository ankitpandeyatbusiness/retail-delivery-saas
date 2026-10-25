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
            if (v.orderType === 'dine_in') return { title: 'Coming to your table', body: `${v.brief ? `${v.brief} is ready` : `Your order #${no} is ready`} and on its way to table ${v.tableNo || ''}. Enjoy your meal!`.replace('table  ', 'your table ') };
            return v.orderType === 'pickup'
                ? { title: 'Ready for pickup', body: `${v.brief ? `${v.brief} is packed. Come and collect it.` : `Your order #${no} is ready for pickup.`}${v.pickupCode ? ` Your pickup code: ${v.pickupCode}.` : ''}` }
                : { title: 'Order is ready', body: v.brief ? `${v.brief} is packed and waiting for the delivery partner.` : `Your order #${no} is ready.` };
        case 'out_for_delivery': return { title: 'On the way', body: v.brief ? `${v.brief} is on its way to you. Keep your phone close.` : `Your order #${no} is on the way.` };
        case 'delivered': if (v.orderType === 'dine_in') return { title: 'Served. Enjoy your meal!', body: `${v.brief || `Order #${no}`} is at your table. Ask us for anything else.` };
            return { title: 'Delivered. Enjoy!', body: `${v.brief || `Order #${no}`} has reached you. Hungry again? Order anytime.` };
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

// where a bill is from: a table number, or an unpaid pickup (kept as 'Pickup #1234')
const at = (t) => (/^\d+$/.test(String(t)) ? `Table ${t}` : String(t));

const TEXTS = {
    order_new: (v) => ({
        title: `New order #${v.orderNo}${v.total ? ` · ₹${Math.round(v.total)}` : ''}`,
        body: [v.brief, v.orderType === 'pickup' ? 'Pickup' : v.orderType === 'dine_in' ? `Dine-in${v.tableNo ? ` · Table ${v.tableNo}` : ''}` : 'Delivery', v.pay, v.auto ? 'Auto accepted' : ''].filter(Boolean).join(' · '),
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
        body: [v.brief || `Order #${v.orderNo}`, v.area, v.collect ? `Collect ₹${v.collect}` : v.items ? `${v.items} item${v.items > 1 ? 's' : ''}` : '', `accept in ${v.secs}s`, v.note ? `Customer says: ${v.note}` : ''].filter(Boolean).join(' · '),
    }),
    rider_assigned_owner: (v) => ({ title: `The owner gave you order #${v.orderNo}`, body: `${v.brief ? `${v.brief}. ` : ''}Deliver it to ${v.address || 'the customer'}.${v.note ? ` Customer says: ${v.note}` : ''}` }),
    rider_assigned: (v) => ({ title: 'Delivery partner assigned', body: `${v.riderName} will deliver your order #${v.orderNo}.` }),
    points_arrived: (v) => ({ title: `${v.points} points added`, body: `Your balance is ${v.balance} points. Use them to get money off your next order.` }),
    rider_badge: (v) => ({ title: `You are now ${String(v.badge).charAt(0).toUpperCase()}${String(v.badge).slice(1)}!`, body: 'Customers and the shop can see your new badge. Keep up the good work.' }),
    table_share_ask: (v) => ({ title: `${v.name} wants to pay and leave`, body: `Table ${v.table}${v.label ? ` · ${v.label}` : ''}. Their share: ₹${v.amount}.` }),
    table_share_paid: (v) => ({ title: `${v.name} paid and left`, body: v.left > 0 ? `Your bill at table ${v.table} is ₹${v.left}.` : `Everything at table ${v.table} is paid.` }),
    table_share_left: (v) => ({ title: `${v.name} left`, body: `Your bill at table ${v.table} is now ₹${v.left}. The shop will sort out ${v.name}'s share with them.` }),
    table_guest_alert: (v) => ({
        title: v.state === 'location_off' ? `${v.name}'s location is off` : `${v.name}'s phone is not reachable`,
        body: `Table ${v.table}${v.label ? ` · ${v.label}` : ''}. Their share is ₹${v.amount}. Keep an eye on the table.`,
    }),
    table_join_request: (v) => ({ title: `${v.name} wants to join your table`, body: `At table ${v.table}. Are you together? Say yes to put them on your bill.` }),
    table_join_answer: (v) => (v.approved ? { title: 'You joined the table', body: `You are on the bill at table ${v.table}.` } : { title: 'They said no', body: `Choose your own bill at table ${v.table}.` }),
    staff_leave_request: (v) => ({ title: `${v.name || 'Your staff'} asks for leave`, body: `${v.job ? `${v.job}: ` : ''}${v.from === v.to ? v.from : `${v.from} to ${v.to}`} (${v.days} ${v.days === 1 ? 'day' : 'days'}). Reason: ${v.reason}` }),
    staff_leave_decision: (v) => ({ title: v.approved ? 'Your leave is approved' : 'Your leave was not approved', body: `${v.from === v.to ? v.from : `${v.from} to ${v.to}`}.${v.note ? ` Shop: ${v.note}` : ''}` }),
    staff_leave_withdrawn: (v) => ({ title: `${v.name || 'Your staff'} took ${v.what || 'their leave'} back`, body: `${v.job ? `${v.job}: ` : ''}${v.from === v.to ? v.from : `${v.from} to ${v.to}`}${v.days ? ` (${v.days} ${v.days === 1 ? 'day' : 'days'})` : ''} ${v.wasApproved ? 'was approved' : 'was not decided yet'}. They are on duty on ${v.days === 1 ? 'that day' : 'those days'}.` }),
    staff_holiday: (v) => ({ title: `${v.name || 'Your staff'} will be off`, body: `${v.job ? `${v.job}: ` : ''}${v.from === v.to ? v.from : `${v.from} to ${v.to}`}${v.note ? ` (${v.note})` : ''}.` }),
    pickup_intent: (v) => {
        const who = v.name || 'The customer';
        const what = v.brief || 'the order';
        const at = v.time ? ` Pickup time: ${v.time}.` : '';
        if (v.kind === 'on_time') return { title: `Order #${v.orderNo}: customer will be on time`, body: `${who} says they will be there on time for ${what}.${at}` };
        if (v.kind === 'arrived') return { title: `Order #${v.orderNo}: customer is here`, body: `${who} is at the shop for ${what}. Check the pickup code and hand it over.${at}` };
        if (v.kind === 'late') return { title: `Order #${v.orderNo}: customer is late`, body: `${who} says: on my way, sorry for the delay.${at}` };
        if (v.kind === 'more_time') return { title: `Order #${v.orderNo}: needs more time`, body: `${who} needs a little more time for ${what}. Please keep it warm if you can.${at}` };
        return { title: `Order #${v.orderNo}: customer is coming`, body: `${who} is on the way to collect ${what}.${at}` };
    },
    pickup_waiting: (v) => ({ title: v.over ? 'Your food is still waiting' : 'Your food is waiting', body: `${v.brief ? `${v.brief} (#${v.orderNo})` : `Order #${v.orderNo}`} ${v.over ? 'was ready for your pickup time, which is over. Please come soon, before it gets cold.' : `is ready. Please collect it by ${v.until}.`}${v.pickupCode ? ` Pickup code: ${v.pickupCode}.` : ''}` }),
    pickup_collect_claim: (v) => ({ title: `Order #${v.orderNo}: collected?`, body: `${v.name || 'A customer'} says they collected ${v.brief || 'their order'}.${v.cod ? ` It is a cash order of ₹${Math.round(v.total)}: please confirm and say if they paid.` : ' Please confirm.'}` }),
    pickup_not_wanted_claim: (v) => ({ title: `Order #${v.orderNo}: not wanted`, body: `${v.name || 'A customer'} does not want ${v.brief || 'their order'} (₹${Math.round(v.total)}, ${v.cod ? 'cash' : 'paid online'}). Choose how much to refund.` }),
    pickup_thanks: (v) => ({ title: 'Thank you!', body: `Thank you for collecting order #${v.orderNo}. We hope you enjoy it. Come again soon!${v.message ? ` ${v.message}` : ''}` }),
    pickup_claim_no: (v) => ({ title: 'We could not find it as collected', body: `The shop could not confirm that order #${v.orderNo} was collected. Please come to the shop or call them.${v.message ? ` The shop says: “${v.message}”.` : ''} Thank you for understanding.` }),
    food_packed_rider: (v) => ({ title: `Order #${v.orderNo} is packed`, body: `${v.brief ? `${v.brief}. ` : ''}It is ready for you to collect.` }),
    order_shop_note: (v) => ({ title: `Your order #${v.orderNo}`, body: v.text }),
    staff_leave_removed: (v) => ({ title: 'Your days off were changed', body: `The owner removed your ${v.from === v.to ? v.from : `${v.from} to ${v.to}`} day${v.days === 1 ? '' : 's'} off. You are on duty on ${v.days === 1 ? 'that day' : 'those days'}.${v.note ? ` The owner says: “${v.note}”.` : ''}` }),
    staff_off_duty: (v) => ({ title: `${v.name || 'Staff'} is off duty`, body: `${v.name || 'Someone'} (${v.job || 'staff'}) switched off duty${v.on ? ' and is not taking alerts' : ''}.` }),
    order_undone: (v) => ({ title: `Order #${v.orderNo}: step taken back`, body: `${v.by || 'Someone'} undid "${v.step}".` }),
    kitchen_problem: (v) => ({ title: `Kitchen: order #${v.orderNo}`, body: `${v.name || 'The cook'} says: ${v.what}${v.note ? ` (${v.note})` : ''}. Please decide what to do.` }),
    order_cancel_request: (v) => ({ title: `${v.where || 'Table'}: cancel order #${v.orderNo}?`, body: `${v.name || 'A guest'} asks to cancel ${v.brief || 'their order'}${v.note ? `: “${v.note}”` : ''}. It is already being made. Please say yes or no.` }),
    order_cancel_no: (v) => ({ title: 'We could not cancel it', body: `Sorry, order #${v.orderNo} is already being made, so the shop could not cancel it.${v.message ? ` The shop says: “${v.message}”.` : ''} Thank you for understanding.` }),
    pickup_time_request: (v) => ({ title: `Order #${v.orderNo}: change pickup time?`, body: `${v.name ? `${v.name} ` : 'A customer '}asks to move the pickup${v.brief ? ` of ${v.brief}` : ''} from ${v.was} to ${v.asked}.${v.overdue ? ' Their pickup time is already over.' : ''} Please say yes or no.` }),
    pickup_time_ok: (v) => ({ title: 'Pickup time changed', body: `Good news. The shop has moved your order #${v.orderNo} to ${v.now}.${v.message ? ` The shop says: “${v.message}”.` : ''} See you then!` }),
    pickup_time_no: (v) => ({ title: 'Pickup time stays the same', body: `Sorry, the shop could not move your order #${v.orderNo} to ${v.asked}. Please collect it at ${v.was} as planned.${v.message ? ` The shop says: “${v.message}”.` : ''} Thank you for understanding.` }),
    pickup_no_show: (v) => ({ title: `Order #${v.orderNo} was not collected`, body: `${v.brief ? `${v.brief}. ` : ''}The pickup time ended at ${v.until} and the customer has not come. Call him, or mark it as not collected.` }),
    table_bill_asked: (v) => ({ title: `Table ${v.table} asked for the bill`, body: `${v.due > 0 ? `₹${Math.round(v.due)} to collect` : `₹${Math.round(v.total)} (already paid)`}. Please bring the bill or take the payment at the counter.` }),
    table_paid_claim: (v) => ({ title: `${v.name || 'A customer'} says they paid ₹${Math.round(v.amount)}`, body: `${at(v.table)} bill that was left unpaid. Please check and confirm.` }),
    owed_cleared: (v) => (v.forgiven
        ? { title: 'Your bill is cleared', body: `The shop has cleared your ₹${Math.round(v.amount)} bill from ${at(v.table).toLowerCase()}. You can order again. Thank you!` }
        : v.claimed
        ? { title: 'Sorry for the reminder', body: `Thank you, your ₹${Math.round(v.amount)} bill from ${at(v.table).toLowerCase()} is settled. We are sorry we reminded you by mistake.${v.message ? ` ${v.message}` : ''}` }
        : { title: 'Your bill is settled', body: `Your ₹${Math.round(v.amount)} bill from ${at(v.table).toLowerCase()} is paid. Thank you! You can order again.${v.message ? ` ${v.message}` : ''}` }),
    owed_claim_rejected: (v) => ({ title: 'The shop could not find your payment', body: `${v.message ? `${v.message} ` : ''}Your ₹${Math.round(v.amount)} bill from ${at(v.table).toLowerCase()} is still open. Please call the shop to sort it out.` }),
    owed_reminder: (v) => ({ title: `Your ₹${Math.round(v.amount)} bill is still unpaid`, body: `${at(v.table)}. Tap to see the bill and pay it. Until it is paid you cannot place any order.` }),
    referral_reward: (v) => ({ title: `You earned ${v.points} points`, body: `${v.friend} enjoyed a first meal here because of you. Your points arrive in a day. Thank you for spreading the word!` }),
    table_call: (v) => ({ title: `Table ${v.table}: ${v.label}`, body: `${v.text ? `“${v.text}”. ` : ''}A guest is asking for you at table ${v.table}.` }),
    table_feedback_low: (v) => ({ title: `Table ${v.table} was not happy (${v.stars}/5)`, body: `${v.comment ? `“${v.comment}”. ` : ''}Their private feedback is in Dine in, Guest feedback.` }),
    table_nudge: (v) => ({ title: `Table ${v.table} is waiting`, body: `Please bring the food fast${v.minutes ? ` (ordered ${v.minutes} min ago)` : ''}.${v.what ? ` ${v.what}` : ''}` }),
    table_paid_owner: (v) => ({ title: `Table ${v.table}: bill paid`, body: `₹${Math.round(v.paid || v.total || 0)} by ${v.via || 'cash'}. Received by ${v.by || 'a waiter'}.` }),
    table_bill_waiting: (v) => ({ title: `Table ${v.table} is still waiting for the bill`, body: `They asked ${v.minutes} minutes ago. Please bring the bill or take the payment.` }),
    table_ready_unserved: (v) => ({ title: `Table ${v.table}: food ready, not served`, body: `${v.brief ? `${v.brief} has` : 'An order has'} been ready for ${v.minutes} minutes and nobody has served it.` }),
    table_check: (v) => ({ title: `Table ${v.table}: ₹${Math.round(v.due)} to collect`, body: `They finished eating ${v.minutes} minutes ago and nobody asked for the bill. Please check the table and take the ₹${Math.round(v.due)}.` }),
    table_walkout: (v) => ({ title: 'Your bill is still open', body: `${at(v.table)}: ₹${v.amount} was not paid before you left. Please pay it, or call the shop to sort it out. Until it is paid you cannot place any order.` }),
    table_paid: (v) => ({ title: 'Thank you! Bill paid', body: `Table ${v.table} · ₹${Math.round(v.total)}. We hope you enjoyed it. Your points are on the way. Come again soon!` }),
    rider_leave_request: (v) => ({ title: `${v.riderName} asks for leave`, body: `${v.from === v.to ? v.from : `${v.from} to ${v.to}`} (${v.days} day${v.days > 1 ? 's' : ''}). ${v.reason ? `"${v.reason}" ` : ''}Open Riders to approve or reject.` }),
    rider_leave_decision: (v) => ({ title: v.approved ? 'Leave approved' : 'Leave not approved', body: `${v.from === v.to ? v.from : `${v.from} to ${v.to}`}${v.note ? `: ${v.note}` : v.approved ? '. Enjoy your break.' : '. Please talk to the shop if you need those days.'}` }),
    rider_duty_auto: (v) => ({ title: v.on ? 'You are on duty' : 'Your duty has ended', body: v.on ? 'Your duty time has started, so you are on duty now. New orders can reach you.' : (v.why === 'leave' ? 'You are on leave today, so you were put off duty.' : 'Your duty time is over, so you were put off duty. See you next time.') }),
    rider_arrived_shop: (v) => ({ title: 'Delivery partner has arrived', body: `${v.riderName} reached the customer for order #${v.orderNo}.` }),
    rider_accepted: (v) => ({ title: 'Rider accepted', body: `${v.riderName} accepted order #${v.orderNo}.` }),
    rider_rejected: (v) => ({ title: 'Rider said no', body: `${v.riderName} rejected order #${v.orderNo ?? ''}.` }),
    delivery_pin_skipped: (v) => ({ title: `Order #${v.orderNo} delivered without the PIN`, body: `${v.riderName || 'The rider'}: ${v.reason}.${v.note ? ` "${v.note}"` : ''} The photo of the handover is on the order.` }),
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