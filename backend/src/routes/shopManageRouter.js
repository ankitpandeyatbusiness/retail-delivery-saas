// Everything a shop owner can manage for THEIR OWN shop. It is mounted inside shopRouter,
// so the login and the "is this person an owner of this shop?" check have already happened.
//
//   /api/shop/categories   /api/shop/products   /api/shop/banners
//   /api/shop/coupons      /api/shop/collections
//   /api/shop/orders/:id/invoice     (PDF download)
//   /api/shop/reports/sales

const express = require('express');
const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { applyItemRules } = require('../services/itemRules');
const stockSvc = require('../services/stockService');
const Banner = require('../models/Banner');
const Coupon = require('../models/Coupon');
const Collection = require('../models/Collection');
const Order = require('../models/Order');
const { resolveConfig } = require('../services/tenantConfigService');
const { invalidateAvailability } = require('../services/availability');
const { foodRuleError } = require('../services/foodRules');
const { streamInvoice } = require('../services/invoiceService');
const { timingsError } = require('../services/categoryTimings');
const { salesReport, parseRange } = require('../services/reportService');
const { wrap, httpError } = require('../middlewares/apiErrors');
const crud = require('../utils/crud');

const router = express.Router();
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);

// the shared crud code reads the shop from req.tenantDoc
router.use((req, res, next) => { req.tenantDoc = req.tenant; next(); });

// any change refreshes this shop's cached counts (so filters and strips appear or hide right away)
router.use((req, res, next) => {
    if (req.method !== 'GET') res.on('finish', () => invalidateAvailability(req.tenant._id));
    next();
});

const dateCheck = (d) => {
    if (d.startsAt && d.endsAt && new Date(d.endsAt) < new Date(d.startsAt)) throw httpError(400, 'endsAt must be after startsAt');
};

/* ------------------------------ menu ------------------------------ */
router.use('/categories', crud(Category, {
    fields: ['name', 'image', 'sortOrder', 'isActive', 'timings'],
    sort: { sortOrder: 1, _id: 1 },
    searchField: 'name',
    softDelete: true,
    check: (d) => {
        if (d.timings !== undefined) {
            const problem = timingsError(d.timings);
            if (problem) throw httpError(400, problem);
        }
    },
}));

// Stock of one item. Body: { enabled?, qty?, dailyQty? }
//   enabled   false = unlimited (the default). true = counted.
//   qty       what is left right now. Pieces; for an item sold by weight / volume, grams / millilitres.
//   dailyQty  what every new shop day starts with (null = no daily reset: the count only changes by hand and by orders)
// With counting on, the item is on sale only while qty is above 0. Turning it off puts the item on sale again.
router.patch('/products/:id/stock', wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Item not found');
    const b = req.body || {};
    if (b.enabled !== undefined && typeof b.enabled !== 'boolean') throw httpError(400, 'enabled must be true or false');
    const p = await Product.findOne({ _id: req.params.id, tenantId: req.tenant._id }).select('stock sellBy').lean();
    if (!p) throw httpError(404, 'Item not found');
    const max = p.sellBy === 'weight' || p.sellBy === 'volume' ? 100000000 : 100000;
    const whole = (v, name) => {
        if (!Number.isInteger(v) || v < 0 || v > max) throw httpError(400, `${name} must be a whole number from 0 to ${max}`);
    };
    if (b.qty !== undefined) whole(b.qty, 'qty');
    if (b.dailyQty !== undefined && b.dailyQty !== null) whole(b.dailyQty, 'dailyQty');
    if (b.enabled === undefined && b.qty === undefined && b.dailyQty === undefined) throw httpError(400, 'Send enabled, qty and/or dailyQty');

    const enabled = b.enabled !== undefined ? b.enabled : !!p.stock?.enabled;
    const qty = b.qty !== undefined ? b.qty : (p.stock?.qty || 0);
    const set = { 'stock.enabled': enabled, 'stock.qty': qty, isAvailable: enabled ? qty > 0 : true };
    if (b.dailyQty !== undefined) set['stock.dailyQty'] = b.dailyQty;   // null clears it
    // the count entered now belongs to today: the daily reset must not wipe it before tomorrow
    if (enabled) set['stock.resetOn'] = stockSvc.dayKey();
    const out = await Product.findOneAndUpdate(
        { _id: p._id, tenantId: req.tenant._id },
        { $set: set },
        { returnDocument: 'after' },
    ).select('name stock isAvailable sellBy').lean();
    res.json({ id: out._id, name: out.name, sellBy: out.sellBy, stock: out.stock, isAvailable: out.isAvailable });
}));

router.use('/products', crud(Product, {
    fields: [
        'categoryId', 'categoryName', 'name', 'description', 'image', 'price', 'mrp',
        'isVeg', 'isEggless', 'isSugarFree', 'isJain', 'spiceLevel',
        'isBestseller', 'isNewArrival', 'isGiftPack', 'serves', 'calories', 'prepTimeMin',
        'optionGroups', 'sizes', 'weightOptions', 'addOns',
        'itemKind', 'sellBy', 'measure',
        'isAvailable', 'isActive', 'sortOrder',
    ],
    sort: { sortOrder: 1, _id: 1 },
    searchField: 'name',
    softDelete: true,
    check: async (d, req) => {
        await applyItemRules(d, req.tenant);
        const ok = d.categoryId && isId(String(d.categoryId)) &&
            await Category.exists({ _id: d.categoryId, tenantId: req.tenant._id });
        if (!ok) throw httpError(400, 'categoryId must be a category of this shop');
        const problem = foodRuleError(resolveConfig(req.tenant).home.foodMode, d);
        if (problem) throw httpError(400, problem);
    },
}));

/* ------------------------------ offers and strips ------------------------------ */
router.use('/banners', crud(Banner, {
    fields: ['title', 'subtitle', 'image', 'couponCode', 'firstOrderOnly', 'startsAt', 'endsAt', 'sortOrder', 'isActive'],
    sort: { sortOrder: 1, _id: 1 },
    searchField: 'title',
    softDelete: false,
    check: dateCheck,
}));

router.use('/coupons', crud(Coupon, {
    // usedCount is deliberately NOT editable: only real orders change it
    fields: [
        'code', 'description', 'discountType', 'discountValue', 'maxDiscount', 'minOrder',
        'firstOrderOnly', 'usageLimitPerUser', 'totalUsageLimit', 'isPublic', 'startsAt', 'endsAt', 'isActive',
    ],
    sort: { _id: -1 },
    searchField: 'code',
    softDelete: true,
    check: (d) => {
        if (d.discountType === 'percent' && d.discountValue > 100) throw httpError(400, 'A percent coupon cannot be more than 100');
        dateCheck(d);
    },
}));

router.use('/collections', crud(Collection, {
    fields: ['kind', 'title', 'subtitle', 'image', 'productIds', 'startsAt', 'endsAt', 'sortOrder', 'isActive'],
    sort: { sortOrder: 1, _id: 1 },
    searchField: 'title',
    softDelete: false,
    check: async (d, req) => {
        dateCheck(d);
        const ids = Array.isArray(d.productIds) ? d.productIds.map(String) : [];
        if (ids.some((x) => !isId(x))) throw httpError(400, 'productIds must be valid ids');
        if (ids.length) {
            const n = await Product.countDocuments({ _id: { $in: ids }, tenantId: req.tenant._id });
            if (n !== new Set(ids).size) throw httpError(400, 'Every product must belong to this shop');
        }
    },
}));

module.exports = router;