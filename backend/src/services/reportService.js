// Sales numbers for the superadmin (all shops, or one) and for a shop owner (own shop).
// "Sales" means DELIVERED orders, counted on the day they were delivered. Cancelled orders are counted separately.

const mongoose = require('mongoose');
const Order = require('../models/Order');
const BulkOrder = require('../models/BulkOrder');
const Tenant = require('../models/Tenant');

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 366;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const httpError = (status, message) => Object.assign(new Error(message), { status });
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const oid = (id) => new mongoose.Types.ObjectId(String(id));

// "2026-10-01" means the whole day in Indian time. Full timestamps are used as they are.
function parseDate(value, endOfDay) {
    if (DATE_ONLY.test(value)) {
        return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+05:30`);
    }
    return new Date(value);
}

// ?from=2026-10-01&to=2026-10-31. Default: the last 30 days.
function parseRange(query = {}) {
    const to = query.to ? parseDate(String(query.to), true) : new Date();
    const from = query.from ? parseDate(String(query.from), false) : new Date(to.getTime() - 30 * DAY_MS);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw httpError(400, 'Invalid date');
    if (from > to) throw httpError(400, '"from" must be before "to"');
    if (to - from > MAX_DAYS * DAY_MS) throw httpError(400, `Pick a range of at most ${MAX_DAYS} days`);
    return { from, to };
}

const pctChange = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);
// growing = up 20% or more; falling = down 30% or more; quiet = sold last time and nothing now; new = nothing last time
const trendOf = (now, before) => {
    if (before > 0 && now === 0) return 'quiet';
    if (before === 0 && now > 0) return 'new';
    const c = pctChange(now, before);
    if (c === null) return 'same';
    return c >= 20 ? 'growing' : c <= -30 ? 'falling' : 'same';
};

// A BULK order is a sale too: the quote's food + packaging - discount (the same rule as an order), counted on the day it was delivered. Its work ticket is not
// counted here (it would be the same sale twice: the ticket's own total is only the balance).
const QV = (f) => ({ $ifNull: [`$quote.pricing.${f}`, 0] });
const NETQ = { $subtract: [{ $add: [QV('subtotal'), QV('packagingCharge')] }, QV('discount')] };
const bulkSums = { orders: { $sum: 1 }, revenue: { $sum: NETQ }, subtotal: { $sum: QV('subtotal') }, discount: { $sum: QV('discount') }, deliveryFees: { $sum: QV('deliveryFee') }, packaging: { $sum: QV('packagingCharge') }, tax: { $sum: QV('tax') } };
const bulkSold = (shop, a, b) => ({ ...shop, status: { $in: ['delivered', 'completed'] }, 'stageAt.delivered': { $gte: a, $lte: b } });
// adds the rows of one grouping (by day, by shop...) of the bulk orders into the rows of the normal orders, key by key
function mergeRows(rows, bulkRows) {
    const m = new Map(rows.map((r) => [String(r._id), { ...r }]));
    for (const b of bulkRows) {
        const k = String(b._id);
        const r = m.get(k) || { _id: b._id, orders: 0, revenue: 0 };
        r.orders = (r.orders || 0) + b.orders;
        r.revenue = (r.revenue || 0) + b.revenue;
        m.set(k, r);
    }
    return [...m.values()];
}

async function salesReport({ tenantId, from, to, groupBy, topLimit = 10 }) {
    const shop = tenantId ? { tenantId: oid(tenantId) } : {};
    const delivered = { ...shop, status: 'delivered', bulkId: { $exists: false }, deliveredAt: { $gte: from, $lte: to } };
    const placedInRange = { ...shop, createdAt: { $gte: from, $lte: to } };
    const format = groupBy === 'month' ? '%Y-%m' : '%Y-%m-%d';

    const netRevenue = {
        $subtract: [
            { $add: ['$pricing.subtotal', '$pricing.packagingCharge'] },
            '$pricing.discount'
        ]
    };

    const sums = {
        orders: { $sum: 1 },
        revenue: { $sum: netRevenue }, // Replaced $pricing.total
        subtotal: { $sum: '$pricing.subtotal' },
        discount: { $sum: '$pricing.discount' },
        deliveryFees: { $sum: '$pricing.deliveryFee' },
        packaging: { $sum: '$pricing.packagingCharge' },
        tax: { $sum: '$pricing.tax' },
        tips: { $sum: '$pricing.tip' },
    };

    // the period of the same length right before this one, to say "up" or "down"
    const span = to.getTime() - from.getTime();
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - span);
    const deliveredBefore = { ...shop, status: 'delivered', bulkId: { $exists: false }, deliveredAt: { $gte: prevFrom, $lte: prevTo } };

    const bulkNow = bulkSold(shop, from, to);
    const bulkBefore = bulkSold(shop, prevFrom, prevTo);
    const [totalsRows, byPeriod, byShop, topItems, byPayment, byStatus, prevRows, prevByShop, bulkTotalsRows, bulkByPeriod, bulkByShop, bulkPrevRows, bulkPrevByShop, bulkItems] = await Promise.all([
        Order.aggregate([{ $match: delivered }, { $group: { _id: null, ...sums } }]),
        Order.aggregate([
            { $match: delivered },
            { $group: { _id: { $dateToString: { format, date: '$deliveredAt', timezone: 'Asia/Kolkata' } }, orders: { $sum: 1 }, revenue: { $sum: netRevenue } } },
            { $sort: { _id: 1 } },
        ]),
        tenantId ? Promise.resolve([]) : Order.aggregate([
            { $match: delivered },
            { $group: { _id: '$tenantId', orders: { $sum: 1 }, revenue: { $sum: netRevenue } } },
            { $sort: { revenue: -1 } },
            { $limit: 50 },
        ]),
        Order.aggregate([
            { $match: delivered },
            { $unwind: '$items' },
            // topItems uses item.lineTotal which is already correct, leave it alone
            { $group: { _id: '$items.productId', name: { $first: '$items.name' }, quantity: { $sum: '$items.quantity' }, revenue: { $sum: '$items.lineTotal' } } },
            { $sort: { quantity: -1 } },
            { $limit: 500 },
        ]),
        Order.aggregate([
            { $match: delivered },
            { $group: { _id: '$payment.method', orders: { $sum: 1 }, revenue: { $sum: netRevenue } } },
            { $sort: { revenue: -1 } },
        ]),
        Order.aggregate([{ $match: placedInRange }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
        Order.aggregate([{ $match: deliveredBefore }, { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: netRevenue } } }]),
        tenantId ? Promise.resolve([]) : Order.aggregate([
            { $match: deliveredBefore },
            { $group: { _id: '$tenantId', orders: { $sum: 1 }, revenue: { $sum: netRevenue } } },
        ]),
        // the bulk orders delivered in the same ranges
        BulkOrder.aggregate([{ $match: bulkNow }, { $group: { _id: null, ...bulkSums } }]),
        BulkOrder.aggregate([{ $match: bulkNow }, { $group: { _id: { $dateToString: { format, date: '$stageAt.delivered', timezone: 'Asia/Kolkata' } }, orders: { $sum: 1 }, revenue: { $sum: NETQ } } }]),
        tenantId ? Promise.resolve([]) : BulkOrder.aggregate([{ $match: bulkNow }, { $group: { _id: '$tenantId', orders: { $sum: 1 }, revenue: { $sum: NETQ } } }]),
        BulkOrder.aggregate([{ $match: bulkBefore }, { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: NETQ } } }]),
        tenantId ? Promise.resolve([]) : BulkOrder.aggregate([{ $match: bulkBefore }, { $group: { _id: '$tenantId', orders: { $sum: 1 }, revenue: { $sum: NETQ } } }]),
        // what the delivered bulk orders were made of (the quote's lines)
        BulkOrder.aggregate([{ $match: bulkNow }, { $unwind: '$quote.lines' }, { $group: { _id: '$quote.lines.productId', name: { $first: '$quote.lines.name' }, quantity: { $sum: '$quote.lines.quantity' }, revenue: { $sum: '$quote.lines.lineTotal' } } }, { $limit: 500 }]),
    ]);

    // the sales are the delivered orders AND the delivered bulk orders (`bulk` says how much of it came from bulk orders)
    const bt = bulkTotalsRows[0] || {};
    const total0 = totalsRows[0] || {};
    totalsRows[0] = {
        orders: (total0.orders || 0) + (bt.orders || 0), revenue: (total0.revenue || 0) + (bt.revenue || 0), subtotal: (total0.subtotal || 0) + (bt.subtotal || 0),
        discount: (total0.discount || 0) + (bt.discount || 0), deliveryFees: (total0.deliveryFees || 0) + (bt.deliveryFees || 0), packaging: (total0.packaging || 0) + (bt.packaging || 0),
        tax: (total0.tax || 0) + (bt.tax || 0), tips: total0.tips || 0,
    };
    const periods = mergeRows(byPeriod, bulkByPeriod).sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));
    const shopsNow = mergeRows(byShop, bulkByShop).sort((a, b) => b.revenue - a.revenue).slice(0, 50);
    const shopsBefore = mergeRows(prevByShop, bulkPrevByShop);
    const pb = bulkPrevRows[0] || {};
    const pr0 = prevRows[0] || {};
    prevRows[0] = { orders: (pr0.orders || 0) + (pb.orders || 0), revenue: (pr0.revenue || 0) + (pb.revenue || 0) };
    // the items sold: the dishes of the bulk orders count with the others (a dish sold by the tray to an office is still a dish sold)
    const itemMap = new Map(topItems.map((r) => [String(r._id), { ...r }]));
    for (const b of bulkItems) {
        const k = String(b._id);
        const r = itemMap.get(k) || { _id: b._id, name: b.name, quantity: 0, revenue: 0 };
        r.quantity += b.quantity; r.revenue += b.revenue;
        itemMap.set(k, r);
    }
    const itemRows = [...itemMap.values()].sort((a, b) => b.quantity - a.quantity).slice(0, Math.min(Math.max(Number(topLimit) || 10, 1), 50));
    // by how it was paid: the bulk orders are their own row (their money is an advance online and a balance in cash or online, not one payment)
    const paymentRows = [...byPayment];
    if (bt.orders) paymentRows.push({ _id: 'bulk', orders: bt.orders, revenue: bt.revenue });
    paymentRows.sort((a, b) => b.revenue - a.revenue);
    const bulkOut = {
        orders: bt.orders || 0, revenue: round2(bt.revenue || 0), previousRevenue: round2(pb.revenue || 0),
        sharePct: totalsRows[0].revenue > 0 ? Math.round(((bt.revenue || 0) / totalsRows[0].revenue) * 100) : 0,
    };

    const t = totalsRows[0] || {};
    const orders = t.orders || 0;
    const totals = {
        orders,
        revenue: round2(t.revenue || 0),
        subtotal: round2(t.subtotal || 0),
        discount: round2(t.discount || 0),
        deliveryFees: round2(t.deliveryFees || 0),
        packaging: round2(t.packaging || 0),
        tax: round2(t.tax || 0),
        tips: round2(t.tips || 0),
        averageOrderValue: orders ? round2((t.revenue || 0) / orders) : 0,
    };

    let shops = [];
    const prevBy = new Map(shopsBefore.map((r) => [String(r._id), r]));
    const shopRows = [...shopsNow, ...shopsBefore.filter((r) => !shopsNow.some((x) => String(x._id) === String(r._id))).map((r) => ({ _id: r._id, orders: 0, revenue: 0 }))];
    if (shopRows.length) {
        const names = await Tenant.find({ _id: { $in: shopRows.map((s) => s._id) } }).select('name slug').lean();
        const nameById = new Map(names.map((n) => [String(n._id), n]));
        shops = shopRows.map((s) => {
            const before = prevBy.get(String(s._id));
            const prev = round2(before?.revenue || 0);
            const now = round2(s.revenue);
            return {
                tenantId: s._id,
                name: nameById.get(String(s._id))?.name || 'Unknown shop',
                slug: nameById.get(String(s._id))?.slug || null,
                orders: s.orders,
                revenue: now,
                previousRevenue: prev,
                previousOrders: before?.orders || 0,
                changePct: pctChange(now, prev),
                trend: trendOf(now, prev),
            };
        }).sort((a, b) => b.revenue - a.revenue);
    }

    const pt = prevRows[0] || {};
    const prevAov = pt.orders ? round2((pt.revenue || 0) / pt.orders) : 0;
    const previous = {
        range: { from: prevFrom, to: prevTo },
        totals: { orders: pt.orders || 0, revenue: round2(pt.revenue || 0), averageOrderValue: prevAov },
        change: { revenue: pctChange(totals.revenue, round2(pt.revenue || 0)), orders: pctChange(orders, pt.orders || 0), averageOrderValue: pctChange(totals.averageOrderValue, prevAov) },
    };

    return {
        range: { from, to, groupBy: groupBy === 'month' ? 'month' : 'day' },
        previous,
        totals,
        bulk: bulkOut,
        series: periods.map((r) => ({ period: r._id, orders: r.orders, revenue: round2(r.revenue) })),
        shops,
        topItems: itemRows.map((r) => ({ productId: r._id, name: r.name, quantity: r.quantity, revenue: round2(r.revenue) })),
        payments: paymentRows.map((r) => ({ method: r._id, orders: r.orders, revenue: round2(r.revenue) })),
        statuses: Object.fromEntries(byStatus.map((r) => [r._id, r.n])),
        undelivered: byStatus.find((r) => r._id === 'undelivered')?.n || 0,   // not delivered: shown on its own, never counted as revenue
    };
}

module.exports = { salesReport, parseRange };