const mongoose = require('mongoose');
const { MIN_RATINGS } = require('../config/rules');
const isTrue = (v) => v === 'true' || v === '1';
const num = (v) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const validId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SORTS = {
    popularity: { isBestseller: -1, orderCount: -1, _id: 1 },
    price_low: { price: 1, _id: 1 },
    price_high: { price: -1, _id: 1 },
    rating: { rating: -1, ratingCount: -1, _id: 1 },
    prep_time: { prepTimeMin: 1, _id: 1 },
    newest: { createdAt: -1, _id: 1 },
};

const SPICE = ['none', 'mild', 'medium', 'hot'];

// The shop's food mode is a RULE, not a hint: a veg shop never returns non-veg items,
// whatever the app asks for. Used by the list, the menu and the item detail.
function foodModeFilter(foodMode) {
    if (foodMode === 'veg') return { isVeg: true };
    if (foodMode === 'eggless') return { isEggless: true };
    return {}; // mixed / nonveg shops can sell everything
}

// ctx (all optional), built by the router from the resolved tenant config:
//   foodMode, hideOutOfStock, activeCategoryIds
function buildProductFilter(tenantId, q = {}, ctx = {}) {
    const f = { tenantId, isActive: true, ...foodModeFilter(ctx.foodMode) };
    if (ctx.hideOutOfStock) f.isAvailable = true;

    // Items in a switched-off category are hidden too
    if (Array.isArray(ctx.activeCategoryIds)) {
        if (validId(q.category)) {
            f.categoryId = ctx.activeCategoryIds.some((id) => String(id) === q.category) ? q.category : { $in: [] };
        } else {
            f.categoryId = { $in: ctx.activeCategoryIds };
        }
    } else if (validId(q.category)) {
        f.categoryId = q.category;
    }

    if (isTrue(q.veg)) f.isVeg = true;
    if (isTrue(q.eggFree)) f.isEggless = true;
    if (isTrue(q.sugarFree)) f.isSugarFree = true;
    if (isTrue(q.jain)) f.isJain = true;
    if (isTrue(q.bestseller)) f.isBestseller = true;
    if (isTrue(q.newArrival)) f.isNewArrival = true;
    if (isTrue(q.giftPack)) f.isGiftPack = true;
    if (isTrue(q.offers)) f.$expr = { $gt: ['$mrp', '$price'] };
    if (typeof q.weight === 'string' && /^[a-z0-9_-]{1,30}$/.test(q.weight)) {
        f.optionGroups = { $elemMatch: { id: 'weight', options: { $elemMatch: { id: q.weight, isAvailable: { $ne: false } } } } };
    }
    if (SPICE.includes(q.spice)) f.spiceLevel = q.spice;

    const minRating = num(q.minRating);
    if (minRating !== null) { f.rating = { $gte: minRating }; f.ratingCount = { $gte: MIN_RATINGS }; }

    const serves = num(q.serves);
    if (serves !== null) f.serves = { $gte: serves };

    const minPrice = num(q.minPrice);
    const maxPrice = num(q.maxPrice);
    if (minPrice !== null || maxPrice !== null) {
        f.price = {};
        if (minPrice !== null) f.price.$gte = minPrice;
        if (maxPrice !== null) f.price.$lte = maxPrice;
    }

    // Search: name or description, case-insensitive, special characters escaped
    const term = typeof q.q === 'string' ? q.q.trim().slice(0, 40) : '';
    if (term.length >= 2) {
        const re = new RegExp(escapeRegex(term), 'i');
        f.$or = [{ name: re }, { description: re }];
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

module.exports = { SORTS, buildProductFilter, foodModeFilter, activeNow };