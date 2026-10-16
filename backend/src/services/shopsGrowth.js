// The superadmin's view of how the shops are growing (delivered orders, whole days back from now).
// Every non-suspended shop gets its sales for the last N days against the N days before.
//   growing = sales up 20% or more     slowing = sales down 20% or more, or no order for 14 days after having sales before
const Order = require('../models/Order');
const Tenant = require('../models/Tenant');
const Autopilot = require('../models/Autopilot');
const NudgeLog = require('../models/NudgeLog');

const DAY = 86400000;
const TOTAL = { $ifNull: ['$pricing.total', 0] };

async function build({ days = 30, now = new Date() } = {}) {
    const n = Math.min(Math.max(days, 7), 180);
    const from = new Date(now.getTime() - n * DAY);
    const before = new Date(now.getTime() - 2 * n * DAY);
    const thisPeriod = { $gte: ['$createdAt', from] };
    const agg = await Order.aggregate([
        { $match: { status: 'delivered', createdAt: { $gte: before } } },
        {
            $group: {
                _id: '$tenantId',
                orders: { $sum: { $cond: [thisPeriod, 1, 0] } },
                revenue: { $sum: { $cond: [thisPeriod, TOTAL, 0] } },
                prevOrders: { $sum: { $cond: [thisPeriod, 0, 1] } },
                prevRevenue: { $sum: { $cond: [thisPeriod, 0, TOTAL] } },
                customers: { $addToSet: { $cond: [thisPeriod, '$userId', null] } },
                last: { $max: '$createdAt' },
            },
        },
    ]);
    const by = new Map(agg.map((a) => [String(a._id), a]));
    const tenants = await Tenant.find({ status: { $ne: 'suspended' } }).select('name slug billing.isLive').lean();
    const ap = new Map((await Autopilot.find({}).select('tenantId on platformPaused').lean()).map((a) => [String(a.tenantId), a]));
    const nudges = await NudgeLog.aggregate([{ $match: { createdAt: { $gte: from } } }, { $group: { _id: '$tenantId', sent: { $sum: 1 } } }]);
    const sent = new Map(nudges.map((x) => [String(x._id), x.sent]));

    const shops = tenants.map((t) => {
        const a = by.get(String(t._id)) || {};
        const revenue = Math.round(a.revenue || 0);
        const prev = Math.round(a.prevRevenue || 0);
        const change = prev > 0 ? Math.round(((revenue - prev) / prev) * 100) : null;
        const idle = a.last ? Math.floor((now.getTime() - new Date(a.last).getTime()) / DAY) : null;
        const pilot = ap.get(String(t._id));
        let status = a.orders ? 'steady' : 'quiet';
        if (change !== null && change >= 20) status = 'growing';
        else if ((change !== null && change <= -20) || (prev > 0 && idle !== null && idle >= 14)) status = 'slowing';
        return {
            id: String(t._id), name: t.name, slug: t.slug, live: !!t.billing?.isLive,
            orders: a.orders || 0, revenue, prevOrders: a.prevOrders || 0, prevRevenue: prev, change,
            customers: (a.customers || []).filter(Boolean).length, lastOrderAt: a.last || null, idleDays: idle,
            autopilot: { on: pilot ? Object.values(pilot.on || {}).some(Boolean) : false, paused: !!pilot?.platformPaused, sent: sent.get(String(t._id)) || 0 },
            status,
        };
    });
    const totals = shops.reduce((t, s) => ({ orders: t.orders + s.orders, revenue: t.revenue + s.revenue, prevRevenue: t.prevRevenue + s.prevRevenue, customers: t.customers + s.customers }), { orders: 0, revenue: 0, prevRevenue: 0, customers: 0 });
    return {
        days: n, shops: shops.length,
        totals: { ...totals, change: totals.prevRevenue ? Math.round(((totals.revenue - totals.prevRevenue) / totals.prevRevenue) * 100) : null },
        leaderboard: [...shops].filter((s) => s.revenue > 0).sort((x, y) => y.revenue - x.revenue).slice(0, 20),
        growing: shops.filter((s) => s.status === 'growing').sort((a, b) => b.change - a.change).slice(0, 15),
        slowing: shops.filter((s) => s.status === 'slowing').sort((a, b) => (a.change ?? -999) - (b.change ?? -999)).slice(0, 15),
        quiet: shops.filter((s) => s.status === 'quiet' && s.live).length,
        autopilot: { shopsOn: shops.filter((s) => s.autopilot.on).length, messages: shops.reduce((t, s) => t + s.autopilot.sent, 0) },
    };
}

module.exports = { build };
