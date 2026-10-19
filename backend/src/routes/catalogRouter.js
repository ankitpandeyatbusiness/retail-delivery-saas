const express = require('express');
const mongoose = require('mongoose');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const Category = require('../models/Category');
const Product = require('../models/Product');
const Banner = require('../models/Banner');
const Coupon = require('../models/Coupon');
const { SORTS, buildProductFilter, foodModeFilter, activeNow } = require('../services/catalogQuery');
const { rank } = require('../services/fuzzySearch');
const { publicProduct } = require('../services/stockHints');
const { ensureToday } = require('../services/stockService');
const { resolveConfig } = require('../services/tenantConfigService');
const { openCategoryIds, isOpenNow } = require('../services/categoryTimings');
const optionalAuth = require('../middlewares/optionalAuth');
const Order = require('../models/Order');
const User = require('../models/User');
const { hashPhone } = require('../utils/phoneHash');

const catalogRouter = express.Router();
catalogRouter.use(tenantRecognizer);   // every request knows its shop

const PRODUCT_SELECT = '-tenantId -createdAt -updatedAt -__v';   // the stock count is turned into hints (publicProduct) and removed
const MENU_LIMIT = 500;
const MENU_SORT = { sortOrder: 1, orderCount: -1, _id: 1 };

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const fail = (res, err) => {
    console.error('Catalog error:', err);
    res.status(500).json({ error: 'Something went wrong' });
};

// What every product query needs to know about this shop
async function shopContext(req) {
    await ensureToday(req.tenant._id).catch(() => { });
    const config = resolveConfig(req.tenant);
    const activeCategoryIds = await openCategoryIds(req.tenant._id);   // active AND inside their menu timings
    return {
        config,
        ctx: {
            foodMode: config.home.foodMode,
            hideOutOfStock: config.menu.outOfStock === 'hide',
            activeCategoryIds,
        },
    };
}

async function isReturningCustomer(tenantId, userId) {
    if (!userId) return false;
    const user = await User.findById(userId).select('phone').lean();
    if (!user) return false;
    return await Order.exists({ tenantId, 'customer.phoneHash': hashPhone(tenantId, user.phone), status: { $ne: 'cancelled' } });
}

catalogRouter.get('/categories', async (req, res) => {
    try {
        const rows = await Category.find({ tenantId: req.tenant._id, isActive: true })
            .sort({ sortOrder: 1, _id: 1 })
            .select('name image sortOrder timings')
            .lean();
        const open = rows.filter((c) => isOpenNow(c.timings));

        // a category with no picture of its own shows the first picture uploaded to one of its dishes
        const bare = open.filter((c) => !c.image).map((c) => c._id);
        if (bare.length) {
            const firsts = await Product.aggregate([
                { $match: { tenantId: req.tenant._id, isActive: true, categoryId: { $in: bare }, image: { $type: 'string', $ne: '' } } },
                { $sort: { _id: 1 } },
                { $group: { _id: '$categoryId', image: { $first: '$image' } } },
            ]);
            const byCat = new Map(firsts.map((x) => [String(x._id), x.image]));
            open.forEach((c) => { if (!c.image && byCat.has(String(c._id))) c.image = byCat.get(String(c._id)); });
        }
        res.json({ items: open });
    } catch (e) { fail(res, e); }
});

// Paged list (used by search results and filtered views)
catalogRouter.get('/products', async (req, res) => {
    try {
        const { ctx } = await shopContext(req);
        const page = clamp(parseInt(req.query.page, 10) || 1, 1, 1000);
        const limit = clamp(parseInt(req.query.limit, 10) || 20, 1, 30);
        const term = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 40) : '';
        const fuzzy = term.length >= 2;
        // with a search word the text match is done below (typo tolerant), so build the filter without it
        const filter = buildProductFilter(req.tenant._id, fuzzy ? { ...req.query, q: undefined } : req.query, ctx);
        const sort = SORTS[req.query.sort] || SORTS.popularity;

        let finder = Product.find(filter);
        let orderIds = null;
        if (fuzzy) {
            // every dish this customer may see (same filters), ranked by how close its name is to what was typed
            const pool = await Product.find(filter).select('name description').limit(MENU_LIMIT).lean();
            const ranked = rank(term, pool);
            if (!ranked.length) return res.json({ items: [], page, hasMore: false });
            const ids = ranked.map((r) => r._id);
            finder = Product.find({ _id: { $in: ids } });
            // best match first, unless the customer picked a sort
            if (!SORTS[req.query.sort]) orderIds = ids;
        }

        // ask for one extra item to learn if there is a next page, no slow count needed
        let items;
        if (orderIds) {
            const pageIds = orderIds.slice((page - 1) * limit, page * limit + 1);
            const rows = await Product.find({ _id: { $in: pageIds } }).select(PRODUCT_SELECT).lean();
            const byId = new Map(rows.map((p) => [String(p._id), p]));
            items = pageIds.map((id) => byId.get(String(id))).filter(Boolean).map(publicProduct);
        } else {
            items = await finder
                .sort(sort)
                .skip((page - 1) * limit)
                .limit(limit + 1)
                .select(PRODUCT_SELECT)
                .lean();
            items.forEach(publicProduct);
        }

        const hasMore = items.length > limit;
        if (hasMore) items.pop();
        res.json({ items, page, hasMore });
    } catch (e) { fail(res, e); }
});

// Whole menu in one call, grouped by category, like a Zomato restaurant page.
// Accepts the same filters as /products (veg, minRating, q, ...).
catalogRouter.get('/menu', async (req, res) => {
    try {
        const { ctx } = await shopContext(req);
        const filter = buildProductFilter(req.tenant._id, req.query, ctx);
        const sort = SORTS[req.query.sort] || MENU_SORT;

        const [cats, products] = await Promise.all([
            Category.find({ tenantId: req.tenant._id, isActive: true })
                .sort({ sortOrder: 1, _id: 1 })
                .select('name image sortOrder')
                .lean(),
            Product.find(filter).sort(sort).limit(MENU_LIMIT + 1).select(PRODUCT_SELECT).lean(),
        ]);

        const truncated = products.length > MENU_LIMIT;
        if (truncated) products.pop();
        products.forEach(publicProduct);

        const byCategory = new Map(cats.map((c) => [String(c._id), { ...c, items: [] }]));
        products.forEach((p) => byCategory.get(String(p.categoryId))?.items.push(p));
        // no picture of its own: the picture of the dish uploaded first to this category
        byCategory.forEach((c) => {
            if (c.image) return;
            const first = c.items.filter((p) => p.image).sort((a, b) => String(a._id).localeCompare(String(b._id)))[0];
            if (first) c.image = first.image;
        });
        const categories = [...byCategory.values()].filter((c) => c.items.length);

        const searching = typeof req.query.q === 'string' && req.query.q.trim().length >= 2;
        const recommended = searching
            ? []
            : products
                // a sold-out bestseller stays in Popular (greyed out) unless the shop chose to hide sold-out dishes; available ones come first
                .filter((p) => p.isBestseller && (p.isAvailable || !ctx.hideOutOfStock))
                .sort((a, b) => (b.isAvailable ? 1 : 0) - (a.isAvailable ? 1 : 0) || b.orderCount - a.orderCount)
                .slice(0, 10);

        res.json({ categories, recommended, truncated });
    } catch (e) { fail(res, e); }
});

catalogRouter.get('/products/:id', async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Item not found' });
        const { ctx } = await shopContext(req);
        const item = await Product.findOne({
            _id: req.params.id,
            tenantId: req.tenant._id,
            isActive: true,
            categoryId: { $in: ctx.activeCategoryIds },
            ...foodModeFilter(ctx.foodMode),   // a veg shop can't leak a non-veg item by direct ID
        })
            .select('-tenantId -__v')
            .lean();
        if (!item) return res.status(404).json({ error: 'Item not found' });
        res.json(publicProduct(item));
    } catch (e) { fail(res, e); }
});

catalogRouter.get('/banners', optionalAuth, async (req, res) => {
    try {
        const isReturning = await isReturningCustomer(req.tenant._id, req.auth?.userId);
        const filter = { tenantId: req.tenant._id, ...activeNow() };
        if (isReturning) filter.firstOrderOnly = { $ne: true };

        const items = await Banner.find(filter)
            .sort({ sortOrder: 1, _id: 1 })
            .select('title subtitle image couponCode firstOrderOnly')
            .lean();
        res.json({ items });
    } catch (e) { fail(res, e); }
});

catalogRouter.get('/offers', optionalAuth, async (req, res) => {
    try {
        if (!resolveConfig(req.tenant).offers.couponsEnabled) return res.json({ items: [] });

        const isReturning = await isReturningCustomer(req.tenant._id, req.auth?.userId);
        const filter = {
            tenantId: req.tenant._id,
            isPublic: true,
            ...activeNow(),
            $expr: {
                $or: [
                    { $eq: [{ $ifNull: ['$totalUsageLimit', null] }, null] },
                    { $lt: ['$usedCount', '$totalUsageLimit'] },
                ],
            },
        };
        if (isReturning) filter.firstOrderOnly = { $ne: true };

        const items = await Coupon.find(filter)
            .sort({ _id: -1 })
            .limit(10)
            .select('code description discountType discountValue maxDiscount minOrder firstOrderOnly endsAt')
            .lean();
        res.json({ items });
    } catch (e) { fail(res, e); }
});

module.exports = catalogRouter;