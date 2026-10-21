// What a kitchen or waiter person calls with their own login: /api/staff/...
// The panels (kitchen queue, waiter tables) are added to `core` in the next phases; every route here is already limited to
// an active staff member of THIS shop whose panel the super admin has switched on.
const express = require('express');
const mongoose = require('mongoose');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const apiErrors = require('../middlewares/apiErrors');
const auditTrail = require('../middlewares/auditTrail');
const staff = require('../services/staffService');
const kitchen = require('../services/kitchenService');
const waiter = require('../services/waiterService');
const Staff = require('../models/Staff');

const { wrap, httpError } = apiErrors;

async function requireStaff(req, res, next) {
    try {
        const a = await staff.accessOf({ tenant: req.tenant, userId: req.auth.userId });
        if (!a.ok) return res.status(403).json({ error: a.message, code: a.code });
        req.staff = { id: a.user._id, role: a.role, name: a.row.name || a.user.name || '' };
        req.shopUser = { phone: a.user.phone, label: `${req.staff.name || a.user.phone} (${staff.JOB[a.role].toLowerCase()})` };   // the label in the activity log: "Ramesh (kitchen)"
        return next();
    } catch (e) { return next(e); }
}

const core = express.Router();

// who am I, which shop, which panel
core.get('/me', wrap(async (req, res) => {
    const t = req.tenant;
    const row = await Staff.findOneAndUpdate({ tenantId: t._id, userId: req.staff.id }, { $set: { lastSeenAt: new Date() } }, { projection: 'prefs duty holidays' }).lean().catch(() => null);
    const duty = require('../services/staffDuty');
    const { closed, winding } = await duty.closedFor(t, req.staff.role);
    res.json({
        prefs: { tellDone: row?.prefs?.tellDone !== false }, onDuty: duty.isOnDuty(row || {}, new Date(), closed), dutyStatus: duty.statusOf(row || {}, new Date(), closed), winding,
        userId: String(req.staff.id), role: req.staff.role, job: staff.JOB[req.staff.role], name: req.staff.name,
        phone: req.shopUser.phone, shop: t.name || '', shopPhone: t.phone || null,
    });
}));

// { name? , tellDone? }  the person's own details and choices
core.patch('/me', wrap(async (req, res) => {
    const set = {};
    if (req.body?.name !== undefined) {
        const name = String(req.body.name ?? '').trim().slice(0, 80);
        if (!name) throw httpError(400, 'Write your name');
        set.name = name;
    }
    if (req.body?.tellDone !== undefined) {
        if (typeof req.body.tellDone !== 'boolean') throw httpError(400, 'tellDone must be true or false');
        set['prefs.tellDone'] = req.body.tellDone;
    }
    if (!Object.keys(set).length) throw httpError(400, 'Nothing to change');
    await Staff.updateOne({ tenantId: req.tenant._id, userId: req.staff.id }, { $set: set });
    res.json({ ok: true, ...(set.name ? { name: set.name } : {}), ...(set['prefs.tellDone'] !== undefined ? { tellDone: set['prefs.tellDone'] } : {}) });
}));

// working time: Go live / Go off, weekly hours, days off. { online?, mode?, weekly? }
const dutyRow = (req) => Staff.findOne({ tenantId: req.tenant._id, userId: req.staff.id }).select('duty holidays name role').lean();
const dutyView = async (req) => {
    const d = require('../services/staffDuty');
    const { closed, winding } = await d.closedFor(req.tenant, req.staff.role);
    return { ...d.viewOf(await dutyRow(req), new Date(), closed, winding), leaves: await require('../services/staffLeave').mine(req.tenant._id, req.staff.id) };
};
core.get('/duty', wrap(async (req, res) => { res.json(await dutyView(req)); }));
core.put('/duty', wrap(async (req, res) => {
    const duty = require('../services/staffDuty');
    const c = duty.cleanDuty(req.body);
    if (!Object.keys(c).length) throw httpError(400, 'Nothing to change');
    if (c.online === true && (await duty.closedFor(req.tenant, req.staff.role)).closed) throw httpError(409, 'The shop is closed right now, so you cannot go live. You can when it opens.');
    const set = {};
    for (const [k, v] of Object.entries(c)) {
        if (k === 'weekly') for (const [d, day] of Object.entries(v)) set[`duty.weekly.${d}`] = day;
        else set[`duty.${k}`] = v;
    }
    await Staff.updateOne({ tenantId: req.tenant._id, userId: req.staff.id }, { $set: set });
    res.json(await dutyView(req));
}));
// { from, to, note? }  days off (a holiday or leave). No approval: the owner is told.
core.post('/duty/holidays', wrap(async (req, res) => {
    const duty = require('../services/staffDuty');
    const h = duty.cleanHoliday(req.body);
    const row = await dutyRow(req);
    if ((row?.holidays || []).length >= duty.MAX_HOLIDAYS) throw httpError(409, 'Remove an old holiday first');
    await Staff.updateOne({ tenantId: req.tenant._id, userId: req.staff.id }, { $push: { holidays: h } });
    require('../notifications/center').notify('staff_holiday', { tenantId: req.tenant._id, vars: { name: req.staff.name || req.shopUser.phone, job: staff.JOB[req.staff.role], ...h }, data: { kind: 'staff_holiday', userId: String(req.staff.id) } });
    res.json(await dutyView(req));
}));
// leave the owner approves: { from, to, reason }
core.post('/duty/leave', wrap(async (req, res) => {
    await require('../services/staffLeave').request({ tenantId: req.tenant._id, staff: { id: req.staff.id, name: req.staff.name || req.shopUser.phone, role: req.staff.role }, from: req.body?.from, to: req.body?.to, reason: req.body?.reason });
    res.status(201).json(await dutyView(req));
}));
core.post('/duty/leave/:id/cancel', wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, 'Not found');
    await require('../services/staffLeave').cancel({ tenantId: req.tenant._id, userId: req.staff.id, id: req.params.id });
    res.json(await dutyView(req));
}));
core.delete('/duty/holidays/:id', wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, 'Not found');
    await Staff.updateOne({ tenantId: req.tenant._id, userId: req.staff.id }, { $pull: { holidays: { _id: req.params.id, leaveId: { $exists: false } } } });
    res.json(await dutyView(req));
}));

// the kitchen: the cook's queue and the three things a cook can do
const onlyKitchen = (req, res, next) => (req.staff.role === 'kitchen' ? next() : res.status(403).json({ error: 'This is for the kitchen', code: 'not_staff' }));
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const who = (req) => ({ id: req.staff.id, name: req.staff.name || req.shopUser.phone, phone: req.shopUser.phone });
core.get('/kitchen/orders', onlyKitchen, wrap(async (req, res) => { res.json(await kitchen.queue(req.tenant)); }));
core.post('/kitchen/orders/:id/start', onlyKitchen, wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Order not found');
    res.json(await kitchen.start({ tenant: req.tenant, orderId: req.params.id, staff: who(req) }));
}));
core.post('/kitchen/orders/:id/ready', onlyKitchen, wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Order not found');
    res.json(await kitchen.ready({ tenant: req.tenant, orderId: req.params.id, staff: who(req) }));
}));
// undo a mistaken Start cooking or Ready (within 5 minutes)
core.post('/kitchen/orders/:id/undo', onlyKitchen, wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Order not found');
    const order = await require('../models/Order').findOne({ _id: req.params.id, tenantId: req.tenant._id });
    const r = await require('../services/orderUndo').undo({ order, actor: { type: 'staff', role: 'kitchen', id: req.staff.id, label: req.staff.name || req.shopUser.phone } });
    res.json({ ok: true, undone: r.undone });
}));
// { kind: 'out_of_stock' | 'cannot_make' | 'other', note?, productId? }  tells the owner; out_of_stock with a dish also switches that dish off
core.post('/kitchen/orders/:id/problem', onlyKitchen, wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Order not found');
    res.json(await kitchen.problem({ tenant: req.tenant, orderId: req.params.id, staff: who(req), kind: req.body?.kind, note: req.body?.note, productId: req.body?.productId }));
}));

// the waiter: dishes to serve, what the tables ask for, the tables and their bills
const onlyWaiter = (req, res, next) => (req.staff.role === 'waiter' ? next() : res.status(403).json({ error: 'This is for the waiters', code: 'not_staff' }));
core.get('/waiter/overview', onlyWaiter, wrap(async (req, res) => { res.json(await waiter.overview(req.tenant)); }));
core.post('/waiter/orders/:id/serve', onlyWaiter, wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Order not found');
    res.json(await waiter.serve({ tenant: req.tenant, orderId: req.params.id, staff: who(req) }));
}));
// undo a mistaken Served (within 5 minutes)
core.post('/waiter/orders/:id/undo', onlyWaiter, wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Order not found');
    const order = await require('../models/Order').findOne({ _id: req.params.id, tenantId: req.tenant._id });
    const r = await require('../services/orderUndo').undo({ order, actor: { type: 'staff', role: 'waiter', id: req.staff.id, label: req.staff.name || req.shopUser.phone } });
    res.json({ ok: true, undone: r.undone });
}));
core.post('/waiter/requests/:id/done', onlyWaiter, wrap(async (req, res) => {
    if (typeof req.params.id !== 'string' || !isId(req.params.id)) throw httpError(404, 'Not found');
    res.json(await waiter.doneRequest({ tenant: req.tenant, id: req.params.id, staff: who(req) }));
}));
core.get('/waiter/tables/:sessionId', onlyWaiter, wrap(async (req, res) => {
    if (!isId(req.params.sessionId)) throw httpError(404, 'Bill not found');
    res.json(await waiter.bill({ tenant: req.tenant, sessionId: req.params.sessionId }));
}));
// the QR a guest scans to pay this bill at the table
core.get('/waiter/tables/:sessionId/pay-qr', onlyWaiter, wrap(async (req, res) => {
    if (!isId(req.params.sessionId)) throw httpError(404, 'Bill not found');
    res.json(await waiter.payQr({ tenant: req.tenant, sessionId: req.params.sessionId }));
}));
// { method: 'cash' | 'upi' }  the waiter took the money (only when the shop allows it)
core.post('/waiter/tables/:sessionId/settle', onlyWaiter, wrap(async (req, res) => {
    if (!isId(req.params.sessionId)) throw httpError(404, 'Bill not found');
    res.json(await waiter.settle({ tenant: req.tenant, sessionId: req.params.sessionId, method: req.body?.method, staff: who(req) }));
}));

const router = express.Router();
router.use(tenantRecognizer);
router.use(authenticate);
router.use(requireStaff);
router.use(auditTrail('staff'));
router.use(core);
router.use(apiErrors);

module.exports = router;
module.exports.core = core;
