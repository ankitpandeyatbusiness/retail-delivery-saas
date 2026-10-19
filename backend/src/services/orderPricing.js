// Prices a cart on the server. The app only sends WHAT the customer picked
// (product ids, quantities, option ids, coupon code, tip). Every price is worked out here.
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Coupon = require('../models/Coupon');
const Order = require('../models/Order');
const User = require('../models/User');
const { priceSelection } = require('./optionGroups');
const { priceMeasure } = require('./itemMeasure');
const { isOpenNow } = require('./categoryTimings');
const { foodModeFilter, activeNow } = require('./catalogQuery');
const { hashPhone } = require('../utils/phoneHash');
const { httpError } = require('../middlewares/apiErrors');
const stockSvc = require('./stockService');

const MAX_LINES = 30;
const MAX_QTY = 20;
const MAX_TIP = 500;
const ORDER_TYPES = ['delivery', 'pickup', 'dine_in'];

const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/* ------------------------------ 1. cart -> priced lines ------------------------------ */
async function buildLines(tenant, config, rawItems, at = new Date()) {
    if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > MAX_LINES) {
        throw httpError(400, `Your cart needs 1 to ${MAX_LINES} items`);
    }
    for (const it of rawItems) {
        if (!it || !isId(it.productId)) throw httpError(400, 'Invalid item in cart');
        if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > MAX_QTY) {
            throw httpError(400, `Quantity must be between 1 and ${MAX_QTY}`);
        }
        if (it.measureQty !== undefined && !Number.isInteger(it.measureQty)) throw httpError(400, 'Invalid amount in cart');
    }

    // a new shop day starts the daily quantities again (before the counts are read below)
    await stockSvc.ensureToday(tenant._id).catch(() => { });

    // Same visibility rules as the menu: active item, active category, allowed by the shop's food mode
    const cats = await Category.find({ tenantId: tenant._id, isActive: true }).select('_id timings').lean();
    const activeCategoryIds = cats.map((c) => c._id);
    const closedNow = new Set(cats.filter((c) => !isOpenNow(c.timings, at)).map((c) => String(c._id)));   // menu timings
    const products = await Product.find({
        _id: { $in: rawItems.map((i) => i.productId) },
        tenantId: tenant._id,
        isActive: true,
        categoryId: { $in: activeCategoryIds },
        ...foodModeFilter(config.home.foodMode),
    }).lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));

    // GST: the platform's one rate (config.orders.gst), on every item. Items and shops cannot set their own.
    const gstMode = config.orders.gst?.mode || 'none';
    const shopGst = config.orders.gst?.percent || 0;

    const notesOn = config.features.specialInstructions;
    let subtotal = 0;
    let prepMin = 0;
    const need = new Map();   // tracked stock: productId -> { productId, name, qty }
    const perOrder = new Map();   // productId -> pieces of it in this order, for the item's "most per order"
    const lines = rawItems.map((it) => {
        const p = byId.get(it.productId);
        if (!p) throw httpError(400, 'An item in your cart is no longer available');
        if (p.isAvailable === false) throw httpError(409, `"${p.name}" is out of stock`);
        if (closedNow.has(String(p.categoryId))) throw httpError(409, `"${p.name}" is not served at this time`);
        const sold = p.sellBy === 'weight' || p.sellBy === 'volume';
        if (sold && it.quantity !== 1) throw httpError(400, `"${p.name}" is sold by ${p.sellBy}: choose an amount, not a quantity`);
        if (!sold && it.measureQty !== undefined) throw httpError(400, `"${p.name}" is not sold by weight`);
        let { unitPrice, chosen } = priceSelection(p, it.selections ?? []);   // validates min/max and gives the real price
        let measure;
        if (sold) {
            // the price on the item is per kg (L): the pack price replaces it, option extras still add on top
            const m = priceMeasure(p, it.measureQty, tenant.businessType);
            unitPrice = m.unitPrice + (unitPrice - p.price);
            measure = { qty: m.qty, unit: m.unit, label: m.label };
        }
        if (p.maxPerOrder > 0 && !sold) {   // the shop limits how many of this one item an order may have (all its lines together)
            const got = (perOrder.get(String(p._id)) || 0) + it.quantity;
            if (got > p.maxPerOrder) throw httpError(409, `You can order at most ${p.maxPerOrder} of "${p.name}" in one order`);
            perOrder.set(String(p._id), got);
        }
        if (p.stock?.enabled) {
            // pieces for a normal item; grams / ml for an item sold by weight / volume (the amount IS the quantity)
            const key = String(p._id);
            const amount = measure ? measure.qty * it.quantity : it.quantity;
            const want = (need.get(key)?.qty || 0) + amount;
            if (p.stock.qty <= 0) throw httpError(409, `"${p.name}" is out of stock`);
            if (want > p.stock.qty) throw httpError(409, `There is not enough "${p.name}" left. Please order a little less.`);
            need.set(key, { productId: p._id, name: p.name, qty: want });
        }
        const lineTotal = round2(unitPrice * it.quantity);
        subtotal += lineTotal;
        prepMin = Math.max(prepMin, p.prepTimeMin || 0);

        return {
            productId: p._id,
            name: measure ? `${p.name} · ${measure.label}` : p.name,   // the amount travels with the name: riders, bills and SMS all show it
            image: p.image,
            isVeg: p.isVeg,
            quantity: it.quantity,
            unitPrice: round2(unitPrice),
            lineTotal,
            gstRate: gstMode === 'none' ? 0 : shopGst,
            selections: chosen,
            ...(measure ? { measure } : {}),
            note: notesOn && typeof it.note === 'string' && it.note.trim() ? it.note.trim().slice(0, 200) : undefined,
        };
    });
    return { lines, subtotal: round2(subtotal), prepMin, stockNeeds: [...need.values()] };
}

/* ------------------------------ 2. coupon ------------------------------ */
async function validateCoupon({ tenant, config, userId, code, subtotal }) {
    if (!config.offers.couponsEnabled) throw httpError(400, 'Coupons are not available at this shop');

    const clean = String(code).trim().toUpperCase().slice(0, 30);
    const c = await Coupon.findOne({ tenantId: tenant._id, code: clean, ...activeNow() }).lean();
    if (!c) throw httpError(400, 'Invalid or expired coupon');
    if (c.totalUsageLimit != null && c.usedCount >= c.totalUsageLimit) throw httpError(400, 'This coupon has been fully used');
    if (subtotal < (c.minOrder || 0)) throw httpError(400, `Add ₹${round2(c.minOrder - subtotal)} more to use ${c.code}`);

    // Check by phone hash (not just the user id): deleting the account and registering again must not give a second first-order coupon
    const user = await User.findById(userId).select('phone').lean();
    const identityFilter = user ? { 'customer.phoneHash': hashPhone(tenant._id, user.phone) } : { userId };

    if (c.firstOrderOnly) {
        // If they ever placed a non-cancelled order with this phone number, block it.
        const hasOrders = await Order.exists({ tenantId: tenant._id, ...identityFilter, status: { $ne: 'cancelled' } });
        if (hasOrders) throw httpError(400, 'This coupon is only for your first order');
    }
    if (c.usageLimitPerUser) {
        // Count all past uses attached to this phone number
        const used = await Order.countDocuments({ tenantId: tenant._id, ...identityFilter, couponId: c._id, status: { $ne: 'cancelled' } });
        if (used >= c.usageLimitPerUser) throw httpError(400, 'You have already used this coupon');
    }

    let discount = c.discountType === 'percent' ? (subtotal * c.discountValue) / 100 : c.discountValue;
    if (c.discountType === 'percent' && c.maxDiscount) discount = Math.min(discount, c.maxDiscount);
    return { _id: c._id, code: c.code, discount: round2(Math.min(discount, subtotal)) };
}

// Atomic: two people can never take the last use of a limited coupon
const reserveCoupon = (couponId, tenantId) => Coupon.findOneAndUpdate(
    {
        _id: couponId,
        tenantId,
        isActive: true,
        $expr: { $or: [{ $eq: [{ $ifNull: ['$totalUsageLimit', null] }, null] }, { $lt: ['$usedCount', '$totalUsageLimit'] }] },
    },
    { $inc: { usedCount: 1 } },
    { returnDocument: 'after' },
);
const releaseCoupon = (couponId) =>
    couponId ? Coupon.updateOne({ _id: couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } }) : null;

/* ------------------------------ 3. totals ------------------------------ */
// Delivery fee by distance: baseFee covers the first baseKm, every STARTED km after that adds perKmFee,
// maxFee (when above 0) is the top. Distance unknown (no address yet) = the base fee only.
function distanceFee(f, km) {
    const base = f.baseFee || 0;
    if (!Number.isFinite(km)) return base;
    const extra = Math.max(0, Math.ceil(km - (f.baseKm || 0) - 1e-9));
    let fee = base + extra * (f.perKmFee || 0);
    if (f.maxFee > 0) fee = Math.min(fee, f.maxFee);
    return round2(fee);
}
// Works out GST for each line, after sharing the coupon discount across the lines.
// Writes the result into each line (line.tax) and returns the order's total GST.
function applyTax(lines, { mode, discount, subtotal }) {
    let left = discount;
    lines.forEach((l, i) => {
        const share = i === lines.length - 1 ? left : round2(subtotal ? (discount * l.lineTotal) / subtotal : 0);
        left = round2(left - share);
        const taxable = Math.max(l.lineTotal - share, 0);
        const r = l.gstRate || 0;
        let t = 0;
        if (mode === 'exclusive') t = (taxable * r) / 100;
        else if (mode === 'inclusive') t = (taxable * r) / (100 + r);
        l.tax = round2(t);
    });
    return round2(lines.reduce((s, l) => s + l.tax, 0));
}

// Delivery and packaging are not taxed here: if your CA says they must be, add them in applyTax.
function computeTotals(orders, { orderType, subtotal, discount, tip, tax, distanceKm = null }) {
    let deliveryFee = 0;
    if (orderType === 'delivery') {
        const f = orders.deliveryFee || {};
        if (f.type === 'flat') deliveryFee = f.amount || 0;
        else if (f.type === 'free_above') deliveryFee = subtotal >= (f.freeAbove || 0) ? 0 : (f.amount || 0);
        else if (f.type === 'distance') deliveryFee = f.freeAbove > 0 && subtotal >= f.freeAbove ? 0 : distanceFee(f, distanceKm);
    }
    const packagingCharge = orderType === 'dine_in' ? 0 : (orders.packagingCharge || 0);
    const mode = orders.gst?.mode || 'none';

    const total = round2(subtotal - discount + deliveryFee + packagingCharge + (mode === 'exclusive' ? tax : 0) + tip);
    return {
        deliveryFee: round2(deliveryFee),
        packagingCharge: round2(packagingCharge),
        taxMode: mode,
        taxPercent: orders.gst?.percent || 0,
        tax,
        tip,
        total,
    };
}

async function priceCart({ tenant, config, userId, body, distanceKm = null }) {
    const orderType = body.orderType;
    if (!ORDER_TYPES.includes(orderType)) throw httpError(400, 'Invalid order type');

    // a scheduled order is checked against the menu timings of the chosen time
    const when = body.scheduledFor ? new Date(body.scheduledFor) : null;
    const at = when && !Number.isNaN(when.getTime()) ? when : new Date();
    const { lines, subtotal, prepMin, stockNeeds } = await buildLines(tenant, config, body.items, at);

    const coupon = body.couponCode
        ? await validateCoupon({ tenant, config, userId, code: body.couponCode, subtotal })
        : null;
    const discount = coupon ? coupon.discount : 0;

    // "use my points": whole rupees off, never more than the shop allows (loyaltyService.cartInfo)
    const loyalty = require('./loyaltyService');
    const pts = body.usePoints === true ? await loyalty.priceWithPoints({ tenant, userId, subtotal, couponDiscount: discount }) : null;
    const pointsDiscount = pts ? pts.rupees : 0;
    const discountAll = round2(discount + pointsDiscount);
    const pointsInfo = await loyalty.cartInfo({ tenant, userId, subtotal, couponDiscount: discount }).catch(() => ({ enabled: false }));

    const tip = body.tip === undefined ? 0 : body.tip;
    if (typeof tip !== 'number' || !Number.isFinite(tip) || tip < 0 || tip > MAX_TIP) throw httpError(400, 'Invalid tip');
    if (tip > 0 && (!config.features.tips || orderType !== 'delivery')) throw httpError(400, 'Tips are not available');

    const tax = applyTax(lines, { mode: config.orders.gst?.mode || 'none', discount: discountAll, subtotal });
    const totals = computeTotals(config.orders, { orderType, subtotal, discount: discountAll, tip: round2(tip), tax, distanceKm });
    return {
        orderType, lines, coupon, prepMin, stockNeeds, distanceKm, pointsInfo,
        pricing: { subtotal, discount: discountAll, couponCode: coupon?.code, pointsUsed: pts ? pts.points : 0, pointsDiscount, ...totals },
    };
}

module.exports = {
    ORDER_TYPES, isId, round2, buildLines, validateCoupon, reserveCoupon, releaseCoupon, applyTax, computeTotals, priceCart, distanceFee,
};