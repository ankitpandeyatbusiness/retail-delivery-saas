// Which status can follow which. Delivery orders go out for delivery; pickup and dine-in orders become "ready".
const FLOWS = {
    delivery: ['placed', 'accepted', 'preparing', 'out_for_delivery', 'delivered'],
    other: ['placed', 'accepted', 'preparing', 'ready', 'delivered'],
};

const ACTIVE_STATUSES = ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery'];
const SHOP_CAN_CANCEL_FROM = ['placed', 'accepted', 'preparing'];

// What the SHOP may do next: one step forward, or cancel (until it leaves the kitchen)
function nextStatuses(order) {
    const flow = order.orderType === 'delivery' ? FLOWS.delivery : FLOWS.other;     
    const i = flow.indexOf(order.status);
    if (i < 0 || i === flow.length - 1) return [];            // delivered / cancelled are final
    const next = [flow[i + 1]];
    if (SHOP_CAN_CANCEL_FROM.includes(order.status)) next.push('cancelled');
    return next;
}

// The customer can only cancel before the shop accepts
const customerCanCancel = (order) => order.status === 'placed';

module.exports = { nextStatuses, customerCanCancel, ACTIVE_STATUSES };