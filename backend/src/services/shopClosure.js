// Closing a shop (not deleting it): everything stays, the shop just stops. The superadmin closes it with a reason; it can be opened again.
//   close   status becomes "suspended" (every app of the shop shows the closed screen, see tenantRecognizer) and a record is kept on the shop (tenant.closure).
//           Orders in progress: "cancel" them (the normal cancel, with its refunds) or let them "finish" first (the shop stops taking new orders now and closes by itself
//           the moment the last order is done).
//   reopen  by hand.
//   sweep   every few minutes: finishes a "finish" closing. Nothing is ever closed by the sweep: the superadmin decides.
const Tenant = require('../models/Tenant');
const Order = require('../models/Order');
const { httpError } = require('../middlewares/apiErrors');
const notice = require('./shopSettingsNotice');

const ACTIVE = ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery'];
const KINDS = ['manual'];

const invalidate = (slug) => { try { require('../middlewares/tenantRecognizer').invalidateTenant(slug); } catch (e) { /* the next request reads it */ } };
const activeOrders = (tenantId) => Order.countDocuments({ tenantId, status: { $in: ACTIVE } });

// what the superadmin sees before closing or reopening
async function preview(tenantId) {
    const t = await Tenant.findById(tenantId).select('name status closure').lean();
    if (!t) throw httpError(404, 'Shop not found');
    return {
        name: t.name, closed: !!t.closure?.on, closing: !!t.closure?.closing, closure: t.closure?.on ? { kind: t.closure.kind, reason: t.closure.reason, at: t.closure.at, by: t.closure.by, closing: !!t.closure.closing, mode: t.closure.mode, history: t.closure.history || [] } : null,
        activeOrders: await activeOrders(tenantId),
    };
}

async function cancelActiveOrders(tenantId, admin, reason) {
    const orderStatus = require('./orderStatusService');
    const rows = await Order.find({ tenantId, status: { $in: ACTIVE } });
    let cancelled = 0; let failed = 0;
    for (const order of rows) {
        try {
            await orderStatus.change({ order, status: 'cancelled', actor: { type: 'superadmin', id: admin._id, label: admin.email }, note: `The shop was closed: ${reason}` });
            cancelled += 1;
        } catch (e) { failed += 1; console.error('Close shop: could not cancel an order:', e.message); }
    }
    return { cancelled, failed };
}

async function close(tenantId, { reason, orders = 'finish' } = {}, admin) {
    const why = String(reason || '').trim();
    if (why.length < 3) throw httpError(400, 'Please write the reason for closing');
    if (why.length > 200) throw httpError(400, 'The reason is too long (200 letters at most)');
    if (!['finish', 'cancel'].includes(orders)) throw httpError(400, 'Choose what happens to the orders in progress');
    const t = await Tenant.findById(tenantId).select('name slug status closure settings.orders.acceptingOrders');
    if (!t) throw httpError(404, 'Shop not found');
    if (t.closure?.on) throw httpError(409, 'This shop is already closed');
    const now = new Date();
    const running = await activeOrders(tenantId);
    const prevAccepting = t.settings?.orders?.acceptingOrders !== false;

    let result = { cancelled: 0, failed: 0 };
    let closing = false;
    if (running && orders === 'cancel') result = await cancelActiveOrders(tenantId, admin, why);
    else if (running) closing = true;   // let them finish: stop new orders now, close fully when the last one is done

    // a failed cancel leaves that order running: the shop then also waits for it
    if (!closing && result.failed) closing = true;
    const set = {
        'closure.on': true, 'closure.kind': 'manual', 'closure.reason': why, 'closure.at': now, 'closure.by': admin.email || 'superadmin',
        'closure.mode': orders, 'closure.closing': closing, 'closure.prevAccepting': prevAccepting,
    };
    if (closing) set['settings.orders.acceptingOrders'] = false;
    else set.status = 'suspended';
    await Tenant.updateOne({ _id: t._id }, { $set: set });
    invalidate(t.slug);
    notice.closed(t._id, 'manual', closing);
    return { ok: true, closing, ...result };
}

async function reopenNow(t, how, who) {
    const c = t.closure || {};
    const set = { status: 'active', 'closure.on': false, 'closure.closing': false };
    if (c.prevAccepting !== undefined) set['settings.orders.acceptingOrders'] = c.prevAccepting;
    await Tenant.updateOne({ _id: t._id }, {
        $set: set,
        $push: { 'closure.history': { kind: c.kind, reason: c.reason, at: c.at, by: c.by, reopenedAt: new Date(), reopenedBy: who, how } },
    });
    invalidate(t.slug);
    notice.reopened(t._id);
}

async function reopen(tenantId, _opts, admin) {
    const t = await Tenant.findById(tenantId).select('name slug status closure');
    if (!t) throw httpError(404, 'Shop not found');
    if (!t.closure?.on) throw httpError(409, 'This shop is not closed');
    await reopenNow(t, 'by hand', admin.email || 'superadmin');
    return { ok: true };
}

async function sweep() {
    // "let the orders finish" closings whose last order is done
    const closing = await Tenant.find({ 'closure.on': true, 'closure.closing': true }).select('_id slug').lean();
    for (const t of closing) {
        if (await activeOrders(t._id)) continue;
        await Tenant.updateOne({ _id: t._id, 'closure.on': true, 'closure.closing': true }, { $set: { status: 'suspended', 'closure.closing': false } });
        invalidate(t.slug);
    }
}

module.exports = { preview, close, reopen, sweep, KINDS };
