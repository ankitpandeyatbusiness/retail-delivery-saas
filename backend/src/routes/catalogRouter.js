const express = require('express');
const mongoose = require('mongoose');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const Category = require('../models/Category');
const Product = require('../models/Product');
const Banner = require('../models/Banner');
const Coupon = require('../models/Coupon');
const { SORTS, buildProductFilter, activeNow } = require('../services/catalogQuery');

const catalogRouter = express.Router();
catalogRouter.use(tenantRecognizer);   // every request knows its shop

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const fail = (res, err) => {
    console.error('Catalog error:', err);
    res.status(500).json({ error: 'Something went wrong' });
};

catalogRouter.get('/categories', async (req, res) => {
    try {
        const items = await Category.find({ tenantId: req.tenant._id, isActive: true })
            .sort({ sortOrder: 1, _id: 1 })
            .select('name image sortOrder')
            .lean();
        res.json({ items });
    } catch (e) { fail(res, e); }
});

catalogRouter.get('/products', async (req, res) => {
    try {
        const page = clamp(parseInt(req.query.page, 10) || 1, 1, 1000);
        const limit = clamp(parseInt(req.query.limit, 10) || 20, 1, 30);
        const filter = buildProductFilter(req.tenant._id, req.query);
        const sort = SORTS[req.query.sort] || SORTS.popularity;

        // ask for one extra item to learn if there is a next page, no slow count needed
        const items = await Product.find(filter)
            .sort(sort)
            .skip((page - 1) * limit)
            .limit(limit + 1)
            .select('-tenantId -createdAt -updatedAt -__v')
            .lean();

        const hasMore = items.length > limit;
        if (hasMore) items.pop();
        res.json({ items, page, hasMore });
    } catch (e) { fail(res, e); }
});

catalogRouter.get('/products/:id', async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Item not found' });
        const item = await Product.findOne({ _id: req.params.id, tenantId: req.tenant._id, isActive: true })
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
        const items = await Coupon.find({ tenantId: req.tenant._id, isPublic: true, ...activeNow() })
            .sort({ _id: -1 })
            .limit(10)
            .select('code description discountType discountValue maxDiscount minOrder firstOrderOnly endsAt')
            .lean();
        res.json({ items });
    } catch (e) { fail(res, e); }
});

module.exports = catalogRouter;