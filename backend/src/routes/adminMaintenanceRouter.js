// Superadmin: planned maintenance. Mounted under /api/admin.
//   GET  /maintenance/plans              planned, running and past plans
//   POST /maintenance/plans              { scope: all|shops|brand, tenantIds?, brandId?, startAt, endAt?, message?, audience?: { owners, staff, riders, customers } }
//   POST /maintenance/plans/:id/cancel   a plan not started yet is cancelled; a running one is ended now
// (Switching maintenance on or off right now stays in PUT /platform/maintenance and PUT /tenants/:tid/maintenance.)
const express = require('express');
const plans = require('../services/maintenancePlans');
const { wrap } = require('../middlewares/apiErrors');

const router = express.Router();
const who = (req) => req.admin?.name || req.admin?.email || '';

router.get('/maintenance/plans', wrap(async (req, res) => { res.json({ items: await plans.list() }); }));
router.post('/maintenance/plans', wrap(async (req, res) => {
    req.auditBefore = null;
    res.status(201).json(plans.view(await plans.create(req.body, who(req))));
}));
router.post('/maintenance/plans/:id/cancel', wrap(async (req, res) => { res.json(plans.view(await plans.cancel(req.params.id, who(req)))); }));

module.exports = router;
