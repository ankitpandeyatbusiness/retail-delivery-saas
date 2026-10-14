// Superadmin: the ONE GST that every shop's bills use. Mounted under /api/admin.
//   GET /platform/tax          { gstPercent, gstMode }
//   PUT /platform/tax          { gstPercent: 0..28, gstMode: 'inclusive' | 'exclusive' }
// A shop charges it only when the shop has a GST number (set by the superadmin in Edit shop). Owners cannot change either.
const express = require('express');
const PlatformSettings = require('../models/PlatformSettings');
const platformTax = require('../services/platformTax');
const { wrap, httpError } = require('../middlewares/apiErrors');

const router = express.Router();

const view = (doc) => ({
    gstPercent: Number.isFinite(doc?.tax?.gstPercent) ? doc.tax.gstPercent : 0,
    gstMode: ['inclusive', 'exclusive'].includes(doc?.tax?.gstMode) ? doc.tax.gstMode : 'inclusive',
});

router.get('/platform/tax', wrap(async (req, res) => {
    res.json(view(await PlatformSettings.findById('main').lean()));
}));

router.put('/platform/tax', wrap(async (req, res) => {
    const b = req.body || {};
    const set = {};
    if (b.gstPercent !== undefined) {
        const n = Number(b.gstPercent);
        if (typeof b.gstPercent === 'boolean' || b.gstPercent === '' || !Number.isFinite(n) || n < 0 || n > 28) throw httpError(400, 'GST must be a number from 0 to 28');
        set['tax.gstPercent'] = Math.round(n * 100) / 100;
    }
    if (b.gstMode !== undefined) {
        if (!['inclusive', 'exclusive'].includes(b.gstMode)) throw httpError(400, 'gstMode must be inclusive or exclusive');
        set['tax.gstMode'] = b.gstMode;
    }
    if (!Object.keys(set).length) throw httpError(400, 'Send gstPercent and/or gstMode');
    const doc = await PlatformSettings.findByIdAndUpdate('main', { $set: set }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }).lean();
    await platformTax.load();
    res.json(view(doc));
}));

module.exports = router;
