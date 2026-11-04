// Superadmin switches for ONE shop. Mounted inside adminRouter (after requireSuperAdmin):
//
//   PUT /api/admin/tenants/:tid/owner-access   body { "blocked": true, "reason": "Rent unpaid" }
//       Owner is locked out of the shop panel. Customers only see "not accepting orders right now".
//   PUT /api/admin/tenants/:tid/maintenance    body { "on": true, "message": "Back at 6 PM", "until": "2026-10-07T18:00:00+05:30" }
//       This shop's app (customers and owner) gets a maintenance answer. Other shops are not affected.

const express = require('express');
const Tenant = require('../models/Tenant');
const loadTenant = require('../middlewares/loadTenant');
const { invalidateTenant } = require('../middlewares/tenantRecognizer');
const { wrap, httpError } = require('../middlewares/apiErrors');
const { parseMaintenanceBody, isMaintenanceOn } = require('../utils/maintenance');

const router = express.Router();

router.put('/tenants/:tid/owner-access', loadTenant, wrap(async (req, res) => {
    if (typeof req.body?.blocked !== 'boolean') throw httpError(400, 'Send blocked: true or false');
    const blocked = req.body.blocked;
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 200) : '';
    const was = !!req.tenantDoc.ownerBlocked;

    await Tenant.updateOne(
        { _id: req.tenantDoc._id },
        { $set: { ownerBlocked: blocked, ownerBlockedReason: blocked ? reason : '' } },
    );
    invalidateTenant(req.tenantDoc.slug);   // takes effect at once on this server
    if (was !== blocked) require('../services/shopSettingsNotice')[blocked ? 'ownerBlocked' : 'ownerAllowed'](req.tenantDoc._id);   // the owner hears about it
    res.json({ ok: true, ownerBlocked: blocked });
}));

router.put('/tenants/:tid/maintenance', loadTenant, wrap(async (req, res) => {
    const m = parseMaintenanceBody(req.body);
    const wasOn = isMaintenanceOn(req.tenantDoc.maintenance);
    await Tenant.updateOne(
        { _id: req.tenantDoc._id },
        { $set: { 'maintenance.on': m.on, 'maintenance.message': m.message, 'maintenance.until': m.until } },
    );
    invalidateTenant(req.tenantDoc.slug);
    const nowOn = isMaintenanceOn(m);
    if (nowOn && !wasOn) require('../services/shopSettingsNotice').maintenanceOn(req.tenantDoc._id, m);   // the owner hears about it, with your message and end time
    else if (!nowOn && wasOn) require('../services/shopSettingsNotice').maintenanceOff(req.tenantDoc._id);
    res.json({ ok: true, maintenance: m });
}));

// ---- closing a shop (services/shopClosure.js). Supreme admin only.
const { requireSupreme } = require('../middlewares/supremeAdmin');
const closure = require('../services/shopClosure');
router.get('/tenants/:tid/closure', loadTenant, wrap(async (req, res) => { res.json(await closure.preview(req.tenantDoc._id)); }));
router.post('/tenants/:tid/close', requireSupreme, loadTenant, wrap(async (req, res) => {
    req.auditBefore = { closed: false };
    res.json(await closure.close(req.tenantDoc._id, req.body || {}, req.admin));
}));
router.post('/tenants/:tid/reopen', requireSupreme, loadTenant, wrap(async (req, res) => {
    req.auditBefore = { closed: true };
    try { res.json(await closure.reopen(req.tenantDoc._id, req.body || {}, req.admin)); } catch (e) {
        if (e.needsConfirm) return res.status(409).json({ error: e.message, needsConfirm: true, owed: e.owed });
        throw e;
    }
}));

module.exports = router;