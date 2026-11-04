// How each shop performed over the last N days: cancels caused by the shop, how long it takes to prepare and deliver, complaints.
// A shop is flagged "weak" for a plain reason (shown in `why`) so the superadmin knows what to talk to the owner about.
const Order = require('../models/Order');
const Complaint = require('../models/Complaint');
const Tenant = require('../models/Tenant');

const MIN = 60000;
const MIN_ORDERS = 10;                         // fewer orders than this is too few to judge
const LIMIT = { shopCancelPct: 10, prepMin: 45, deliveryMin: 50, complaintPct: 8 };

// first time the order reached a status (from its history), as a pipeline expression
const firstAt = (status) => ({ $arrayElemAt: [{ $map: { input: { $filter: { input: { $ifNull: ['$statusHistory', []] }, cond: { $eq: ['$$this.status', status] } } }, in: '$$this.at' } }, 0] });

async function report({ days = 30, now = Date.now() } = {}) {
    const since = new Date(now - days * 86400000);
    const rows = await Order.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $project: {
            tenantId: 1, status: 1, cancelledBy: 1, total: '$pricing.total',
            prep: { $cond: [{ $and: [firstAt('accepted'), firstAt('ready')] }, { $divide: [{ $subtract: [firstAt('ready'), firstAt('accepted')] }, MIN] }, null] },
            trip: { $cond: [{ $and: [firstAt('out_for_delivery'), firstAt('delivered')] }, { $divide: [{ $subtract: [firstAt('delivered'), firstAt('out_for_delivery')] }, MIN] }, null] },
        } },
        { $group: {
            _id: '$tenantId', orders: { $sum: 1 },
            delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
            shopCancels: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'cancelled'] }, { $eq: ['$cancelledBy', 'shop'] }] }, 1, 0] } },
            otherCancels: { $sum: { $cond: [{ $and: [{ $in: ['$status', ['cancelled', 'undelivered']] }, { $ne: ['$cancelledBy', 'shop'] }] }, 1, 0] } },
            prepAvg: { $avg: '$prep' }, tripAvg: { $avg: '$trip' }, sales: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, '$total', 0] } },
        } },
    ]);
    const complaints = await Complaint.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$tenantId', n: { $sum: 1 } } }]);
    const cBy = new Map(complaints.map((c) => [String(c._id), c.n]));
    const names = new Map((await Tenant.find({ _id: { $in: rows.map((r) => r._id) } }).select('name').lean()).map((s) => [String(s._id), s.name]));
    const round = (n) => (n == null ? null : Math.round(n));
    const items = rows.map((r) => {
        const id = String(r._id);
        const c = cBy.get(id) || 0;
        const pct = (n) => (r.orders ? Math.round((n / r.orders) * 1000) / 10 : 0);
        const why = [];
        if (r.orders >= MIN_ORDERS) {
            if (pct(r.shopCancels) >= LIMIT.shopCancelPct) why.push(`The shop cancelled ${pct(r.shopCancels)}% of orders`);
            if (r.prepAvg != null && r.prepAvg >= LIMIT.prepMin) why.push(`Takes ${round(r.prepAvg)} min to prepare`);
            if (r.tripAvg != null && r.tripAvg >= LIMIT.deliveryMin) why.push(`Deliveries take ${round(r.tripAvg)} min`);
            if (pct(c) >= LIMIT.complaintPct) why.push(`Complaints on ${pct(c)}% of orders`);
        }
        return { tenantId: id, shopName: names.get(id) || 'Unknown shop', orders: r.orders, delivered: r.delivered, sales: r.sales || 0, shopCancels: r.shopCancels, otherCancels: r.otherCancels, shopCancelPct: pct(r.shopCancels), prepMin: round(r.prepAvg), deliveryMin: round(r.tripAvg), complaints: c, weak: why.length > 0, why };
    });
    items.sort((a, b) => (b.weak - a.weak) || (b.why.length - a.why.length) || (b.orders - a.orders));
    return { days, items, weak: items.filter((i) => i.weak).length };
}

module.exports = { report, LIMIT, MIN_ORDERS };
