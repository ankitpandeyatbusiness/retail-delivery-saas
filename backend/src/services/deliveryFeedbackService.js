// Customer side of delivery: live status for one order, and the delivery rating.
const Order = require('../models/Order');
const Rider = require('../models/Rider');
const User = require('../models/User');
const pinSvc = require('./deliveryPinService');
const maps = require('./adapters/maps');
const { httpError } = require('../middlewares/apiErrors');

const AVG_KMH = 20;             // straight-line speed used for the ETA until Phase 7
const FRESH_MS = 5 * 60000;     // a rider location older than this is ignored
const DONE = ['delivered', 'cancelled'];
const TAG_MAX = 5;

const maskPhone = (p) => (/^\d{10}$/.test(p || '') ? `${p.slice(0, 2)}XXXXXX${p.slice(-2)}` : null);

function km(a, b) {
    const rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// one simple word the app can draw from
function stateOf(order) {
    if (order.status === 'cancelled') return 'cancelled';
    if (order.status === 'delivered') return 'delivered';
    const d = order.delivery;
    if (!d?.riderId || d.status === 'assigned' || d.status === 'rejected') return 'finding_rider';
    if (d.status === 'accepted') return 'rider_assigned';
    return 'on_the_way';   // picked_up
}

async function tracking({ tenant, userId, orderId }) {
    const order = await Order.findOne({ _id: orderId, tenantId: tenant._id, userId });
    if (!order) throw httpError(404, 'Order not found');
    if (order.orderType !== 'delivery') throw httpError(409, 'This order has no delivery');

    const d = order.delivery || {};
    const state = stateOf(order);
    const showRider = !!d.riderId && ['accepted', 'picked_up', 'delivered'].includes(d.status) && order.status !== 'cancelled';

    let rider = null;
    let live = null;
    if (showRider) {
        const [profile, user] = await Promise.all([
            Rider.findOne({ tenantId: tenant._id, userId: d.riderId }).select('name vehicle photo lastLocation').lean(),
            User.findById(d.riderId).select('name phone').lean(),
        ]);
        rider = {
            name: profile?.name || user?.name || 'Delivery partner',
            phoneMasked: maskPhone(user?.phone),
            vehicle: profile?.vehicle?.type || null,
            photo: profile?.photo || null,
        };
        live = profile?.lastLocation;
    }

    // ETA: distance based when the rider is on the way and sent a fresh location, otherwise the shop's estimate
    let etaAt = null;
    let etaSource = null;
    if (!DONE.includes(order.status)) {
        const a = order.address;
        const fresh = live?.at && Date.now() - new Date(live.at).getTime() < FRESH_MS;
        if (state === 'on_the_way' && fresh && a?.latitude != null && a?.longitude != null) {
            const to = { lat: a.latitude, lng: a.longitude };
            let mins;
            try {
                ({ minutes: mins } = await maps.etaMinutes({ from: { lat: live.lat, lng: live.lng }, to }));
            } catch (e) {
                mins = Math.max(1, Math.ceil((km(live, to) / AVG_KMH) * 60));   // maps provider failed: use the old local estimate
            }
            etaAt = new Date(Date.now() + mins * 60000);
            etaSource = 'distance';
        } else if (order.scheduledFor) {
            etaAt = order.scheduledFor;
            etaSource = 'scheduled';
        } else if (order.etaMin) {
            etaAt = new Date(order.createdAt.getTime() + order.etaMin * 60000);
            etaSource = 'estimate';
        }
    }

    const pin = d.pinRequired && ['accepted', 'picked_up'].includes(d.status) && !DONE.includes(order.status)
        ? pinSvc.pinFor(order) : null;

    // the rider's position is shown only while he is on the way, the shop has tracking on, and the location is fresh
    const trackingOn = tenant.settings?.riders?.liveTracking !== false;
    const riderLocation = trackingOn && state === 'on_the_way' && live?.lat != null && live?.at
        && Date.now() - new Date(live.at).getTime() < FRESH_MS
        ? { lat: live.lat, lng: live.lng, at: live.at } : null;

    return {
        orderId: order._id,
        orderNo: order.orderNo,
        status: order.status,
        state,                       // finding_rider | rider_assigned | on_the_way | delivered | cancelled
        rider,                       // null until a rider accepts
        riderLocation,               // { lat, lng, at } or null. Draw the rider on the map.
        deliveryPin: pin,            // show it to the customer, he tells it to the rider
        etaAt, etaSource,            // etaSource: distance | scheduled | estimate
        canRate: order.status === 'delivered' && !!d.riderId && !order.deliveryRating?.rating,
        deliveryRating: order.deliveryRating?.rating ? order.deliveryRating : null,
    };
}

// body: { rating: 1-5, tags: ["On time"], comment: "Polite" }
async function rateDelivery({ tenant, userId, orderId, body }) {
    const rating = body?.rating;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw httpError(400, 'Rating must be a whole number from 1 to 5');

    let tags = [];
    if (body.tags !== undefined) {
        if (!Array.isArray(body.tags)) throw httpError(400, 'Tags must be a list');
        tags = [...new Set(body.tags.filter((t) => typeof t === 'string').map((t) => t.trim().slice(0, 30)).filter(Boolean))].slice(0, TAG_MAX);
    }
    let comment;
    if (body.comment !== undefined && body.comment !== null && body.comment !== '') {
        if (typeof body.comment !== 'string') throw httpError(400, 'Invalid comment');
        comment = body.comment.trim().slice(0, 300) || undefined;
    }

    const order = await Order.findOne({ _id: orderId, tenantId: tenant._id, userId }).select('status delivery deliveryRating');
    if (!order) throw httpError(404, 'Order not found');
    if (order.status !== 'delivered') throw httpError(409, 'You can rate the delivery after it is delivered');
    if (!order.delivery?.riderId) throw httpError(409, 'This order had no delivery partner');
    if (order.deliveryRating?.rating) throw httpError(409, 'You already rated this delivery');

    // only one request can win this update, so a double tap never counts twice
    const done = await Order.findOneAndUpdate(
        {
            _id: order._id, tenantId: tenant._id, userId, status: 'delivered',
            'delivery.riderId': order.delivery.riderId,
            'deliveryRating.rating': { $exists: false },
        },
        { $set: { deliveryRating: { rating, tags, comment, ratedAt: new Date() } } },
        { new: true },
    );
    if (!done) throw httpError(409, 'You already rated this delivery');

    // rider's average and count, recalculated from the stored ratings (always correct, and heals old data)
    try {
        const [stat] = await Order.aggregate([
            { $match: { tenantId: tenant._id, 'delivery.riderId': order.delivery.riderId, 'deliveryRating.rating': { $gte: 1 } } },
            { $group: { _id: null, avg: { $avg: '$deliveryRating.rating' }, count: { $sum: 1 } } },
        ]);
        if (stat) {
            await Rider.updateOne(
                { tenantId: tenant._id, userId: order.delivery.riderId },
                { $set: { ratingAvg: Math.round(stat.avg * 100) / 100, ratingCount: stat.count } },
            );
        }
    } catch (e) {
        console.error('rider rating update failed', e.message);
    }

    if (rating <= 2) {
        require('./notificationService').lowDeliveryRating({
            tenantId: tenant._id, orderId: order._id, orderNo: done.orderNo,
            rating, riderUserId: order.delivery.riderId, comment,
        });
    }
    return { ok: true, deliveryRating: done.deliveryRating };
}

module.exports = { tracking, rateDelivery };