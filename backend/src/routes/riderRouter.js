// Rider API.
//   /api/rider/...                              for a rider (login with phone + OTP, role rider)
//   /api/admin/tenants/:tid/riders/:rid/...     the superadmin acts as that rider
//
//   GET   /me            PATCH /me {name, vehicle}      PUT /online {isOnline}
//   GET   /orders?tab=offered|active|history&page=      GET /orders/:id
//   POST  /orders/:id/accept | /reject | /pickup
//   POST  /orders/:id/deliver {pin}      POST /orders/:id/problem {reason, note}
//   GET   /summary
//   POST  /me/photo/sign {contentType, bytes}  ->  POST /me/photo {key}       DELETE /me/photo      his own picture
//   POST  /orders/:id/proof/sign {contentType, bytes}  ->  POST /orders/:id/proof {key}   DELETE /orders/:id/proof
//         the photo of the food handed over (proof of a safe delivery). Optional.

const express = require('express');
const mongoose = require('mongoose');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const auditTrail = require('../middlewares/auditTrail');
const apiErrors = require('../middlewares/apiErrors');
const User = require('../models/User');
const Rider = require('../models/Rider');
const Order = require('../models/Order');
const CodSettlement = require('../models/CodSettlement');
const orderStatus = require('../services/orderStatusService');
const assignment = require('../services/assignmentService');
const pins = require('../services/deliveryPinService');
const riderEarnings = require('../services/riderEarnings');
const riderPay = require('../services/riderPay');
const cod = require('../services/codService');
const { ACTIVE_STATUSES } = require('../services/orderflow');
const notify = require('../services/notificationService');
const media = require('../services/mediaService');
const Media = require('../models/Media');
const liveFeed = require('../services/liveFeed');
const { takeSignSlot } = require('../middlewares/uploadLimit');
const liveTracking = require('../services/liveTracking');
const doorPayment = require('../services/doorPayment');
const { haversineKm } = require('../utils/geo');
const deliveryPlan = require('../services/deliveryPlan');
const { wrap, httpError } = apiErrors;
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

const OPEN = ['accepted', 'preparing', 'out_for_delivery'];
const MAX_PIN_TRIES = 5;
const MAX_DELIVER_M = 300;          // marking delivered from farther than this from the customer's pin needs a tap on "deliver anyway"
const GPS_FRESH_MS = 5 * 60 * 1000;  // the last position sent to the server counts if it is this fresh
const REASONS = ['cannot_reach', 'customer_not_answering', 'wrong_address', 'other'];
const IST = 330 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

const actorOf = (req) => ({
    type: 'rider', id: req.riderId,
    label: req.actor?.type === 'superadmin' ? `${req.riderPhone} (by superadmin)` : req.riderPhone,
});

// what a rider may see. Customer name, phone and full address only after he accepted.
// ctx: { shop (the tenant), plan (how he is paid) }
function riderView(o, ctx = {}) {
    const d = o.delivery || {};
    const accepted = ['accepted', 'picked_up'].includes(d.status);
    const cod = o.payment?.method === 'cod' && o.payment?.status !== 'paid';
    const spot = Number.isFinite(o.address?.latitude) && Number.isFinite(o.address?.longitude) ? { latitude: o.address.latitude, longitude: o.address.longitude } : null;
    const from = ctx.shop?.delivery || {};
    const distanceKm = spot && Number.isFinite(from.latitude) && Number.isFinite(from.longitude)
        ? Math.round(haversineKm(from.latitude, from.longitude, spot.latitude, spot.longitude) * 10) / 10 : null;
    const qr = d.doorQr;
    return {
        id: o._id, orderNo: o.orderNo, status: o.status, createdAt: o.createdAt,
        items: (o.items || []).map((i) => ({ name: i.name, quantity: i.quantity })),
        note: o.note || null,
        customer: accepted ? { name: o.customer?.name, phone: o.customer?.phone } : null,
        address: accepted ? o.address : { city: o.address?.city, pincode: o.address?.pincode, landmark: o.address?.landmark },
        payment: { method: o.payment?.method, collectAmount: cod ? o.pricing?.total : 0, paidAtDoor: !!o.payment?.paidAtDoor },
        distanceKm,                                  // shop to the customer, in a straight line
        earnPaise: riderPay.earnPaise(ctx.plan, { totalRupees: o.pricing?.total, distanceKm }),   // what this delivery pays him (0 when pay is not tracked)
        destination: accepted ? spot : null,         // the customer's pin, for the map
        doorPay: {
            canStart: cod && d.status === 'picked_up' && o.status === 'out_for_delivery',
            qr: cod && doorPayment.isOpen(qr) ? doorPayment.qrView(qr) : null,
        },
        delivery: {
            status: d.status, offerExpiresAt: d.offerExpiresAt || (d.broadcast?.active ? d.broadcast.expiresAt : null) || null,
            pinRequired: !!d.pinRequired, deliveredAt: d.deliveredAt || null, collectedAt: d.pickedUpAt || null, arrivedAt: d.arrivedAt || null,
            plannedSec: d.plannedSec || null, dueAt: d.dueAt || null,   // the time allowed for the journey, saved when the food is collected
            proof: d.proof?.url ? { url: d.proof.url, at: d.proof.at } : null,
        },
    };
}

// the view function for this request (the shop and what a delivery pays are looked up once)
const viewer = async (req) => {
    const rider = await Rider.findOne({ tenantId: req.tenant._id, userId: req.riderId }).select('pay').lean();
    const plan = riderPay.effectivePlan(req.tenant.settings?.riders, rider);
    return (o) => riderView(o, { shop: req.tenant, plan });
};

// where the rider is right now: the phone's position sent with the request, else the last one the server has (if fresh)
async function whereIsHe(req) {
    const b = req.body || {};
    if (Number.isFinite(b.lat) && Number.isFinite(b.lng) && Math.abs(b.lat) <= 90 && Math.abs(b.lng) <= 180) return { lat: b.lat, lng: b.lng };
    const l = liveTracking.latestFor(req.riderId);   // the live position (memory); null when it is older than a few minutes
    return l && Date.now() - new Date(l.at).getTime() < GPS_FRESH_MS ? { lat: l.lat, lng: l.lng } : null;
}

const findMine = async (req) => {
    const order = isId(req.params.id)
        ? await Order.findOne({ _id: req.params.id, tenantId: req.tenant._id, 'delivery.riderId': req.riderId })
        : null;
    if (!order) throw httpError(404, 'Order not found');
    return order;
};

/* ------------------------------ the routes (read req.tenant and req.riderId) ------------------------------ */
const core = express.Router();

core.get('/me', wrap(async (req, res) => {
    const r = await Rider.findOne({ tenantId: req.tenant._id, userId: req.riderId }).lean();
    if (!r) throw httpError(404, 'Rider not found');
    res.json({
        userId: r.userId, name: r.name || null, phone: req.riderPhone, shop: req.tenant.name, shopPhone: req.tenant.phone || null,
        isActive: r.isActive, isOnline: r.isOnline, vehicle: r.vehicle || null, photo: r.photo || null,
        activeOrderCount: r.activeOrderCount, ratingAvg: r.ratingAvg, ratingCount: r.ratingCount,
        avgDeliveryMin: deliveryPlan.avgMin(r), deliveryCount: r.deliveryCount || 0, lateCount: r.lateCount || 0,   // the record of his journeys
    });
}));

core.patch('/me', wrap(async (req, res) => {
    const b = req.body || {};
    const set = {};
    if (b.name !== undefined) set.name = String(b.name).trim().slice(0, 80);
    if (b.vehicle !== undefined) {
        if (!b.vehicle || typeof b.vehicle !== 'object') throw httpError(400, 'Invalid vehicle');
        if (b.vehicle.type !== undefined) set['vehicle.type'] = String(b.vehicle.type).trim().slice(0, 20);
        if (b.vehicle.number !== undefined) set['vehicle.number'] = String(b.vehicle.number).trim().slice(0, 20);
    }
    if (!Object.keys(set).length) throw httpError(400, 'Nothing to update');
    await Rider.updateOne({ tenantId: req.tenant._id, userId: req.riderId }, { $set: set });
    res.json({ ok: true });
}));

/* ------------------------------ photos ------------------------------ */
const photoActor = (req) => ({ type: 'rider', id: String(req.riderId), label: req.riderPhone });
async function signSlot(req, res) {
    try {
        await takeSignSlot('rl_upload_r', `upload:r:${req.tenant._id}:${req.riderId}`, 40);
    } catch (e) {
        if (e.retryAfter) res.set('Retry-After', String(e.retryAfter));
        throw e;
    }
}

// his own picture: sign -> PUT the file to the address -> confirm
core.post('/me/photo/sign', wrap(async (req, res) => {
    await signSlot(req, res);
    const { contentType, bytes } = req.body || {};
    res.json(await media.sign({
        tenant: req.tenant, actorId: String(req.riderId), kind: 'rider', refId: String(req.riderId), contentType, bytes, allowed: media.RIDER_KINDS,
    }));
}));

core.post('/me/photo', wrap(async (req, res) => {
    const doc = await media.confirm({
        tenant: req.tenant, actorId: String(req.riderId), kind: 'rider', refId: String(req.riderId), key: req.body?.key,
        allowed: media.RIDER_KINDS, uploadedBy: photoActor(req),
    });
    await Rider.updateOne({ tenantId: req.tenant._id, userId: req.riderId }, { $set: { photo: doc.url } });
    res.locals.auditAction = 'RIDER_PHOTO';
    res.status(201).json({ ok: true, photo: doc.url });
}));

core.delete('/me/photo', wrap(async (req, res) => {
    const m = await Media.findOne({ tenantId: req.tenant._id, kind: 'rider', refId: String(req.riderId) }).select('_id').lean();
    if (!m) throw httpError(404, 'No photo to remove');
    await media.removeMedia({ tenant: req.tenant, id: String(m._id), allowed: media.RIDER_KINDS });
    res.json({ ok: true });
}));

// proof of a safe delivery: the photo of the food handed over to the customer
core.post('/orders/:id/proof/sign', wrap(async (req, res) => {
    const order = await findMine(req);
    await signSlot(req, res);
    const { contentType, bytes } = req.body || {};
    res.json(await media.sign({
        tenant: req.tenant, actorId: String(req.riderId), kind: 'proof', refId: String(order._id), contentType, bytes, allowed: media.RIDER_KINDS,
    }));
}));

core.post('/orders/:id/proof', wrap(async (req, res) => {
    const order = await findMine(req);
    const doc = await media.confirm({
        tenant: req.tenant, actorId: String(req.riderId), kind: 'proof', refId: String(order._id), key: req.body?.key,
        allowed: media.RIDER_KINDS, uploadedBy: photoActor(req),
    });
    const before = order.delivery?.proof?.mediaId;
    await Order.updateOne(
        { _id: order._id, tenantId: req.tenant._id },
        { $set: { 'delivery.proof': { url: doc.url, at: new Date(), mediaId: doc._id } } },
    );
    // a new photo replaces the old one (set first, so a failure never leaves the order without a photo)
    if (before && String(before) !== String(doc._id)) {
        media.removeMedia({ tenant: req.tenant, id: String(before), allowed: media.RIDER_KINDS }).catch(() => { });
    }
    liveFeed.emit(req.tenant._id, 'orders', { type: 'delivery.proof', orderNo: order.orderNo });
    res.locals.auditAction = `RIDER_PROOF (order #${order.orderNo})`;
    res.status(201).json({ ok: true, proof: { url: doc.url, at: new Date() } });
}));

core.delete('/orders/:id/proof', wrap(async (req, res) => {
    const order = await findMine(req);
    const id = order.delivery?.proof?.mediaId;
    if (!id) throw httpError(404, 'This delivery has no photo');
    await media.removeMedia({ tenant: req.tenant, id: String(id), allowed: media.RIDER_KINDS });
    res.json({ ok: true });
}));

// { "isOnline": true }
core.put('/online', wrap(async (req, res) => {
    if (typeof req.body?.isOnline !== 'boolean') throw httpError(400, 'Send isOnline: true or false');
    const r = await Rider.updateOne(
        { tenantId: req.tenant._id, userId: req.riderId, ...(req.body.isOnline && { isActive: true }) },
        req.body.isOnline ? { $set: { isOnline: true, onlineSince: new Date() } } : { $set: { isOnline: false }, $unset: { onlineSince: 1 } },
    );
    if (!r.matchedCount) throw httpError(403, 'Your rider account is switched off');
    res.json({ ok: true, isOnline: req.body.isOnline });
}));

core.get('/orders', wrap(async (req, res) => {
    const tab = req.query.tab || 'active';
    const base = { tenantId: req.tenant._id, 'delivery.riderId': req.riderId };
    // two kinds of offers: one made to him alone, or the broadcast to all free riders (still open, not expired, he has not answered)
    const nowTime = new Date();
    const offered = {
        tenantId: req.tenant._id, status: { $in: OPEN },
        $or: [
            { 'delivery.riderId': req.riderId, 'delivery.status': 'assigned', 'delivery.offerExpiresAt': { $gt: nowTime } },
            {
                'delivery.riderId': { $exists: false }, 'delivery.broadcast.active': true,
                'delivery.broadcast.expiresAt': { $gt: nowTime },
                'delivery.offers': { $elemMatch: { riderId: req.riderId, result: 'offered' } },
            },
        ],
    };
    const active = { ...base, 'delivery.status': { $in: ['accepted', 'picked_up'] }, status: { $in: ACTIVE_STATUSES } };
    const history = { ...base, status: { $in: ['delivered', 'cancelled', 'undelivered'] } };
    // asked, but the time ran out before he answered (shown in History; he can still take it while nobody else has)
    const missed = { tenantId: req.tenant._id, 'delivery.offers': { $elemMatch: { riderId: req.riderId, result: 'timeout' } } };
    const filter = { offered, active, history, missed }[tab];
    if (!filter) throw httpError(400, 'tab must be offered, active, history or missed');

    // "since" = when he last looked at History: how many offers he missed after that (the red dot)
    const since = new Date(req.query.since);
    const newMissed = Number.isNaN(since.getTime()) ? 0 : await Order.countDocuments({
        tenantId: req.tenant._id, 'delivery.offers': { $elemMatch: { riderId: req.riderId, result: 'timeout', at: { $gt: since } } },
    });

    const page = clamp(parseInt(req.query.page, 10) || 1, 1, 1000);
    const limit = clamp(parseInt(req.query.limit, 10) || 20, 1, 50);
    const [items, nOffered, nActive] = await Promise.all([
        Order.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit + 1).lean(),
        Order.countDocuments(offered),
        Order.countDocuments(active),
    ]);
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    const view = await viewer(req);
    const row = tab !== 'missed' ? view : (o) => {
        const miss = [...(o.delivery?.offers || [])].reverse().find((x) => String(x.riderId) === String(req.riderId) && x.result === 'timeout');
        return { ...view(o), missed: { at: miss?.at || null, canTake: OPEN.includes(o.status) && !o.delivery?.riderId } };
    };
    res.json({ items: items.map(row), counts: { offered: nOffered, active: nActive, missed: newMissed }, page, hasMore });
}));

core.get('/orders/:id', wrap(async (req, res) => {
    const view = await viewer(req);
    res.json(view((await findMine(req)).toObject()));
}));

// The way for the map on his phone and the time allowed: from the shop to the customer (he collects at the shop and delivers from
// there). One road per order, kept for 30 minutes (services/deliveryPlan.js), so Google is called once per order and counted in
// the same monthly caps as every route; when the caps are used up or Google fails the answer is the free estimate
// (source "estimate") and the app still shows the time. The shop's location is not sent as a point, only the road.
core.get('/orders/:id/route', wrap(async (req, res) => {
    const order = await findMine(req);
    if (!['accepted', 'picked_up'].includes(order.delivery?.status) || !OPEN.includes(order.status)) throw httpError(409, 'No delivery to show');
    // a shop without a pin on the map: the road starts where the rider is
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const from = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
    const result = await deliveryPlan.plan(order, req.tenant, from);
    if (!result) throw httpError(404, 'The shop or the customer has no pin on the map');
    res.json(result);
}));

core.post('/orders/:id/accept', wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Order not found');
    const order = await assignment.accept({ orderId: req.params.id, tenantId: req.tenant._id, riderUserId: req.riderId });
    res.locals.auditAction = `RIDER_ACCEPT (order #${order.orderNo})`;
    res.json((await viewer(req))(order.toObject()));
}));

core.post('/orders/:id/reject', wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Order not found');
    const out = await assignment.reject({ orderId: req.params.id, tenantId: req.tenant._id, riderUserId: req.riderId });
    res.locals.auditAction = 'RIDER_REJECT';
    res.locals.auditParams = { orderId: req.params.id };
    res.json(out);
}));

// food collected from the shop
core.post('/orders/:id/pickup', wrap(async (req, res) => {
    const order = await findMine(req);
    const updated = await orderStatus.change({ order, status: 'out_for_delivery', actor: actorOf(req) });
    res.locals.auditAction = `RIDER_PICKUP (order #${updated.orderNo})`;
    res.json((await viewer(req))(updated.toObject()));
}));

// { "pin": "1234" }  (when the shop uses the delivery PIN)
// "I have arrived": the time is kept (waiting time, and the owner can see it). Safe to tap twice.
core.post('/orders/:id/arrived', wrap(async (req, res) => {
    const order = await findMine(req);
    if (order.delivery?.status !== 'picked_up' || order.status !== 'out_for_delivery') throw httpError(409, 'Collect the order from the shop first');
    await Order.updateOne({ _id: order._id, tenantId: req.tenant._id, 'delivery.arrivedAt': { $exists: false } }, { $set: { 'delivery.arrivedAt': new Date() } });
    liveFeed.emit(req.tenant._id, 'riders', { type: 'rider.arrived', orderNo: order.orderNo, riderId: String(req.riderId) });
    res.locals.auditAction = `RIDER_ARRIVED (order #${order.orderNo})`;
    res.json((await viewer(req))((await findMine(req)).toObject()));
}));

// He cannot do this delivery after all, and has NOT collected the food yet: the order goes back to the other riders and the
// owner is told. After pickup the food must come back, so he calls the shop (the problem button) instead.
core.post('/orders/:id/release', wrap(async (req, res) => {
    const order = await findMine(req);
    if (order.delivery?.status !== 'accepted' || order.status === 'out_for_delivery') throw httpError(409, 'You have the food now. Call the shop to decide what to do.');
    const note = String(req.body?.note || '').trim().slice(0, 120);
    await assignment.unassign({ orderId: order._id, tenantId: req.tenant._id, reason: `Rider gave it back${note ? `: ${note}` : ''}`, actor: actorOf(req) });
    assignment.startBroadcast({ orderId: order._id, tenantId: req.tenant._id, excludeRiderId: req.riderId })
        .catch((e) => console.error('Rider broadcast error:', e.message));
    notify.riderProblem({ tenantId: req.tenant._id, orderId: order._id, orderNo: order.orderNo, riderUserId: req.riderId, reason: 'released', note });
    res.locals.auditAction = `RIDER_RELEASED (order #${order.orderNo})`;
    res.json({ ok: true });
}));

// A Cash on delivery customer wants to pay online at the door: a QR for the exact amount (see services/doorPayment.js).
core.post('/orders/:id/door-pay', wrap(async (req, res) => {
    const order = await findMine(req);
    const qr = await doorPayment.start({ order, tenant: req.tenant });
    res.locals.auditAction = `RIDER_DOOR_QR (order #${order.orderNo})`;
    res.status(201).json({ qr });
}));
// has it been paid? (asks Razorpay now, so the rider never waits for a late webhook)
core.get('/orders/:id/door-pay', wrap(async (req, res) => {
    res.json(await doorPayment.check({ order: await findMine(req), tenant: req.tenant }));
}));

core.post('/orders/:id/deliver', wrap(async (req, res) => {
    const order = await findMine(req);
    if (order.delivery?.status !== 'picked_up' || order.status !== 'out_for_delivery') {
        throw httpError(409, 'Mark the order as picked up first');
    }
    // Where is he? A phone far from the customer's pin must tap "deliver anyway" (and the owner can see it was flagged).
    let point = null;
    if (req.actor?.type !== 'superadmin') {
        const dest = order.address || {};
        if (Number.isFinite(dest.latitude) && Number.isFinite(dest.longitude)) {
            const here = await whereIsHe(req);
            if (here) {
                const distanceM = Math.round(haversineKm(here.lat, here.lng, dest.latitude, dest.longitude) * 1000);
                point = { lat: here.lat, lng: here.lng, distanceM, far: distanceM > MAX_DELIVER_M, noGps: false };
                if (point.far && req.body?.farOk !== true) {
                    const away = distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)} km` : `${distanceM} m`;
                    throw Object.assign(httpError(409, `You seem to be ${away} from the customer.`), { extra: { code: 'TOO_FAR', distanceM } });
                }
            } else {
                point = { noGps: true, far: false };   // no position at all: allowed, but flagged
            }
        }
    }
    if (order.delivery.pinRequired) {
        // count the try first (atomic), so the PIN cannot be guessed by many fast requests
        const tryOk = await Order.findOneAndUpdate(
            { _id: order._id, tenantId: order.tenantId, 'delivery.riderId': req.riderId, 'delivery.pinAttempts': { $lt: MAX_PIN_TRIES } },
            { $inc: { 'delivery.pinAttempts': 1 } },
        ).select('_id');
        if (!tryOk) throw httpError(429, 'Too many wrong PINs. Ask the shop owner to complete this delivery.');
        if (!pins.matches(order, req.body?.pin)) throw httpError(400, 'Wrong delivery PIN');
    } else if (!order.delivery.proof?.url && req.actor?.type !== 'superadmin') {
        // no PIN at this shop: the photo of the food handed over is the proof, so it is compulsory
        // (the superadmin acting as the rider has no camera, and the owner completes orders on his own route)
        throw httpError(409, 'Take a photo of the food handed over before marking it delivered');
    }
    if (order.delivery?.doorQr?.qrId) await doorPayment.closeOpen({ order, tenantId: req.tenant._id });   // he takes cash after all: the QR must not stay open
    const updated = await orderStatus.change({ order, status: 'delivered', actor: actorOf(req) });
    if (point) {
        await Order.updateOne({ _id: order._id, tenantId: req.tenant._id }, { $set: { 'delivery.deliveredPoint': { ...point, at: new Date() } } });
        if (point.far || point.noGps) liveFeed.emit(req.tenant._id, 'orders', { type: 'delivery.flagged', orderNo: updated.orderNo, distanceM: point.distanceM, noGps: !!point.noGps });
    }
    res.locals.auditAction = `RIDER_DELIVERED (order #${updated.orderNo})`;
    res.json((await viewer(req))(updated.toObject()));
}));

// { "reason": "cannot_reach", "note": "gate is locked" }
core.post('/orders/:id/problem', wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Order not found');
    const { reason } = req.body || {};
    const note = String(req.body?.note || '').trim().slice(0, 200);
    if (!REASONS.includes(reason)) throw httpError(400, `reason must be one of: ${REASONS.join(', ')}`);
    if (reason === 'other' && !note) throw httpError(400, 'Please write a short note');

    const r = await Order.findOneAndUpdate(
        {
            _id: req.params.id, tenantId: req.tenant._id, 'delivery.riderId': req.riderId,
            'delivery.status': { $in: ['accepted', 'picked_up'] }, status: { $in: ACTIVE_STATUSES },
            'delivery.problems.9': { $exists: false },
        },
        { $push: { 'delivery.problems': { at: new Date(), reason, note: note || undefined } } },
    );
    if (!r) throw httpError(409, 'A problem cannot be reported on this order now');
    notify.riderProblem({
        tenantId: req.tenant._id, orderId: r._id, orderNo: r.orderNo, riderUserId: req.riderId, reason, note,
    });
    res.locals.auditAction = `RIDER_PROBLEM (order #${r.orderNo})`;
    res.locals.auditParams = { reason, note };
    res.status(201).json({ ok: true });
}));

// The help button. The owner gets a push at once with his name, phone, order and last position (and an SMS when the push cannot reach him).
// Pressing it again within a minute does nothing new, so a nervous double tap cannot flood the owner.
const lastSos = new Map();
core.post('/sos', wrap(async (req, res) => {
    const key = String(req.riderId);
    const repeated = Date.now() - (lastSos.get(key) || 0) < 60000;
    if (!repeated) {
        lastSos.set(key, Date.now());
        let orderNo = null;
        if (isId(String(req.body?.orderId || ''))) orderNo = (await Order.findOne({ _id: req.body.orderId, tenantId: req.tenant._id, 'delivery.riderId': req.riderId }).select('orderNo').lean())?.orderNo || null;
        notify.riderSos({ tenantId: req.tenant._id, riderUserId: req.riderId, phone: req.riderPhone, orderNo, spot: liveTracking.latestFor(req.riderId) });
        res.locals.auditAction = 'RIDER_SOS';
    }
    res.json({ ok: true, repeated, shopPhone: req.tenant.phone || null });
}));

// One page for his money: the cash he holds (and the limit), and what he earns. Pay is left out when the shop pays outside the app.
core.get('/money', wrap(async (req, res) => {
    const tenantId = req.tenant._id;
    const riders = req.tenant.settings?.riders || {};
    const rider = await Rider.findOne({ tenantId, userId: req.riderId }).select('pay').lean();
    const plan = riderPay.effectivePlan(riders, rider);
    const [bal, ledger, pay] = await Promise.all([
        cod.balanceOf(tenantId, req.riderId),
        cod.ledger({ tenantId, riderId: req.riderId, page: 1, limit: 15 }),
        riderPay.moneyFor({ tenantId, riderId: req.riderId, plan, riders }),
    ]);
    res.json({
        cash: {
            balancePaise: bal.balancePaise,
            limitPaise: Math.round((riders.cashLimit || 0) * 100),
            items: ledger.items.map((r) => ({ id: r.id, type: r.type, amountPaise: r.amountPaise, orderNo: r.orderNo, note: r.note, at: r.createdAt })),
        },
        pay,
    });
}));

core.get('/summary', wrap(async (req, res) => {
    const now = Date.now();
    const today = new Date(Math.floor((now + IST) / DAY) * DAY - IST);
    const month = new Date(`${new Date(now + IST).toISOString().slice(0, 7)}-01T00:00:00+05:30`);
    const mine = { tenantId: req.tenant._id, 'delivery.riderId': req.riderId, status: 'delivered' };

    const [dToday, dMonth, dTotal, cash] = await Promise.all([
        Order.countDocuments({ ...mine, deliveredAt: { $gte: today } }),
        Order.countDocuments({ ...mine, deliveredAt: { $gte: month } }),
        Order.countDocuments(mine),
        CodSettlement.aggregate([
            { $match: { tenantId: req.tenant._id, riderId: req.riderId } },
            { $group: { _id: null, balance: { $sum: '$amountPaise' }, collected: { $sum: { $cond: [{ $eq: ['$type', 'collect'] }, '$amountPaise', 0] } } } },
        ]),
    ]);
    const rider = await Rider.findOne({ tenantId: req.tenant._id, userId: req.riderId }).select('pay').lean();
    const plan = riderPay.effectivePlan(req.tenant.settings?.riders, rider);
    const e = riderPay.paysPerDelivery(plan) ? await riderPay.earned({ tenantId: req.tenant._id, riderId: req.riderId }) : { todayPaise: 0, monthPaise: 0, totalPaise: 0 };
    res.json({
        earnings: { todayPaise: e.todayPaise, monthPaise: e.monthPaise, totalPaise: e.totalPaise },   // information only
        pay: { type: plan.type, label: riderPay.describe(plan) },
        deliveries: { today: dToday, month: dMonth, total: dTotal },
        cash: { owedToShopPaise: cash[0]?.balance || 0, collectedTotalPaise: cash[0]?.collected || 0, limitPaise: Math.round((req.tenant.settings?.riders?.cashLimit || 0) * 100) },
    });
}));

core.use(apiErrors);

/* ------------------------------ a rider logs in ------------------------------ */
// POST /api/rider/location  { "lat": 26.84, "lng": 80.94 }
// The app sends this every locationIntervalSec seconds while the rider has an order.
const locationRoute = wrap(async (req, res) => {
    // the same code as the socket path (services/liveTracking.js): a position is kept only while the rider has an order on the way
    const r = await liveTracking.ingest({ tenantId: req.tenant._id, riderId: req.riderId, body: req.body || {}, via: 'http' });
    if (!r.ok) throw httpError(400, r.reason || 'Send lat and lng as numbers');
    res.json({ ok: true, saved: !!r.saved, reason: r.reason, everySec: r.everySec });
});

async function requireRider(req, res, next) {
    const u = await User.findOne({ _id: req.auth.userId, tenantId: req.tenant._id }).select('role isBlocked phone').lean();
    if (!u || u.isBlocked || u.role !== 'rider') return res.status(403).json({ error: 'This account is not a rider' });
    const r = await Rider.findOne({ tenantId: req.tenant._id, userId: u._id }).select('isActive').lean();
    if (!r || !r.isActive) return res.status(403).json({ error: 'Your rider account is switched off' });
    req.riderId = u._id;
    req.riderPhone = u.phone;
    req.shopUser = { phone: u.phone };        // used as the label in the activity log
    next();
}

// the superadmin picks a rider: /tenants/:tid/riders/:rid/...
async function asRider(req, res, next) {
    if (!isId(req.params.rid)) return next(httpError(404, 'Rider not found'));
    const [r, u] = await Promise.all([
        Rider.findOne({ tenantId: req.tenant._id, userId: req.params.rid }).select('_id').lean(),
        User.findOne({ _id: req.params.rid, tenantId: req.tenant._id }).select('phone').lean(),
    ]);
    if (!r || !u) return next(httpError(404, 'Rider not found'));
    req.riderId = u._id;
    req.riderPhone = u.phone;
    next();
}

const router = express.Router();
router.use((req, res, next) => { req.allowFrozenShop = true; next(); });   // a frozen shop must not strand a rider mid-delivery
router.use(tenantRecognizer);
router.use(authenticate);
router.use(requireRider);
router.post('/location', locationRoute);   // before auditTrail on purpose: no log row per update
router.use(auditTrail('rider'));
router.use(core);
router.use(apiErrors);

module.exports = router;
module.exports.core = core;
module.exports.asRider = asRider;