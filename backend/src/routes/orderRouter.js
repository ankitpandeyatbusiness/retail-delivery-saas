const express = require('express');
const mongoose = require('mongoose');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const apiErrors = require('../middlewares/apiErrors');
const Order = require('../models/Order');
const svc = require('../services/orderService');
const ratingSvc = require('../services/ratingService');
const feedbackSvc = require('../services/deliveryFeedbackService');
const complaintSvc = require('../services/complaintService');
const { ACTIVE_STATUSES } = require('../services/orderflow');
const { streamInvoice } = require('../services/invoiceService');
const paymentService = require('../services/paymentService');
const accounts = require('../services/paymentAccounts');
const { APP_METHODS, UNPAID_QUERY } = require('../services/onlineOrder');

const { wrap, httpError } = apiErrors;
const router = express.Router();

// A frozen shop (suspended or in maintenance) must still let customers VIEW their orders
// and CANCEL an order. Everything else (quote, place order, reorder) stays blocked.
router.use((req, res, next) => {
    const isRead = req.method === 'GET';
    const isCancel = req.method === 'POST' && /^\/[a-fA-F0-9]{24}\/(cancel|complaints|pay\/verify)$/.test(req.path);
    req.allowFrozenShop = isRead || isCancel;
    next();
});
router.use(tenantRecognizer);
router.use(authenticate);   // every order route needs a logged-in customer

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);

// order as JSON, plus a flag the app uses to show or hide the Cancel button
const { pinFor } = require('../services/deliveryPinService');
const queueInfo = require('../services/queueInfo');
const view = (order, tenant, queue) => { const j = order.toJSON(); delete j.needsLook;
    // what the kitchen did is the shop's business: the guest only learns that the food is packed (delivery) - never a cook's name or a problem note
    if (j.kitchen) j.kitchen = j.kitchen.readyAt ? { readyAt: j.kitchen.readyAt } : undefined;
    if (queue) j.queue = queue;   // where it is in the kitchen: { stage, position, ahead, etaMin } (only when the shop shows it)
    // the 4-digit code he shows when he collects a pickup order (worked out from a secret, nothing is stored)
    if (order.orderType === 'pickup' && ['placed', 'accepted', 'preparing', 'ready'].includes(order.status)) { try { j.pickupCode = pinFor(order); } catch (e) { /* no secret set up: no code */ } }
    return { ...j, canCancel: svc.customerCanCancel(order, tenant), canChangePickup: svc.canChangePickup(order, tenant), canAskCancel: require('../services/customerAsks').canAskCancel(order, tenant) }; };   // needsLook is for the shop only

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
    const t0 = Date.now();
    const { order, duplicate } = await svc.placeOrder({
        tenant: req.tenant,
        userId: req.auth.userId,
        body: req.body || {},
        idempotencyKey: key,
    });
    const tPlaced = Date.now() - t0;
    const out = view(order, req.tenant);
    // An online order: send what the payment screen needs in the SAME answer, so the app opens the UPI app
    // without a second round trip. If this fails the app just calls /:id/pay as before.
    if (order.payment?.method && order.payment.method !== 'cod' && order.payment.status !== 'paid' && order.status === 'placed') {
        try { out.paymentStart = await paymentService.startForOrder({ order }); } catch (e) { /* the app asks again */ }
    }
    // how long each part took (visible in the network tab / app log): place = order saved, rzp = Razorpay order made
    res.set('Server-Timing', `place;dur=${tPlaced}, total;dur=${Date.now() - t0}`);
    res.status(duplicate ? 200 : 201).json(out);
}));

// Which online payment methods this shop can take right now. The app asks BEFORE it shows the pay button.
router.get('/payment-config', wrap(async (req, res) => {
    const can = await accounts.canTakePayments(req.tenant._id);
    // keyId is Razorpay's PUBLIC key: the app uses it to get the payment SDK ready before the customer taps pay
    let keyId = null;
    if (can.ok) { try { keyId = (await paymentService.credsFor(req.tenant._id)).keyId || null; } catch (e) { /* none */ } }
    res.json({ online: !!can.ok, methods: can.ok ? APP_METHODS : [], keyId });
}));

// Pickup time windows for the cart screen
router.get('/pickup-slots', wrap(async (req, res) => {
    res.json(svc.pickupSlots(req.tenant));
}));

// At his pickup time the app asks: did you collect it? (the pickup orders waiting for an answer)
router.get('/pickup-due', wrap(async (req, res) => { res.json({ items: await require('../services/customerAsks').pickupDue({ tenant: req.tenant, userId: req.auth.userId }) }); }));

// Order history. ?active=true for the "ongoing" list. Pages: ?page=1&limit=20
router.get('/', wrap(async (req, res) => {

    const page = clamp(parseInt(req.query.page, 10) || 1, 1, 1000);
    const limit = clamp(parseInt(req.query.limit, 10) || 20, 1, 50);
    const filter = { tenantId: req.tenant._id, userId: req.auth.userId };
    if (req.query.active === 'true') filter.status = { $in: ACTIVE_STATUSES };
    // a payment the customer abandoned (cancelled before paying) is not an order: it never shows in his history
    filter.$nor = [{ status: 'cancelled', ...UNPAID_QUERY }];

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
    const q = await queueInfo.forOrders(req.tenant, items);
    res.json({ items: items.map((o) => view(o, req.tenant, q.get(String(o._id)))), page, hasMore });
}));

router.get('/:id', wrap(async (req, res) => {
    checkId(req);
    const order = await Order.findOne({ _id: req.params.id, tenantId: req.tenant._id, userId: req.auth.userId });
    if (!order) throw httpError(404, 'Order not found');
    res.json(view(order, req.tenant, (await queueInfo.forOrders(req.tenant, [order])).get(String(order._id))));
}));

router.post('/:id/pickup-answer', wrap(async (req, res) => {
    checkId(req);
    res.json(await require('../services/customerAsks').pickupAnswer({ tenant: req.tenant, userId: req.auth.userId, orderId: req.params.id, answer: req.body?.answer }));
}));
// a table guest asks the shop to cancel a round that is already being made
router.post('/:id/cancel-request', wrap(async (req, res) => {
    checkId(req);
    const order = await require('../services/customerAsks').askCancel({ tenant: req.tenant, userId: req.auth.userId, orderId: req.params.id, note: req.body?.note });
    res.json(view(order, req.tenant));
}));
// ask to move a pickup to a later time window (the shop says yes or no)
router.post('/:id/pickup-time', wrap(async (req, res) => {
    checkId(req);
    const order = await svc.requestPickupTime({ tenant: req.tenant, userId: req.auth.userId, orderId: req.params.id, pickupSlot: req.body?.pickupSlot });
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

// Start paying an online order. Gives the app what its payment screen needs. Safe to call again.
router.post('/:id/pay', wrap(async (req, res) => {
    checkId(req);
    const order = await Order.findOne({ _id: req.params.id, tenantId: req.tenant._id, userId: req.auth.userId });
    if (!order) throw httpError(404, 'Order not found');
    res.json(await paymentService.startForOrder({ order }));
}));

// "Is it paid?": asks Razorpay directly (no webhook needed). The app uses it when it came back without a payment proof.
router.post('/:id/pay/check', wrap(async (req, res) => {
    checkId(req);
    const order = await Order.findOne({ _id: req.params.id, tenantId: req.tenant._id, userId: req.auth.userId });
    if (!order) throw httpError(404, 'Order not found');
    let r;
    try {
        r = await paymentService.checkWithRazorpay({ order });
    } catch (e) {
        r = { paid: false, status: 'unknown' };   // Razorpay not reachable: the app treats it as "not known yet"
    }
    const fresh = await Order.findById(order._id);
    res.json({ paid: !!r.paid, status: r.status, order: view(fresh, req.tenant) });
}));

// After the customer paid: the app sends the proof. We check it and ask Razorpay what really happened.
router.post('/:id/pay/verify', wrap(async (req, res) => {
    checkId(req);
    const b = req.body || {};
    const [rzpOrderId, rzpPaymentId, signature] = [b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature];
    if (![rzpOrderId, rzpPaymentId, signature].every((v) => typeof v === 'string' && v && v.length <= 100)) {
        throw httpError(400, 'Payment details are missing');
    }
    const order = await Order.findOne({ _id: req.params.id, tenantId: req.tenant._id, userId: req.auth.userId });
    if (!order) throw httpError(404, 'Order not found');
    const r = await paymentService.verifyFromApp({ order, rzpOrderId, rzpPaymentId, signature });
    const fresh = await Order.findById(order._id);
    res.json({ paid: !!r.paid, order: view(fresh, req.tenant) });
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

// Complaint about a delivered order (within 24 hours of delivery, one per order).
// Body: { "type": "missing_item|wrong_item|quality|late|packaging|other", "text": "...", "photos": ["https://..."] }
router.post('/:id/complaints', wrap(async (req, res) => {
    checkId(req);
    res.status(201).json(await complaintSvc.create({ tenant: req.tenant, userId: req.auth.userId, orderId: req.params.id, body: req.body }));
}));

// { items: [the complaint, if any], canComplain, until }
router.get('/:id/complaints', wrap(async (req, res) => {
    checkId(req);
    res.json(await complaintSvc.forOrder({ tenant: req.tenant, userId: req.auth.userId, orderId: req.params.id }));
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