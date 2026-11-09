// Superadmin: plans (Partner / Growth / Pro). Mounted inside adminRouter. Reads are open to every superadmin; every change is supreme-only
// (middlewares/supremeAdmin.js MONEY list + requireSupreme here as a second lock).
//
//   GET /api/admin/plans                     catalog (features, limits) + platform defaults
//   PUT /api/admin/platform/plans            defaults: growth/pro pricePaise, feeSlabs, freeDays, graceDays, gstPercent, includedBranches, branchAddonPaise, monthDiscounts
//   GET /api/admin/tenants/:tid/plan         one shop's plan view
//   PUT /api/admin/tenants/:tid/plan         { to, freeDays?, keepExtras? }  switch the plan (instant)
//   PUT /api/admin/tenants/:tid/plan/extras  { key, on }                      switch one feature outside the plan on/off
//   PUT /api/admin/tenants/:tid/plan/terms   { pricePaise?, freeDays?, feeSlabs?, webEnabled?, nativeEnabled? }  null clears an override
const express = require('express');
const plans = require('../config/plans');
const svc = require('../services/planService');
const loadTenant = require('../middlewares/loadTenant');
const { requireSupreme } = require('../middlewares/supremeAdmin');
const { wrap } = require('../middlewares/apiErrors');

const router = express.Router();

router.get('/plans', wrap(async (req, res) => {
    res.json({ ids: plans.PLAN_IDS, features: plans.FEATURES, limits: plans.LIMITS, defaults: await svc.getDefaults() });
}));

router.put('/platform/plans', requireSupreme, wrap(async (req, res) => {
    req.auditBefore = await svc.getDefaults();
    res.json(await svc.saveDefaults(req.body));
}));

router.get('/tenants/:tid/plan', loadTenant, wrap(async (req, res) => {
    res.json(svc.viewOf(req.tenantDoc));
}));

router.put('/tenants/:tid/plan', requireSupreme, loadTenant, wrap(async (req, res) => {
    req.auditBefore = svc.viewOf(req.tenantDoc);
    const who = req.admin?.phone || req.admin?.email || 'supreme';
    res.json(await svc.setPlan(req.tenantDoc, { to: req.body?.to, freeDays: req.body?.freeDays, keepExtras: req.body?.keepExtras !== false, by: String(who) }));
}));

router.put('/tenants/:tid/plan/extras', requireSupreme, loadTenant, wrap(async (req, res) => {
    req.auditBefore = svc.viewOf(req.tenantDoc);
    const who = req.admin?.phone || req.admin?.email || 'supreme';
    res.json(await svc.setExtra(req.tenantDoc, req.body?.key, req.body?.on === true, String(who)));
}));

router.put('/tenants/:tid/plan/terms', requireSupreme, loadTenant, wrap(async (req, res) => {
    req.auditBefore = svc.viewOf(req.tenantDoc);
    res.json(await svc.setShopTerms(req.tenantDoc, req.body || {}));
}));

module.exports = router;
