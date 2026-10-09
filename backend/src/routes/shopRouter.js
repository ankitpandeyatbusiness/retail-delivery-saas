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
const Rider = require('../models/Rider');
const { invalidateAvailability } = require('../services/availability');
const auditTrail = require('../middlewares/auditTrail');
const { validateSettings } = require('../services/tenantConfigService');

const { wrap, httpError } = apiErrors;
const router = express.Router();

// These routes are mounted twice: for owners (/api/shop) and for the superadmin
// (/api/admin/tenants/:tid/shop). The superadmin mount sets req.tenant and req.actor first
// and has already done its own login and audit, so the owner checks are skipped for him.
const isSuper = (req) => req.actor?.type === 'superadmin';
const ownerOnly = (mw) => (req, res, next) => (isSuper(req) ? next() : mw(req, res, next));
const ownerChain = (chain) => { const r = express.Router(); r.use(chain); return ownerOnly(r); };
const actorOf = (req) => req.actor || { type: 'owner', id: req.auth.userId, label: req.shopUser?.phone || 'shop owner' };

router.use(ownerOnly(tenantRecognizer));
router.use(ownerOnly(auditTrail('owner')));   // records every change a shop owner makes
router.use('/subscription', ownerChain(requireShopAdmin.allowBlocked), require('./shopSubscriptionRouter'));   // rent invoices stay visible even when blocked
router.use('/orders', ownerChain(requireShopAdmin.allowBlocked));
router.use('/orders', require('./shopRiderRouter').orders);   // assign riders (open while paused: orders in progress must finish)
router.use('/notifications', ownerChain(requireShopAdmin.allowBlocked), require('./notificationRouter').shop);   // owner inbox, stays open while paused
router.use('/billing', ownerChain(requireShopAdmin.allowBlocked), require('./shopBillingRouter'));   // stays open while paused

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
        actor: actorOf(req),
        orderId: req.params.id,
        status,
        note: req.body?.note,
    });
    res.json(view(order));
}));

router.use(ownerChain(requireShopAdmin));

// Pause or resume taking orders
router.put('/accepting-orders', wrap(async (req, res) => {
    if (typeof req.body?.acceptingOrders !== 'boolean') throw httpError(400, 'Send acceptingOrders: true or false');
    await Tenant.updateOne({ _id: req.tenant._id }, { $set: { 'settings.orders.acceptingOrders': req.body.acceptingOrders } });
    tenantRecognizer.invalidateTenant(req.tenant.slug);
    res.json({ ok: true, acceptingOrders: req.body.acceptingOrders });
}));

router.put('/settings', wrap(async (req, res) => {
    const body = req.body || {};
    const updates = {};

    if (body.hours !== undefined) {
        // same validator the superadmin panel uses
        const v = validateSettings({ hours: body.hours });
        if (!v.ok) return res.status(400).json({ error: 'Invalid hours', errors: v.errors });
        updates['settings.hours'] = v.clean.hours;
    }

    if (body.riders !== undefined) {
        const v = validateSettings({ riders: body.riders });
        if (!v.ok) return res.status(400).json({ error: 'Invalid rider settings', errors: v.errors });
        for (const [k, val] of Object.entries(v.clean.riders || {})) updates[`settings.riders.${k}`] = val;   // only the fields sent change
    }

    if (body.phone !== undefined) {
        const phone = String(body.phone).trim();
        if (!/^[6-9]\d{9}$/.test(phone)) throw httpError(400, 'Enter a valid 10-digit mobile number');
        updates.phone = phone;
    }

    if (body.address !== undefined) {
        if (!body.address || typeof body.address !== 'object') throw httpError(400, 'Invalid address');
        const a = body.address;
        if (a.line !== undefined) updates['address.line'] = String(a.line).trim().slice(0, 150);
        if (a.city !== undefined) updates['address.city'] = String(a.city).trim().slice(0, 60);
        if (a.pincode !== undefined) {
            const pin = String(a.pincode).trim();
            if (!/^\d{6}$/.test(pin)) throw httpError(400, 'Enter a valid 6-digit pincode');
            updates['address.pincode'] = pin;
        }
    }

    if (body.delivery !== undefined) {
        const d = body.delivery;
        if (!d || typeof d !== 'object') throw httpError(400, 'Invalid delivery settings');
        const cur = req.tenant.delivery || {};
        // keeps the old value when a field is not sent; 0 is allowed
        const pick = (key, min, max) => {
            if (d[key] === undefined) return cur[key];
            const n = Number(d[key]);
            if (d[key] === '' || !Number.isFinite(n) || n < min || n > max) {
                throw httpError(400, `${key} must be a number between ${min} and ${max}`);
            }
            return n;
        };
        const rules = [['latitude', -90, 90], ['longitude', -180, 180], ['radiusKm', 0, 100], ['minOrder', 0, 5000]];
        for (const [key, min, max] of rules) {
            if (d[key] === undefined) continue;   // not sent, so leave the old value alone
            updates[`delivery.${key}`] = pick(key, min, max);
        }
    }

    if (!Object.keys(updates).length) throw httpError(400, 'No valid settings provided to update');

    req.auditBefore = {   // for the audit log
        phone: req.tenant.phone, address: req.tenant.address,
        delivery: req.tenant.delivery, hours: req.tenant.settings?.hours,
    };

    const t = await Tenant.findOneAndUpdate(
        { _id: req.tenant._id },
        { $set: updates },
        { new: true, runValidators: true },
    ).select('phone address delivery settings.hours settings.riders').lean();

    tenantRecognizer.invalidateTenant(req.tenant.slug);
    res.json({ ok: true, phone: t.phone, address: t.address, delivery: t.delivery, hours: t.settings?.hours || null, riders: t.settings?.riders || null });
}));

router.use('/uploads', require('./uploadRouter'));   // direct-to-R2 uploads (owner and superadmin)
router.use('/sms', require('./shopSmsRouter'));      // SMS wallet (owner and superadmin)
// Owner map: riders with a location from the last 5 minutes. Must stay above the /riders mount below.
router.get('/riders/locations', wrap(async (req, res) => {
    const since = new Date(Date.now() - 5 * 60000);
    const items = await Rider.find({
        tenantId: req.tenant._id, isActive: true, 'lastLocation.at': { $gte: since },
    }).select('userId name isOnline activeOrderCount lastLocation').lean();
    res.json({
        items: items.map((r) => ({
            riderId: r.userId, name: r.name || null, isOnline: r.isOnline, activeOrderCount: r.activeOrderCount,
            lat: r.lastLocation.lat, lng: r.lastLocation.lng, at: r.lastLocation.at,
        })),
    });
}));
router.use('/riders', require('./shopRiderRouter').manage);   // add, list, switch off, remove riders
router.use('/cod', require('./shopCodRouter'));               // COD cash with riders, rider performance
router.use('/activity', require('./shopAuditRouter'));   // owner activity log (rows of this shop only)
router.use(require('./shopManageRouter'));
router.use(apiErrors);
module.exports = router;