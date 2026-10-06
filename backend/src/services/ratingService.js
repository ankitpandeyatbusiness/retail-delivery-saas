const mongoose = require('mongoose');
const Order = require('../models/Order');
const Review = require('../models/Review');
const Product = require('../models/Product');

const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const httpError = (status, message) => Object.assign(new Error(message), { status });

// Body: { ratings: [{ productId, rating: 1-5, comment? }] }. Sending again edits the earlier rating.
async function rateOrder({ tenantId, userId, orderId, ratings }) {
    const order = await Order.findOne({ _id: orderId, tenantId, userId });
    if (!order) throw httpError(404, 'Order not found');
    if (order.status !== 'delivered') throw httpError(409, 'You can rate an order after it is delivered');

    if (!Array.isArray(ratings) || ratings.length < 1 || ratings.length > 30) throw httpError(400, 'Send 1 to 30 ratings');
    const inOrder = new Set(order.items.map((l) => String(l.productId)));
    const seen = new Set();
    for (const r of ratings) {
        if (!r || !isId(r.productId) || !inOrder.has(r.productId)) throw httpError(400, 'You can only rate items from this order');
        if (seen.has(r.productId)) throw httpError(400, 'Same item sent twice');
        seen.add(r.productId);
        if (!Number.isInteger(r.rating) || r.rating < 1 || r.rating > 5) throw httpError(400, 'Rating must be 1 to 5');
    }

    await Review.bulkWrite(ratings.map((r) => ({
        updateOne: {
            filter: { tenantId, orderId: order._id, productId: r.productId, userId },
            update: { $set: { rating: r.rating, comment: typeof r.comment === 'string' ? r.comment.trim().slice(0, 300) : undefined } },
            upsert: true,
        },
    })));

    // recalculate each rated product from all its reviews
    const rows = await Review.aggregate([
        { $match: { tenantId: new mongoose.Types.ObjectId(String(tenantId)), productId: { $in: [...seen].map((id) => new mongoose.Types.ObjectId(id)) } } },
        { $group: { _id: '$productId', avg: { $avg: '$rating' }, n: { $sum: 1 } } },
    ]);
    if (rows.length) {
        await Product.bulkWrite(rows.map((r) => ({
            updateOne: {
                filter: { _id: r._id, tenantId },
                update: { $set: { rating: Math.round(r.avg * 10) / 10, ratingCount: r.n } },
            },
        })));
    }
    await Order.updateOne({ _id: order._id }, { $set: { ratedAt: new Date() } });
    return getRatings({ tenantId, userId, orderId });
}

async function getRatings({ tenantId, userId, orderId }) {
    const items = await Review.find({ tenantId, userId, orderId }).select('productId rating comment -_id').lean();
    return { items };
}

module.exports = { rateOrder, getRatings };