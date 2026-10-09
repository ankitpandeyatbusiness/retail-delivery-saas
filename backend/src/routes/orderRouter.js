const express = require('express');
const mongoose = require('mongoose');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const apiErrors = require('../middlewares/apiErrors');
const Order = require('../models/Order');
const svc = require('../services/orderService');
const ratingSvc = require('../services/ratingService');
const feedbackSvc = require('../services/deliveryFeedbackService');
const { ACTIVE_STATUSES } = require('../services/orderflow');
const { streamInvoice } = require('../services/invoiceService');

const { wrap, httpError } = apiErrors;
const router = express.Router();

// A frozen shop (suspended or in maintenance) must still let customers VIEW their orders
// and CANCEL an order. Everything else (quote, place order, reorder) stays blocked.
router.use((req, res, next) => {
    const isRead = req.method === 'GET';
    const isCancel = req.method === 'POST' && /^\/[a-fA-F0-9]{24}\/cancel$/.test(req.path);
    req.allowFrozenShop = isRead || isCancel;
    next();
});
router.use(tenantRecognizer);
router.use(authenticate);   // every order route needs a logged-in customer

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);

// order as JSON, plus a flag the app uses to show or hide the Cancel button
const view = (order, tenant) => ({ ...order.toJSON(), canCancel: svc.customerCanCancel(order, tenant) });

const checkId = (req) => {
    if (!isId(req.params.id)) throw httpError(404, 'Order not found');
};

// Cart screen: the server works out the bill. The app never sends a total.
router.post('/quote', wrap(async (req, res) => {
    res.json(await svc.quote({ tenant: req.tenant, userId: req.auth.userId, body: req.body || {} }));
}));

// Place an order. Send an "Idempotency-Key" header (any unique string, e.g. a UUID made when checkout opens)
// so a double-tap or a retry returns the same order instead of creating two.
router.post('/', wrap(async (req, res) => {
    const key = req.get('idempotency-key');
    if (key !== undefined && (key.length < 8 || key.length > 64)) {
        throw httpError(400, 'Idempotency-Key must be 8 to 64 characters');
    }
    const { order, duplicate } = await svc.placeOrder({
        tenant: req.tenant,
        userId: req.auth.userId,
        body: req.body || {},
        idempotencyKey: key,
    });
    res.status(duplicate ? 200 : 201).json(view(order, req.tenant));
}));

// Pickup time windows for the cart screen
router.get('/pickup-slots', wrap(async (req, res) => {
    res.json(svc.pickupSlots(req.tenant));
}));

// Order history. ?active=true for the "ongoing" list. Pages: ?page=1&limit=20
router.get('/', wrap(async (req, res) => {

    const page = clamp(parseInt(req.query.page, 10) || 1, 1, 1000);
    const limit = clamp(parseInt(req.query.limit, 10) || 20, 1, 50);
    const filter = { tenantId: req.tenant._id, userId: req.auth.userId };
    if (req.query.active === 'true') filter.status = { $in: ACTIVE_STATUSES };

    // ?from=2026-10-01&to=2026-10-08 (days in Indian time). One day = same date in both. ?sort=oldest
    const IST_MS = 330 * 60000;
    const day = (v, endOfDay) => {
        if (v === undefined) return null;
        const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
        if (!m) throw httpError(400, 'Dates must look like 2026-10-31');
        const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
        if (mo < 1 || mo > 12 || d < 1 || d > 31) throw httpError(400, 'Invalid date');
        return new Date(Date.UTC(y, mo - 1, d) - IST_MS + (endOfDay ? 86400000 - 1 : 0));
    };
    const from = day(req.query.from, false);
    const to = day(req.query.to, true);
    if (from && to && from > to) throw httpError(400, 'The "from" date must not be after the "to" date');
    if (from || to) filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    const dir = req.query.sort === 'oldest' ? 1 : -1;

    const items = await Order.find(filter).sort({ createdAt: dir, _id: dir }).skip((page - 1) * limit).limit(limit + 1);
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    res.json({ items: items.map((o) => view(o, req.tenant)), page, hasMore });
}));

router.get('/:id', wrap(async (req, res) => {
    checkId(req);
    const order = await Order.findOne({ _id: req.params.id, tenantId: req.tenant._id, userId: req.auth.userId });
    if (!order) throw httpError(404, 'Order not found');
    res.json(view(order, req.tenant));
}));

router.post('/:id/cancel', wrap(async (req, res) => {
    checkId(req);
    const order = await svc.cancelByCustomer({
        tenant: req.tenant,
        userId: req.auth.userId,
        orderId: req.params.id,
        reason: req.body?.reason,
    });
    res.json(view(order, req.tenant));
}));

// Returns cart lines to refill the cart. Call /quote next to get today's prices.
router.post('/:id/reorder', wrap(async (req, res) => {
    checkId(req);
    res.json(await svc.reorderCart({ tenant: req.tenant, userId: req.auth.userId, orderId: req.params.id }));
}));

// Rate the dishes of a delivered order. Body: { "ratings": [{ "productId": "...", "rating": 5, "comment": "Tasty" }] }
router.post('/:id/rating', wrap(async (req, res) => {
    checkId(req);
    res.json(await ratingSvc.rateOrder({
        tenantId: req.tenant._id,
        userId: req.auth.userId,
        orderId: req.params.id,
        ratings: req.body?.ratings,
    }));
}));

// What the customer already rated on this order (so the app can pre-fill the stars)
router.get('/:id/rating', wrap(async (req, res) => {
    checkId(req);
    res.json(await ratingSvc.getRatings({ tenantId: req.tenant._id, userId: req.auth.userId, orderId: req.params.id }));
}));

// Live status of a delivery order: rider, ETA, delivery PIN. Only the customer who placed it.
router.get('/:id/tracking', wrap(async (req, res) => {
    checkId(req);
    res.json(await feedbackSvc.tracking({ tenant: req.tenant, userId: req.auth.userId, orderId: req.params.id }));
}));

// Rate the delivery (separate from the dishes). Body: { "rating": 5, "tags": ["On time"], "comment": "Polite" }
router.post('/:id/delivery-rating', wrap(async (req, res) => {
    checkId(req);
    res.status(201).json(await feedbackSvc.rateDelivery({
        tenant: req.tenant, userId: req.auth.userId, orderId: req.params.id, body: req.body || {},
    }));
}));

router.get('/:id/invoice', wrap(async (req, res) => {
    checkId(req);
    const order = await Order.findOne({ _id: req.params.id, tenantId: req.tenant._id, userId: req.auth.userId });
    if (!order) throw httpError(404, 'Order not found');
    if (order.status !== 'delivered') throw httpError(409, 'The invoice is only available after delivery');
    streamInvoice(res, order, req.tenant, { inline: req.query.view === '1' });
}));

router.use(apiErrors);
module.exports = router;