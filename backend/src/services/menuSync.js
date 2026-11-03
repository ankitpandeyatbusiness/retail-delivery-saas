// Multi-branch menu: a starting copy for a new branch, and pushing dishes from one branch to others.
//   - Each branch keeps its OWN menu. A copy is a separate product of the other branch.
//   - Stock and "sold out" are never copied or pushed. A dish the branch hid stays hidden.
//   - Prices stay per branch. A push changes a price only when the owner chooses to:
//       prices = 'keep'       never (default)
//       prices = 'untouched'  only where the branch still has the price that came from the last copy or push
//       prices = 'all'        everywhere
//   - Dishes of different branches are matched by product.brandKey (the id of the dish they were copied from).
const Product = require('../models/Product');
const Category = require('../models/Category');
const { httpError } = require('../middlewares/apiErrors');

// everything about a dish EXCEPT: owner/shop ids, ratings, counts, stock and sold-out state, hide switch, order of the list
const CONTENT = [
    'name', 'description', 'image', 'images', 'itemKind', 'sellBy', 'measure', 'bulkMin', 'mrp', 'isVeg', 'gstRate', 'gstInclusive',
    'isEggless', 'isSugarFree', 'isJain', 'spiceLevel', 'isBestseller', 'isNewArrival', 'isGiftPack', 'maxPerOrder', 'bulk',
    'serves', 'calories', 'prepTimeMin',
];

const plain = (v) => JSON.parse(JSON.stringify(v));

// the target branch's category with this name (any case), made if it is missing
async function categoryFor(source, targetTenantId, cache) {
    const key = String(source._id);
    if (cache.has(key)) return cache.get(key);
    const esc = source.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let cat = await Category.findOne({ tenantId: targetTenantId, name: new RegExp(`^${esc}$`, 'i') }).select('_id');
    if (!cat) {
        cat = await Category.create({
            tenantId: targetTenantId, name: source.name, image: source.image, imageSource: source.imageSource,
            sortOrder: source.sortOrder, isActive: source.isActive !== false, timings: plain(source.timings || []),
        });
    }
    cache.set(key, cat._id);
    return cat._id;
}

// copy the option groups of the source but keep the prices the target branch already has for the same option
function mergeGroups(sourceGroups, targetGroups, keepTargetPrices) {
    const groups = plain(sourceGroups || []);
    if (!keepTargetPrices) return groups;
    const old = new Map();
    for (const g of targetGroups || []) for (const o of g.options || []) old.set(`${g.id}/${o.id}`, o);
    for (const g of groups) for (const o of g.options || []) {
        const prev = old.get(`${g.id}/${o.id}`);
        if (prev) { o.price = prev.price; o.isAvailable = prev.isAvailable; o.unavailableUntil = prev.unavailableUntil; }
    }
    return groups;
}

// Gives one dish to one branch. Returns 'created' | 'updated'.
async function giveDish(source, targetTenantId, catCache, prices) {
    if (!source.brandKey) { await Product.updateOne({ _id: source._id }, { $set: { brandKey: source._id } }); source.brandKey = source._id; }
    const existing = await Product.findOne({ tenantId: targetTenantId, brandKey: source.brandKey });
    const base = Object.fromEntries(CONTENT.filter((k) => source[k] !== undefined).map((k) => [k, plain(source[k])]));

    if (!existing) {
        const category = await Category.findById(source.categoryId).lean();
        await Product.create({
            ...base, tenantId: targetTenantId, categoryId: await categoryFor(category, targetTenantId, catCache),
            price: source.price, brandPrice: source.price, brandKey: source.brandKey,
            optionGroups: plain(source.optionGroups || []),
            isActive: source.isActive !== false, sortOrder: source.sortOrder || 0,
            // stock and sold-out start fresh: the branch has its own
            isAvailable: true, stock: { enabled: false, qty: 0 },
        });
        return 'created';
    }
    const changePrice = prices === 'all' || (prices === 'untouched' && existing.price === existing.brandPrice);
    const set = { ...base, optionGroups: mergeGroups(source.optionGroups, existing.optionGroups, !changePrice) };
    if (changePrice) { set.price = source.price; set.brandPrice = source.price; }
    existing.set(set);
    await existing.save();
    return 'updated';
}

// The starting copy for a new branch: every dish of the source branch that is still switched on in the menu.
async function copyMenu({ fromTenantId, toTenantId }) {
    if (String(fromTenantId) === String(toTenantId)) throw httpError(400, 'Choose a different branch');
    const dishes = await Product.find({ tenantId: fromTenantId, isActive: true });
    const cache = new Map();
    let created = 0;
    for (const d of dishes) if ((await giveDish(d, toTenantId, cache, 'keep')) === 'created') created += 1;
    return { dishes: dishes.length, created };
}

// Push chosen dishes of one branch to other branches.
async function push({ fromTenantId, productIds, toTenantIds, prices = 'keep' }) {
    if (!['keep', 'untouched', 'all'].includes(prices)) throw httpError(400, 'prices must be keep, untouched or all');
    if (!Array.isArray(productIds) || !productIds.length || productIds.length > 200) throw httpError(400, 'Choose 1 to 200 dishes');
    if (!toTenantIds.length) throw httpError(400, 'Choose at least one branch');
    const dishes = await Product.find({ _id: { $in: productIds }, tenantId: fromTenantId });
    if (dishes.length !== new Set(productIds.map(String)).size) throw httpError(404, 'A chosen dish is not on this branch\'s menu');
    const out = { created: 0, updated: 0, branches: toTenantIds.length, dishes: dishes.length };
    for (const to of toTenantIds) {
        const cache = new Map();
        for (const d of dishes) out[await giveDish(d, to, cache, prices)] += 1;
    }
    return out;
}

module.exports = { copyMenu, push, CONTENT };
