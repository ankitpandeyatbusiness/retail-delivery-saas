// All order rules live here. The app only sends WHAT the customer picked
// (product ids, quantities, option ids, coupon code, tip). Every price is worked out on the server.

const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Coupon = require('../models/Coupon');
const Order = require('../models/Order');
const Counter = require('../models/Counter');
const Address = require('../models/Address');
const User = require('../models/User');
const { priceSelection } = require('./optionGroups');
const { foodModeFilter, activeNow } = require('./catalogQuery');
const { resolveConfig, openStatus } = require('./tenantConfigService');
const { nextStatuses, customerCanCancel } = require('./orderflow'); // lowercase: matches the real file name
const { serviceability } = require('../utils/geo');

const MAX_LINES = 30;
const MAX_QTY = 20;
const MAX_TIP = 500;
const MAX_SCHEDULE_DAYS = 7;
const ORDER_TYPES = ['delivery', 'pickup', 'dine_in'];
const TYPE_LABEL = { delivery: 'delivery', pickup: 'pickup', dine_in: 'dine-in' };

const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const httpError = (status, message) => Object.assign(new Error(message), { status });

/* ------------------------------ 1. cart -> priced lines ------------------------------ */
async function buildLines(tenant, config, rawItems) {
    if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > MAX_LINES) {
        throw httpError(400, `Your cart needs 1 to ${MAX_LINES} items`);
    }
    for (const it of rawItems) {
        if (!it || !isId(it.productId)) throw httpError(400, 'Invalid item in cart');
        if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > MAX_QTY) {
            throw httpError(400, `Quantity must be between 1 and ${MAX_QTY}`);
        }
    }

    // Same visibility rules as the menu: active item, active category, allowed by the shop's food mode
    const activeCategoryIds = await Category.find({ tenantId: tenant._id, isActive: true }).distinct('_id');
    const products = await Product.find({
        _id: { $in: rawItems.map((i) => i.productId) },
        tenantId: tenant._id,
        isActive: true,
        categoryId: { $in: activeCategoryIds },
        ...foodModeFilter(config.home.foodMode),
    }).lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));

    // GST: an item's own rate wins, otherwise the shop's rate. The mode comes from the shop settings.
    const gstMode = config.orders.gst?.mode || 'none';
    const shopGst = config.orders.gst?.percent || 0;

    const notesOn = config.features.specialInstructions;
    let subtotal = 0;
    let prepMin = 0;
    const lines = rawItems.map((it) => {
        const p = byId.get(it.productId);
        if (!p) throw httpError(400, 'An item in your cart is no longer available');
        if (p.isAvailable === false) throw httpError(409, `"${p.name}" is out of stock`);

        const { unitPrice, chosen } = priceSelection(p, it.selections ?? []);   // validates min/max and gives the real price
        const lineTotal = round2(unitPrice * it.quantity);
        subtotal += lineTotal;
        prepMin = Math.max(prepMin, p.prepTimeMin || 0);

        return {
            productId: p._id,
            name: p.name,
            image: p.image,
            isVeg: p.isVeg,
            quantity: it.quantity,
            unitPrice: round2(unitPrice),
            lineTotal,
            gstRate: gstMode === 'none' ? 0 : (p.gstRate ?? shopGst),
            selections: chosen,
            note: notesOn && typeof it.note === 'string' && it.note.trim() ? it.note.trim().slice(0, 200) : undefined,
        };
    });
    return { lines, subtotal: round2(subtotal), prepMin };
}

/* ------------------------------ 2. coupon ------------------------------ */
async function validateCoupon({ tenant, config, userId, code, subtotal }) {
    if (!config.offers.couponsEnabled) throw httpError(400, 'Coupons are not available at this shop');

    const clean = String(code).trim().toUpperCase().slice(0, 30);
    const c = await Coupon.findOne({ tenantId: tenant._id, code: clean, ...activeNow() }).lean();
    if (!c) throw httpError(400, 'Invalid or expired coupon');
    if (c.totalUsageLimit != null && c.usedCount >= c.totalUsageLimit) throw httpError(400, 'This coupon has been fully used');
    if (subtotal < (c.minOrder || 0)) throw httpError(400, `Add ₹${round2(c.minOrder - subtotal)} more to use ${c.code}`);

    // EXPLOIT FIX: Check by Phone Number, not just User ID
    const user = await User.findById(userId).select('phone').lean();
    const identityFilter = user ? { 'customer.phone': user.phone } : { userId };

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
    { new: true },
);
const releaseCoupon = (couponId) =>
    couponId ? Coupon.updateOne({ _id: couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } }) : null;

/* ------------------------------ 3. totals ------------------------------ */
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
function computeTotals(orders, { orderType, subtotal, discount, tip, tax }) {
    let deliveryFee = 0;
    if (orderType === 'delivery') {
        const f = orders.deliveryFee || {};
        if (f.type === 'flat') deliveryFee = f.amount || 0;
        else if (f.type === 'free_above') deliveryFee = subtotal >= (f.freeAbove || 0) ? 0 : (f.amount || 0);
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

async function priceCart({ tenant, config, userId, body }) {
    const orderType = body.orderType;
    if (!ORDER_TYPES.includes(orderType)) throw httpError(400, 'Invalid order type');

    const { lines, subtotal, prepMin } = await buildLines(tenant, config, body.items);

    const coupon = body.couponCode
        ? await validateCoupon({ tenant, config, userId, code: body.couponCode, subtotal })
        : null;
    const discount = coupon ? coupon.discount : 0;

    const tip = body.tip === undefined ? 0 : body.tip;
    if (typeof tip !== 'number' || !Number.isFinite(tip) || tip < 0 || tip > MAX_TIP) throw httpError(400, 'Invalid tip');
    if (tip > 0 && (!config.features.tips || orderType !== 'delivery')) throw httpError(400, 'Tips are not available');

    const tax = applyTax(lines, { mode: config.orders.gst?.mode || 'none', discount, subtotal });
    const totals = computeTotals(config.orders, { orderType, subtotal, discount, tip: round2(tip), tax });
    return {
        orderType, lines, coupon, prepMin,
        pricing: { subtotal, discount, couponCode: coupon?.code, ...totals },
    };
}

/* ------------------------------ 4. can this order be placed? ------------------------------ */
// Returns null if fine, or { status, message } for the first problem found.
function checkPlacement({ tenant, config, body, priced, address }) {
    const o = config.orders;

    if (!o.types.includes(priced.orderType)) return { status: 400, message: `This shop does not offer ${TYPE_LABEL[priced.orderType]}` };
    if (!o.payments.includes(body.paymentMethod)) return { status: 400, message: 'This payment method is not available' };

    // open now, or open at the chosen time
    if (body.scheduledFor) {
        if (!config.features.scheduleOrder) return { status: 400, message: 'Scheduled orders are not available' };
        const when = new Date(body.scheduledFor);
        if (Number.isNaN(when.getTime())) return { status: 400, message: 'Invalid time' };
        if (when.getTime() < Date.now() + (o.prepTimeMin || 0) * 60000) return { status: 400, message: 'Please pick a later time' };
        if (when.getTime() > Date.now() + MAX_SCHEDULE_DAYS * 86400000) return { status: 400, message: `You can schedule up to ${MAX_SCHEDULE_DAYS} days ahead` };
        const st = openStatus(config.hours.weekly, o.acceptingOrders, when);
        if (!st.isOpen) return { status: 409, message: st.reason === 'paused' ? 'The shop is not accepting orders right now' : 'The shop is closed at that time' };
    } else if (!config.restaurant.isOpen) {
        return {
            status: 409,
            message: config.restaurant.closedReason === 'paused' ? 'The shop is not accepting orders right now' : config.hours.closedMessage,
        };
    }

    if (priced.pricing.subtotal < (o.minOrder || 0)) return { status: 400, message: `Minimum order is ₹${o.minOrder}` };

    if (priced.orderType === 'delivery') {
        if (!address) return { status: 400, message: 'Please choose a delivery address' };
        const s = serviceability(tenant, address.latitude, address.longitude);
        if (!s.serviceable) return { status: 400, message: s.message };
    }
    if (priced.orderType === 'dine_in') {
        const t = typeof body.tableNo === 'string' ? body.tableNo.trim() : '';
        if (!t || t.length > 10) return { status: 400, message: 'Table number is required' };
    }
    return null;
}

async function prepare({ tenant, userId, body }) {
    const config = resolveConfig(tenant);
    const priced = await priceCart({ tenant, config, userId, body });

    let address = null;
    if (priced.orderType === 'delivery' && body.addressId !== undefined) {
        if (!isId(body.addressId)) throw httpError(400, 'Invalid address');
        address = await Address.findOne({ _id: body.addressId, tenantId: tenant._id, userId }).lean();
        if (!address) throw httpError(400, 'Address not found');
    }
    return { config, priced, address, problem: checkPlacement({ tenant, config, body, priced, address }) };
}

/* ------------------------------ 5. quote (cart screen) ------------------------------ */
async function quote({ tenant, userId, body }) {
    const { priced, problem } = await prepare({ tenant, userId, body });
    return {
        items: priced.lines,
        pricing: priced.pricing,
        canPlace: !problem,
        problem: problem ? problem.message : null,
    };
}

/* ------------------------------ 6. place order ------------------------------ */
async function nextOrderNo(tenantId) {
    const c = await Counter.findOneAndUpdate(
        { _id: `order:${tenantId}` },
        { $inc: { seq: 1 } },
        { new: true, upsert: true },
    );
    return 1000 + c.seq;   // first order is #1001
}

async function placeOrder({ tenant, userId, body, idempotencyKey }) {
    const findDuplicate = () => Order.findOne({ tenantId: tenant._id, userId, idempotencyKey });

    // double-tap or retry after a bad network: return the order that was already made
    if (idempotencyKey) {
        const dup = await findDuplicate();
        if (dup) return { order: dup, duplicate: true };
    }

    const { config, priced, address, problem } = await prepare({ tenant, userId, body });
    if (problem) throw httpError(problem.status, problem.message);

    if (priced.coupon) {
        const reserved = await reserveCoupon(priced.coupon._id, tenant._id);
        if (!reserved) throw httpError(409, 'This coupon is no longer available');
    }

    try {
        const user = await User.findById(userId).select('name phone').lean();
        const orderNo = await nextOrderNo(tenant._id);
        const order = await Order.create({
            tenantId: tenant._id,
            userId,
            orderNo,
            idempotencyKey: idempotencyKey || undefined,
            orderType: priced.orderType,
            items: priced.lines,
            pricing: priced.pricing,
            couponId: priced.coupon?._id,
            // copied now, so the invoice stays correct even if the shop's details change later
            seller: {
                name: tenant.business?.legalName || tenant.name,
                gstin: tenant.business?.gstin,
                fssai: tenant.business?.fssai,
            },
            payment: { method: body.paymentMethod, status: 'pending' },
            customer: { name: user?.name, phone: user?.phone },
            address: address ? {
                label: address.label, name: address.name, phone: address.phone, line1: address.line1, line2: address.line2,
                landmark: address.landmark, city: address.city, pincode: address.pincode,
                latitude: address.latitude, longitude: address.longitude,
            } : undefined,
            tableNo: priced.orderType === 'dine_in' ? String(body.tableNo).trim() : undefined,
            scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : undefined,
            note: config.features.specialInstructions && typeof body.note === 'string' && body.note.trim()
                ? body.note.trim().slice(0, 300) : undefined,
            etaMin: Math.max(config.orders.prepTimeMin || 0, priced.prepMin),
            statusHistory: [{ status: 'placed', by: userId }],
        });
        return { order, duplicate: false };
    } catch (e) {
        await releaseCoupon(priced.coupon?._id);   // the order was not created, give the coupon use back
        if (e.code === 11000 && idempotencyKey) {
            const dup = await findDuplicate();
            if (dup) return { order: dup, duplicate: true };
        }
        throw e;
    }
}

/* ------------------------------ 7. customer actions ------------------------------ */
async function cancelByCustomer({ tenant, userId, orderId, reason }) {
    const order = await Order.findOne({ _id: orderId, tenantId: tenant._id, userId });
    if (!order) throw httpError(404, 'Order not found');

    // Feed both the order AND the tenant into the escape hatch logic
    if (!customerCanCancel(order, tenant)) {
        throw httpError(409, 'You can cancel only before the shop accepts your order (unless the shop is suspended)');
    }

    const cleanNote = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 200) : undefined;

    // We use Optimistic Locking (status: order.status) so it fails if the shop just delivered it
    const updated = await Order.findOneAndUpdate(
        { _id: order._id, status: order.status },
        {
            $set: { status: 'cancelled', cancelledBy: 'customer', cancelReason: cleanNote },
            $push: { statusHistory: { status: 'cancelled', by: userId, note: cleanNote } },
        },
        { new: true },
    );

    if (!updated) throw httpError(409, 'This order was just updated. Refresh and try again.');

    await releaseCoupon(updated.couponId);
    return updated;
}

// Turns an old order back into cart lines. Skips items that are gone or whose options changed.
// The app should call /quote afterwards to get today's prices.
async function reorderCart({ tenant, userId, orderId }) {
    const config = resolveConfig(tenant);
    if (!config.features.reorder) throw httpError(400, 'Reorder is not available at this shop');
    const order = await Order.findOne({ _id: orderId, tenantId: tenant._id, userId });
    if (!order) throw httpError(404, 'Order not found');

    const items = [];
    const skipped = [];
    for (const l of order.items) {
        const byGroup = new Map();
        for (const s of l.selections || []) {
            if (!byGroup.has(s.groupId)) byGroup.set(s.groupId, []);
            byGroup.get(s.groupId).push(s.optionId);
        }
        const line = {
            productId: String(l.productId),
            quantity: l.quantity,
            selections: [...byGroup].map(([groupId, optionIds]) => ({ groupId, optionIds })),
            note: l.note,
        };
        try {
            await buildLines(tenant, config, [line]);
            items.push(line);
        } catch (e) {
            skipped.push(l.name);
        }
    }
    return { items, skipped };
}

/* ------------------------------ 8. shop actions ------------------------------ */
async function updateStatusByShop({ tenantId, adminId, orderId, status, note }) {
    const order = await Order.findOne({ _id: orderId, tenantId });
    if (!order) throw httpError(404, 'Order not found');

    if (!nextStatuses(order).includes(status)) {
        throw httpError(409, `This order is "${order.status}". It cannot move to "${status}".`);
    }
    const cleanNote = typeof note === 'string' && note.trim() ? note.trim().slice(0, 200) : undefined;
    if (status === 'cancelled' && !cleanNote) throw httpError(400, 'Please give a reason for cancelling');

    const set = { status };
    if (status === 'delivered') {
        set.deliveredAt = new Date();
        if (order.payment?.method === 'cod') set['payment.status'] = 'paid';   // cash collected at the door
    }
    if (status === 'cancelled') { set.cancelledBy = 'shop'; set.cancelReason = cleanNote; }

    const updated = await Order.findOneAndUpdate(
        { _id: orderId, tenantId, status: order.status },   // fails if someone else moved it a moment ago
        { $set: set, $push: { statusHistory: { status, by: adminId, note: cleanNote } } },
        { new: true },
    );
    if (!updated) throw httpError(409, 'This order was just updated. Refresh and try again.');

    if (status === 'cancelled') await releaseCoupon(updated.couponId);
    if (status === 'delivered') {
        // --- FIX STARTS HERE: Block admins from farming bestsellers ---
        const buyer = await User.findById(order.userId).select('role').lean();

        // Only increment the Bestseller counts if a normal customer bought it
        if (!buyer || buyer.role !== 'admin') {
            await Product.bulkWrite(updated.items.map((l) => ({
                updateOne: { filter: { _id: l.productId, tenantId }, update: { $inc: { orderCount: l.quantity } } },
            })));
        }
        // --- FIX ENDS HERE ---
    }
    return updated;
}

module.exports = {
    quote, placeOrder, cancelByCustomer, reorderCart, updateStatusByShop,
    customerCanCancel, nextStatuses,
};