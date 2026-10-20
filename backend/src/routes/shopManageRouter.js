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
const { typeOf } = require('../config/businessTypes');
const { nextMorning } = require('../utils/nextMorning');

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
// The owner's whole menu in one go: every category (hidden ones too) with its item count, and light items.
router.get('/menu', wrap(async (req, res) => {
    await stockSvc.ensureToday(req.tenant._id);
    const tenantId = req.tenant._id;
    const [categories, products] = await Promise.all([
        Category.find({ tenantId }).sort({ sortOrder: 1, _id: 1 }).limit(200).lean(),
        Product.find({ tenantId, isActive: true }).sort({ sortOrder: 1, _id: 1 }).limit(600)
            .select('categoryId name image price mrp isVeg isAvailable unavailableUntil optionGroups stock sellBy itemKind isBestseller isNewArrival isGiftPack isJain isEggless isSugarFree sortOrder').lean(),
    ]);
    const counts = {};
    for (const p of products) counts[String(p.categoryId)] = (counts[String(p.categoryId)] || 0) + 1;
    res.json({
        categories: categories.map((c) => ({ ...c, itemCount: counts[String(c._id)] || 0 })),
        products,
        truncated: products.length >= 600,
    });
}));

// What the item form needs to know about this shop
router.get('/menu/options', wrap(async (req, res) => {
    const cfg = resolveConfig(req.tenant);
    const bt = typeOf(req.tenant.businessType);
    res.json({ foodMode: cfg.home?.foodMode || 'any', businessType: req.tenant.businessType || null, itemKinds: bt.itemKinds, measures: bt.measures });
}));

// Sold out for a while. Body: { available: true } | { available: false } | { available: false, minutes } | { available: false, untilMorning: true }
router.patch('/products/:id/availability', wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Item not found');
    const b = req.body || {};
    if (typeof b.available !== 'boolean') throw httpError(400, 'available must be true or false');
    const p = await Product.findOne({ _id: req.params.id, tenantId: req.tenant._id }).select('stock').lean();
    if (!p) throw httpError(404, 'Item not found');
    let until = null;
    if (!b.available) {
        if (b.untilMorning) until = nextMorning();
        else if (b.minutes !== undefined) {
            if (!Number.isInteger(b.minutes) || b.minutes < 1 || b.minutes > 1440) throw httpError(400, 'minutes must be from 1 to 1440');
            until = new Date(Date.now() + b.minutes * 60000);
        }
    } else if (p.stock?.enabled && !(p.stock.qty > 0)) {
        throw httpError(409, 'This item has no stock left. Add stock first.');
    }
    const update = b.available
        ? { $set: { isAvailable: true }, $unset: { unavailableUntil: 1 } }
        : until ? { $set: { isAvailable: false, unavailableUntil: until } } : { $set: { isAvailable: false }, $unset: { unavailableUntil: 1 } };
    const out = await Product.findOneAndUpdate({ _id: p._id, tenantId: req.tenant._id }, update, { returnDocument: 'after' })
        .select('name isAvailable unavailableUntil').lean();
    res.json({ id: out._id, name: out.name, isAvailable: out.isAvailable, unavailableUntil: out.unavailableUntil || null });
}));

// One portion (Half / Full / Small...) of an item on or off, without touching the others.
// Body: { groupId, optionId, available }. When no portion of a "must pick one" choice is left, the whole item is sold out;
// when the first portion comes back to an item that had none, the item is back too.
router.patch('/products/:id/option-availability', wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Item not found');
    const b = req.body || {};
    if (typeof b.available !== 'boolean' || typeof b.groupId !== 'string' || typeof b.optionId !== 'string') throw httpError(400, 'Send groupId, optionId and available');
    const p = await Product.findOne({ _id: req.params.id, tenantId: req.tenant._id });
    if (!p) throw httpError(404, 'Item not found');
    const g = (p.optionGroups || []).find((x) => x.id === b.groupId);
    const o = g && g.options.find((x) => x.id === b.optionId);
    if (!o) throw httpError(404, 'That choice was not found');
    const hadOne = g.options.some((x) => x.isAvailable !== false);
    o.isAvailable = b.available;
    // for a while: { minutes } or { untilMorning: true }; neither = off until the owner switches it on
    let until = null;
    if (!b.available) {
        if (b.untilMorning) until = nextMorning();
        else if (b.minutes !== undefined) {
            if (!Number.isInteger(b.minutes) || b.minutes < 1 || b.minutes > 1440) throw httpError(400, 'minutes must be from 1 to 1440');
            until = new Date(Date.now() + b.minutes * 60000);
        }
    }
    o.unavailableUntil = until || undefined;
    if ((g.min || 0) >= 1) {
        const hasOne = g.options.some((x) => x.isAvailable !== false);
        if (!hasOne) { p.isAvailable = false; p.unavailableUntil = undefined; }
        else if (!hadOne && !p.unavailableUntil) p.isAvailable = true;
    }
    p.markModified('optionGroups');
    await p.save();
    res.json({ id: p._id, isAvailable: p.isAvailable, unavailableUntil: p.unavailableUntil || null, optionGroups: p.optionGroups });
}));

// Put things in the order the owner dragged them. Body: { ids: [...] } — the first id becomes 0, and so on.
// Must be registered before the crud mounts, otherwise "/:id" would take the word "order".
const reorder = (path, Model) => router.put(`${path}/order`, wrap(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : null;
    if (!ids || !ids.length || ids.length > 700 || ids.some((x) => !isId(x)) || new Set(ids).size !== ids.length) {
        throw httpError(400, 'ids must be a list of valid, different ids');
    }
    const n = await Model.countDocuments({ _id: { $in: ids }, tenantId: req.tenant._id });
    if (n !== ids.length) throw httpError(400, 'Every id must belong to this shop');
    await Model.bulkWrite(ids.map((id, i) => ({
        updateOne: { filter: { _id: id, tenantId: req.tenant._id }, update: { $set: { sortOrder: i } } },
    })));
    res.json({ ok: true, count: ids.length });
}));
reorder('/categories', Category);
reorder('/products', Product);
reorder('/collections', Collection);
reorder('/banners', Banner);

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
    const unset = { unavailableUntil: 1 };   // the stock count decides now, not an earlier "sold out until"
    if (b.dailyQty !== undefined) set['stock.dailyQty'] = b.dailyQty;   // null clears it
    // the count entered now belongs to today: the daily reset must not wipe it before tomorrow
    if (enabled) set['stock.resetOn'] = stockSvc.dayKey();
    const out = await Product.findOneAndUpdate(
        { _id: p._id, tenantId: req.tenant._id },
        { $set: set, $unset: unset },
        { returnDocument: 'after' },
    ).select('name stock isAvailable sellBy').lean();
    res.json({ id: out._id, name: out.name, sellBy: out.sellBy, stock: out.stock, isAvailable: out.isAvailable });
}));

router.use('/products', crud(Product, {
    fields: [
        'categoryId', 'categoryName', 'name', 'description', 'image', 'price', 'mrp',
        'isVeg', 'isEggless', 'isSugarFree', 'isJain', 'spiceLevel',
        'isBestseller', 'isNewArrival', 'isGiftPack', 'serves', 'calories', 'prepTimeMin', 'maxPerOrder',
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
        'firstOrderOnly', 'dineInOnly', 'usageLimitPerUser', 'totalUsageLimit', 'isPublic', 'startsAt', 'endsAt', 'isActive',
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