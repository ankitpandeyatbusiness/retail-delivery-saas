// Closing a shop (not deleting it): everything stays, the shop just stops. The superadmin closes it with a reason; it can be opened again.
//   close   status becomes "suspended" (every app of the shop shows the closed screen, see tenantRecognizer) and a record is kept on the shop (tenant.closure).
//           Orders in progress: "cancel" them (the normal cancel, with its refunds) or let them "finish" first (the shop stops taking new orders now and closes by itself
//           the moment the last order is done).
//   reopen  by hand (if rent is still owed the superadmin must say "open anyway"), or by itself the moment a shop that was closed FOR RENT has paid everything.
//   sweep   every few minutes: finishes a "finish" closing, reopens settled rent shops, and tells the superadmin about shops whose rent is unpaid for months
//           (closeAfterMonths, 6 unless changed in Billing rules). Nothing is ever closed by the sweep: the superadmin decides.
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const Order = require('../models/Order');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const PlatformSettings = require('../models/PlatformSettings');
const Brand = require('../models/Brand');
const { httpError } = require('../middlewares/apiErrors');
const notice = require('./shopSettingsNotice');

const DAY = 86400000;
const ACTIVE = ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery'];
const KINDS = ['rent', 'manual'];
const ALERT_EVERY_DAYS = 7;   // the "may need closing" alert for one shop is repeated at most this often

const rupees = (n) => Math.round(Number(n || 0) * 100) / 100;
const invalidate = (slug) => { try { require('../middlewares/tenantRecognizer').invalidateTenant(slug); } catch (e) { /* the next request reads it */ } };

async function owedOf(tenantId) {
    const rows = await SubscriptionInvoice.find({ tenantId, status: 'pending' }).select('total dueDate').lean();
    return {
        total: rupees(rows.reduce((a, r) => a + Number(r.total || 0), 0)),
        bills: rows.length,
        oldestDueAt: rows.length ? new Date(Math.min(...rows.map((r) => new Date(r.dueDate || Date.now()).getTime()))) : null,
    };
}
const activeOrders = (tenantId) => Order.countDocuments({ tenantId, status: { $in: ACTIVE } });
const closeAfterMonths = async () => (await PlatformSettings.findById('main').select('billing.closeAfterMonths').lean())?.billing?.closeAfterMonths || 6;

// what the superadmin sees before closing or reopening
async function preview(tenantId) {
    const t = await Tenant.findById(tenantId).select('name status closure').lean();
    if (!t) throw httpError(404, 'Shop not found');
    return {
        name: t.name, closed: !!t.closure?.on, closing: !!t.closure?.closing, closure: t.closure?.on ? { kind: t.closure.kind, reason: t.closure.reason, at: t.closure.at, by: t.closure.by, closing: !!t.closure.closing } : null,
        owed: await owedOf(tenantId), activeOrders: await activeOrders(tenantId),
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

async function close(tenantId, { reason, kind = 'manual', orders = 'finish' } = {}, admin) {
    const why = String(reason || '').trim();
    if (why.length < 3) throw httpError(400, 'Please write the reason for closing');
    if (why.length > 200) throw httpError(400, 'The reason is too long (200 letters at most)');
    if (!KINDS.includes(kind)) throw httpError(400, 'Choose why: rent or another reason');
    if (!['finish', 'cancel'].includes(orders)) throw httpError(400, 'Choose what happens to the orders in progress');
    const t = await Tenant.findById(tenantId).select('name slug status closure settings.orders.acceptingOrders');
    if (!t) throw httpError(404, 'Shop not found');
    if (t.closure?.on) throw httpError(409, 'This shop is already closed');
    const owed = await owedOf(tenantId);
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
        'closure.on': true, 'closure.kind': kind, 'closure.reason': why, 'closure.at': now, 'closure.by': admin.email || 'superadmin',
        'closure.mode': orders, 'closure.closing': closing, 'closure.owedAtClose': owed.total, 'closure.prevAccepting': prevAccepting,
    };
    if (closing) set['settings.orders.acceptingOrders'] = false;
    else set.status = 'suspended';
    await Tenant.updateOne({ _id: t._id }, { $set: set });
    invalidate(t.slug);
    notice.closed(t._id, kind, closing);
    return { ok: true, closing, ...result, owed };
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

// by hand. When rent is still owed the superadmin must confirm (confirmDue: true), so it is a deliberate act.
async function reopen(tenantId, { confirmDue } = {}, admin) {
    const t = await Tenant.findById(tenantId).select('name slug status closure');
    if (!t) throw httpError(404, 'Shop not found');
    if (!t.closure?.on) throw httpError(409, 'This shop is not closed');
    const owed = await owedOf(tenantId);
    if (owed.total > 0 && confirmDue !== true) {
        throw Object.assign(httpError(409, `${t.name} still owes Rs ${owed.total} (${owed.bills} bill${owed.bills === 1 ? '' : 's'}). Open it anyway?`), { needsConfirm: true, owed });
    }
    await reopenNow(t, 'by hand', admin.email || 'superadmin');
    return { ok: true, owed };
}

// the moment a shop closed FOR RENT has nothing left to pay
async function reopenIfSettled(tenantId) {
    const t = await Tenant.findById(tenantId).select('name slug status closure');
    if (!t?.closure?.on || t.closure.kind !== 'rent' || t.closure.closing) return false;
    if ((await owedOf(tenantId)).bills > 0) return false;
    await reopenNow(t, 'rent paid', 'automatic');
    try { await require('./adminAlerts').alert('admin_shop_unpaused', { tenantId: t._id }); } catch (e) { /* the shop is open anyway */ }
    return true;
}

// shops with rent unpaid for closeAfterMonths or more, not closed yet: the list the superadmin decides from. A brand's branches come together.
async function toClose(now = new Date()) {
    const months = await closeAfterMonths();
    const cut = new Date(now.getTime() - months * 30 * DAY);
    const rows = await SubscriptionInvoice.aggregate([
        { $match: { status: 'pending', dueDate: { $lt: cut } } },
        { $group: { _id: '$tenantId', oldest: { $min: '$dueDate' } } },
    ]);
    const ids = rows.map((r) => r._id);
    if (!ids.length) return { months, shops: [], brands: [] };
    const tenants = await Tenant.find({ _id: { $in: ids }, 'closure.on': { $ne: true } }).select('name slug brandId').lean();
    const brands = new Map((await Brand.find({ _id: { $in: tenants.map((t) => t.brandId).filter(Boolean) } }).select('name').lean()).map((b) => [String(b._id), b.name]));
    const oldest = new Map(rows.map((r) => [String(r._id), r.oldest]));
    const shops = [];
    for (const t of tenants) {
        const owed = await owedOf(t._id);
        shops.push({
            tenantId: String(t._id), name: t.name, brandId: t.brandId ? String(t.brandId) : null, brandName: t.brandId ? brands.get(String(t.brandId)) || null : null,
            owed: owed.total, bills: owed.bills, oldestDueAt: oldest.get(String(t._id)), monthsLate: Math.floor((now.getTime() - new Date(oldest.get(String(t._id))).getTime()) / (30 * DAY)),
        });
    }
    shops.sort((a, b) => b.owed - a.owed);
    return { months, shops };
}

async function sweep(now = new Date()) {
    // 1. "let the orders finish" closings whose last order is done
    const closing = await Tenant.find({ 'closure.on': true, 'closure.closing': true }).select('_id slug').lean();
    for (const t of closing) {
        if (await activeOrders(t._id)) continue;
        await Tenant.updateOne({ _id: t._id, 'closure.on': true, 'closure.closing': true }, { $set: { status: 'suspended', 'closure.closing': false } });
        invalidate(t.slug);
    }
    // 2. shops closed for rent that have paid (or had their bills waived or cancelled)
    const rent = await Tenant.find({ 'closure.on': true, 'closure.kind': 'rent', 'closure.closing': { $ne: true } }).select('_id').lean();
    for (const t of rent) await reopenIfSettled(t._id).catch((e) => console.error('Reopen check error:', e.message));
    // 3. tell the superadmin about shops that may need closing (a shop at most once a week)
    const { shops } = await toClose(now);
    for (const s of shops) {
        const claimed = await Tenant.updateOne(
            { _id: s.tenantId, $or: [{ 'closure.dueAlertedAt': { $exists: false } }, { 'closure.dueAlertedAt': { $lt: new Date(now.getTime() - ALERT_EVERY_DAYS * DAY) } }] },
            { $set: { 'closure.dueAlertedAt': now } },
        );
        if (!claimed.modifiedCount) continue;
        await require('./adminAlerts').alert('admin_shop_close_due', { tenantId: s.tenantId, vars: { months: s.monthsLate, amount: String(s.owed) }, data: { kind: 'toClose' } });
    }
}

module.exports = { preview, close, reopen, reopenIfSettled, toClose, sweep, owedOf, KINDS };
