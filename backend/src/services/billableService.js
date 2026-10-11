// "Billable" orders: the orders that EARNED MONEY for the shop. Only these count for the free period and the monthly rent.
//   today: an order that is delivered (cancel and undelivered rules join in the order-rules batch)
// An order is NOT billable when:
//   - the shop is not live yet (no Go live), or the order was placed before go-live (a test order)
//   - the buyer is a shop owner (an owner test order)
// An order becomes billable ONCE. The order flag and the shop counter change in ONE transaction.
const Order = require('../models/Order');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const withTransaction = require('./withTransaction');
const adminAlerts = require('./adminAlerts');

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// "2026-10" -> from 1 Oct 00:00 IST to 1 Nov 00:00 IST
function monthRange(period) {
    if (!PERIOD_RE.test(String(period))) throw Object.assign(new Error('period must look like 2026-10'), { status: 400 });
    const [y, m] = period.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    return { from: new Date(`${period}-01T00:00:00+05:30`), to: new Date(`${next}-01T00:00:00+05:30`) };
}

// how many orders became billable inside this Indian calendar month
async function countInPeriod(tenantId, period) {
    const { from, to } = monthRange(period);
    return Order.countDocuments({ tenantId, 'billing.billable': true, 'billing.at': { $gte: from, $lt: to } });
}

// Safe to call twice, or from two servers at once: only one call can win.
async function markBillable(order, reason, at = new Date()) {
    const tenant = await Tenant.findById(order.tenantId).select('billing.isLive billing.goLiveAt').lean();
    if (!tenant?.billing?.isLive) return { marked: false, why: 'shop_not_live' };
    const goLiveAt = tenant.billing.goLiveAt;
    if (goLiveAt && new Date(order.createdAt) < new Date(goLiveAt)) return { marked: false, why: 'before_go_live' };
    const buyer = await User.findById(order.userId).select('role').lean();
    if (buyer?.role === 'admin') return { marked: false, why: 'owner_order' };

    const done = await withTransaction(async (session) => {
        const o = await Order.findOneAndUpdate(
            { _id: order._id, tenantId: order.tenantId, 'billing.billable': { $ne: true } },
            { $set: { 'billing.billable': true, 'billing.at': at, 'billing.reason': reason } },
            { returnDocument: 'after', session, timestamps: false },
        );
        if (!o) return null;
        const t = await Tenant.findOneAndUpdate(
            { _id: order.tenantId }, { $inc: { 'billing.billableCount': 1 } }, { returnDocument: 'after', session },
        );
        return { count: t?.billing?.billableCount };
    });
    if (!done) return { marked: false, why: 'already_billable' };
    if (done.count === 1) adminAlerts.alert('admin_shop_first_order', { tenantId: order.tenantId }).catch(() => { });
    return { marked: true, count: done.count };
}

const markDelivered = (order) => markBillable(order, 'delivered');

module.exports = { monthRange, countInPeriod, markBillable, markDelivered };