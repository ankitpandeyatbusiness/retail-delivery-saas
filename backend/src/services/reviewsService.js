// What customers said about the food (dish reviews) and about the delivery, for the owner.
// Dish reviews are in Review (one per dish per order); the delivery rating sits on the order.
const mongoose = require('mongoose');
const Review = require('../models/Review');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const { httpError } = require('../middlewares/apiErrors');

const PAGE = 20;
const r2 = (n) => Math.round(n * 100) / 100;

async function stars(Model, match, field) {
    const rows = await Model.aggregate([
        { $match: match },
        { $group: { _id: `$${field}`, n: { $sum: 1 } } },
    ]);
    const out = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let count = 0; let sum = 0;
    for (const r of rows) { if (out[r._id] !== undefined) { out[r._id] = r.n; count += r.n; sum += r._id * r.n; } }
    return { count, avg: count ? r2(sum / count) : null, stars: out };
}

async function summary(tenantId) {
    const [dish, delivery] = await Promise.all([
        stars(Review, { tenantId }, 'rating'),
        stars(Order, { tenantId, 'deliveryRating.rating': { $gte: 1 } }, 'deliveryRating.rating'),
    ]);
    return { dish, delivery };
}

// kind: 'dish' (default) | 'delivery'. rating: 1..5 shows only that many stars.
async function list({ tenantId, query = {} }) {
    const kind = query.kind === 'delivery' ? 'delivery' : 'dish';
    const page = Math.min(Math.max(parseInt(query.page, 10) || 1, 1), 1000);
    let rating;
    if (query.rating !== undefined) {
        rating = Number(query.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw httpError(400, 'rating must be 1 to 5');
    }

    let items; let hasMore;
    if (kind === 'dish') {
        const rows = await Review.find({ tenantId, ...(rating ? { rating } : {}) })
            .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * PAGE).limit(PAGE + 1).lean();
        hasMore = rows.length > PAGE;
        if (hasMore) rows.pop();
        const [products, users, orders] = await Promise.all([
            Product.find({ _id: { $in: rows.map((r) => r.productId) }, tenantId }).select('name').lean(),
            User.find({ _id: { $in: rows.map((r) => r.userId) }, tenantId }).select('name').lean(),
            Order.find({ _id: { $in: rows.map((r) => r.orderId) }, tenantId }).select('orderNo customer.deleted').lean(),
        ]);
        const pn = new Map(products.map((p) => [String(p._id), p.name]));
        const un = new Map(users.map((u) => [String(u._id), u.name]));
        const on = new Map(orders.map((o) => [String(o._id), o]));
        items = rows.map((r) => ({
            id: r._id, rating: r.rating, comment: r.comment || null, createdAt: r.createdAt,
            productId: r.productId, item: pn.get(String(r.productId)) || 'Removed item',
            customer: on.get(String(r.orderId))?.customer?.deleted ? 'Deleted customer' : (un.get(String(r.userId)) || 'Customer'),
            orderId: r.orderId, orderNo: on.get(String(r.orderId))?.orderNo ?? null,
        }));
    } else {
        const match = { tenantId, 'deliveryRating.rating': rating ? rating : { $gte: 1 } };
        const rows = await Order.find(match).sort({ 'deliveryRating.ratedAt': -1, _id: -1 }).skip((page - 1) * PAGE).limit(PAGE + 1)
            .select('orderNo customer deliveryRating delivery.riderId').lean();
        hasMore = rows.length > PAGE;
        if (hasMore) rows.pop();
        items = rows.map((o) => ({
            id: o._id, rating: o.deliveryRating.rating, comment: o.deliveryRating.comment || null, tags: o.deliveryRating.tags || [],
            createdAt: o.deliveryRating.ratedAt || null, orderId: o._id, orderNo: o.orderNo, riderId: o.delivery?.riderId || null,
            customer: o.customer?.deleted ? 'Deleted customer' : (o.customer?.name || 'Customer'),
        }));
    }
    return { kind, items, page, hasMore, ...(page === 1 ? { summary: await summary(tenantId) } : {}) };
}

module.exports = { list, summary };
