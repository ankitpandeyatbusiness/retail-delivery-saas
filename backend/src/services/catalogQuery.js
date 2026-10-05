const mongoose = require('mongoose');

const isTrue = (v) => v === 'true' || v === '1';
const num = (v) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

const SORTS = {
    popularity: { isBestseller: -1, orderCount: -1, _id: 1 },
    price_low: { price: 1, _id: 1 },
    price_high: { price: -1, _id: 1 },
    rating: { rating: -1, ratingCount: -1, _id: 1 },
    prep_time: { prepTimeMin: 1, _id: 1 },
    newest: { createdAt: -1, _id: 1 },
};

const SPICE = ['none', 'mild', 'medium', 'hot'];

function buildProductFilter(tenantId, q) {
    const f = { tenantId, isActive: true };

    if (q.category && mongoose.isValidObjectId(q.category)) f.categoryId = q.category;
    if (isTrue(q.veg)) f.isVeg = true;
    if (isTrue(q.eggFree)) f.isEggless = true;
    if (isTrue(q.sugarFree)) f.isSugarFree = true;
    if (isTrue(q.jain)) f.isJain = true;
    if (isTrue(q.bestseller)) f.isBestseller = true;
    if (isTrue(q.newArrival)) f.isNewArrival = true;
    if (isTrue(q.giftPack)) f.isGiftPack = true;
    if (SPICE.includes(q.spice)) f.spiceLevel = q.spice;

    const minRating = num(q.minRating);
    if (minRating !== null) f.rating = { $gte: minRating };

    const serves = num(q.serves);
    if (serves !== null) f.serves = { $gte: serves };

    const minPrice = num(q.minPrice);
    const maxPrice = num(q.maxPrice);
    if (minPrice !== null || maxPrice !== null) {
        f.price = {};
        if (minPrice !== null) f.price.$gte = minPrice;
        if (maxPrice !== null) f.price.$lte = maxPrice;
    }
    return f;
}

// Only things whose start/end dates include "now" (empty dates mean no limit)
function activeNow(now = new Date()) {
    return {
        isActive: true,
        $and: [
            { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
            { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
        ],
    };
}

module.exports = { SORTS, buildProductFilter, activeNow };