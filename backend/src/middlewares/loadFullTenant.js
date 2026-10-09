const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const { wrap, httpError } = require('./apiErrors');

// For the superadmin's copy of the shop routes: /api/admin/tenants/:tid/shop/...
// Does what tenantRecognizer + the owner login do for owners:
// puts the full shop on req.tenant and the superadmin as the actor.
// Use AFTER requireSuperAdmin. Private fields (ownerBlockedReason) are not loaded.
module.exports = wrap(async (req, res, next) => {
    if (typeof req.params.tid !== 'string' || !mongoose.isValidObjectId(req.params.tid)) {
        throw httpError(404, 'Tenant not found');
    }
    const t = await Tenant.findById(req.params.tid).select('-ownerBlockedReason').lean();
    if (!t) throw httpError(404, 'Tenant not found');
    req.tenant = t;
    req.tenantDoc = t;
    req.actor = { type: 'superadmin', id: req.admin._id, label: req.admin.email };
    next();
});