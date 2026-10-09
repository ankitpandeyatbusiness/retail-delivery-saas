// Rider assignment: offer, accept, reject, timeout, reassign.
// Every change is ONE atomic update with a filter, so an order can never get two riders.
//
// Order.delivery: (no riderId) -> assigned (offer waiting) -> accepted -> picked_up -> delivered
// A rejected, timed out or removed offer clears riderId again.
// Rider.activeOrderCount: +1 when an offer is made, -1 when the offer ends
// (orderStatusService gives it back when the order is delivered or cancelled).
//
// PHASE 3 markers: owner alerts and push go where "PHASE 3" is written.

const crypto = require('crypto');
const Order = require('../models/Order');
const Rider = require('../models/Rider');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const auditTrail = require('../middlewares/auditTrail');
const { DEFAULTS } = require('./tenantConfigService');
const { httpError } = require('../middlewares/apiErrors');
const notify = require('./notificationService');

const OPEN = ['accepted', 'preparing', 'out_for_delivery'];       // order steps where a rider can be set
const WITH_RIDER = ['assigned', 'accepted', 'picked_up'];
const CLEAR = {
    'delivery.riderId': 1, 'delivery.status': 1, 'delivery.offerExpiresAt': 1, 'delivery.assignedAt': 1,
    'delivery.acceptedAt': 1, 'delivery.pickedUpAt': 1,
};
const ref = (a) => ({ type: a.type, id: a.id ? String(a.id) : undefined, label: a.label });

// One log row for events nobody clicked (automatic offer, timeout, nobody free).
// Rows carry tenantId, so the owner log and the superadmin log both show them.
async function logEvent({ tenantId, action, orderNo, riderUserId, detail }) {
    try {
        const u = riderUserId ? await User.findById(riderUserId).select('phone').lean() : null;
        await auditTrail.record({
            actorType: 'system', actorLabel: 'system', tenantId, action, status: 200,
            params: { orderNo, riderId: riderUserId ? String(riderUserId) : undefined, riderPhone: u?.phone, ...detail },
        });
    } catch (e) {
        console.error('Rider log error:', e.message);
    }
}

async function settingsOf(tenantId) {
    const t = await Tenant.findById(tenantId).select('settings.riders').lean();
    const s = { ...DEFAULTS.riders, ...(t?.settings?.riders || {}) };
    return {
        assignMode: s.assignMode,
        offerSeconds: Math.round(s.offerSeconds),
        maxActiveOrders: Math.max(1, Math.floor(s.maxActiveOrders)),
        deliveryPin: s.deliveryPin !== false,
    };
}

/* ------------------------------ rider slots ------------------------------ */
const reserveSlot = (tenantId, userId, limit, needOnline) => Rider.findOneAndUpdate(
    { tenantId, userId, isActive: true, ...(needOnline && { isOnline: true }), activeOrderCount: { $lt: limit } },
    { $inc: { activeOrderCount: 1 } },
    { new: true },
);
const releaseSlot = (tenantId, userId) => Rider.updateOne(
    { tenantId, userId, activeOrderCount: { $gt: 0 } },
    { $inc: { activeOrderCount: -1 } },
);

/* ------------------------------ offer ------------------------------ */
async function offerTo({ orderId, tenantId, riderUserId, by, settings, slotReserved = false, needOnline = false }) {
    settings = settings || await settingsOf(tenantId);
    if (!slotReserved) {
        const slot = await reserveSlot(tenantId, riderUserId, settings.maxActiveOrders, needOnline);
        if (!slot) throw httpError(409, 'This rider is not available (switched off, offline, or has too many orders)');
    }
    const now = new Date();
    const expires = new Date(now.getTime() + settings.offerSeconds * 1000);
    const order = await Order.findOneAndUpdate(
        { _id: orderId, tenantId, orderType: 'delivery', status: { $in: OPEN }, 'delivery.riderId': { $exists: false } },
        {
            $set: {
                'delivery.riderId': riderUserId, 'delivery.status': 'assigned', 'delivery.assignedAt': now,
                'delivery.offerExpiresAt': expires, 'delivery.pinRequired': settings.deliveryPin,
            },
            $push: { 'delivery.offers': { riderId: riderUserId, offeredAt: now, expiresAt: expires, result: 'offered', by } },
        },
        { new: true },
    );
    if (!order) {
        await releaseSlot(tenantId, riderUserId);
        throw httpError(409, 'This order cannot be assigned now (it already has a rider, or it is not in a delivery step)');
    }
    if (by === 'system') {
        logEvent({ tenantId, action: 'RIDER_OFFER (automatic)', orderNo: order.orderNo, riderUserId, detail: { expiresAt: expires } });
    }
    notify.riderOffered(order);
    return order;
}

// Ends a waiting offer (rejected, timeout). Returns null if it was already handled, so it is safe to repeat.
async function clearOffer({ orderId, tenantId, riderUserId, result, onlyExpired = false }) {
    const now = new Date();
    const old = await Order.findOneAndUpdate(
        {
            _id: orderId, tenantId, status: { $in: OPEN }, 'delivery.riderId': riderUserId, 'delivery.status': 'assigned',
            ...(onlyExpired && { 'delivery.offerExpiresAt': { $lte: now } }),
        },
        { $unset: CLEAR, $set: { 'delivery.offers.$[o].result': result, 'delivery.offers.$[o].at': now } },
        { new: false, arrayFilters: [{ 'o.riderId': riderUserId, 'o.result': 'offered' }] },
    );
    if (!old) return null;
    await releaseSlot(tenantId, riderUserId);
    const offer = [...(old.delivery?.offers || [])].reverse()
        .find((o) => String(o.riderId) === String(riderUserId) && o.result === 'offered');
    return { by: offer?.by || 'system' };
}

/* ------------------------------ automatic ------------------------------ */
// A random online, active rider under the load limit who has not been offered this order yet.
async function autoAssign({ orderId, tenantId, settings }) {
    settings = settings || await settingsOf(tenantId);
    const order = await Order.findOne({ _id: orderId, tenantId, orderType: 'delivery' })
        .select('orderNo status delivery.riderId delivery.offers').lean();
    if (!order || !OPEN.includes(order.status) || order.delivery?.riderId) return null;

    const tried = (order.delivery?.offers || []).map((o) => o.riderId);
    const pool = await Rider.find({
        tenantId, isActive: true, isOnline: true, activeOrderCount: { $lt: settings.maxActiveOrders }, userId: { $nin: tried },
    }).select('userId').lean();

    while (pool.length) {
        const [pick] = pool.splice(crypto.randomInt(pool.length), 1);
        try {
            return await offerTo({ orderId, tenantId, riderUserId: pick.userId, by: 'system', settings, needOnline: true });
        } catch (e) {
            if (e.status !== 409) throw e;
        }
    }
    logEvent({ tenantId, action: 'RIDER_NONE_AVAILABLE', orderNo: order.orderNo });
    notify.noRiderFree({ tenantId, orderId, orderNo: order.orderNo });   // owner assigns by hand
    return null;
}

async function autoOnPreparing(order) {
    if (order.orderType !== 'delivery' || order.delivery?.riderId) return null;
    const settings = await settingsOf(order.tenantId);
    if (settings.assignMode !== 'automatic') return null;
    return autoAssign({ orderId: order._id, tenantId: order.tenantId, settings });
}

/* ------------------------------ owner / superadmin ------------------------------ */
// Takes the current rider off an order and keeps it in riderHistory.
async function removeCurrent({ orderId, tenantId, current, reason, actor }) {
    const now = new Date();
    const old = await Order.findOneAndUpdate(
        { _id: orderId, tenantId, status: { $in: OPEN }, 'delivery.riderId': current.riderId, 'delivery.status': { $in: WITH_RIDER } },
        {
            $unset: CLEAR,
            $set: { 'delivery.pinAttempts': 0, 'delivery.offers.$[o].result': 'cancelled', 'delivery.offers.$[o].at': now },
            $push: {
                'delivery.riderHistory': {
                    riderId: current.riderId, assignedAt: current.assignedAt, removedAt: now,
                    reason: String(reason).trim().slice(0, 200), by: ref(actor),
                },
            },
        },
        { new: false, arrayFilters: [{ 'o.result': 'offered' }] },
    );
    if (!old) throw httpError(409, 'This order just changed. Refresh and try again.');
    await releaseSlot(tenantId, current.riderId);
    notify.riderRemoved({ tenantId, riderUserId: current.riderId, orderId, orderNo: old.orderNo });   // old rider only
}

// riderUserId = pick by hand, auto = let the system pick. If the order already has a rider, a reason is needed.
async function assign({ orderId, tenantId, riderUserId, auto = false, reason, actor }) {
    const order = await Order.findOne({ _id: orderId, tenantId })
        .select('orderType status delivery.riderId delivery.status delivery.assignedAt').lean();
    if (!order) throw httpError(404, 'Order not found');
    if (order.orderType !== 'delivery') throw httpError(400, 'Only delivery orders need a rider');
    if (!OPEN.includes(order.status)) throw httpError(409, `A rider cannot be set when the order is "${order.status}"`);

    const current = order.delivery?.riderId
        ? { riderId: order.delivery.riderId, assignedAt: order.delivery.assignedAt } : null;
    const settings = await settingsOf(tenantId);

    if (auto) {
        if (current) throw httpError(409, 'This order already has a rider. Choose a rider by hand to change him.');
        const o = await autoAssign({ orderId, tenantId, settings });
        if (!o) throw httpError(409, 'No rider is free right now. Choose one by hand.');
        return o;
    }

    if (current && String(current.riderId) === String(riderUserId)) throw httpError(409, 'This rider already has the order');
    if (current && !String(reason || '').trim()) throw httpError(400, 'Please give a reason for changing the rider');

    // owner picks by hand: the rider must be active and under the limit (online is not required)
    const slot = await reserveSlot(tenantId, riderUserId, settings.maxActiveOrders, false);
    if (!slot) throw httpError(409, 'This rider is not available (switched off, not found, or has too many orders)');
    try {
        if (current) await removeCurrent({ orderId, tenantId, current, reason, actor });
    } catch (e) {
        await releaseSlot(tenantId, riderUserId);
        throw e;
    }
    return offerTo({
        orderId, tenantId, riderUserId, settings, slotReserved: true,
        by: actor.type === 'superadmin' ? 'superadmin' : 'owner',
    });
}

async function unassign({ orderId, tenantId, reason, actor }) {
    if (!String(reason || '').trim()) throw httpError(400, 'Please give a reason');
    const order = await Order.findOne({ _id: orderId, tenantId }).select('delivery.riderId delivery.assignedAt').lean();
    if (!order) throw httpError(404, 'Order not found');
    if (!order.delivery?.riderId) throw httpError(409, 'This order has no rider');
    await removeCurrent({
        orderId, tenantId, reason, actor,
        current: { riderId: order.delivery.riderId, assignedAt: order.delivery.assignedAt },
    });
    return { ok: true };
}

/* ------------------------------ rider side (routes come in the next batch) ------------------------------ */
async function accept({ orderId, tenantId, riderUserId }) {
    const cur = await Order.findOne({ _id: orderId, tenantId })
        .select('status delivery.riderId delivery.status delivery.offerExpiresAt').lean();
    if (!cur || String(cur.delivery?.riderId) !== String(riderUserId) || cur.delivery.status !== 'assigned') {
        throw httpError(409, 'This request is no longer available');
    }
    if (!cur.delivery.offerExpiresAt || new Date(cur.delivery.offerExpiresAt) <= new Date()) throw httpError(409, 'This request has expired');
    if (!OPEN.includes(cur.status)) throw httpError(409, 'This request is no longer available');

    const now = new Date();
    const pickedUp = cur.status === 'out_for_delivery';          // the food already left: he takes over from there
    const order = await Order.findOneAndUpdate(
        {
            _id: orderId, tenantId, status: cur.status, 'delivery.riderId': riderUserId,
            'delivery.status': 'assigned', 'delivery.offerExpiresAt': { $gt: now },
        },
        {
            $set: {
                'delivery.status': pickedUp ? 'picked_up' : 'accepted', 'delivery.acceptedAt': now,
                ...(pickedUp && { 'delivery.pickedUpAt': now }),
                'delivery.offers.$[o].result': 'accepted', 'delivery.offers.$[o].at': now,
            },
            $unset: { 'delivery.offerExpiresAt': 1 },
        },
        { new: true, arrayFilters: [{ 'o.riderId': riderUserId, 'o.result': 'offered' }] },
    );
    if (!order) throw httpError(409, 'This request is no longer available');
    notify.riderAccepted(order);   // customer and owner
    return order;
}

async function reject({ orderId, tenantId, riderUserId }) {
    const r = await clearOffer({ orderId, tenantId, riderUserId, result: 'rejected' });
    if (!r) throw httpError(409, 'This request is no longer available');
    notify.riderRejected({ tenantId, orderId, riderUserId });   // only the owner is told
    // system offers move on to the next rider
    if (r.by === 'system') await autoAssign({ orderId, tenantId }).catch((e) => console.error('Auto-assign error:', e.message));
    return { ok: true };
}

/* ------------------------------ timeouts ------------------------------ */
async function expireOffers(now = new Date()) {
    const due = await Order.find({
        'delivery.status': 'assigned', 'delivery.offerExpiresAt': { $lte: now }, status: { $in: OPEN },
    }).select('orderNo tenantId delivery.riderId').limit(50).lean();

    let n = 0;
    for (const o of due) {
        const r = await clearOffer({
            orderId: o._id, tenantId: o.tenantId, riderUserId: o.delivery.riderId, result: 'timeout', onlyExpired: true,
        });
        if (!r) continue;
        n += 1;
        logEvent({
            tenantId: o.tenantId, action: 'RIDER_OFFER_TIMEOUT', orderNo: o.orderNo,
            riderUserId: o.delivery.riderId, detail: { offeredBy: r.by },
        });
        if (r.by === 'system') {
            await autoAssign({ orderId: o._id, tenantId: o.tenantId }).catch((e) => console.error('Auto-assign error:', e.message));
        } else {
            // owner or superadmin picked this rider by hand and he did not answer: tell the owner
            notify.noRiderFree({ tenantId: o.tenantId, orderId: o._id, orderNo: o.orderNo });
        }
    }
    return n;
}

// Safe if two servers run it: every step is a filtered update.
function startOfferScheduler() {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            const n = await expireOffers();
            if (n) console.log(`Riders: ${n} offer(s) timed out`);
        } catch (e) {
            console.error('Offer scheduler error:', e.message);
        } finally {
            running = false;
        }
    };
    setInterval(run, 15 * 1000).unref?.();
}

module.exports = {
    settingsOf, autoOnPreparing, assign, unassign, accept, reject, expireOffers, startOfferScheduler,
};