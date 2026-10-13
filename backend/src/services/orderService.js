// Order rules: can this order be placed, quote, place, cancel, reorder.
// Pricing is in orderPricing.js and pickup windows are in pickupSlots.js.
// The app only sends WHAT the customer picked. Every price is worked out on the server.

const crypto = require('crypto');
const Order = require('../models/Order');
const Counter = require('../models/Counter');
const Address = require('../models/Address');
const User = require('../models/User');
const Coupon = require('../models/Coupon');
const CustomerRisk = require('../models/CustomerRisk');
const OrderGuard = require('../models/OrderGuard');
const { resolveConfig, openStatus } = require('./tenantConfigService');
const { nextStatuses, customerCanCancel } = require('./orderflow'); // lowercase: matches the real file name
const { serviceability, haversineKm } = require('../utils/geo');
const orderStatus = require('./orderStatusService');
const notify = require('./notificationService');
const { hashPhone } = require('../utils/phoneHash');
const { httpError } = require('../middlewares/apiErrors');
const { isId, round2, buildLines, reserveCoupon, releaseCoupon, priceCart } = require('./orderPricing');
const { pickupSlots, findPickupSlot } = require('./pickupSlots');
const stock = require('./stockService');

const MAX_SCHEDULE_DAYS = 7;
const TYPE_LABEL = { delivery: 'delivery', pickup: 'pickup', dine_in: 'dine-in' };
const SAME_CART_WINDOW_MS = 10 * 1000;   // the same cart twice inside 10 seconds is a double tap

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ can this order be placed? ------------------------------ */
// Returns null if fine, or { status, message } for the first problem found.
// cod = { earlierOrders, blocked } (only worked out for Cash on delivery orders)
function checkPlacement({ tenant, config, body, priced, address, user, cod }) {
    const o = config.orders;

    if (!o.types.includes(priced.orderType)) return { status: 400, message: `This shop does not offer ${TYPE_LABEL[priced.orderType]}` };
    // unpaid rent after grace (the shop is already shown as not accepting orders; this is a second guard)
    if (tenant.billing?.state === 'paused') return { status: 409, message: 'The shop is not accepting orders right now' };

    // No COD during free service. Switched on with ENFORCE_NO_COD_IN_FREE=true (keep it OFF until online payments exist)
    const noCod = process.env.ENFORCE_NO_COD_IN_FREE === 'true' && tenant.billing?.state === 'free';
    const methods = noCod ? o.payments.filter((m) => m !== 'cod') : o.payments;
    if (!methods.includes(body.paymentMethod)) {
        return { status: 400, message: noCod && body.paymentMethod === 'cod' ? 'Cash on delivery is not available right now' : 'This payment method is not available' };
    }

    // Cash on delivery rules: a blocked phone, and a limit for the first orders of a new phone
    if (body.paymentMethod === 'cod') {
        if (cod?.blocked) return { status: 400, message: 'Cash on delivery is not available for this number' };
        const cap = o.codCap || {};
        if (cap.amount > 0 && cap.firstOrders > 0 && (cod?.earlierOrders ?? 0) < cap.firstOrders && priced.pricing.total > cap.amount) {
            return {
                status: 400,
                message: `Cash on delivery is limited to Rs ${cap.amount} for your first ${cap.firstOrders} orders. Pay online or reduce the order.`,
            };
        }
    }

    // open now, or open at the chosen time
    if (priced.orderType === 'pickup') {
        // pickup always needs a time window from /orders/pickup-slots, and the shop must be open right now
        if (!config.restaurant.isOpen) {
            return { status: 409, message: config.restaurant.closedReason === 'paused' ? 'The shop is not accepting orders right now' : config.restaurant.closedMessage };
        }
        if (!findPickupSlot(tenant, body.pickupSlot)) {
            return { status: 409, message: body.pickupSlot ? 'That pickup time is no longer available. Pick another.' : 'Please pick a pickup time' };
        }
    } else if (body.scheduledFor) {
        if (!config.features.scheduleOrder) return { status: 400, message: 'Scheduled orders are not available' };
        const when = new Date(body.scheduledFor);
        if (Number.isNaN(when.getTime())) return { status: 400, message: 'Invalid time' };
        if (when.getTime() < Date.now() + (o.prepTimeMin || 0) * 60000) return { status: 400, message: 'Please pick a later time' };
        if (when.getTime() > Date.now() + MAX_SCHEDULE_DAYS * 86400000) return { status: 400, message: `You can schedule up to ${MAX_SCHEDULE_DAYS} days ahead` };
        const st = openStatus(config.hours.weekly, o.acceptingOrders, when, config.hours.closedDates);
        if (!st.isOpen) return { status: 409, message: st.reason === 'paused' ? 'The shop is not accepting orders right now' : (st.message || 'The shop is closed at that time') };
    } else if (!config.restaurant.isOpen) {
        return {
            status: 409,
            message: config.restaurant.closedReason === 'paused' ? 'The shop is not accepting orders right now' : config.restaurant.closedMessage,
        };
    }

    if (priced.pricing.subtotal < (o.minOrder || 0)) return { status: 400, message: `Minimum order is ₹${o.minOrder}` };

    if (priced.orderType === 'delivery') {
        if (!address) return { status: 400, message: 'Please choose a delivery address' };
        const s = serviceability(tenant, address.latitude, address.longitude);
        if (!s.serviceable) return { status: 400, message: s.message };
        if (!/^[6-9]\d{9}$/.test(address.phone || user?.phone || '')) {
            return { status: 400, message: 'Add a phone number the delivery partner can call' };
        }
    }
    if (priced.orderType === 'dine_in') {
        const t = typeof body.tableNo === 'string' ? body.tableNo.trim() : '';
        if (!t || t.length > 10) return { status: 400, message: 'Table number is required' };
    }
    return null;
}

async function prepare({ tenant, userId, body }) {
    const config = resolveConfig(tenant);
    const user = await User.findById(userId).select('name phone').lean();

    // the address comes first: a delivery fee by distance needs it
    let address = null;
    if (body.orderType === 'delivery' && body.addressId !== undefined) {
        if (!isId(body.addressId)) throw httpError(400, 'Invalid address');
        address = await Address.findOne({ _id: body.addressId, tenantId: tenant._id, userId }).lean();
        if (!address) throw httpError(400, 'Address not found');
    }
    // straight-line distance from the shop to the address (null when either place is unknown)
    const shopAt = tenant.delivery || {};
    const distanceKm = address && [shopAt.latitude, shopAt.longitude, address.latitude, address.longitude].every(Number.isFinite)
        ? Math.round(haversineKm(shopAt.latitude, shopAt.longitude, address.latitude, address.longitude) * 10) / 10
        : null;
    const priced = await priceCart({ tenant, config, userId, body, distanceKm });

    // Cash on delivery: how many earlier orders this PHONE has in this shop (by hash), and is it blocked
    let cod = null;
    if (body.paymentMethod === 'cod' && user?.phone) {
        const phoneHash = hashPhone(tenant._id, user.phone);
        const [earlierOrders, risk] = await Promise.all([
            Order.countDocuments({ tenantId: tenant._id, 'customer.phoneHash': phoneHash, status: { $ne: 'cancelled' } }),
            CustomerRisk.findOne({ tenantId: tenant._id, phoneHash }).select('codBlocked').lean(),
        ]);
        cod = { earlierOrders, blocked: !!risk?.codBlocked };
    }
    return { config, priced, address, user, problem: checkPlacement({ tenant, config, body, priced, address, user, cod }) };
}

/* ------------------------------ quote (cart screen) ------------------------------ */
async function quote({ tenant, userId, body }) {
    const { config, priced, problem } = await prepare({ tenant, userId, body });
    return {
        items: priced.lines,
        pricing: priced.pricing,
        distanceKm: priced.distanceKm ?? null,
        shopOpen: config.restaurant.isOpen,
        canPlace: !problem,
        problem: problem ? problem.message : null,
    };
}

/* ------------------------------ place order ------------------------------ */
async function nextOrderNo(tenantId) {
    const c = await Counter.findOneAndUpdate(
        { _id: `order:${tenantId}` },
        { $inc: { seq: 1 } },
        { new: true, upsert: true },
    );
    return 1000 + c.seq;   // first order is #1001
}

// The app sends the total it showed the customer. If today's total is different, nothing is created.
function checkExpectedTotal(body, priced) {
    if (body.expectedTotal === undefined || body.expectedTotal === null) return;   // older apps do not send it
    const expected = body.expectedTotal;
    if (typeof expected !== 'number' || !Number.isFinite(expected) || expected < 0) throw httpError(400, 'Invalid expectedTotal');
    if (round2(expected) !== priced.pricing.total) {
        throw Object.assign(httpError(409, 'The price changed. Please check your cart.'), {
            extra: { code: 'PRICE_CHANGED', newTotal: priced.pricing.total, items: priced.lines },
        });
    }
}

// Same shop + person + items + options + total
function cartKey(tenantId, userId, priced) {
    const lines = priced.lines.map((l) => ({
        p: String(l.productId),
        q: l.quantity,
        s: (l.selections || []).map((s) => `${s.groupId}:${s.optionId}`).sort(),
    })).sort((a, b) => `${a.p}${a.s.join()}`.localeCompare(`${b.p}${b.s.join()}`));
    const raw = JSON.stringify({ t: String(tenantId), u: String(userId), o: priced.orderType, lines, total: priced.pricing.total });
    return crypto.createHash('sha256').update(raw).digest('hex');
}

// ONE atomic step: wins if there is no row, or the old row is older than the window. A newer row means a double tap.
async function takeGuard(key, now = new Date()) {
    try {
        await OrderGuard.updateOne(
            { key, at: { $lt: new Date(now.getTime() - SAME_CART_WINDOW_MS) } },
            { $set: { at: now } },
            { upsert: true },
        );
        return true;
    } catch (e) {
        if (e.code === 11000) return false;
        throw e;
    }
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
    checkExpectedTotal(body, priced);

    // the same cart again within 10 seconds is refused
    const guardKey = cartKey(tenant._id, userId, priced);
    if (!(await takeGuard(guardKey))) {
        if (idempotencyKey) {   // the same request is still being made: give back its order
            for (let i = 0; i < 10; i += 1) {
                const dup = await findDuplicate();
                if (dup) return { order: dup, duplicate: true };
                await sleep(150);
            }
        }
        throw httpError(409, 'Duplicate order');
    }
    const letGo = () => OrderGuard.deleteOne({ key: guardKey }).catch(() => { });   // a failed order must not block a retry

    if (priced.coupon) {
        const reserved = await reserveCoupon(priced.coupon._id, tenant._id);
        if (!reserved) {
            await letGo();
            throw httpError(409, 'This coupon is no longer available');
        }
    }

    let reserved = [];
    try {
        reserved = await stock.reserve(tenant._id, priced.stockNeeds || []);   // takes the units, or 409 when short
        const user = await User.findById(userId).select('name phone').lean();
        const slot = priced.orderType === 'pickup' ? findPickupSlot(tenant, body.pickupSlot) : null;
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
            customer: { name: user?.name, phone: user?.phone, phoneHash: user?.phone ? hashPhone(tenant._id, user.phone) : undefined },
            address: address ? {
                label: address.label,
                name: address.name || user?.name,
                phone: address.phone || user?.phone,
                line1: address.line1, line2: address.line2,
                landmark: address.landmark, city: address.city, pincode: address.pincode,
                latitude: address.latitude, longitude: address.longitude,
            } : undefined,
            tableNo: priced.orderType === 'dine_in' ? String(body.tableNo).trim() : undefined,
            scheduledFor: slot ? new Date(slot.from) : (body.scheduledFor && priced.orderType !== 'pickup' ? new Date(body.scheduledFor) : undefined),
            pickupUntil: slot ? new Date(slot.to) : undefined,
            note: config.features.specialInstructions && typeof body.note === 'string' && body.note.trim()
                ? body.note.trim().slice(0, 300) : undefined,
            etaMin: Math.max(config.orders.prepTimeMin || 0, priced.prepMin),
            statusHistory: [{ status: 'placed', by: userId }],
        });
        // Second check, AFTER the order exists. The first check (in validateCoupon) can be beaten
        // by two parallel requests, because neither order existed yet when both checked.
        if (priced.coupon) {
            const c = await Coupon.findById(priced.coupon._id).select('firstOrderOnly usageLimitPerUser').lean();
            const who = user?.phone ? { 'customer.phoneHash': hashPhone(tenant._id, user.phone) } : { userId };
            let lost = false;

            if (c?.firstOrderOnly) {
                // any OTHER live order from this customer means this was not their first
                const others = await Order.countDocuments({
                    tenantId: tenant._id, ...who, _id: { $ne: order._id }, status: { $ne: 'cancelled' },
                });
                if (others > 0) lost = true;
            }
            if (!lost && c?.usageLimitPerUser) {
                const used = await Order.countDocuments({
                    tenantId: tenant._id, ...who, couponId: priced.coupon._id, status: { $ne: 'cancelled' },
                });
                if (used > c.usageLimitPerUser) lost = true;   // this order is included in the count
            }

            if (lost) {
                await Order.updateOne({ _id: order._id }, {
                    $set: { status: 'cancelled', cancelledBy: 'customer', cancelReason: 'Coupon was already used' },
                    $push: { statusHistory: { status: 'cancelled', by: userId, note: 'Coupon was already used' } },
                });
                // the catch block below gives the coupon use back, so do not release it here
                throw httpError(409, 'This coupon has already been used');
            }
        }

        notify.orderPlaced(order);   // tells the owner
        return { order, duplicate: false };
    } catch (e) {
        await releaseCoupon(priced.coupon?._id);   // the order was not created, give the coupon use back
        await stock.restore(tenant._id, reserved).catch((err) => console.error('Stock restore error:', err.message));
        if (e.code === 11000 && idempotencyKey) {
            const dup = await findDuplicate();
            if (dup) return { order: dup, duplicate: true };
        }
        await letGo();
        throw e;
    }
}

async function cancelByCustomer({ tenant, userId, orderId, reason }) {
    const order = await Order.findOne({ _id: orderId, tenantId: tenant._id, userId });
    if (!order) throw httpError(404, 'Order not found');
    return orderStatus.change({
        order,
        status: 'cancelled',
        actor: { type: 'customer', id: userId, label: order.customer?.phone },
        note: reason,
        tenant,
    });
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

async function updateStatusByShop({ tenantId, actor, orderId, status, note, reasonCode }) {
    const order = await Order.findOne({ _id: orderId, tenantId });
    if (!order) throw httpError(404, 'Order not found');
    return orderStatus.change({ order, status, actor, note, reasonCode });
}

module.exports = {
    quote, placeOrder, pickupSlots, cancelByCustomer, reorderCart, updateStatusByShop,
    customerCanCancel, nextStatuses,
};