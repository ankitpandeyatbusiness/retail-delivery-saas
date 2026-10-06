const express = require('express');
const mongoose = require('mongoose');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const Category = require('../models/Category');
const Product = require('../models/Product');
const Banner = require('../models/Banner');
const Coupon = require('../models/Coupon');
const { SORTS, buildProductFilter, foodModeFilter, activeNow } = require('../services/catalogQuery');
const { resolveConfig } = require('../services/tenantConfigService');

const catalogRouter = express.Router();
catalogRouter.use(tenantRecognizer);   // every request knows its shop

const PRODUCT_SELECT = '-tenantId -createdAt -updatedAt -__v';
const MENU_LIMIT = 500;
const MENU_SORT = { sortOrder: 1, orderCount: -1, _id: 1 };

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const fail = (res, err) => {
    console.error('Catalog error:', err);
    res.status(500).json({ error: 'Something went wrong' });
};

// What every product query needs to know about this shop
async function shopContext(req) {
    const config = resolveConfig(req.tenant);
    const activeCategoryIds = await Category.find({ tenantId: req.tenant._id, isActive: true }).distinct('_id');
    return {
        config,
        ctx: {
            foodMode: config.home.foodMode,
            hideOutOfStock: config.menu.outOfStock === 'hide',
            activeCategoryIds,
        },
    };
}

catalogRouter.get('/categories', async (req, res) => {
    try {
        const items = await Category.find({ tenantId: req.tenant._id, isActive: true })
            .sort({ sortOrder: 1, _id: 1 })
            .select('name image sortOrder')
            .lean();
        res.json({ items });
    } catch (e) { fail(res, e); }
});

// Paged list (used by search results and filtered views)
catalogRouter.get('/products', async (req, res) => {
    try {
        const { ctx } = await shopContext(req);
        const page = clamp(parseInt(req.query.page, 10) || 1, 1, 1000);
        const limit = clamp(parseInt(req.query.limit, 10) || 20, 1, 30);
        const filter = buildProductFilter(req.tenant._id, req.query, ctx);
        const sort = SORTS[req.query.sort] || SORTS.popularity;

        // ask for one extra item to learn if there is a next page, no slow count needed
        const items = await Product.find(filter)
            .sort(sort)
            .skip((page - 1) * limit)
            .limit(limit + 1)
            .select(PRODUCT_SELECT)
            .lean();

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

        const byCategory = new Map(cats.map((c) => [String(c._id), { ...c, items: [] }]));
        products.forEach((p) => byCategory.get(String(p.categoryId))?.items.push(p));
        const categories = [...byCategory.values()].filter((c) => c.items.length);

        const searching = typeof req.query.q === 'string' && req.query.q.trim().length >= 2;
        const recommended = searching
            ? []
            : products
                .filter((p) => p.isBestseller && p.isAvailable)
                .sort((a, b) => b.orderCount - a.orderCount)
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
        res.json(item);
    } catch (e) { fail(res, e); }
});

catalogRouter.get('/banners', async (req, res) => {
    try {
        const items = await Banner.find({ tenantId: req.tenant._id, ...activeNow() })
            .sort({ sortOrder: 1, _id: 1 })
            .select('title subtitle image couponCode firstOrderOnly')
            .lean();
        res.json({ items });
    } catch (e) { fail(res, e); }
});

catalogRouter.get('/offers', async (req, res) => {
    try {
        if (!resolveConfig(req.tenant).offers.couponsEnabled) return res.json({ items: [] });

        const items = await Coupon.find({
            tenantId: req.tenant._id,
            isPublic: true,
            ...activeNow(),
            // hide coupons whose total usage limit is already used up
            $expr: {
                $or: [
                    { $eq: [{ $ifNull: ['$totalUsageLimit', null] }, null] },
                    { $lt: ['$usedCount', '$totalUsageLimit'] },
                ],
            },
        })
            .sort({ _id: -1 })
            .limit(10)
            .select('code description discountType discountValue maxDiscount minOrder firstOrderOnly endsAt')
            .lean();
        res.json({ items });
    } catch (e) { fail(res, e); }
});

module.exports = catalogRouter;