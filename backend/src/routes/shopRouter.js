const express = require('express');
const mongoose = require('mongoose');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const requireShopAdmin = require('../middlewares/requireShopAdmin');
const apiErrors = require('../middlewares/apiErrors');
const Order = require('../models/Order');
const svc = require('../services/orderService');
const { ACTIVE_STATUSES } = require('../services/orderflow');
const Product = require('../models/Product');
const Tenant = require('../models/Tenant');
const { invalidateAvailability } = require('../services/availability');

const OWNER_PRODUCT_FIELDS = ['price', 'mrp', 'isAvailable', 'isActive', 'gstRate'];   // nothing else

const { wrap, httpError } = apiErrors;
const router = express.Router();
router.use(tenantRecognizer);
router.use('/subscription', requireShopAdmin.allowBlocked, require('./shopSubscriptionRouter'));   // rent invoices stay visible even when blocked
router.use('/orders', requireShopAdmin.allowBlocked);

const STATUSES = Order.schema.path('status').enumValues;
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);

// order as JSON, plus the next steps the shop is allowed to take (the panel draws its buttons from this)
const view = (order) => ({ ...order.toJSON(), allowedNext: svc.nextStatuses(order) });

/*
  GET /api/shop/orders
    ?status=active            all orders still in progress
    ?status=placed,accepted   or a list of statuses
    ?q=1042                   find by order number
    ?from=2026-10-01&to=2026-10-31
    ?page=1&limit=20
  Also returns `counts`: how many active orders per status (for the badges).
*/
router.get('/orders', wrap(async (req, res) => {
    const page = clamp(parseInt(req.query.page, 10) || 1, 1, 1000);
    const limit = clamp(parseInt(req.query.limit, 10) || 20, 1, 50);
    const filter = { tenantId: req.tenant._id };

    if (req.query.status === 'active') {
        filter.status = { $in: ACTIVE_STATUSES };
    } else if (typeof req.query.status === 'string' && req.query.status) {
        const list = req.query.status.split(',').filter((s) => STATUSES.includes(s));
        if (!list.length) throw httpError(400, 'Unknown status');
        filter.status = { $in: list };
    }

    if (typeof req.query.q === 'string' && /^\d{1,9}$/.test(req.query.q.trim())) {
        filter.orderNo = Number(req.query.q.trim());
    }

    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) throw httpError(400, 'Invalid date');
    if (from || to) filter.createdAt = { ...(from && { $gte: from }), ...(to && { $lte: to }) };

    const [items, counts] = await Promise.all([
        Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit + 1),
        Order.aggregate([
            { $match: { tenantId: req.tenant._id, status: { $in: ACTIVE_STATUSES } } },
            { $group: { _id: '$status', n: { $sum: 1 } } },
        ]),
    ]);
    const hasMore = items.length > limit;
    if (hasMore) items.pop();

    res.json({
        items: items.map(view),
        counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
        page,
        hasMore,
    });
}));

router.get('/orders/:id', wrap(async (req, res) => {
    const order = isId(req.params.id) ? await Order.findOne({ _id: req.params.id, tenantId: req.tenant._id }) : null;
    if (!order) throw httpError(404, 'Order not found');
    res.json(view(order));
}));

// Body: { "status": "accepted", "note": "optional" }. Cancelling needs a "note" (the reason).
router.patch('/orders/:id/status', wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Order not found');
    const status = req.body?.status;
    if (typeof status !== 'string' || !STATUSES.includes(status)) throw httpError(400, 'Invalid status');

    const order = await svc.updateStatusByShop({
        tenantId: req.tenant._id,
        adminId: req.auth.userId,
        orderId: req.params.id,
        status,
        note: req.body?.note,
    });
    res.json(view(order));
}));

router.use(requireShopAdmin);

// Pause or resume taking orders
router.put('/accepting-orders', wrap(async (req, res) => {
    if (typeof req.body?.acceptingOrders !== 'boolean') throw httpError(400, 'Send acceptingOrders: true or false');
    await Tenant.updateOne({ _id: req.tenant._id }, { $set: { 'settings.orders.acceptingOrders': req.body.acceptingOrders } });
    tenantRecognizer.invalidateTenant(req.tenant.slug);
    res.json({ ok: true, acceptingOrders: req.body.acceptingOrders });
}));

router.use(require('./shopManageRouter'));
router.use(apiErrors);
module.exports = router;