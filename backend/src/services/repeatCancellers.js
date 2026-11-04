// Customers who cancel (or are not there for the delivery) again and again, over the last N days. View only: the superadmin decides what to do
// (talk to the shop, block him from the shop's Users screen). Each row is one customer account of one shop.
const Order = require('../models/Order');
const User = require('../models/User');
const Tenant = require('../models/Tenant');

const MIN_TIMES = 3;

async function report({ days = 30, min = MIN_TIMES, now = Date.now() } = {}) {
    const since = new Date(now - days * 86400000);
    const rows = await Order.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: {
            _id: '$userId', tenantId: { $first: '$tenantId' }, orders: { $sum: 1 },
            cancelled: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'cancelled'] }, { $eq: ['$cancelledBy', 'customer'] }] }, 1, 0] } },
            noShow: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'undelivered'] }, { $eq: ['$undelivered.reasonCode', 'customer'] }] }, 1, 0] } },
            keptPaise: { $sum: { $ifNull: ['$cancel.keptPaise', { $ifNull: ['$undelivered.keptPaise', 0] }] } },
            name: { $last: '$customer.name' }, phone: { $last: '$customer.phone' },
            lastAt: { $max: { $cond: [{ $or: [{ $and: [{ $eq: ['$status', 'cancelled'] }, { $eq: ['$cancelledBy', 'customer'] }] }, { $eq: ['$status', 'undelivered'] }] }, '$createdAt', null] } },
        } },
        { $addFields: { times: { $add: ['$cancelled', '$noShow'] } } },
        { $match: { times: { $gte: min } } },
        { $sort: { times: -1, lastAt: -1 } },
        { $limit: 100 },
    ]);
    const users = new Map((await User.find({ _id: { $in: rows.map((r) => r._id) } }).select('isBlocked').lean()).map((u) => [String(u._id), u]));
    const shops = new Map((await Tenant.find({ _id: { $in: rows.map((r) => r.tenantId) } }).select('name').lean()).map((t) => [String(t._id), t.name]));
    return {
        days, min,
        items: rows.map((r) => ({
            userId: String(r._id), tenantId: String(r.tenantId), shopName: shops.get(String(r.tenantId)) || 'Unknown shop',
            name: r.name || '', phone: r.phone || '', orders: r.orders, cancelled: r.cancelled, noShow: r.noShow, times: r.times,
            sharePct: r.orders ? Math.round((r.times / r.orders) * 100) : 0, keptPaise: r.keptPaise || 0, lastAt: r.lastAt, blocked: !!users.get(String(r._id))?.isBlocked,
        })),
    };
}

module.exports = { report, MIN_TIMES };
