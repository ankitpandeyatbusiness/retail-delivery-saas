// Superadmin: platform-wide settings. Mounted inside adminRouter (after requireSuperAdmin):
//
//   GET /api/admin/platform
//   PUT /api/admin/platform/maintenance   body { "on": true, "message": "...", "until": "optional future time" }
//       Switches EVERY shop's app to maintenance. /api/admin and /health keep working.
//   PUT /api/admin/platform/business      your details printed on rent invoices:
//       legalName, address, gstin, email, phone, sacCode, paymentInstructions

const express = require('express');
const PlatformSettings = require('../models/PlatformSettings');
const platformGate = require('../middlewares/platformGate');
const { wrap, httpError } = require('../middlewares/apiErrors');
const { parseMaintenanceBody } = require('../utils/maintenance');

const router = express.Router();

const BUSINESS_FIELDS = ['legalName', 'address', 'gstin', 'pan', 'state', 'stateCode', 'invoicePrefix', 'poweredBy', 'contactPhone', 'email', 'phone', 'sacCode', 'paymentInstructions', 'appName', 'brandColor', 'logoUrl'];
const EMPTY = { _id: 'main', maintenance: { on: false }, business: {}, billing: { dueDays: 7 } };

const loadDoc = async () => (await PlatformSettings.findById('main')) || new PlatformSettings({ _id: 'main' });

router.get('/platform', wrap(async (req, res) => {
    res.json((await PlatformSettings.findById('main').lean()) || EMPTY);
}));

router.put('/platform/maintenance', wrap(async (req, res) => {
    const m = parseMaintenanceBody(req.body);
    const doc = await PlatformSettings.findByIdAndUpdate(
        'main',
        { $set: { 'maintenance.on': m.on, 'maintenance.message': m.message, 'maintenance.until': m.until, 'maintenance.since': m.on ? new Date() : null } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    ).lean();
    platformGate.invalidate();   // the gate re-reads the switch right away
    require('../services/maintenanceState').invalidatePlatform();
    require('../services/maintenancePlans').tellEveryShop();
    require('../services/maintenanceShopSwitch').sweep().catch(() => { });   // every shop's open apps show the badge (or lose it) within seconds
    res.json({ ok: true, maintenance: doc.maintenance });
}));

router.put('/platform/business', wrap(async (req, res) => {
    const changes = {};
    for (const f of BUSINESS_FIELDS) {
        if (typeof req.body?.[f] === 'string') changes[`business.${f}`] = req.body[f];
    }
    if (!Object.keys(changes).length) throw httpError(400, `Send at least one of: ${BUSINESS_FIELDS.join(', ')}`);
    // the state decides CGST+SGST or IGST: it must be a real state, and its code follows it unless a code is sent
    if (changes['business.state']) {
        const gstSplit = require('../services/gstSplit');
        const code = gstSplit.codeFromName(changes['business.state']);
        if (!code) throw httpError(400, 'Enter an Indian state name, like Uttar Pradesh');
        changes['business.state'] = gstSplit.nameOf(code);
        if (changes['business.stateCode'] === undefined || changes['business.stateCode'] === '') changes['business.stateCode'] = code;
    }

    const doc = await loadDoc();
    doc.set(changes);
    await doc.save();   // runs the GST number check
    res.json(doc.toObject().business);
}));

// Your alert SMS switch.  PUT /api/admin/platform/alerts  { smsToAdmin, allEvents, phone }
router.put('/platform/alerts', wrap(async (req, res) => {
    const b = req.body || {};
    const set = {};
    const unset = {};
    for (const k of ['smsToAdmin', 'allEvents']) {
        if (b[k] === undefined) continue;
        if (typeof b[k] !== 'boolean') throw httpError(400, `${k} must be true or false`);
        set[`alerts.${k}`] = b[k];
    }
    if (b.phone !== undefined) {
        const phone = typeof b.phone === 'string' ? b.phone.trim() : '';
        if (phone && !/^[6-9]\d{9}$/.test(phone)) throw httpError(400, 'Enter a valid 10-digit mobile number');
        if (phone) set['alerts.phone'] = phone; else unset['alerts.phone'] = 1;
    }
    if (!Object.keys(set).length && !Object.keys(unset).length) throw httpError(400, 'Send smsToAdmin, allEvents or phone');

    const cur = (await PlatformSettings.findById('main').select('alerts').lean())?.alerts || {};
    req.auditBefore = { alerts: { smsToAdmin: cur.smsToAdmin, allEvents: cur.allEvents, phone: cur.phone } };
    const phoneAfter = unset['alerts.phone'] ? undefined : (set['alerts.phone'] ?? cur.phone);
    const smsAfter = set['alerts.smsToAdmin'] ?? cur.smsToAdmin;
    if (smsAfter && !phoneAfter) throw httpError(400, 'Set your phone number first');

    const update = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    const doc = await PlatformSettings.findByIdAndUpdate(
        'main', update, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    ).lean();
    const a = doc.alerts || {};
    res.json({ alerts: { smsToAdmin: !!a.smsToAdmin, allEvents: !!a.allEvents, phone: a.phone || null } });
}));

module.exports = router;