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

    // --- FIX STARTS HERE: O(1) Math instead of O(N) DB Aggregation ---

    // 1. Get the customer's previous ratings for this order (to know if they are updating)
    const oldReviews = await Review.find({ tenantId, orderId, userId }).lean();
    const oldReviewMap = new Map(oldReviews.map((r) => [String(r.productId), r.rating]));

    // 2. Get the current product stats
    const products = await Product.find({ _id: { $in: [...seen] }, tenantId }).select('rating ratingCount').lean();
    const productMap = new Map(products.map((p) => [String(p._id), p]));

    // 3. Save the actual reviews to the database
    await Review.bulkWrite(ratings.map((r) => ({
        updateOne: {
            filter: { tenantId, orderId: order._id, productId: r.productId, userId },
            update: { $set: { rating: r.rating, comment: typeof r.comment === 'string' ? r.comment.trim().slice(0, 300) : undefined } },
            upsert: true,
        },
    })));

    // 4. Calculate the new averages instantly using math
    const productUpdates = ratings.map((r) => {
        const p = productMap.get(String(r.productId));
        if (!p) return null;

        let count = p.ratingCount || 0;
        let currentTotal = (p.rating || 0) * count;
        const oldUserRating = oldReviewMap.get(String(r.productId));

        if (oldUserRating !== undefined) {
            // They are updating an existing review: subtract old, add new
            currentTotal = currentTotal - oldUserRating + r.rating;
        } else {
            // Brand new review
            count += 1;
            currentTotal += r.rating;
        }

        const newAvg = count > 0 ? Math.round((currentTotal / count) * 10) / 10 : 0;

        return {
            updateOne: {
                filter: { _id: r.productId, tenantId },
                update: { $set: { rating: newAvg, ratingCount: count } }
            }
        };
    }).filter(Boolean);

    if (productUpdates.length) {
        await Product.bulkWrite(productUpdates);
    }
    // --- FIX ENDS HERE ---

    await Order.updateOne({ _id: order._id }, { $set: { ratedAt: new Date() } });
    return getRatings({ tenantId, userId, orderId });
}

async function getRatings({ tenantId, userId, orderId }) {
    const items = await Review.find({ tenantId, userId, orderId }).select('productId rating comment -_id').lean();
    return { items };
}

module.exports = { rateOrder, getRatings };