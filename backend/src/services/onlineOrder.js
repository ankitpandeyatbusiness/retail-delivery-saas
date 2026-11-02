// Small rules about ONLINE orders (UPI / card / wallet), in one place. PURE: no database.
// An online order exists from the moment the customer taps "place order", but the SHOP only gets to know about it
// (list, alert, accept) after the money has arrived.
const ONLINE = ['upi', 'card', 'wallet'];
const APP_METHODS = ['upi', 'card'];   // what the customer app offers (wallet is not offered yet)

const isOnline = (order) => ONLINE.includes(order?.payment?.method);
const isUnpaidOnline = (order) => isOnline(order) && ['pending', 'failed', undefined].includes(order.payment?.status);

// the same rule as a database filter
const UNPAID_QUERY = { 'payment.method': { $in: ONLINE }, 'payment.status': { $in: ['pending', 'failed'] } };
const HIDE_UNPAID = { $nor: [UNPAID_QUERY] };   // spread it into a filter: the shop never sees unpaid online orders

// placing an online order: is the method offered, and can this shop take money right now?
function onlineProblem(method, can) {
    if (!ONLINE.includes(method)) return null;
    if (!APP_METHODS.includes(method)) return { status: 400, message: 'This payment method is not available yet' };
    if (!can?.ok) return { status: 409, message: 'Online payment is not available at this shop right now. Please try again later or choose another payment method.' };
    return null;
}

// The work ticket of a paid bulk order (services/bulkKitchen.js) is for the cook and the rider only: the bulk order itself is the sale. Spread it into SALES and REPORT filters, never into the kitchen's or the rider's.
const HIDE_BULK_TICKET = { bulkId: { $exists: false } };

module.exports = { HIDE_BULK_TICKET, ONLINE, APP_METHODS, isOnline, isUnpaidOnline, UNPAID_QUERY, HIDE_UNPAID, onlineProblem };