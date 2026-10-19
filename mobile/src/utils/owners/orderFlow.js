// What the owner's order screens say and offer, in one place. No screens, no network: plain functions.
// The SERVER decides which steps are allowed (order.allowedNext, from backend services/orderflow.js); this file only
// names them. An order the server would refuse a step for never shows that button.

export const STATUS = {
    placed: { label: 'New', tone: 'warn' },
    accepted: { label: 'Accepted', tone: 'info' },
    preparing: { label: 'Preparing', tone: 'info' },
    ready: { label: 'Ready', tone: 'ok' },
    out_for_delivery: { label: 'On the road', tone: 'info' },
    delivered: { label: 'Delivered', tone: 'ok' },
    cancelled: { label: 'Cancelled', tone: 'bad' },
    undelivered: { label: 'Not delivered', tone: 'bad' },
};
export const statusLabel = (s) => STATUS[s]?.label || String(s || '').replace(/_/g, ' ');
export const statusTone = (s) => STATUS[s]?.tone || 'info';
export const isFinal = (s) => ['delivered', 'cancelled', 'undelivered'].includes(s);

// the button for moving an order one step forward
export function stepLabel(order, next) {
    if (next === 'accepted') return 'Accept';
    if (next === 'preparing') return 'Start preparing';
    if (next === 'ready') return 'Mark ready';
    if (next === 'out_for_delivery') return 'Out for delivery';
    if (next === 'delivered') {
        if (order?.orderType === 'pickup') return 'Handed over';
        if (order?.orderType === 'dine_in') return 'Served';
        return 'Mark delivered';
    }
    return statusLabel(next);
}

// the one step forward the server allows (never cancel or "not delivered")
export const forwardStep = (order) => (order?.allowedNext || []).find((s) => s !== 'cancelled' && s !== 'undelivered') || null;
// a delivery order cannot go out until a delivery partner is assigned (the server refuses too)
export const needsRider = (order, next) => next === 'out_for_delivery' && order?.orderType === 'delivery' && order.riderAssigned === false;
// What the order looks like the moment a step is tapped, before the server has answered: the board shows the next button at once.
// The server's answer replaces it a moment later (and puts the old state back if the step is refused).
export function afterStep(order, next) {
    const delivery = order.orderType === 'delivery';
    const flow = delivery ? ['placed', 'accepted', 'preparing', 'out_for_delivery', 'delivered'] : ['placed', 'accepted', 'preparing', 'ready', 'delivered'];
    const following = flow[flow.indexOf(next) + 1];
    return { ...order, status: next, allowedNext: following ? [following, 'cancelled'] : [] };
}
// A delivery order with a delivery partner: HE collects it ("I have collected") and delivers it (the PIN), and the order moves by itself.
// So the owner has no "Out for delivery" or "Mark delivered" button on the board for it.
export const riderHandles = (order, next) => order?.orderType === 'delivery' && order.riderAssigned !== false && (next === 'out_for_delivery' || next === 'delivered');
export const canCancel = (order) => (order?.allowedNext || []).includes('cancelled');
export const canMarkUndelivered = (order) => (order?.allowedNext || []).includes('undelivered');

// Why an owner may cancel (backend services/orderOutcome.js OWNER_CANCEL_REASONS). "other" needs his own words.
export const CANCEL_REASONS = [
    ['busy', 'Too busy right now'],
    ['out_of_stock', 'Item is out of stock'],
    ['shop_fault', 'A problem at the shop'],
    ['customer_asked', 'The customer asked to cancel'],
    ['other', 'Other: write the reason'],
];
// Who was at fault when a delivery failed (UNDELIVERED_REASONS)
export const UNDELIVERED_WHO = [
    ['customer', 'The customer (not reachable, refused, wrong address)'],
    ['shop', 'The shop'],
    ['rider', 'The rider'],
];
export const MIN_REASON_LENGTH = 3;

// the filter chips on the Orders board: [id, label]
export const BOARD_FILTERS = [
    ['active', 'Active'],
    ['placed', 'New'],
    ['accepted', 'Accepted'],
    ['preparing', 'Preparing'],
    ['ready', 'Ready'],
    ['out_for_delivery', 'On the road'],
    ['delivered', 'Delivered'],
    ['cancelled', 'Cancelled'],
];
// what to ask the server for each chip (cancelled also covers "not delivered")
export const serverStatusFor = (filter) => (filter === 'cancelled' ? 'cancelled,undelivered' : filter);

export const TYPE_LABEL = { delivery: 'Delivery', pickup: 'Pickup', dine_in: 'Dine in' };
export const typeLabel = (t) => TYPE_LABEL[t] || String(t || '');

// "COD", "Paid online", "Online, not paid yet"
export function paymentLabel(order) {
    const p = order?.payment || {};
    if (p.method === 'cod') return 'Cash on delivery';
    if (p.status === 'paid') return 'Paid online';
    if (p.status === 'refunded') return 'Refunded';
    if (p.status === 'failed') return 'Payment failed';
    return 'Online, not paid yet';
}
export const isPaid = (order) => order?.payment?.status === 'paid';
export const isCod = (order) => order?.payment?.method === 'cod';

/* ------------------------------ words for numbers and times ------------------------------ */

// "2 Butter Naan, 1 Laccha Paratha +2 more"
export function itemsSummary(order, max = 3) {
    const lines = (order?.items || []).map((l) => (l.measure?.label ? `${l.measure.label} ${l.name}` : `${l.quantity} ${l.name}`));
    if (lines.length <= max) return lines.join(', ');
    return `${lines.slice(0, max).join(', ')} +${lines.length - max} more`;
}
export const itemCount = (order) => (order?.items || []).reduce((n, l) => n + (l.quantity || 1), 0);

export function ago(date, now = Date.now()) {
    const m = Math.max(0, Math.floor((now - new Date(date).getTime()) / 60000));
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h ${m % 60 ? `${m % 60} min ` : ''}ago`;
    return new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// 402000 ms -> "6:42"
export function mmss(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const clockTime = (date) => new Date(date).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
export const dayTime = (date) => {
    const d = new Date(date);
    const same = d.toDateString() === new Date().toDateString();
    return same ? clockTime(d) : `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${clockTime(d)}`;
};

// the change from before to now, in whole percent. null when there is nothing to compare with.
export function percentChange(now, before) {
    if (!before) return null;
    return Math.round(((now - before) / before) * 100);
}

// "6 min" or "1 h 5 min": a span in seconds
export function spanText(seconds) {
    if (seconds === null || seconds === undefined) return '–';
    if (seconds < 60) return `${seconds} sec`;
    const m = Math.round(seconds / 60);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
}

// A short sentence for a line of the live feed. Unknown kinds fall back to the plain event name.
export function feedLine(e) {
    const no = e?.data?.orderNo ? `#${e.data.orderNo}` : '';
    const total = e?.data?.total ? ` · ₹${Math.round(e.data.total)}` : '';
    const MAP = {
        'order.placed': `New order ${no}${total}`,
        'order.accepted': `Order ${no} accepted`,
        'order.preparing': `Order ${no} is being prepared`,
        'order.ready': `Order ${no} is ready`,
        'order.out_for_delivery': `Order ${no} is on the road`,
        'order.delivered': `Order ${no} delivered`,
        'order.cancelled': `Order ${no} cancelled`,
        'order.undelivered': `Order ${no} not delivered`,
        'rider.offered': `Order ${no} offered to a rider`,
        'rider.accepted': `A rider took order ${no}`,
        'rider.rejected': `A rider declined order ${no}`,
        'rider.none': `No rider took order ${no}`,
        'rider.problem': `A rider reported a problem with order ${no}`,
        'complaint.new': `New complaint ${no}`,
    };
    return (MAP[e?.type] || String(e?.type || 'Update').replace(/[._]/g, ' ')).replace(/\s+/g, ' ').trim();
}
