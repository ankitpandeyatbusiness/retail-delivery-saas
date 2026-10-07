// Superadmin view of ORDERS across all shops, invoices and sales reports.
// Mounted inside adminRouter (after requireSuperAdmin), so these URLs are:
//
//   GET /api/admin/orders                 all shops (filters below)
//   GET /api/admin/orders/:id
//   GET /api/admin/orders/:id/invoice     PDF download (?view=1 opens it in the browser)
//   GET /api/admin/reports/sales          all shops, or one with ?tenantId=...

const express = require('express');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Tenant = require('../models/Tenant');
const { streamInvoice } = require('../services/invoiceService');
const { salesReport, parseRange } = require('../services/reportService');
const { wrap, httpError } = require('../middlewares/apiErrors');
const Coupon = require('../models/Coupon');
const { ACTIVE_STATUSES } = require('../services/orderflow');

const router = express.Router();
const STATUSES = Order.schema.path('status').enumValues;
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

// adds the shop's name and short name to each order so the panel can show where it came from
async function withShop(orders) {
    const ids = [...new Set(orders.map((o) => String(o.tenantId)))];
    const shops = await Tenant.find({ _id: { $in: ids } }).select('name slug').lean();
    const byId = new Map(shops.map((s) => [String(s._id), s]));
    return orders.map((o) => ({
        ...o.toJSON(),
        shopName: byId.get(String(o.tenantId))?.name || 'Unknown shop',
        shopSlug: byId.get(String(o.tenantId))?.slug || null,
    }));
}

/*
  ?tenantId=...             only one shop
  ?status=active            orders still in progress, or ?status=placed,delivered
  ?q=1042                   order number, or a 10-digit customer phone
  ?from=2026-10-01&to=2026-10-31
  ?page=1&limit=20
*/
router.get('/orders', wrap(async (req, res) => {
    const page = clamp(parseInt(req.query.page, 10) || 1, 1, 1000);
    const limit = clamp(parseInt(req.query.limit, 10) || 20, 1, 50);
    const filter = {};

    if (req.query.tenantId !== undefined) {
        if (!isId(req.query.tenantId)) throw httpError(400, 'Invalid tenantId');
        filter.tenantId = req.query.tenantId;
    }

    if (req.query.status === 'active') {
        filter.status = { $in: ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery'] };
    } else if (typeof req.query.status === 'string' && req.query.status) {
        const list = req.query.status.split(',').filter((s) => STATUSES.includes(s));
        if (!list.length) throw httpError(400, 'Unknown status');
        filter.status = { $in: list };
    }

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (/^[6-9]\d{9}$/.test(q)) filter['customer.phone'] = q;
    else if (/^\d{1,9}$/.test(q)) filter.orderNo = Number(q);

    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) throw httpError(400, 'Invalid date');
    if (from || to) filter.createdAt = { ...(from && { $gte: from }), ...(to && { $lte: to }) };

    const items = await Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit + 1);
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    res.json({ items: await withShop(items), page, hasMore });
}));

router.get('/orders/:id', wrap(async (req, res) => {
    const order = isId(req.params.id) ? await Order.findById(req.params.id) : null;
    if (!order) throw httpError(404, 'Order not found');
    res.json((await withShop([order]))[0]);
}));

router.get('/orders/:id/invoice', wrap(async (req, res) => {
    const order = isId(req.params.id) ? await Order.findById(req.params.id) : null;
    if (!order) throw httpError(404, 'Order not found');
    if (order.status !== 'delivered') throw httpError(409, 'The invoice is only available after delivery');
    const tenant = await Tenant.findById(order.tenantId).select('name address phone').lean();
    streamInvoice(res, order, tenant, { inline: req.query.view === '1' });
}));

// ?from=2026-10-01&to=2026-10-31&groupBy=day|month&tenantId=optional
router.get('/reports/sales', wrap(async (req, res) => {
    const { from, to } = parseRange(req.query);
    let tenantId;
    if (req.query.tenantId !== undefined) {
        if (!isId(req.query.tenantId)) throw httpError(400, 'Invalid tenantId');
        tenantId = req.query.tenantId;
    }
    res.json(await salesReport({ tenantId, from, to, groupBy: req.query.groupBy }));
}));


router.patch('/orders/:id/status', wrap(async (req, res) => {
    const order = isId(req.params.id) ? await Order.findById(req.params.id) : null;
    if (!order) throw httpError(404, 'Order not found');

    const status = req.body?.status;
    if (!['cancelled', 'delivered'].includes(status)) {
        throw httpError(400, 'Superadmin can only force status to cancelled or delivered');
    }

    // Only orders still in progress can be forced. Finished orders are final.
    if (!ACTIVE_STATUSES.includes(order.status)) {
        throw httpError(409, `This order is already "${order.status}" and cannot be changed`);
    }

    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 200) : '';

    const set = { status };
    if (status === 'cancelled') {
        set.cancelledBy = 'admin';
        set.cancelReason = note || 'Force cancelled by Superadmin';
    } else {
        set.deliveredAt = new Date();
        if (order.payment?.method === 'cod') set['payment.status'] = 'paid';
    }

    // The status filter makes this fail if the shop or customer moved the order a moment ago
    const updated = await Order.findOneAndUpdate(
        { _id: order._id, status: order.status },
        {
            $set: set,
            $push: { statusHistory: { status, by: req.admin._id, note: `Superadmin: ${note || 'override'}` } },
        },
        { new: true }
    );
    if (!updated) throw httpError(409, 'This order was just updated. Refresh and try again.');

    // The coupon is released only once, because a cancelled order can no longer be changed
    if (status === 'cancelled' && updated.couponId) {
        await Coupon.updateOne({ _id: updated.couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
    }

    res.json((await withShop([updated]))[0]);
}));

module.exports = router;