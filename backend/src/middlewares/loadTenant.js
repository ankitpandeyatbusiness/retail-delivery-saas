const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const { wrap, httpError } = require('./apiErrors');

// For superadmin routes with /tenants/:tid in the URL. Puts { _id, slug, maintenance, ownerBlocked, plan } on req.tenantDoc.
module.exports = wrap(async (req, res, next) => {
    if (typeof req.params.tid !== 'string' || !mongoose.isValidObjectId(req.params.tid)) {
        throw httpError(404, 'Tenant not found');
    }
    const t = await Tenant.findById(req.params.tid).select('_id slug maintenance ownerBlocked plan').lean();
    if (!t) throw httpError(404, 'Tenant not found');
    req.tenantDoc = t;
    next();
});