// Rider API.
//   /api/rider/...                              for a rider (login with phone + OTP, role rider)
//   /api/admin/tenants/:tid/riders/:rid/...     the superadmin acts as that rider
//
//   GET   /me            PATCH /me {name, vehicle}      PUT /online {isOnline}
//   GET   /orders?tab=offered|active|history&page=      GET /orders/:id
//   POST  /orders/:id/accept | /reject | /pickup
//   POST  /orders/:id/deliver {pin}      POST /orders/:id/problem {reason, note}
//   GET   /summary

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
const { ACTIVE_STATUSES } = require('../services/orderflow');
const notify = require('../services/notificationService');
const realtime = require('../services/realtime');
const { wrap, httpError } = apiErrors;
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

const OPEN = ['accepted', 'preparing', 'out_for_delivery'];
const MAX_PIN_TRIES = 5;
const REASONS = ['cannot_reach', 'customer_not_answering', 'wrong_address', 'other'];
const IST = 330 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

const actorOf = (req) => ({
    type: 'rider', id: req.riderId,
    label: req.actor?.type === 'superadmin' ? `${req.riderPhone} (by superadmin)` : req.riderPhone,
});

// what a rider may see. Customer name, phone and full address only after he accepted.
function riderView(o) {
    const d = o.delivery || {};
    const accepted = ['accepted', 'picked_up'].includes(d.status);
    const cod = o.payment?.method === 'cod' && o.payment?.status !== 'paid';
    return {
        id: o._id, orderNo: o.orderNo, status: o.status, createdAt: o.createdAt,
        items: (o.items || []).map((i) => ({ name: i.name, quantity: i.quantity })),
        note: o.note || null,
        customer: accepted ? o.customer : null,
        address: accepted ? o.address : { city: o.address?.city, pincode: o.address?.pincode, landmark: o.address?.landmark },
        payment: { method: o.payment?.method, collectAmount: cod ? o.pricing?.total : 0 },
        delivery: { status: d.status, offerExpiresAt: d.offerExpiresAt || null, pinRequired: !!d.pinRequired, deliveredAt: d.deliveredAt || null },
    };
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
        userId: r.userId, name: r.name || null, phone: req.riderPhone, shop: req.tenant.name,
        isActive: r.isActive, isOnline: r.isOnline, vehicle: r.vehicle || null,
        activeOrderCount: r.activeOrderCount, ratingAvg: r.ratingAvg, ratingCount: r.ratingCount,
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

// { "isOnline": true }
core.put('/online', wrap(async (req, res) => {
    if (typeof req.body?.isOnline !== 'boolean') throw httpError(400, 'Send isOnline: true or false');
    const r = await Rider.updateOne(
        { tenantId: req.tenant._id, userId: req.riderId, ...(req.body.isOnline && { isActive: true }) },
        { $set: { isOnline: req.body.isOnline } },
    );
    if (!r.matchedCount) throw httpError(403, 'Your rider account is switched off');
    res.json({ ok: true, isOnline: req.body.isOnline });
}));

core.get('/orders', wrap(async (req, res) => {
    const tab = req.query.tab || 'active';
    const base = { tenantId: req.tenant._id, 'delivery.riderId': req.riderId };
    const offered = { ...base, 'delivery.status': 'assigned', 'delivery.offerExpiresAt': { $gt: new Date() }, status: { $in: OPEN } };
    const active = { ...base, 'delivery.status': { $in: ['accepted', 'picked_up'] }, status: { $in: ACTIVE_STATUSES } };
    const history = { ...base, status: { $in: ['delivered', 'cancelled'] } };
    const filter = { offered, active, history }[tab];
    if (!filter) throw httpError(400, 'tab must be offered, active or history');

    const page = clamp(parseInt(req.query.page, 10) || 1, 1, 1000);
    const limit = clamp(parseInt(req.query.limit, 10) || 20, 1, 50);
    const [items, nOffered, nActive] = await Promise.all([
        Order.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit + 1).lean(),
        Order.countDocuments(offered),
        Order.countDocuments(active),
    ]);
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    res.json({ items: items.map(riderView), counts: { offered: nOffered, active: nActive }, page, hasMore });
}));

core.get('/orders/:id', wrap(async (req, res) => {
    res.json(riderView((await findMine(req)).toObject()));
}));

core.post('/orders/:id/accept', wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Order not found');
    const order = await assignment.accept({ orderId: req.params.id, tenantId: req.tenant._id, riderUserId: req.riderId });
    res.locals.auditAction = `RIDER_ACCEPT (order #${order.orderNo})`;
    res.json(riderView(order.toObject()));
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
    res.json(riderView(updated.toObject()));
}));

// { "pin": "1234" }  (when the shop uses the delivery PIN)
core.post('/orders/:id/deliver', wrap(async (req, res) => {
    const order = await findMine(req);
    if (order.delivery?.status !== 'picked_up' || order.status !== 'out_for_delivery') {
        throw httpError(409, 'Mark the order as picked up first');
    }
    if (order.delivery.pinRequired) {
        // count the try first (atomic), so the PIN cannot be guessed by many fast requests
        const tryOk = await Order.findOneAndUpdate(
            { _id: order._id, tenantId: order.tenantId, 'delivery.riderId': req.riderId, 'delivery.pinAttempts': { $lt: MAX_PIN_TRIES } },
            { $inc: { 'delivery.pinAttempts': 1 } },
        ).select('_id');
        if (!tryOk) throw httpError(429, 'Too many wrong PINs. Ask the shop owner to complete this delivery.');
        if (!pins.matches(order, req.body?.pin)) throw httpError(400, 'Wrong delivery PIN');
    }
    const updated = await orderStatus.change({ order, status: 'delivered', actor: actorOf(req) });
    res.locals.auditAction = `RIDER_DELIVERED (order #${updated.orderNo})`;
    res.json(riderView(updated.toObject()));
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
    res.json({
        deliveries: { today: dToday, month: dMonth, total: dTotal },
        cash: { owedToShopPaise: cash[0]?.balance || 0, collectedTotalPaise: cash[0]?.collected || 0 },
    });
}));

core.use(apiErrors);

/* ------------------------------ a rider logs in ------------------------------ */
// POST /api/rider/location  { "lat": 26.84, "lng": 80.94 }
// The app sends this every locationIntervalSec seconds while the rider has an order.
const MIN_GAP_MS = 3000;   // the server ignores updates faster than this
const locationRoute = wrap(async (req, res) => {
    const { lat, lng } = req.body || {};
    const okNum = (v, lim) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
    if (!okNum(lat, 90) || !okNum(lng, 180)) throw httpError(400, 'Send lat and lng as numbers');

    // shop switched tracking off
    if (req.tenant.settings?.riders?.liveTracking === false) return res.json({ ok: true, saved: false });

    // save only while the rider has an order, and not more often than MIN_GAP_MS
    const now = new Date();
    const r = await Rider.updateOne(
        {
            tenantId: req.tenant._id, userId: req.riderId, activeOrderCount: { $gt: 0 },
            $or: [{ 'lastLocation.at': { $exists: false } }, { 'lastLocation.at': { $lte: new Date(now.getTime() - MIN_GAP_MS) } }],
        },
        { $set: { lastLocation: { lat, lng, at: now } } },
    );
    if (!r.matchedCount) return res.json({ ok: true, saved: false });

    // tell the customer and the owner only for orders that are on the way
    const onTheWay = await Order.find({
        tenantId: req.tenant._id, 'delivery.riderId': req.riderId,
        'delivery.status': 'picked_up', status: 'out_for_delivery',
    }).select('_id').lean();
    onTheWay.forEach((o) => realtime.toOrder(String(o._id), 'rider:location', { orderId: String(o._id), lat, lng, at: now }));

    res.json({ ok: true, saved: true });
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