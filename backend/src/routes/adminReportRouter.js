// Superadmin: how the progress report is presented to shop owners.
//   GET /api/admin/platform/insights   -> { showMarketplaceCompare, marketplaceCommissionPct, monthlyReportEmail, autopilotEnabled }
//   PUT /api/admin/platform/insights   any of those
// (A shop's own report: GET /api/admin/tenants/:tid/shop/business-report?range=30, the same route the owner uses.)
const express = require('express');
const mongoose = require('mongoose');
const PlatformSettings = require('../models/PlatformSettings');
const apiErrors = require('../middlewares/apiErrors');

const { wrap, httpError } = apiErrors;
const router = express.Router();
const DEFAULTS = { showMarketplaceCompare: true, marketplaceCommissionPct: 25, monthlyReportEmail: true, autopilotEnabled: true };

router.get('/platform/insights', wrap(async (req, res) => {
    const p = await PlatformSettings.findById('main').select('insights').lean();
    res.json({ ...DEFAULTS, ...(p?.insights || {}) });
}));

router.put('/platform/insights', wrap(async (req, res) => {
    const b = req.body || {};
    const set = {};
    if (b.showMarketplaceCompare !== undefined) {
        if (typeof b.showMarketplaceCompare !== 'boolean') throw httpError(400, 'showMarketplaceCompare must be true or false');
        set['insights.showMarketplaceCompare'] = b.showMarketplaceCompare;
    }
    if (b.monthlyReportEmail !== undefined) {
        if (typeof b.monthlyReportEmail !== 'boolean') throw httpError(400, 'monthlyReportEmail must be true or false');
        set['insights.monthlyReportEmail'] = b.monthlyReportEmail;
    }
    if (b.autopilotEnabled !== undefined) {
        if (typeof b.autopilotEnabled !== 'boolean') throw httpError(400, 'autopilotEnabled must be true or false');
        set['insights.autopilotEnabled'] = b.autopilotEnabled;
    }
    if (b.marketplaceCommissionPct !== undefined) {
        if (typeof b.marketplaceCommissionPct !== 'number' || !(b.marketplaceCommissionPct >= 0 && b.marketplaceCommissionPct <= 60)) throw httpError(400, 'The commission is a number from 0 to 60');
        set['insights.marketplaceCommissionPct'] = b.marketplaceCommissionPct;
    }
    if (b.reset === true) {
        Object.entries(DEFAULTS).forEach(([k, v]) => { set[`insights.${k}`] = v; });   // back to the recommended settings
    } else if (!Object.keys(set).length) throw httpError(400, 'Nothing to change');
    await PlatformSettings.findByIdAndUpdate('main', { $set: set }, { upsert: true, setDefaultsOnInsert: true });
    const p = await PlatformSettings.findById('main').select('insights').lean();
    res.json({ ...DEFAULTS, ...(p?.insights || {}) });
}));

// How the shops are growing: every shop with its sales against the period before, the leaders and the slowing ones.
//   GET /api/admin/platform/shops-growth?days=30
router.get('/platform/shops-growth', wrap(async (req, res) => {
    res.json(await require('../services/shopsGrowth').build({ days: parseInt(req.query.days, 10) || 30 }));
}));

// Autopilot for one shop: GET shows it, PUT { paused: true } stops it for that shop (the owner cannot undo it)
router.get('/tenants/:tid/autopilot', wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.tid)) throw httpError(404, 'Shop not found');
    const autopilot = require('../services/autopilot');
    res.json({ ...(await autopilot.getConfig(req.params.tid)), stats: await autopilot.stats({ tenantId: req.params.tid, days: 30 }) });
}));
router.put('/tenants/:tid/autopilot', wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.tid)) throw httpError(404, 'Shop not found');
    if (typeof req.body?.paused !== 'boolean') throw httpError(400, 'paused must be true or false');
    await require('../models/Autopilot').findOneAndUpdate({ tenantId: req.params.tid }, { $set: { platformPaused: req.body.paused }, $setOnInsert: { tenantId: req.params.tid } }, { upsert: true });
    res.json({ ok: true, paused: req.body.paused });
}));

router.use(apiErrors);
module.exports = router;
