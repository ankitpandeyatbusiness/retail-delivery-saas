const express = require('express');
const mongoose = require('mongoose');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const requireShopAdmin = require('../middlewares/requireShopAdmin');
const apiErrors = require('../middlewares/apiErrors');
const Order = require('../models/Order');
const svc = require('../services/orderService');
const { ACTIVE_STATUSES } = require('../services/orderflow');
const Tenant = require('../models/Tenant');
const Rider = require('../models/Rider');
const auditTrail = require('../middlewares/auditTrail');
const { validateSettings } = require('../services/tenantConfigService');
const invoiceRoutes = require('./shopInvoiceRouter');
const liveSnapshot = require('../services/liveSnapshot');
const { HIDE_UNPAID } = require('../services/onlineOrder');
const { orderSpeech, orderSpeechHi } = require('../utils/orderSpeech');
const pushChannel = require('../notifications/channels/push');
const { NEW_ORDER_CHANNEL } = require('../notifications/events');
const dashboardService = require('../services/dashboardService');
const { nextMorning } = require('../utils/nextMorning');
const { acceptDeadline } = require('../services/orderTimeout');
const { resolveConfig, DEFAULTS } = require('../services/tenantConfigService');

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

/* ------------------------------------------------------------------------------------------------
   Three levels of access:
   1. allowBlocked : open even when the shop is paused for rent AND when the superadmin blocked the owner panel
   2. allowPaused  : open while paused for unpaid rent, but closed when the superadmin blocked the owner panel
   3. normal       : closed while paused for rent, and when blocked
   ------------------------------------------------------------------------------------------------ */

/* ---------- level 1: orders in progress, billing, bills, messages ---------- */
router.use('/subscription', ownerChain(requireShopAdmin.allowBlocked), require('./shopSubscriptionRouter'));   // rent invoices stay visible
router.use('/orders', ownerChain(requireShopAdmin.allowBlocked));
router.use('/orders', require('./shopRiderRouter').orders);   // assign riders (orders in progress must finish)
router.use('/orders/:id/invoice', invoiceRoutes.invoice);     // the invoice PDF of an order (already past the login above)
router.use('/notifications', ownerChain(requireShopAdmin.allowBlocked), require('./notificationRouter').shop);
router.use('/support', ownerChain(requireShopAdmin.allowBlocked), require('./shopSupportRouter'));          // help & support: also for a blocked or unpaid shop
router.use('/profile', ownerChain(requireShopAdmin.allowBlocked), require('./shopProfileRouter'));          // the owner's own name, email and picture
router.use('/billing', ownerChain(requireShopAdmin.allowBlocked), require('./shopBillingRouter'));

const STATUSES = Order.schema.path('status').enumValues;
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);

// order as JSON, plus the next steps the shop is allowed to take (the panel draws its buttons from this)
// speech / speechHi: what the owner's Soundbox reads out for this order (English and Hindi)
// acceptBy: while an order waits, the moment the server will cancel it if nobody accepts (the owner sees a countdown)
const view = (order) => ({
    ...order.toJSON(),
    allowedNext: svc.nextStatuses(order),
    riderAssigned: !!(order.delivery?.riderId && order.delivery?.status !== 'rejected'),   // a delivery order cannot go out without one
    speech: orderSpeech(order),
    speechHi: orderSpeechHi(order),
    ...(order.status === 'placed' ? { acceptBy: acceptDeadline(order) } : {}),
});

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
    const page = clamp(parseInt(req.query.page, 10) || 1, 1, 10000);
    const limit = clamp(parseInt(req.query.limit, 10) || 20, 1, 50);
    const filter = { tenantId: req.tenant._id, ...HIDE_UNPAID };   // an online order shows up after it is paid

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
            { $match: { tenantId: req.tenant._id, status: { $in: ACTIVE_STATUSES }, ...HIDE_UNPAID } },
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
    const order = isId(req.params.id) ? await Order.findOne({ _id: req.params.id, tenantId: req.tenant._id, ...HIDE_UNPAID }) : null;
    if (!order) throw httpError(404, 'Order not found');
    // what the customer said about the food of this order (the delivery review is part of the order itself)
    const reviews = order.ratedAt ? await require('../models/Review').find({ tenantId: req.tenant._id, orderId: order._id }).select('productId rating comment -_id').lean() : [];
    const nameOf = Object.fromEntries((order.items || []).map((l) => [String(l.productId), l.name || l.title || 'Dish']));
    res.json({ ...view(order), foodReviews: reviews.map((r) => ({ name: nameOf[String(r.productId)] || 'Dish', rating: r.rating, comment: r.comment || '' })) });
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
        reasonCode: req.body?.reasonCode,
    });
    res.json(view(order));
}));

/* ---------- level 2: open while the shop is paused for unpaid rent ---------- */
// The owner must be able to settle cash with riders, manage riders, see his money and top up SMS.
const openWhilePaused = ownerChain(requireShopAdmin.allowPaused);

// Owner map: riders whose live position (memory, from the socket) is from the last 5 minutes. Must stay above the /riders mount below.
router.get('/riders/locations', openWhilePaused, wrap(async (req, res) => {
    const liveTracking = require('../services/liveTracking');
    const riders = await Rider.find({ tenantId: req.tenant._id, isActive: true, $or: [{ isOnline: true }, { activeOrderCount: { $gt: 0 } }] })
        .select('userId name isOnline activeOrderCount').lean();
    res.json({
        items: riders
            .map((r) => ({ r, p: liveTracking.latestFor(r.userId) }))
            .filter(({ p }) => p)
            .map(({ r, p }) => ({
                riderId: r.userId, name: r.name || null, isOnline: r.isOnline, activeOrderCount: r.activeOrderCount,
                lat: p.lat, lng: p.lng, at: p.at, heading: p.heading ?? null,
            })),
    });
}));
// The owner's live map in one answer: the shop pin, every rider with his position, and every delivery on the way with its road, due
// time and the customer's details (services/liveMap.js).
router.get('/live-map', openWhilePaused, wrap(async (req, res) => {
    res.json(await require('../services/liveMap').build(req.tenant));
}));
// The live picture of the shop: order counts, riders, billable orders, revenue, SMS balance, last 50 feed lines
// Everything the owner's Home screen shows, in one call (see services/dashboardService.js). Open while rent is unpaid,
// like /live: the owner still needs his orders and numbers.
router.get('/dashboard', openWhilePaused, wrap(async (req, res) => {
    const data = await dashboardService.build(req.tenant._id);
    const cfg = resolveConfig(req.tenant);
    res.json({
        ...data,
        shop: {
            isOpen: cfg.restaurant.isOpen,
            closedReason: cfg.restaurant.closedReason,
            acceptingOrders: cfg.orders.acceptingOrders,
            pausedUntil: cfg.orders.pausedUntil || null,
        },
    });
}));
// The shop's progress report: GET /api/shop/business-report?range=7|30|90|2026-09
router.get('/business-report', openWhilePaused, wrap(async (req, res) => {
    res.json(await require('../services/businessReport').build({ tenantId: req.tenant._id, range: req.query.range || '30' }));
}));
router.get('/live', openWhilePaused, wrap(async (req, res) => {
    res.json(await liveSnapshot.build(req.tenant._id, { owner: true }));
}));
// A test of the real new-order alert: sends the owner's own phone(s) a push exactly like a new order (the loud channel,
// the voice clip, the spoken sentence), after delaySec seconds so he can lock the screen first. Nothing is saved: no
// order, no inbox row, no SMS. Only the phones of the person who asks.   Body: { delaySec: 0..30 }
const lastTestAlert = new Map();   // userId -> time, so the button can not be used to flood a phone
router.post('/test-alert', openWhilePaused, wrap(async (req, res) => {
    if (isSuper(req) || !req.auth?.userId) throw httpError(400, 'Only the shop owner can send a test alert to his own phone');
    const who = String(req.auth.userId);
    if (Date.now() - (lastTestAlert.get(who) || 0) < 8000) throw httpError(429, 'Wait a few seconds before sending another test');
    lastTestAlert.set(who, Date.now());

    const delaySec = Math.min(Math.max(Math.round(Number(req.body?.delaySec) || 0), 0), 30);
    const sample = {
        orderType: 'delivery', pricing: { total: 540 }, payment: { method: 'cod' },
        items: [
            { name: 'Butter Naan', quantity: 2 }, { name: 'Laccha Paratha', quantity: 1 },
            { name: 'Paneer Butter Masala', quantity: 1, selections: [{ name: 'Full' }] },
        ],
    };
    const push = () => pushChannel.send({
        tenantId: req.tenant._id,
        userId: who,
        title: 'New order (test)',
        body: 'This is a test of your new-order alert',
        data: { type: 'order_new', test: '1', orderNo: 'TEST', speech: orderSpeech(sample), speechHi: orderSpeechHi(sample) },
        channelId: NEW_ORDER_CHANNEL,
        sound: 'new_order',
    }).catch((e) => console.error('Test alert push error:', e.message));

    if (delaySec) setTimeout(push, delaySec * 1000).unref?.();
    const r = delaySec ? { sent: null } : await push();
    res.json({ ok: true, delaySec, sent: r.sent });
}));

router.use('/riders', openWhilePaused, require('./shopRiderRouter').manage);   // add, list, switch off, remove riders
router.use('/cod', openWhilePaused, require('./shopCodRouter'));               // COD cash with riders, rider performance
router.use('/activity', openWhilePaused, require('./shopAuditRouter'));        // owner activity log (rows of this shop only)
router.use('/sms', openWhilePaused, require('./shopSmsRouter'));
router.use('/payments', openWhilePaused, require('./shopPaymentsRouter'));     // online money: report and refunds       // SMS wallet and top-up
router.use('/reports', openWhilePaused, invoiceRoutes.reports);                // sales report

/* ---------- level 3: closed while paused ---------- */
router.use(ownerChain(requireShopAdmin));

// Pause or resume taking orders
//   { acceptingOrders: true }                        start taking orders now (also ends a timed pause)
//   { acceptingOrders: false }                       pause until he starts again
//   { acceptingOrders: false, pauseMinutes: 30 }     pause for 30 minutes (1 to 1440): the shop reopens BY ITSELF
//   { acceptingOrders: false, untilMorning: true }   pause until 4 AM (India time): tomorrow's 4 AM, or today's if it is earlier
router.put('/accepting-orders', wrap(async (req, res) => {
    const b = req.body || {};
    if (typeof b.acceptingOrders !== 'boolean') throw httpError(400, 'Send acceptingOrders: true or false');

    let pausedUntil = null;
    if (!b.acceptingOrders && b.pauseMinutes !== undefined) {
        const m = Number(b.pauseMinutes);
        if (!Number.isInteger(m) || m < 1 || m > 1440) throw httpError(400, 'pauseMinutes must be a whole number from 1 to 1440');
        pausedUntil = new Date(Date.now() + m * 60000);
    } else if (!b.acceptingOrders && b.untilMorning === true) {
        pausedUntil = nextMorning();
    }

    req.auditBefore = { acceptingOrders: req.tenant.settings?.orders?.acceptingOrders, pausedUntil: req.tenant.settings?.orders?.pausedUntil || null };
    const update = pausedUntil
        // a timed pause leaves the on/off switch ON: when the time is over the shop simply reopens, nothing has to run
        ? { $set: { 'settings.orders.acceptingOrders': true, 'settings.orders.pausedUntil': pausedUntil } }
        : { $set: { 'settings.orders.acceptingOrders': b.acceptingOrders }, $unset: { 'settings.orders.pausedUntil': '' } };
    await Tenant.updateOne({ _id: req.tenant._id }, update);
    tenantRecognizer.invalidateTenant(req.tenant.slug);
    res.json({ ok: true, acceptingOrders: b.acceptingOrders, pausedUntil });
}));


// What the owner can change on his own shop, as it is now (the screens fill their forms from this).
// riders: the delivery rules. orders.codCap: the cash on delivery limit for a phone's first orders.
const riderPay = require('../services/riderPay');
router.get('/settings', wrap(async (req, res) => {
    const st = req.tenant.settings || {};
    const cfg = resolveConfig(req.tenant);
    res.json({
        phone: req.tenant.phone || null,
        address: req.tenant.address || {},
        delivery: req.tenant.delivery || {},
        hours: { weekly: cfg.hours.weekly || {}, closedMessage: st.hours?.closedMessage || '', closedDates: cfg.hours.closedDates || [] },
        riders: { payPerDelivery: 0, ...DEFAULTS.riders, ...(st.riders || {}), pay: riderPay.effectivePlan(st.riders) },
        notifications: { ...DEFAULTS.notifications, ...(st.notifications || {}) },
        menu: { outOfStock: cfg.menu.outOfStock },   // 'dim' = sold-out dishes stay on the menu, greyed out. 'hide' = they disappear. Shared with the superadmin panel.
        orders: {
            codCap: { ...DEFAULTS.orders.codCap, ...(st.orders?.codCap || {}) },
            deliveryFee: { ...DEFAULTS.orders.deliveryFee, ...(st.orders?.deliveryFee || {}) },
            packagingCharge: cfg.orders.packagingCharge || 0,
            tipOptions: cfg.orders.tipOptions || [],
            minOrder: cfg.orders.minOrder || 0,
            prepTimeMin: st.orders?.prepTimeMin ?? DEFAULTS.orders.prepTimeMin,
            gst: cfg.orders.gst,   // set by the platform, shown only
            busy: cfg.orders.busy || null,
        },
    });
}));

// Busy mode: the kitchen is rushed, so customers see a longer wait for a while. It ends by itself.
//   { extraMin: 15, minutes: 60 } | { extraMin: 30, untilMorning: true } | { off: true }
router.put('/busy', wrap(async (req, res) => {
    const b = req.body || {};
    req.auditBefore = { busy: req.tenant.settings?.orders?.busy || null };
    if (b.off === true) {
        await Tenant.updateOne({ _id: req.tenant._id }, { $unset: { 'settings.orders.busy': '' } });
        tenantRecognizer.invalidateTenant(req.tenant.slug);
        return res.json({ ok: true, busy: null });
    }
    if (!Number.isInteger(b.extraMin) || b.extraMin < 5 || b.extraMin > 120) throw httpError(400, 'extraMin must be a whole number from 5 to 120');
    let until;
    if (b.untilMorning === true) until = nextMorning();
    else {
        if (!Number.isInteger(b.minutes) || b.minutes < 1 || b.minutes > 1440) throw httpError(400, 'minutes must be a whole number from 1 to 1440');
        until = new Date(Date.now() + b.minutes * 60000);
    }
    await Tenant.updateOne({ _id: req.tenant._id }, { $set: { 'settings.orders.busy': { extraMin: b.extraMin, until } } });
    tenantRecognizer.invalidateTenant(req.tenant.slug);
    res.json({ ok: true, busy: { extraMin: b.extraMin, until } });
}));

// The end-of-day summary. ?date=2026-10-31 (default today, India time)
router.get('/closing-report', wrap(async (req, res) => {
    res.json(await require('../services/closingReport').build({ tenantId: req.tenant._id, date: req.query.date }));
}));

router.put('/settings', wrap(async (req, res) => {
    const body = req.body || {};
    const updates = {};
    let menuSwitched = false;

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
        // the day the owner starts recording payments: what a rider is owed is counted from then, never from older deliveries
        if (v.clean.riders?.trackPayouts === true && !req.tenant.settings?.riders?.trackPayouts) updates['settings.riders.trackFrom'] = new Date();
    }

    if (body.menu !== undefined) {
        // the one menu switch the owner shares with the superadmin: show sold-out dishes (greyed out) or hide them. Whoever saves last decides.
        if (!body.menu || typeof body.menu !== 'object' || Object.keys(body.menu).some((k) => k !== 'outOfStock')) throw httpError(400, 'You can change only whether sold-out dishes are shown');
        const v = validateSettings({ menu: { outOfStock: body.menu.outOfStock } });
        if (!v.ok || !v.clean.menu?.outOfStock) throw httpError(400, 'Choose show or hide');
        updates['settings.menu.outOfStock'] = v.clean.menu.outOfStock;
        menuSwitched = true;
    }

    if (body.orders !== undefined) {
        // what the owner may change of the order settings: the cash limit and what a customer pays on top of the food.
        // GST, payment methods and order types stay with the platform.
        const OWNER_ORDER_KEYS = ['codCap', 'deliveryFee', 'packagingCharge', 'tipOptions', 'minOrder', 'prepTimeMin'];
        if (!body.orders || typeof body.orders !== 'object' || Array.isArray(body.orders) || Object.keys(body.orders).some((k) => !OWNER_ORDER_KEYS.includes(k))) {
            throw httpError(400, 'You can change only the cash limit, delivery fee, packaging charge, tips, minimum order and preparation time');
        }
        const v = validateSettings({ orders: body.orders });
        if (!v.ok) return res.status(400).json({ error: 'Invalid order settings', errors: v.errors });
        for (const [k, val] of Object.entries(v.clean.orders || {})) {
            if (val && typeof val === 'object' && !Array.isArray(val)) {
                for (const [k2, val2] of Object.entries(val)) updates[`settings.orders.${k}.${k2}`] = val2;
            } else updates[`settings.orders.${k}`] = val;
        }
    }

    if (body.notifications !== undefined) {
        const v = validateSettings({ notifications: body.notifications });
        if (!v.ok) return res.status(400).json({ error: 'Invalid notification settings', errors: v.errors });
        for (const [k, val] of Object.entries(v.clean.notifications || {})) updates[`settings.notifications.${k}`] = val;
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
        if (a.state !== undefined) {
            const st = String(a.state).trim();
            const gs = require('../services/gstSplit');
            if (st && !gs.codeFromName(st)) throw httpError(400, 'Enter an Indian state name, like Uttar Pradesh');
            updates['address.state'] = st ? gs.nameOf(gs.codeFromName(st)) : '';
        }
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
        delivery: req.tenant.delivery, hours: req.tenant.settings?.hours, orders: req.tenant.settings?.orders,
    };

    const t = await Tenant.findOneAndUpdate(
        { _id: req.tenant._id },
        { $set: updates },
        { returnDocument: 'after', runValidators: true },
    ).select('phone address delivery settings.hours settings.riders settings.notifications settings.orders').lean();

    tenantRecognizer.invalidateTenant(req.tenant.slug);
    if (menuSwitched) { try { require('../services/realtime').toShop(req.tenant._id, 'menu:changed', {}); } catch (e) { /* the apps also refresh on their own */ } }   // customers see it at once
    res.json({
        ok: true, phone: t.phone, address: t.address, delivery: t.delivery,
        hours: t.settings?.hours || null, riders: t.settings?.riders || null, notifications: t.settings?.notifications || null,
        codCap: t.settings?.orders?.codCap || null, orders: t.settings?.orders || null,
    });
}));

router.use('/uploads', require('./uploadRouter'));   // direct-to-R2 uploads (owner and superadmin)
router.get('/reviews', wrap(async (req, res) => { res.json(await require('../services/reviewsService').list({ tenantId: req.tenant._id, query: req.query })); }));   // what customers say: dishes and delivery
router.use('/customers', require('./shopCustomersRouter'));   // customer tools: list, detail, edit, Cash on delivery block
router.use('/autopilot', require('./shopAutopilotRouter'));   // automatic reminders to customers (push and inbox only)
router.use('/messages', require('./shopMessagesRouter'));     // messages to his customers and riders
router.use('/complaints', require('./shopComplaintsRouter')); // complaints of his customers
router.use(require('./shopManageRouter'));           // menu: categories, products, banners, coupons, collections
router.use(apiErrors);
module.exports = router;