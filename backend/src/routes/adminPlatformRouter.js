// Superadmin: platform-wide settings. Mounted inside adminRouter (after requireSuperAdmin):
//
//   GET /api/admin/platform
//   PUT /api/admin/platform/maintenance   body { "on": true, "message": "...", "until": "optional future time" }
//       Switches EVERY shop's app to maintenance. /api/admin and /health keep working.
//   PUT /api/admin/platform/business      your details printed on rent invoices:
//       legalName, address, gstin, email, phone, sacCode, paymentInstructions
//   PUT /api/admin/platform/billing       body { "dueDays": 7 }

const express = require('express');
const PlatformSettings = require('../models/PlatformSettings');
const platformGate = require('../middlewares/platformGate');
const { wrap, httpError } = require('../middlewares/apiErrors');
const { parseMaintenanceBody } = require('../utils/maintenance');

const router = express.Router();

const BUSINESS_FIELDS = ['legalName', 'address', 'gstin', 'email', 'phone', 'sacCode', 'paymentInstructions'];
const EMPTY = { _id: 'main', maintenance: { on: false }, business: {}, billing: { dueDays: 7 } };

const loadDoc = async () => (await PlatformSettings.findById('main')) || new PlatformSettings({ _id: 'main' });

router.get('/platform', wrap(async (req, res) => {
    res.json((await PlatformSettings.findById('main').lean()) || EMPTY);
}));

router.put('/platform/maintenance', wrap(async (req, res) => {
    const m = parseMaintenanceBody(req.body);
    const doc = await PlatformSettings.findByIdAndUpdate(
        'main',
        { $set: { 'maintenance.on': m.on, 'maintenance.message': m.message, 'maintenance.until': m.until } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    platformGate.invalidate();   // the gate re-reads the switch right away
    res.json({ ok: true, maintenance: doc.maintenance });
}));

router.put('/platform/business', wrap(async (req, res) => {
    const changes = {};
    for (const f of BUSINESS_FIELDS) {
        if (typeof req.body?.[f] === 'string') changes[`business.${f}`] = req.body[f];
    }
    if (!Object.keys(changes).length) throw httpError(400, `Send at least one of: ${BUSINESS_FIELDS.join(', ')}`);

    const doc = await loadDoc();
    doc.set(changes);
    await doc.save();   // runs the GST number check
    res.json(doc.toObject().business);
}));

router.put('/platform/billing', wrap(async (req, res) => {
    const rules = { dueDays: [0, 60], graceDays: [0, 60], freeOrders: [0, 100000], freeMonths: [0, 36] };
    const changes = {};
    for (const [key, [min, max]] of Object.entries(rules)) {
        const v = req.body?.[key];
        if (v === undefined) continue;
        if (!Number.isInteger(v) || v < min || v > max) throw httpError(400, `${key} must be a whole number from ${min} to ${max}`);
        changes[`billing.${key}`] = v;
    }
    if (!Object.keys(changes).length) throw httpError(400, `Send at least one of: ${Object.keys(rules).join(', ')}`);

    const doc = await loadDoc();
    doc.set(changes);
    await doc.save();
    res.json(doc.toObject().billing);
}));

module.exports = router;