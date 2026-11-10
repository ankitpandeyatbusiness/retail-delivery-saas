// Partner shops pay a fee per COMPLETED order. A shop can take orders outside the app, or let orders sit unfinished, and pay less. That cannot be stopped,
// but it can be seen. Every night, for each Partner shop with enough orders, the superadmin is told (at most once a week per shop and kind) when
//   dropped      the last 7 days have less than half the orders a day of the 4 weeks before (and the shop had at least 3 a day before)
//   unfinished   at least 10 orders were placed in the last 7 days and fewer than 60% of them were completed
// The alerts name the numbers; what to do (call the shop, check its orders) is the superadmin's call.
const Tenant = require('../models/Tenant');
const Order = require('../models/Order');
const Notification = require('../models/Notification');
const adminAlerts = require('./adminAlerts');

const DAY = 86400000;
const MIN_PER_DAY_BEFORE = 3;
const DROP_BELOW = 0.5;
const MIN_PLACED = 10;
const COMPLETED_BELOW = 0.6;

async function toldRecently(type, tenantId, now) {
    return !!(await Notification.exists({ role: 'superadmin', type, tenantId, createdAt: { $gte: new Date(now.getTime() - 7 * DAY) } }));
}

async function sweep(now = new Date()) {
    const shops = await Tenant.find({ 'plan.id': 'partner', 'closure.on': { $ne: true } }).select('name').lean();
    if (!shops.length) return { shops: 0, dropped: 0, unfinished: 0 };
    const recentFrom = new Date(now.getTime() - 7 * DAY);
    const priorFrom = new Date(now.getTime() - 35 * DAY);
    const rows = await Order.aggregate([
        { $match: { tenantId: { $in: shops.map((s) => s._id) }, createdAt: { $gte: priorFrom, $lt: now } } },
        { $group: {
            _id: '$tenantId',
            recentPlaced: { $sum: { $cond: [{ $gte: ['$createdAt', recentFrom] }, 1, 0] } },
            recentDone: { $sum: { $cond: [{ $and: [{ $gte: ['$createdAt', recentFrom] }, { $eq: ['$status', 'delivered'] }] }, 1, 0] } },
            priorPlaced: { $sum: { $cond: [{ $lt: ['$createdAt', recentFrom] }, 1, 0] } },
        } },
    ]);
    const by = new Map(rows.map((r) => [String(r._id), r]));
    const out = { shops: shops.length, dropped: 0, unfinished: 0 };
    for (const s of shops) {
        const r = by.get(String(s._id));
        if (!r) continue;
        const priorPerDay = r.priorPlaced / 28;
        const recentPerDay = r.recentPlaced / 7;
        if (priorPerDay >= MIN_PER_DAY_BEFORE && recentPerDay < priorPerDay * DROP_BELOW && !(await toldRecently('admin_orders_dropped', s._id, now))) {
            await adminAlerts.alert('admin_orders_dropped', { tenantId: s._id, vars: { summary: `${recentPerDay.toFixed(1)} orders a day in the last 7 days, against ${priorPerDay.toFixed(1)} a day in the 4 weeks before. Check that this shop still takes its orders in the app.` } });
            out.dropped += 1;
        }
        if (r.recentPlaced >= MIN_PLACED && r.recentDone / r.recentPlaced < COMPLETED_BELOW && !(await toldRecently('admin_orders_unfinished', s._id, now))) {
            await adminAlerts.alert('admin_orders_unfinished', { tenantId: s._id, vars: { summary: `Only ${r.recentDone} of ${r.recentPlaced} orders in the last 7 days were completed. A fee is taken only on completed orders.` } });
            out.unfinished += 1;
        }
    }
    return out;
}

module.exports = { sweep };
