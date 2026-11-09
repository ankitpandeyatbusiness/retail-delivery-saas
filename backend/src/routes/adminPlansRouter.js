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

// the live preview: how a shop looks on a plan. With a shop, its own price, free days and extras are used. Reads only.
router.get('/plans/preview', wrap(async (req, res) => { res.json(await svc.previewOf(null, req.query.plan, { freeDays: req.query.freeDays !== undefined ? Number(req.query.freeDays) : undefined })); }));
router.get('/tenants/:tid/plan/preview', loadTenant, wrap(async (req, res) => { res.json({ current: svc.viewOf(req.tenantDoc), preview: await svc.previewOf(req.tenantDoc, req.query.plan, { freeDays: req.query.freeDays !== undefined && req.query.freeDays !== '' ? Number(req.query.freeDays) : undefined }) }); }));

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

// the Partner wallet of one shop: balance, ledger, and the nightly check (balance must equal the ledger)
router.get('/tenants/:tid/wallet', loadTenant, wrap(async (req, res) => {
    const w = require('../services/partnerWalletService');
    if (!w.isPartner(req.tenantDoc)) return res.json({ partner: false });
    const [status, history, check] = await Promise.all([w.status(req.tenantDoc._id), w.history(req.tenantDoc._id, { limit: 30 }), w.reconcile(req.tenantDoc._id)]);
    res.json({ partner: true, ...status, ...history, check });
}));

// { direction: 'add' | 'take', amountPaise, note }  a manual correction by the supreme admin; always in the ledger and the audit log
router.post('/tenants/:tid/wallet/adjust', requireSupreme, loadTenant, wrap(async (req, res) => {
    const w = require('../services/partnerWalletService');
    const { direction, amountPaise, note } = req.body || {};
    if (!w.isPartner(req.tenantDoc)) throw Object.assign(new Error('This shop is not on the Partner plan'), { status: 400 });
    if (typeof note !== 'string' || note.trim().length < 3) throw Object.assign(new Error('Write a reason (at least 3 letters)'), { status: 400 });
    if (!['add', 'take'].includes(direction)) throw Object.assign(new Error('direction must be add or take'), { status: 400 });
    req.auditBefore = await w.status(req.tenantDoc._id);
    const actor = { type: 'superadmin', id: String(req.admin?._id || ''), label: String(req.admin?.phone || req.admin?.email || 'supreme') };
    const r = direction === 'add'
        ? await w.credit({ tenantId: req.tenantDoc._id, amountPaise, type: 'adjust', note: note.trim().slice(0, 200), actor })
        : await w.manualDebit({ tenantId: req.tenantDoc._id, amountPaise, note: note.trim().slice(0, 200), actor });
    res.json({ ...r, status: await w.status(req.tenantDoc._id) });
}));

// Phase 9: move the shops that exist today onto Pro, free for 30 days. Supreme only. The preview is a dry run; the run takes a backup first.
//   GET  /plans/migration/preview
//   POST /plans/migration/run      { confirm: "MOVE SHOPS TO PRO" }
//   POST /plans/migration/rollback { confirm: "UNDO THE MOVE" }
const CONFIRM_RUN = 'MOVE SHOPS TO PRO';
const CONFIRM_BACK = 'UNDO THE MOVE';
router.get('/plans/migration/preview', requireSupreme, wrap(async (req, res) => { res.json(await require('../services/planMigration').preview()); }));
router.post('/plans/migration/run', requireSupreme, wrap(async (req, res) => {
    if (req.body?.confirm !== CONFIRM_RUN) throw Object.assign(new Error(`Type exactly: ${CONFIRM_RUN}`), { status: 400 });
    req.auditBefore = { action: 'plan migration' };
    res.json(await require('../services/planMigration').run({ by: String(req.admin?.phone || req.admin?.email || 'supreme') }));
}));
router.post('/plans/migration/rollback', requireSupreme, wrap(async (req, res) => {
    if (req.body?.confirm !== CONFIRM_BACK) throw Object.assign(new Error(`Type exactly: ${CONFIRM_BACK}`), { status: 400 });
    req.auditBefore = { action: 'plan migration rollback' };
    res.json(await require('../services/planMigration').rollback({ by: String(req.admin?.phone || req.admin?.email || 'supreme') }));
}));

module.exports = router;
