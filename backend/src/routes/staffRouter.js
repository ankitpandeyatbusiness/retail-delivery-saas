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
const Staff = require('../models/Staff');

const { wrap, httpError } = apiErrors;

async function requireStaff(req, res, next) {
    try {
        const a = await staff.accessOf({ tenant: req.tenant, userId: req.auth.userId });
        if (!a.ok) return res.status(403).json({ error: a.message, code: a.code });
        req.staff = { id: a.user._id, role: a.role, name: a.row.name || a.user.name || '' };
        req.shopUser = { phone: a.user.phone };   // the label in the activity log
        return next();
    } catch (e) { return next(e); }
}

const core = express.Router();

// who am I, which shop, which panel
core.get('/me', wrap(async (req, res) => {
    const t = req.tenant;
    Staff.updateOne({ tenantId: t._id, userId: req.staff.id }, { $set: { lastSeenAt: new Date() } }).catch(() => { });
    res.json({
        userId: String(req.staff.id), role: req.staff.role, job: staff.JOB[req.staff.role], name: req.staff.name,
        phone: req.shopUser.phone, shop: t.name || '', shopPhone: t.phone || null,
    });
}));

core.patch('/me', wrap(async (req, res) => {
    const name = String(req.body?.name ?? '').trim().slice(0, 80);
    if (!name) throw httpError(400, 'Write your name');
    await Staff.updateOne({ tenantId: req.tenant._id, userId: req.staff.id }, { $set: { name } });
    res.json({ ok: true, name });
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
// { kind: 'out_of_stock' | 'cannot_make' | 'other', note?, productId? }  tells the owner; out_of_stock with a dish also switches that dish off
core.post('/kitchen/orders/:id/problem', onlyKitchen, wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Order not found');
    res.json(await kitchen.problem({ tenant: req.tenant, orderId: req.params.id, staff: who(req), kind: req.body?.kind, note: req.body?.note, productId: req.body?.productId }));
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
