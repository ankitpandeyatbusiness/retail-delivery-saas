// Sales numbers for the superadmin (all shops, or one) and for a shop owner (own shop).
// "Sales" means DELIVERED orders, counted on the day they were delivered. Cancelled orders are counted separately.

const mongoose = require('mongoose');
const Order = require('../models/Order');
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

async function salesReport({ tenantId, from, to, groupBy }) {
    const shop = tenantId ? { tenantId: oid(tenantId) } : {};
    const delivered = { ...shop, status: 'delivered', deliveredAt: { $gte: from, $lte: to } };
    const placedInRange = { ...shop, createdAt: { $gte: from, $lte: to } };
    const format = groupBy === 'month' ? '%Y-%m' : '%Y-%m-%d';

    const sums = {
        orders: { $sum: 1 },
        revenue: { $sum: '$pricing.total' },
        subtotal: { $sum: '$pricing.subtotal' },
        discount: { $sum: '$pricing.discount' },
        deliveryFees: { $sum: '$pricing.deliveryFee' },
        packaging: { $sum: '$pricing.packagingCharge' },
        tax: { $sum: '$pricing.tax' },
        tips: { $sum: '$pricing.tip' },
    };

    const [totalsRows, byPeriod, byShop, topItems, byPayment, byStatus] = await Promise.all([
        Order.aggregate([{ $match: delivered }, { $group: { _id: null, ...sums } }]),
        Order.aggregate([
            { $match: delivered },
            { $group: { _id: { $dateToString: { format, date: '$deliveredAt', timezone: 'Asia/Kolkata' } }, orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } },
            { $sort: { _id: 1 } },
        ]),
        tenantId ? Promise.resolve([]) : Order.aggregate([
            { $match: delivered },
            { $group: { _id: '$tenantId', orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } },
            { $sort: { revenue: -1 } },
            { $limit: 50 },
        ]),
        Order.aggregate([
            { $match: delivered },
            { $unwind: '$items' },
            { $group: { _id: '$items.productId', name: { $first: '$items.name' }, quantity: { $sum: '$items.quantity' }, revenue: { $sum: '$items.lineTotal' } } },
            { $sort: { quantity: -1 } },
            { $limit: 10 },
        ]),
        Order.aggregate([
            { $match: delivered },
            { $group: { _id: '$payment.method', orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } },
            { $sort: { revenue: -1 } },
        ]),
        Order.aggregate([{ $match: placedInRange }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);

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
    if (byShop.length) {
        const names = await Tenant.find({ _id: { $in: byShop.map((s) => s._id) } }).select('name slug').lean();
        const nameById = new Map(names.map((n) => [String(n._id), n]));
        shops = byShop.map((s) => ({
            tenantId: s._id,
            name: nameById.get(String(s._id))?.name || 'Unknown shop',
            slug: nameById.get(String(s._id))?.slug || null,
            orders: s.orders,
            revenue: round2(s.revenue),
        }));
    }

    return {
        range: { from, to, groupBy: groupBy === 'month' ? 'month' : 'day' },
        totals,
        series: byPeriod.map((r) => ({ period: r._id, orders: r.orders, revenue: round2(r.revenue) })),
        shops,
        topItems: topItems.map((r) => ({ productId: r._id, name: r.name, quantity: r.quantity, revenue: round2(r.revenue) })),
        payments: byPayment.map((r) => ({ method: r._id, orders: r.orders, revenue: round2(r.revenue) })),
        statuses: Object.fromEntries(byStatus.map((r) => [r._id, r.n])),
    };
}

module.exports = { salesReport, parseRange };