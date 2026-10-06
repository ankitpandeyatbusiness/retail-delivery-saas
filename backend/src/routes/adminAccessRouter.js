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
const { parseMaintenanceBody } = require('../utils/maintenance');

const router = express.Router();

router.put('/tenants/:tid/owner-access', loadTenant, wrap(async (req, res) => {
    if (typeof req.body?.blocked !== 'boolean') throw httpError(400, 'Send blocked: true or false');
    const blocked = req.body.blocked;
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 200) : '';

    await Tenant.updateOne(
        { _id: req.tenantDoc._id },
        { $set: { ownerBlocked: blocked, ownerBlockedReason: blocked ? reason : '' } },
    );
    invalidateTenant(req.tenantDoc.slug);   // takes effect at once on this server
    res.json({ ok: true, ownerBlocked: blocked });
}));

router.put('/tenants/:tid/maintenance', loadTenant, wrap(async (req, res) => {
    const m = parseMaintenanceBody(req.body);
    await Tenant.updateOne(
        { _id: req.tenantDoc._id },
        { $set: { 'maintenance.on': m.on, 'maintenance.message': m.message, 'maintenance.until': m.until } },
    );
    invalidateTenant(req.tenantDoc.slug);
    res.json({ ok: true, maintenance: m });
}));

module.exports = router;