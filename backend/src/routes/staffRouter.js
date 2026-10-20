// What a kitchen or waiter person calls with their own login: /api/staff/...
// The panels (kitchen queue, waiter tables) are added to `core` in the next phases; every route here is already limited to
// an active staff member of THIS shop whose panel the super admin has switched on.
const express = require('express');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const apiErrors = require('../middlewares/apiErrors');
const auditTrail = require('../middlewares/auditTrail');
const staff = require('../services/staffService');
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

const router = express.Router();
router.use(tenantRecognizer);
router.use(authenticate);
router.use(requireStaff);
router.use(auditTrail('staff'));
router.use(core);
router.use(apiErrors);

module.exports = router;
module.exports.core = core;
