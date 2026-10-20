// Which status can follow which. Delivery orders go out for delivery; pickup and dine-in orders become "ready".
// Final statuses: delivered, cancelled, undelivered.
const FLOWS = {
    delivery: ['placed', 'accepted', 'preparing', 'out_for_delivery', 'delivered'],
    other: ['placed', 'accepted', 'preparing', 'ready', 'delivered'],
};

const ACTIVE_STATUSES = ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery'];
const SHOP_CAN_CANCEL_FROM = ACTIVE_STATUSES;
const COD_CUSTOMER_CAN_CANCEL_FROM = ['placed', 'accepted'];   // cash orders: free until the owner taps "preparing"
const UNDELIVERED_WAIT_MS = 15 * 60 * 1000;                     // after the FIRST rider problem

const isCod = (order) => !order.payment?.method || order.payment.method === 'cod';

// Suspended, in maintenance or blocked: customers must still be able to cancel without any cost
function shopFrozen(tenant) {
    if (!tenant) return false;
    const m = tenant.maintenance;
    const maintenance = !!m?.on && (!m.until || new Date(m.until) > new Date());
    return (!!tenant.status && tenant.status !== 'active') || !!tenant.ownerBlocked || maintenance;
}

// The owner may mark a delivery order "undelivered" only after the rider reported a problem AND 15 minutes passed since the first report
const NO_SHOW_WAIT_MS = 30 * 60 * 1000;   // pickup: after the customer's time window ended
function canMarkUndelivered(order, now = new Date()) {
    if (order.orderType === 'pickup') {
        if (order.status !== 'ready') return { ok: false, message: 'Only an order that is ready and waiting can be marked as not collected' };
        const end = order.pickupUntil ? new Date(order.pickupUntil).getTime() : null;
        const left = end ? end + NO_SHOW_WAIT_MS - now.getTime() : 1;
        if (left > 0) return { ok: false, minutesLeft: Math.ceil(left / 60000), message: 'You can mark it as not collected 30 minutes after the pickup time ends' };
        return { ok: true };
    }
    if (order.orderType !== 'delivery') return { ok: false, message: 'Only a delivery order can be marked as not delivered' };
    if (!ACTIVE_STATUSES.includes(order.status)) return { ok: false, message: `This order is already "${order.status}"` };
    const first = order.delivery?.problems?.[0];
    if (!first?.at) return { ok: false, message: 'The rider must report a delivery problem first' };
    const left = new Date(first.at).getTime() + UNDELIVERED_WAIT_MS - now.getTime();
    if (left > 0) {
        const minutesLeft = Math.ceil(left / 60000);
        return {
            ok: false, minutesLeft,
            message: `Please wait ${minutesLeft} more minute(s). An order can be marked as not delivered 15 minutes after the first delivery problem.`,
        };
    }
    return { ok: true };
}

// What the SHOP may do next: one step forward, cancel (until it is finished), or "undelivered" when the rule above allows it
function nextStatuses(order, now = new Date()) {
    const flow = order.orderType === 'delivery' ? FLOWS.delivery : FLOWS.other;
    const i = flow.indexOf(order.status);
    if (i < 0 || i === flow.length - 1) return [];            // delivered / cancelled / undelivered are final
    const next = [flow[i + 1]];
    if (SHOP_CAN_CANCEL_FROM.includes(order.status)) next.push('cancelled');
    if (canMarkUndelivered(order, now).ok) next.push('undelivered');
    return next;
}

// Cash orders: only while placed or accepted. Online orders: any active status (the refund share depends on the step).
// ESCAPE HATCH: if the shop is frozen the customer can always cancel an active order, free of cost.
const customerCanCancel = (order, tenant) => {
    // a guest at a table may cancel a round by himself for the first few minutes (the owner's setting): ordered by mistake
    if (order.orderType === 'dine_in' && ['placed', 'accepted', 'preparing'].includes(order.status)) {
        const { DEFAULTS } = require('./tenantConfigService');
        const grace = tenant?.settings?.orders?.dineIn?.cancelGraceMin ?? DEFAULTS.orders.dineIn.cancelGraceMin;
        if (grace > 0 && Date.now() - new Date(order.createdAt).getTime() <= grace * 60000) return true;
    }
    const allowed = isCod(order) ? COD_CUSTOMER_CAN_CANCEL_FROM : ACTIVE_STATUSES;
    if (allowed.includes(order.status)) return true;
    return !!tenant && ACTIVE_STATUSES.includes(order.status) && shopFrozen(tenant);
};

module.exports = {
    nextStatuses, customerCanCancel, canMarkUndelivered, shopFrozen, ACTIVE_STATUSES, UNDELIVERED_WAIT_MS, NO_SHOW_WAIT_MS,
};