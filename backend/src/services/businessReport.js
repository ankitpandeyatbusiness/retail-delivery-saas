// The shop's progress report: how the shop did over a period, against the period before it, what customers like, which delivery
// partner is best, what the app earned the owner, and plain-words tips. One place builds it for the owner's app, the monthly
// email and the superadmin's view of a shop.
//
// "Sales" means DELIVERED orders counted on the day they were delivered (food + packaging - discount), the same rule as the Home
// screen and the sales report. Money in this file is rupees. Days are India days.
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Review = require('../models/Review');
const Product = require('../models/Product');
const User = require('../models/User');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const OnlineRefund = require('../models/OnlineRefund');
const PlatformSettings = require('../models/PlatformSettings');
const cod = require('./codService');
const { HIDE_UNPAID } = require('./onlineOrder');
const { buildTips, quoteFor } = require('./businessTips');
const { httpError } = require('../middlewares/apiErrors');

const IST_MS = 330 * 60000;
const DAY_MS = 86400000;
const TZ = 'Asia/Kolkata';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
const NET = {
    $subtract: [
        { $add: [{ $ifNull: ['$pricing.subtotal', 0] }, { $ifNull: ['$pricing.packagingCharge', 0] }] },
        { $ifNull: ['$pricing.discount', 0] },
    ],
};
const ymd = (d) => new Date(new Date(d).getTime() + IST_MS).toISOString().slice(0, 10);
const startOfDay = (s) => new Date(Date.parse(`${s}T00:00:00+05:30`));
const hourLabel = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`;

// '7' | '30' | '90' -> the last N days up to today; '2026-09' -> that whole month. -> { from, to (exclusive), label }
function rangeOf(spec = '30', now = new Date()) {
    const today = ymd(now);
    if (/^\d{4}-\d{2}$/.test(String(spec))) {
        const from = startOfDay(`${spec}-01`);
        if (Number.isNaN(from.getTime())) throw httpError(400, 'Bad month');
        const next = new Date(Date.UTC(Number(spec.slice(0, 4)), Number(spec.slice(5, 7)), 1));
        const to = startOfDay(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`);
        return { from, to, label: new Date(from.getTime() + IST_MS).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
    }
    const days = { 7: 7, 30: 30, 90: 90 }[String(spec)];
    if (!days) throw httpError(400, 'range must be 7, 30, 90 or a month like 2026-09');
    const to = new Date(startOfDay(today).getTime() + DAY_MS);
    return { from: new Date(to.getTime() - days * DAY_MS), to, label: `Last ${days} days` };
}

async function totalsFor(tenantId, from, to) {
    const [row] = await Order.aggregate([
        { $match: { tenantId, status: 'delivered', deliveredAt: { $gte: from, $lt: to } } },
        { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: NET }, tips: { $sum: { $ifNull: ['$pricing.tip', 0] } } } },
    ]);
    const orders = row?.orders || 0;
    const revenue = r2(row?.revenue || 0);
    return { orders, revenue, avgOrder: orders ? r2(revenue / orders) : 0, tips: r2(row?.tips || 0) };
}

// per-day numbers -> the points of the chart: days (up to 35), weeks starting Monday (up to 100 days) or months
function bucket(days, from, to) {
    const n = Math.round((to - from) / DAY_MS);
    const byKey = new Map(days.map((d) => [d._id, d]));
    const out = [];
    const kind = n <= 35 ? 'day' : n <= 100 ? 'week' : 'month';
    const add = (key, label, orders, revenue) => out.push({ key, label, orders, revenue: r2(revenue) });
    if (kind === 'day') {
        for (let i = 0; i < n; i += 1) {
            const k = ymd(new Date(from.getTime() + i * DAY_MS));
            add(k, k, byKey.get(k)?.orders || 0, byKey.get(k)?.revenue || 0);
        }
    } else if (kind === 'week') {
        const weeks = new Map();
        for (let i = 0; i < n; i += 1) {
            const day = new Date(from.getTime() + i * DAY_MS);
            const k = ymd(day);
            const dow = new Date(day.getTime() + IST_MS).getUTCDay();   // 0 = Sunday
            const monday = ymd(new Date(day.getTime() - ((dow + 6) % 7) * DAY_MS));
            const w = weeks.get(monday) || { orders: 0, revenue: 0 };
            w.orders += byKey.get(k)?.orders || 0;
            w.revenue += byKey.get(k)?.revenue || 0;
            weeks.set(monday, w);
        }
        for (const [k, w] of weeks) add(k, k, w.orders, w.revenue);
    } else {
        const months = new Map();
        for (let i = 0; i < n; i += 1) {
            const k = ymd(new Date(from.getTime() + i * DAY_MS)).slice(0, 7);
            const m = months.get(k) || { orders: 0, revenue: 0 };
            m.orders += byKey.get(ymd(new Date(from.getTime() + i * DAY_MS)))?.orders || 0;
            m.revenue += byKey.get(ymd(new Date(from.getTime() + i * DAY_MS)))?.revenue || 0;
            months.set(k, m);
        }
        for (const [k, m] of months) add(k, k, m.orders, m.revenue);
    }
    return { kind, points: out };
}

const MILESTONE_ORDERS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const MILESTONE_SALES = [10000, 50000, 100000, 500000, 1000000, 5000000];

async function build({ tenantId, range = '30', now = new Date() }) {
    const { from, to, label } = rangeOf(range, now);
    const days = Math.round((to - from) / DAY_MS);
    const prevFrom = new Date(from.getTime() - (to - from));
    const delivered = { tenantId, status: 'delivered', deliveredAt: { $gte: from, $lt: to } };
    const placed = { tenantId, createdAt: { $gte: from, $lt: to }, ...HIDE_UNPAID };

    const [cur, prev, perDay, perHour, perWeekday, top, statusRows, cancelledLost, periodCustomers, riderRows, reviewRows, deliveryRating,
        life, refunds, fees, platform, owed] = await Promise.all([
        totalsFor(tenantId, from, to),
        totalsFor(tenantId, prevFrom, from),
        Order.aggregate([{ $match: delivered }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$deliveredAt', timezone: TZ } }, orders: { $sum: 1 }, revenue: { $sum: NET } } }]),
        Order.aggregate([{ $match: delivered }, { $group: { _id: { $hour: { date: '$deliveredAt', timezone: TZ } }, orders: { $sum: 1 } } }]),
        Order.aggregate([{ $match: delivered }, { $group: { _id: { $dayOfWeek: { date: '$deliveredAt', timezone: TZ } }, orders: { $sum: 1 } } }]),
        Order.aggregate([{ $match: delivered }, { $unwind: '$items' }, { $group: { _id: '$items.productId', name: { $first: '$items.name' }, quantity: { $sum: '$items.quantity' }, revenue: { $sum: '$items.lineTotal' } } }, { $sort: { quantity: -1 } }, { $limit: 30 }]),
        Order.aggregate([{ $match: placed }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
        Order.aggregate([{ $match: { ...placed, status: 'cancelled' } }, { $group: { _id: null, total: { $sum: { $ifNull: ['$pricing.total', 0] } } } }]),
        Order.aggregate([{ $match: delivered }, { $group: { _id: '$userId', orders: { $sum: 1 }, spent: { $sum: NET } } }]),
        cod.performance({ tenantId, from, to: new Date(to.getTime() - 1) }),
        Review.aggregate([{ $match: { tenantId, createdAt: { $gte: from, $lt: to } } }, { $group: { _id: '$productId', avg: { $avg: '$rating' }, count: { $sum: 1 } } }]),
        Order.aggregate([{ $match: { tenantId, 'deliveryRating.rating': { $gte: 1 }, 'deliveryRating.ratedAt': { $gte: from, $lt: to } } }, { $group: { _id: null, avg: { $avg: '$deliveryRating.rating' }, count: { $sum: 1 } } }]),
        Order.aggregate([{ $match: { tenantId, status: 'delivered' } }, { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: NET }, customers: { $addToSet: '$userId' } } }, { $project: { orders: 1, revenue: 1, customers: { $size: '$customers' } } }]),
        OnlineRefund.aggregate([{ $match: { tenantId, status: 'processed', processedAt: { $gte: from, $lt: to } } }, { $group: { _id: null, paise: { $sum: '$amountPaise' } } }]),
        SubscriptionInvoice.aggregate([{ $match: { tenantId, status: { $ne: 'void' }, issueDate: { $gte: from, $lt: to } } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
        PlatformSettings.findById('main').select('insights').lean(),
        cod.balances(tenantId),
    ]);

    // customers: new (first ever delivered order inside the period) and returning
    const userIds = periodCustomers.map((c) => c._id).filter(Boolean);
    const lifetime = userIds.length
        ? await Order.aggregate([{ $match: { tenantId, status: 'delivered', userId: { $in: userIds } } }, { $group: { _id: '$userId', first: { $min: '$deliveredAt' }, n: { $sum: 1 } } }])
        : [];
    const lifeBy = new Map(lifetime.map((l) => [String(l._id), l]));
    const newCount = lifetime.filter((l) => l.first >= from).length;
    const repeaters = periodCustomers.filter((c) => (lifeBy.get(String(c._id))?.n || 0) >= 2).length;
    const topPeople = [...periodCustomers].sort((a, b) => b.spent - a.spent).slice(0, 5);
    const people = await User.find({ _id: { $in: topPeople.map((x) => x._id) }, tenantId }).select('name phone').lean();
    const nameOf = new Map(people.map((u) => [String(u._id), u.name || `Customer ${String(u.phone).slice(-4)}`]));

    // food: ratings and what is not selling
    const productIds = reviewRows.map((r) => r._id);
    const named = productIds.length ? await Product.find({ _id: { $in: productIds }, tenantId }).select('name').lean() : [];
    const pn = new Map(named.map((p) => [String(p._id), p.name]));
    const rated = reviewRows.map((r) => ({ productId: r._id, name: pn.get(String(r._id)) || 'Removed item', avg: r2(r.avg), count: r.count })).filter((r) => r.name !== 'Removed item');
    const loved = rated.filter((r) => r.count >= 2).sort((a, b) => b.avg - a.avg || b.count - a.count).slice(0, 5);
    const attention = rated.filter((r) => r.count >= 2 && r.avg < 3.5).sort((a, b) => a.avg - b.avg).slice(0, 5);
    const soldIds = new Set(top.map((t) => String(t._id)));
    const sellingAny = await Order.distinct('items.productId', delivered);
    const soldSet = new Set(sellingAny.map(String));
    const slow = (await Product.find({ tenantId, isActive: true, createdAt: { $lt: from } }).select('name').limit(300).lean())
        .filter((p) => !soldSet.has(String(p._id)) && !soldIds.has(String(p._id))).slice(0, 8).map((p) => ({ productId: p._id, name: p.name }));

    // when the shop is busy
    const byHour = Array.from({ length: 24 }, (_, h) => perHour.find((x) => x._id === h)?.orders || 0);
    const byWeekday = Array.from({ length: 7 }, (_, i) => perWeekday.find((x) => x._id === i + 1)?.orders || 0);   // $dayOfWeek: 1 = Sunday
    const peakHour = byHour.some((n) => n) ? byHour.indexOf(Math.max(...byHour)) : null;
    const peakDay = byWeekday.some((n) => n) ? byWeekday.indexOf(Math.max(...byWeekday)) : null;

    // orders that did not become sales
    const status = Object.fromEntries(statusRows.map((s) => [s._id, s.n]));
    const placedCount = Object.values(status).reduce((a, b) => a + b, 0);
    const cancelled = status.cancelled || 0;

    // delivery partners
    const riders = (riderRows.items || []).map((r) => ({ riderId: r.riderId, name: r.name, deliveries: r.deliveries, avgMin: r.avgDeliveryMin, rating: r.periodRatingAvg ?? r.overallRatingAvg ?? null, ratedCount: r.periodRatedCount }));
    const best = [...riders].sort((a, b) => b.deliveries - a.deliveries || (b.rating || 0) - (a.rating || 0))[0] || null;

    // what the app earned the owner
    const ins = platform?.insights || {};
    const showCompare = ins.showMarketplaceCompare !== false;
    const commissionPct = Number.isFinite(ins.marketplaceCommissionPct) ? ins.marketplaceCommissionPct : 25;
    const feeBilled = r2(fees[0]?.total || 0);
    const marketplaceCost = r2((cur.revenue * commissionPct) / 100);
    const lifeRow = life[0] || {};

    // milestones crossed inside this period
    const before = await Order.aggregate([{ $match: { tenantId, status: 'delivered', deliveredAt: { $lt: from } } }, { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: NET } } }]);
    const b0 = before[0] || { orders: 0, revenue: 0 };
    const milestones = [
        ...MILESTONE_ORDERS.filter((m) => b0.orders < m && (lifeRow.orders || 0) >= m).map((m) => `You reached ${m.toLocaleString('en-IN')} delivered orders`),
        ...MILESTONE_SALES.filter((m) => b0.revenue < m && (lifeRow.revenue || 0) >= m).map((m) => `You crossed ₹${m.toLocaleString('en-IN')} in total sales`),
    ];

    const report = {
        range: { from, to, days, label, spec: String(range) },
        totals: {
            ...cur, placed: placedCount, cancelled, undelivered: status.undelivered || 0,
            cancelRate: placedCount ? Math.round((cancelled / placedCount) * 100) : 0, cancelledLost: r2(cancelledLost[0]?.total || 0),
            refunds: r2((refunds[0]?.paise || 0) / 100),
        },
        previous: prev,
        change: { orders: pct(cur.orders, prev.orders), revenue: pct(cur.revenue, prev.revenue), avgOrder: pct(cur.avgOrder, prev.avgOrder) },
        series: bucket(perDay, from, to),
        busiest: { hour: peakHour, hourLabel: peakHour === null ? null : hourLabel(peakHour), weekday: peakDay === null ? null : WEEKDAYS[peakDay], byHour, byWeekday },
        customers: {
            unique: periodCustomers.length, newCount, returning: periodCustomers.length - newCount,
            repeatPct: periodCustomers.length ? Math.round((repeaters / periodCustomers.length) * 100) : 0,
            top: topPeople.map((c) => ({ userId: c._id, name: nameOf.get(String(c._id)) || 'Customer', orders: c.orders, spent: r2(c.spent) })),
        },
        food: {
            top: top.slice(0, 10).map((t) => ({ name: t.name, quantity: t.quantity, revenue: r2(t.revenue) })),
            loved, attention, slow,
        },
        delivery: { best, riders: riders.slice(0, 8), rating: { avg: deliveryRating[0] ? r2(deliveryRating[0].avg) : null, count: deliveryRating[0]?.count || 0 }, cashWithRidersPaise: owed.totalOwedPaise || 0 },
        ratings: { dish: { avg: rated.length ? r2(rated.reduce((a, r) => a + r.avg * r.count, 0) / rated.reduce((a, r) => a + r.count, 0)) : null, count: rated.reduce((a, r) => a + r.count, 0) } },
        value: {
            show: showCompare, commissionPct, revenue: cur.revenue, orders: cur.orders, feeBilled,
            marketplaceCost: showCompare ? marketplaceCost : null,
            netGain: showCompare ? r2(marketplaceCost - feeBilled) : null,
            roi: feeBilled > 0 ? r2(cur.revenue / feeBilled) : null,
            lifetime: { orders: lifeRow.orders || 0, revenue: r2(lifeRow.revenue || 0), customers: lifeRow.customers || 0 },
        },
        milestones,
    };
    report.tips = buildTips(report);
    report.quote = quoteFor(`${tenantId}:${report.range.spec}:${ymd(now)}`);
    return report;
}

module.exports = { build, rangeOf, hourLabel };
