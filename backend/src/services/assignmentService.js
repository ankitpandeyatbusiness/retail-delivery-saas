// Rider assignment. Two ways to find a rider:
//
// 1. BROADCAST (automatic mode, the default). When the owner ACCEPTS a delivery order, ALL riders who are online, active and
//    have NO active order get the offer at once (live message + push). The FIRST rider to accept gets the order: ONE filtered
//    update decides. The others are told "Taken by someone else". If everybody says no, or offerSeconds (120) pass, the owner
//    is alerted and assigns by hand. A rider's slot (activeOrderCount + 1) is taken only when he accepts.
// 2. ONE RIDER at a time: the owner picks a rider (assign), or presses "auto" (autoAssign). offerTo / accept / reject / expireOffers.
//
// Every change is ONE atomic update with a filter, so an order can never get two riders.
// Order.delivery: (no riderId) -> assigned (offer waiting) -> accepted -> picked_up -> delivered
// A rejected, timed out or removed offer clears riderId again.
// Rider.activeOrderCount: +1 when an offer is made (one rider) or accepted (broadcast), -1 when it ends
// (orderStatusService gives it back when the order is delivered, cancelled or undelivered).

const crypto = require('crypto');
const Order = require('../models/Order');
const Rider = require('../models/Rider');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const auditTrail = require('../middlewares/auditTrail');
const { DEFAULTS } = require('./tenantConfigService');
const { httpError } = require('../middlewares/apiErrors');
const notify = require('./notificationService');
const cod = require('./codService');

const OPEN = ['accepted', 'preparing', 'out_for_delivery'];       // order steps where a rider can be set
const WITH_RIDER = ['assigned', 'accepted', 'picked_up'];
const CLEAR = {
    'delivery.riderId': 1, 'delivery.status': 1, 'delivery.offerExpiresAt': 1, 'delivery.assignedAt': 1,
    'delivery.acceptedAt': 1, 'delivery.pickedUpAt': 1,
};
const ref = (a) => ({ type: a.type, id: a.id ? String(a.id) : undefined, label: a.label });
const lastOffer = (order, riderUserId) => [...(order?.delivery?.offers || [])].reverse()
    .find((o) => String(o.riderId) === String(riderUserId));

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
        cashLimitPaise: Math.round((Number(s.cashLimit) || 0) * 100),   // 0 = no limit
    };
}

/* ------------------------------ rider slots ------------------------------ */
const reserveSlot = (tenantId, userId, limit, needOnline) => Rider.findOneAndUpdate(
    { tenantId, userId, isActive: true, ...(needOnline && { isOnline: true }), activeOrderCount: { $lt: limit } },
    { $inc: { activeOrderCount: 1 } },
    { returnDocument: 'after' },
);
const releaseSlot = (tenantId, userId) => Rider.updateOne(
    { tenantId, userId, activeOrderCount: { $gt: 0 } },
    { $inc: { activeOrderCount: -1 } },
);

/* ------------------------------ one rider at a time: offer ------------------------------ */
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
        { returnDocument: 'after' },
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
        { returnDocument: 'before', arrayFilters: [{ 'o.riderId': riderUserId, 'o.result': 'offered' }] },
    );
    if (!old) return null;
    await releaseSlot(tenantId, riderUserId);
    const offer = [...(old.delivery?.offers || [])].reverse()
        .find((o) => String(o.riderId) === String(riderUserId) && o.result === 'offered');
    return { by: offer?.by || 'system' };
}

/* ------------------------------ one rider at a time: "auto" button ------------------------------ */
// A random online, active rider under the load limit who has not been offered this order yet.
async function autoAssign({ orderId, tenantId, settings }) {
    settings = settings || await settingsOf(tenantId);
    const order = await Order.findOne({ _id: orderId, tenantId, orderType: 'delivery' })
        .select('orderNo status delivery.riderId delivery.offers').lean();
    if (!order || !OPEN.includes(order.status) || order.delivery?.riderId) return null;

    const tried = (order.delivery?.offers || []).map((o) => o.riderId);
    let pool = await Rider.find({
        tenantId, isActive: true, isOnline: true, activeOrderCount: { $lt: settings.maxActiveOrders }, userId: { $nin: tried },
    }).select('userId').lean();
    const full = await cod.overLimitIds(tenantId, settings.cashLimitPaise);   // riders holding too much cash get no new orders
    pool = pool.filter((r) => !full.has(String(r.userId)));

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

/* ------------------------------ broadcast: ask ALL free riders at once ------------------------------ */
// Stops the broadcast. Safe to call twice (only the first call does anything).
//   why: no_rider | all_rejected | timeout  (the owner is alerted)   or   cancelled (order ended, or the owner assigned by hand)
async function endBroadcast(orderId, tenantId, why) {
    const now = new Date();
    const closed = { 'delivery.broadcast.active': false, 'delivery.broadcast.endedAt': now, 'delivery.broadcast.endReason': why };
    const unanswered = why === 'cancelled' ? 'cancelled' : 'timeout';

    // ONE update closes the broadcast AND every offer nobody answered, so nobody can ever see it half closed
    let old = await Order.findOneAndUpdate(
        { _id: orderId, tenantId, 'delivery.broadcast.active': true, 'delivery.offers.0': { $exists: true } },
        { $set: { ...closed, 'delivery.offers.$[o].result': unanswered, 'delivery.offers.$[o].at': now } },
        { returnDocument: 'before', arrayFilters: [{ 'o.result': 'offered' }] },
    );
    if (!old) {
        // nobody was asked yet (no rider was free): only the broadcast itself is closed
        old = await Order.findOneAndUpdate(
            { _id: orderId, tenantId, 'delivery.broadcast.active': true },
            { $set: closed },
            { returnDocument: 'before' },
        );
    }
    if (!old) return null;   // already ended

    const waiting = (old.delivery?.offers || []).filter((o) => o.result === 'offered');
    if (['no_rider', 'all_rejected', 'timeout'].includes(why) && !old.delivery?.broadcast?.reoffer) {   // (an order offered again to a rider who just came on duty already alerted him once)
        notify.noRiderFree({ tenantId, orderId, orderNo: old.orderNo });   // ONE alert: the owner assigns by hand
    }
    notify.offersClosed({ tenantId, orderId, orderNo: old.orderNo, why: 'closed', riderIds: waiting.map((o) => o.riderId) });
    logEvent({ tenantId, action: `RIDER_BROADCAST_ENDED (${why})`, orderNo: old.orderNo });
    return old;
}

// Starts the broadcast. Only in automatic mode, only for a delivery order that has no rider yet.
async function startBroadcast({ orderId, tenantId, excludeRiderId }) {
    const settings = await settingsOf(tenantId);
    if (settings.assignMode !== 'automatic') return null;
    const now = new Date();
    const expires = new Date(now.getTime() + settings.offerSeconds * 1000);
    const order = await Order.findOneAndUpdate(
        {
            _id: orderId, tenantId, orderType: 'delivery', status: { $in: OPEN },
            'delivery.riderId': { $exists: false }, 'delivery.broadcast.active': { $ne: true },
        },
        { $set: { 'delivery.broadcast': { active: true, startedAt: now, expiresAt: expires }, 'delivery.pinRequired': settings.deliveryPin } },
        { returnDocument: 'after' },
    );
    if (!order) return null;

    // online, active and FREE (no active order) riders only
    const full = await cod.overLimitIds(tenantId, settings.cashLimitPaise);   // riders holding too much cash get no new orders
    const riders = (await Rider.find({ tenantId, isActive: true, isOnline: true, activeOrderCount: 0, ...(excludeRiderId && { userId: { $ne: excludeRiderId } }) }).select('userId').lean())
        .filter((r) => !full.has(String(r.userId)));
    if (!riders.length) {
        await endBroadcast(order._id, tenantId, 'no_rider');
        return null;
    }
    const offers = riders.map((r) => ({ riderId: r.userId, offeredAt: now, expiresAt: expires, result: 'offered', by: 'system' }));
    const asked = await Order.findOneAndUpdate(
        { _id: order._id, tenantId, 'delivery.broadcast.active': true },
        { $push: { 'delivery.offers': { $each: offers } } },
        { returnDocument: 'after' },
    );
    if (!asked) return null;   // the order was cancelled a moment ago
    notify.riderBroadcast(asked, riders.map((r) => r.userId));
    logEvent({ tenantId, action: 'RIDER_BROADCAST', orderNo: asked.orderNo, detail: { riders: riders.length, expiresAt: expires } });
    return asked;
}

// A rider has just gone on duty (by hand, or by his timing). Every open delivery order that still has no rider is shown to him at once,
// so an order that came in while nobody was on duty is not left waiting. Same rules as a broadcast: automatic mode only, he must be
// free and not hold too much cash; he sees it as a normal request (live card + push) and the first to accept gets it.
async function offerOpenToRider({ tenantId, riderUserId }) {
    const settings = await settingsOf(tenantId);
    if (settings.assignMode !== 'automatic') return 0;
    const rider = await Rider.findOne({ tenantId, userId: riderUserId, isActive: true, isOnline: true }).select('activeOrderCount').lean();
    if (!rider || rider.activeOrderCount >= settings.maxActiveOrders) return 0;
    if (settings.cashLimitPaise > 0 && (await cod.balanceOf(tenantId, riderUserId)).balancePaise >= settings.cashLimitPaise) return 0;

    const { HIDE_UNPAID } = require('./onlineOrder');
    const open = await Order.find({
        tenantId, orderType: 'delivery', status: { $in: ['accepted', 'preparing'] }, 'delivery.riderId': { $exists: false }, ...HIDE_UNPAID,
    }).sort({ createdAt: 1 }).limit(3).select('_id').lean();

    const now = new Date();
    const expires = new Date(now.getTime() + settings.offerSeconds * 1000);
    let shown = 0;
    for (const o of open) {
        // the broadcast is opened again if it had ended (nobody was free)
        await Order.updateOne(
            { _id: o._id, tenantId, 'delivery.riderId': { $exists: false }, 'delivery.broadcast.active': { $ne: true } },
            { $set: { 'delivery.broadcast': { active: true, startedAt: now, expiresAt: expires, reoffer: true }, 'delivery.pinRequired': settings.deliveryPin } },
        );
        const asked = await Order.findOneAndUpdate(
            {
                _id: o._id, tenantId, 'delivery.riderId': { $exists: false }, 'delivery.broadcast.active': true,
                'delivery.offers': { $not: { $elemMatch: { riderId: riderUserId, result: 'offered' } } },
            },
            { $push: { 'delivery.offers': { riderId: riderUserId, offeredAt: now, expiresAt: expires, result: 'offered', by: 'system' } } },
            { returnDocument: 'after' },
        );
        if (!asked) continue;
        notify.riderBroadcast(asked, [riderUserId]);
        shown += 1;
    }
    if (shown) logEvent({ tenantId, action: 'RIDER_ORDERS_SHOWN_ON_DUTY', riderUserId, detail: { orders: shown } });
    return shown;
}

// A rider says yes. Only the FIRST rider passes the filter of the second step.
async function acceptBroadcast({ orderId, tenantId, riderUserId }) {
    const settings = await settingsOf(tenantId);
    const now = new Date();
    if (settings.cashLimitPaise > 0 && (await cod.balanceOf(tenantId, riderUserId)).balancePaise >= settings.cashLimitPaise) {
        throw httpError(409, 'You hold too much cash. Give it to the shop before taking more orders.');
    }

    // 1) take a slot for this rider
    const slot = await Rider.findOneAndUpdate(
        { tenantId, userId: riderUserId, isActive: true, isOnline: true, activeOrderCount: { $lt: settings.maxActiveOrders } },
        { $inc: { activeOrderCount: 1 } },
        { returnDocument: 'after' },
    );
    if (!slot) throw httpError(409, 'You cannot take this order now');

    // 2) win the order
    let won;
    try {
        won = await Order.findOneAndUpdate(
            {
                // still open and nobody has it: he can take it even after his time ran out ("timeout" = he missed it)
                _id: orderId, tenantId, status: { $in: OPEN }, 'delivery.riderId': { $exists: false },
                'delivery.offers': { $elemMatch: { riderId: riderUserId, result: { $in: ['offered', 'timeout'] } } },
            },
            {
                $set: {
                    'delivery.riderId': riderUserId, 'delivery.status': 'accepted', 'delivery.assignedAt': now, 'delivery.acceptedAt': now,
                    'delivery.broadcast.active': false, 'delivery.broadcast.endedAt': now, 'delivery.broadcast.endReason': 'accepted',
                    'delivery.offers.$[mine].result': 'accepted', 'delivery.offers.$[mine].at': now,
                    'delivery.offers.$[other].result': 'taken', 'delivery.offers.$[other].at': now,
                },
            },
            {
                returnDocument: 'after',
                arrayFilters: [
                    { 'mine.riderId': riderUserId, 'mine.result': { $in: ['offered', 'timeout'] } },
                    { 'other.riderId': { $ne: riderUserId }, 'other.result': 'offered' },
                ],
            },
        );
    } catch (e) {
        await releaseSlot(tenantId, riderUserId);
        throw e;
    }
    if (!won) {
        await releaseSlot(tenantId, riderUserId);   // the loser's count goes back to what it was
        const cur = await Order.findOne({ _id: orderId, tenantId }).select('status delivery.riderId delivery.broadcast').lean();
        if (!cur || !OPEN.includes(cur.status)) throw httpError(409, 'This request is no longer available');
        if (!cur.delivery?.riderId) throw httpError(409, 'This request is not available for you');
        throw httpError(409, 'Taken by someone else');
    }

    let order = won;
    if (order.status === 'out_for_delivery') {   // the food already left: he takes over from there
        order = (await Order.findOneAndUpdate(
            { _id: order._id, tenantId, 'delivery.riderId': riderUserId, 'delivery.status': 'accepted' },
            { $set: { 'delivery.status': 'picked_up', 'delivery.pickedUpAt': now } },
            { returnDocument: 'after' },
        )) || order;
    }

    notify.riderAccepted(order);   // the owner and the customer see the rider name
    const lost = (order.delivery?.offers || [])
        .filter((o) => o.result === 'taken' && o.at && new Date(o.at).getTime() === now.getTime())
        .map((o) => o.riderId);
    notify.offersClosed({ tenantId, orderId: order._id, orderNo: order.orderNo, why: 'taken', riderIds: lost });
    return order;
}

// A rider says no. If nobody is left to answer, the broadcast ends and the owner is alerted ONCE.
async function rejectBroadcast({ orderId, tenantId, riderUserId }) {
    const now = new Date();
    const r = await Order.updateOne(
        {
            _id: orderId, tenantId, 'delivery.broadcast.active': true,
            'delivery.offers': { $elemMatch: { riderId: riderUserId, result: 'offered' } },
        },
        { $set: { 'delivery.offers.$[o].result': 'rejected', 'delivery.offers.$[o].at': now } },
        { arrayFilters: [{ 'o.riderId': riderUserId, 'o.result': 'offered' }] },
    );
    if (!r.modifiedCount) throw httpError(409, 'This request is no longer available');
    notify.riderRejected({ tenantId, orderId, riderUserId });
    const left = await Order.exists({ _id: orderId, tenantId, 'delivery.offers': { $elemMatch: { result: 'offered' } } });
    if (!left) await endBroadcast(orderId, tenantId, 'all_rejected');   // everybody said no
    return { ok: true };
}

async function expireBroadcasts(now = new Date()) {
    const due = await Order.find({ 'delivery.broadcast.active': true, 'delivery.broadcast.expiresAt': { $lte: now } })
        .select('tenantId').limit(50).lean();
    let n = 0;
    for (const o of due) if (await endBroadcast(o._id, o.tenantId, 'timeout')) n += 1;
    return n;
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
        { returnDocument: 'before', arrayFilters: [{ 'o.result': 'offered' }] },
    );
    if (!old) throw httpError(409, 'This order just changed. Refresh and try again.');
    await releaseSlot(tenantId, current.riderId);
    notify.riderRemoved({ tenantId, riderUserId: current.riderId, orderId, orderNo: old.orderNo });   // old rider only
}

// riderUserId = pick by hand, auto = let the system pick. If the order already has a rider, a reason is needed.
// Picking a rider by hand ends an open broadcast ("the owner assigns by hand").
async function assign({ orderId, tenantId, riderUserId, auto = false, reason, actor }) {
    const order = await Order.findOne({ _id: orderId, tenantId })
        .select('orderType status delivery.riderId delivery.status delivery.assignedAt delivery.broadcast').lean();
    if (!order) throw httpError(404, 'Order not found');
    if (order.orderType !== 'delivery') throw httpError(400, 'Only delivery orders need a rider');
    if (!OPEN.includes(order.status)) throw httpError(409, `A rider cannot be set when the order is "${order.status}"`);

    const current = order.delivery?.riderId
        ? { riderId: order.delivery.riderId, assignedAt: order.delivery.assignedAt } : null;
    const settings = await settingsOf(tenantId);

    if (auto) {
        if (current) throw httpError(409, 'This order already has a rider. Choose a rider by hand to change him.');
        if (order.delivery?.broadcast?.active) {
            throw httpError(409, 'All free riders are already being asked. Wait for one to accept, or choose a rider by hand.');
        }
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
        await endBroadcast(orderId, tenantId, 'cancelled');   // the other riders are told it is closed
    } catch (e) {
        await releaseSlot(tenantId, riderUserId);
        throw e;
    }
    return assignDirect({
        orderId, tenantId, riderUserId, settings, status: order.status,
        by: actor.type === 'superadmin' ? 'superadmin' : 'owner',
    });
}

// The owner picks the rider by hand: that is an order, not an offer. No countdown and nothing to accept: the rider is TOLD (what, where), and the
// customer and the owner hear that a delivery partner is on the way. (The slot was reserved by the caller.)
async function assignDirect({ orderId, tenantId, riderUserId, settings, status, by }) {
    const now = new Date();
    const pickedUp = status === 'out_for_delivery';   // the food already left: he takes over from there
    const order = await Order.findOneAndUpdate(
        { _id: orderId, tenantId, orderType: 'delivery', status: { $in: OPEN }, 'delivery.riderId': { $exists: false } },
        {
            $set: {
                'delivery.riderId': riderUserId, 'delivery.status': pickedUp ? 'picked_up' : 'accepted', 'delivery.assignedAt': now, 'delivery.acceptedAt': now,
                ...(pickedUp && { 'delivery.pickedUpAt': now }), 'delivery.pinRequired': settings.deliveryPin,
            },
            $push: { 'delivery.offers': { riderId: riderUserId, offeredAt: now, at: now, result: 'accepted', by } },
        },
        { returnDocument: 'after' },
    );
    if (!order) {
        await releaseSlot(tenantId, riderUserId);
        throw httpError(409, 'This order cannot be assigned now (it already has a rider, or it is not in a delivery step)');
    }
    notify.riderAssignedByOwner(order);   // the rider: "the owner gave you this order, deliver it to ..."
    notify.riderAccepted(order);          // the customer and the owner: a delivery partner is on the way
    return order;
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

/* ------------------------------ rider side ------------------------------ */
async function acceptManual({ orderId, tenantId, riderUserId }) {
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
        { returnDocument: 'after', arrayFilters: [{ 'o.riderId': riderUserId, 'o.result': 'offered' }] },
    );
    if (!order) throw httpError(409, 'This request is no longer available');
    notify.riderAccepted(order);   // customer and owner
    return order;
}

async function rejectManual({ orderId, tenantId, riderUserId }) {
    const r = await clearOffer({ orderId, tenantId, riderUserId, result: 'rejected' });
    if (!r) throw httpError(409, 'This request is no longer available');
    notify.riderRejected({ tenantId, orderId, riderUserId });   // only the owner is told
    // system offers move on to the next rider
    if (r.by === 'system') await autoAssign({ orderId, tenantId }).catch((e) => console.error('Auto-assign error:', e.message));
    return { ok: true };
}

// The routes call these two. While a broadcast is open the broadcast rules apply, otherwise the one-rider rules.
async function accept({ orderId, tenantId, riderUserId }) {
    const cur = await Order.findOne({ _id: orderId, tenantId }).select('delivery.broadcast delivery.offers delivery.riderId').lean();
    // a missed (timed out) offer on an order nobody has taken yet is taken the same way as a live one
    if (cur?.delivery?.broadcast?.active || (!cur?.delivery?.riderId && lastOffer(cur, riderUserId)?.result === 'timeout')) {
        return acceptBroadcast({ orderId, tenantId, riderUserId });
    }
    if (lastOffer(cur, riderUserId)?.result === 'taken') throw httpError(409, 'Taken by someone else');
    return acceptManual({ orderId, tenantId, riderUserId });
}

async function reject({ orderId, tenantId, riderUserId }) {
    const cur = await Order.findOne({ _id: orderId, tenantId }).select('delivery.broadcast').lean();
    if (cur?.delivery?.broadcast?.active) return rejectBroadcast({ orderId, tenantId, riderUserId });
    return rejectManual({ orderId, tenantId, riderUserId });
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
            const b = await expireBroadcasts();
            if (b) console.log(`Riders: ${b} broadcast(s) timed out`);
        } catch (e) {
            console.error('Offer scheduler error:', e.message);
        } finally {
            running = false;
        }
    };
    setInterval(run, 15 * 1000).unref?.();
}

module.exports = {
    settingsOf, assign, unassign, accept, reject, expireOffers, startOfferScheduler,
    startBroadcast, endBroadcast, acceptBroadcast, rejectBroadcast, expireBroadcasts, offerOpenToRider,
};