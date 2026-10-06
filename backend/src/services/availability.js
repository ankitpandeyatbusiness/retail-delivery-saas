// "Show it only if there is data for it."
//
// The panel lets you switch on any filter / block / feature. Before the config goes to the app,
// applyAutoHide() removes the ones that would be empty right now (e.g. the "Weight" filter when no item
// has weight options). Your saved settings are NOT changed: add the data and the option appears by itself.

const { LRUCache } = require('lru-cache');
const Product = require('../models/Product');
const Collection = require('../models/Collection');
const Banner = require('../models/Banner');
const Coupon = require('../models/Coupon');
const { activeNow } = require('./catalogQuery');
const { MIN_RATINGS } = require('../config/rules');

const cache = new LRUCache({ max: 500, ttl: 60 * 1000 });

const count = (cond) => ({ $sum: { $cond: [cond, 1, 0] } });
const hasWeightGroup = {
    $gt: [{ $size: { $filter: { input: { $ifNull: ['$optionGroups', []] }, cond: { $eq: ['$$this.id', 'weight'] } } } }, 0],
};

const ZERO = {
    items: 0, eggless: 0, sugarFree: 0, jain: 0, bestseller: 0, newArrival: 0, giftPack: 0, spice: 0,
    serves: 0, weight: 0, offers: 0, calories: 0, prepTime: 0, ratedItems: 0, ratedHigh: 0,
};

async function compute(tenantId) {
    const [agg] = await Product.aggregate([
        { $match: { tenantId, isActive: true } },
        {
            $group: {
                _id: null,
                items: { $sum: 1 },
                eggless: count('$isEggless'),
                sugarFree: count('$isSugarFree'),
                jain: count('$isJain'),
                bestseller: count('$isBestseller'),
                newArrival: count('$isNewArrival'),
                giftPack: count('$isGiftPack'),
                spice: count({ $ne: [{ $ifNull: ['$spiceLevel', 'none'] }, 'none'] }),
                serves: count({ $gt: ['$serves', 0] }),
                weight: count(hasWeightGroup),
                offers: count({ $gt: [{ $ifNull: ['$mrp', 0] }, '$price'] }),
                calories: count({ $gt: ['$calories', 0] }),
                prepTime: count({ $gt: ['$prepTimeMin', 0] }),
                ratedItems: count({ $gte: ['$ratingCount', MIN_RATINGS] }),
                ratedHigh: count({ $and: [{ $gte: ['$ratingCount', MIN_RATINGS] }, { $gte: ['$rating', 4] }] }),
            },
        },
    ]);
    if (agg) delete agg._id;

    const [collections, banners, coupons] = await Promise.all([
        Collection.find({ tenantId, ...activeNow(), 'productIds.0': { $exists: true } }).select('kind').lean(),
        Banner.countDocuments({ tenantId, ...activeNow() }),
        Coupon.countDocuments({ tenantId, isPublic: true, ...activeNow() }),
    ]);

    return {
        ...ZERO,
        ...(agg || {}),
        festival: collections.filter((c) => c.kind === 'festival').length,
        combo: collections.filter((c) => c.kind === 'combo').length,
        banners,
        coupons,
    };
}

async function getAvailability(tenantId) {
    const key = String(tenantId);
    let a = cache.get(key);
    if (!a) { a = await compute(tenantId); cache.set(key, a); }
    return a;
}
const invalidateAvailability = (tenantId) => cache.delete(String(tenantId));

/* ------------------------------ rules: what needs data ------------------------------ */
const FILTER_RULES = {
    egg_free: [(a) => a.eggless > 0, 'No item is marked eggless'],
    rating_4: [(a) => a.ratedHigh > 0, `No item has ${MIN_RATINGS}+ ratings with 4 stars or more yet`],
    price_range: [(a) => a.items > 1, 'The shop has fewer than 2 items'],
    offers: [(a) => a.offers > 0, 'No item has an MRP higher than its price'],
    bestseller: [(a) => a.bestseller > 0, 'No item is marked bestseller'],
    spice_level: [(a) => a.spice > 0, 'No item has a spice level'],
    sugar_free: [(a) => a.sugarFree > 0, 'No item is marked sugar free'],
    jain: [(a) => a.jain > 0, 'No item is marked Jain'],
    weight: [(a) => a.weight > 0, 'No item has a "weight" option group'],
    serves: [(a) => a.serves > 0, 'No item has a "serves" number'],
    gift_pack: [(a) => a.giftPack > 0, 'No item is marked gift pack'],
    new: [(a) => a.newArrival > 0, 'No item is marked new arrival'],
};
const SORT_RULES = {
    rating: [(a) => a.ratedItems > 0, `No item has ${MIN_RATINGS}+ ratings yet`],
    prep_time: [(a) => a.prepTime > 0, 'No item has a preparation time'],
    newest: [(a) => a.items > 0, 'The shop has no items'],
};
const BLOCK_RULES = {
    banner: [(a) => a.banners > 0, 'No active banner'],
    offers: [(a) => a.coupons > 0, 'No active public coupon'],
    bestsellers: [(a) => a.bestseller > 0, 'No item is marked bestseller'],
    new_arrivals: [(a) => a.newArrival > 0, 'No item is marked new arrival'],
    festival: [(a) => a.festival > 0, 'No active festival collection with items'],
    combos: [(a) => a.combo > 0, 'No active combo collection with items'],
};
const FEATURE_RULES = {
    ratingBadge: [(a) => a.ratedItems > 0, `No item has ${MIN_RATINGS}+ ratings yet`],
    calories: [(a) => a.calories > 0, 'No item has calories'],
    serves: [(a) => a.serves > 0, 'No item has a "serves" number'],
    prepTime: [(a) => a.prepTime > 0, 'No item has a preparation time'],
};

// config = output of resolveConfig(). Returns a copy for the app, plus the list of what was hidden and why.
function applyAutoHide(config, a) {
    const cfg = JSON.parse(JSON.stringify(config));
    const hidden = [];
    const keep = (type, rules) => (id) => {
        const rule = rules[id];
        if (!rule || rule[0](a)) return true;
        hidden.push({ type, id, reason: rule[1] });
        return false;
    };

    cfg.home.filters = (cfg.home.filters || []).filter(keep('filter', FILTER_RULES));
    cfg.home.sortOptions = (cfg.home.sortOptions || []).filter(keep('sort', SORT_RULES));
    if (!cfg.home.sortOptions.length) cfg.home.sortOptions = ['popularity'];
    cfg.home.blocks = (cfg.home.blocks || []).filter(keep('block', BLOCK_RULES));

    // the filter bar is pointless with no filters
    if (!cfg.home.filters.length && cfg.home.blocks.includes('filters')) {
        cfg.home.blocks = cfg.home.blocks.filter((b) => b !== 'filters');
        hidden.push({ type: 'block', id: 'filters', reason: 'No filter has data yet' });
    }

    for (const [key, [ok, why]] of Object.entries(FEATURE_RULES)) {
        if (cfg.features[key] && !ok(a)) {
            cfg.features[key] = false;
            hidden.push({ type: 'feature', id: key, reason: why });
        }
    }

    cfg.ratings = { minCount: MIN_RATINGS };   // the app shows an item's stars only when ratingCount >= this
    return { config: cfg, hidden, availability: a };
}

module.exports = { getAvailability, invalidateAvailability, applyAutoHide, MIN_RATINGS };