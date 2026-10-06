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
const Banner = require('../models/Banner');
const Coupon = require('../models/Coupon');
const Collection = require('../models/Collection');
const Order = require('../models/Order');
const { resolveConfig } = require('../services/tenantConfigService');
const { invalidateAvailability } = require('../services/availability');
const { foodRuleError } = require('../services/foodRules');
const { streamInvoice } = require('../services/invoiceService');
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
    fields: ['name', 'image', 'sortOrder', 'isActive'],
    sort: { sortOrder: 1, _id: 1 },
    searchField: 'name',
    softDelete: true,
}));

router.use('/products', crud(Product, {
    fields: [
        'categoryId', 'name', 'description', 'image', 'price', 'mrp',
        'isVeg', 'isEggless', 'isSugarFree', 'isJain', 'spiceLevel',
        'isBestseller', 'isNewArrival', 'isGiftPack', 'serves', 'calories', 'prepTimeMin',
        'optionGroups', 'sizes', 'weightOptions', 'addOns',
        'isAvailable', 'isActive', 'sortOrder', 'gstRate',
    ],
    sort: { sortOrder: 1, _id: 1 },
    searchField: 'name',
    softDelete: true,
    check: async (d, req) => {
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

/* ------------------------------ invoice ------------------------------ */
// GET /api/shop/orders/:id/invoice            downloads the PDF
// GET /api/shop/orders/:id/invoice?view=1     opens it in the browser instead
router.get('/orders/:id/invoice', wrap(async (req, res) => {
    const order = isId(req.params.id) ? await Order.findOne({ _id: req.params.id, tenantId: req.tenant._id }) : null;
    if (!order) throw httpError(404, 'Order not found');
    if (order.status !== 'delivered') throw httpError(409, 'The invoice is only available after delivery');
    streamInvoice(res, order, req.tenant, { inline: req.query.view === '1' });
}));

/* ------------------------------ sales report ------------------------------ */
// GET /api/shop/reports/sales?from=2026-10-01&to=2026-10-31&groupBy=day   (groupBy: day or month)
router.get('/reports/sales', wrap(async (req, res) => {
    const { from, to } = parseRange(req.query);
    res.json(await salesReport({ tenantId: req.tenant._id, from, to, groupBy: req.query.groupBy }));
}));

module.exports = router;