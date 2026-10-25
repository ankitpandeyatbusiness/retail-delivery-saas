// /api/me/alerts: which alerts this person wants as a notification, a popup and a sound (notifications/alertGroups.js).
//   GET  /            { role, groups: [{ id, label, hint, can, critical, types, kinds, sample, defaults, pref: { n, p, s } }] }
//   PUT  /            { prefs: { <groupId>: { n?, p?, s? } } }   what to change; or { reset: true } for the recommended settings
const express = require('express');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const apiErrors = require('../middlewares/apiErrors');
const User = require('../models/User');
const groups = require('../notifications/alertGroups');

const { wrap, httpError } = apiErrors;
const router = express.Router();
router.use((req, res, next) => { req.allowFrozenShop = true; next(); });
router.use(tenantRecognizer);
router.use(authenticate);

router.get('/', wrap(async (req, res) => {
    const u = await User.findOne({ _id: req.auth.userId, tenantId: req.tenant._id }).select('role alertPrefs').lean();
    if (!u) throw httpError(404, 'Not found');
    res.json({ role: u.role, groups: groups.view(u.role, u.alertPrefs, { offerSeconds: req.tenant?.settings?.riders?.offerSeconds }) });
}));

router.put('/', wrap(async (req, res) => {
    const u = await User.findOne({ _id: req.auth.userId, tenantId: req.tenant._id }).select('role alertPrefs');
    if (!u) throw httpError(404, 'Not found');
    const b = req.body || {};
    let next;
    if (b.reset === true) next = {};
    else {
        if (!b.prefs || typeof b.prefs !== 'object') throw httpError(400, 'Send prefs, or reset: true');
        // today's choices with the changes on top, then only the ones that differ from the recommended settings are kept
        const now = {};
        for (const grp of groups.groupsFor(u.role)) now[grp.id] = { ...groups.prefOf(u.alertPrefs, grp), ...(b.prefs[grp.id] || {}) };
        next = groups.cleanPrefs(u.role, now);
    }
    u.alertPrefs = next;
    u.markModified('alertPrefs');
    await u.save();
    res.json({ role: u.role, groups: groups.view(u.role, u.alertPrefs, { offerSeconds: req.tenant?.settings?.riders?.offerSeconds }) });
}));

router.use(apiErrors);
module.exports = router;
