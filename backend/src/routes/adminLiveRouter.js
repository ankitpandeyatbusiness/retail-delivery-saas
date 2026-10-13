// Superadmin: the live picture of a shop, and "show me this phone number".
// Mounted inside adminRouter (after requireSuperAdmin):
//   GET /api/admin/tenants/:tid/live
//   GET /api/admin/tenants/:tid/users/:userId/phone     writes an audit row PHONE_REVEAL
const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const loadTenant = require('../middlewares/loadTenant');
const auditTrail = require('../middlewares/auditTrail');
const snapshot = require('../services/liveSnapshot');
const { wrap, httpError } = require('../middlewares/apiErrors');

const router = express.Router();

router.get('/tenants/:tid/live', loadTenant, wrap(async (req, res) => {
    res.json(await snapshot.build(req.tenantDoc._id, { owner: false }));
}));

// Lists show masked phones. This is the only way to see a full number, and every look is written to the audit log.
router.get('/tenants/:tid/users/:userId/phone', loadTenant, wrap(async (req, res) => {
    const id = req.params.userId;
    const user = mongoose.isValidObjectId(id) ? await User.findOne({ _id: id, tenantId: req.tenantDoc._id }).select('phone role').lean() : null;
    if (!user) throw httpError(404, 'User not found');
    await auditTrail.record({
        actorType: 'superadmin', actorId: req.admin._id, actorLabel: req.admin.email, tenantId: req.tenantDoc._id,
        action: 'PHONE_REVEAL', method: 'GET', path: req.originalUrl.split('?')[0], status: 200,
        params: { userId: String(user._id), role: user.role }, ip: req.ip,
    });
    res.json({ userId: user._id, phone: user.phone });
}));

module.exports = router;