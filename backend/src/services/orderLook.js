// "Needs a look": an order the owner has to see once, because something happened to it (cancelled, the rider cancelled or asked
// for help, a very late delivery...). It is flagged on the order (Order.needsLook) and goes away when the owner opens the order.
//   urgent  true = the owner should act now (rider cancelled, help button, rider problem, no rider, very late): the app blinks it.
//           false = good to know (the customer cancelled, the shop did not answer in time, not delivered).
// Nothing here throws: a flag problem must never break an order.
const Order = require('../models/Order');
const { HIDE_UNPAID } = require('./onlineOrder');

const REASONS = {
    rider_cancelled: { text: 'The delivery partner cancelled it', urgent: true },
    rider_sos: { text: 'The delivery partner pressed the help button', urgent: true },
    rider_problem: { text: 'The delivery partner reported a problem', urgent: true },
    no_rider: { text: 'No delivery partner took it', urgent: true },
    late: { text: 'The delivery is very late', urgent: true },
    late_cancelled: { text: 'Cancelled: the delivery was more than an hour late', urgent: true },
    customer_cancelled: { text: 'The customer cancelled it', urgent: false },
    not_accepted: { text: 'Cancelled: it was not accepted in time', urgent: false },
    undelivered: { text: 'It could not be delivered', urgent: false },
    pickup_no_show: { text: 'The customer has not collected it', urgent: false },
};

async function flag(filter, reason) {
    try {
        const r = REASONS[reason];
        if (!r) return;
        await Order.updateOne(filter, { $set: { needsLook: { reason, urgent: r.urgent, at: new Date() } } });   // a new event shows it again
    } catch (e) {
        console.error('Needs-a-look error:', e.message);
    }
}

const byId = (tenantId, orderId, reason) => flag({ _id: orderId, tenantId }, reason);
const byNo = (tenantId, orderNo, reason) => (orderNo ? flag({ tenantId, orderNo: Number(orderNo) }, reason) : null);

// the owner opened the order: it is not shown again (until something new happens to it)
async function markSeen(tenantId, orderId) {
    try {
        await Order.updateOne({ _id: orderId, tenantId, 'needsLook.reason': { $exists: true }, 'needsLook.seenAt': { $exists: false } }, { $set: { 'needsLook.seenAt': new Date() } });
    } catch (e) { /* shown once more at worst */ }
}

// the orders waiting to be seen (not seen yet, from the last 3 days)
const waiting = (tenantId) => ({ tenantId, ...HIDE_UNPAID, 'needsLook.reason': { $exists: true }, 'needsLook.seenAt': { $exists: false }, 'needsLook.at': { $gte: new Date(Date.now() - 3 * 86400000) } });

// { count, urgent, top }: how many, how many are urgent, and the words of the most important one (urgent first, then the newest)
async function summary(tenantId) {
    const rows = await Order.find(waiting(tenantId)).select('orderNo needsLook').sort({ 'needsLook.at': -1 }).limit(50).lean();
    const urgent = rows.filter((o) => o.needsLook.urgent);
    const first = urgent[0] || rows[0] || null;
    return {
        count: rows.length, urgent: urgent.length,
        top: first ? { orderNo: first.orderNo, reason: first.needsLook.reason, text: REASONS[first.needsLook.reason]?.text || '' } : null,
    };
}

// the owner opened the Orders tab: everything waiting counts as seen (like opening the notification panel)
async function markAllSeen(tenantId) {
    try {
        const r = await Order.updateMany(waiting(tenantId), { $set: { 'needsLook.seenAt': new Date() } });
        return r.modifiedCount || 0;
    } catch (e) { return 0; }
}

module.exports = { REASONS, byId, byNo, markSeen, markAllSeen, waiting, summary };
