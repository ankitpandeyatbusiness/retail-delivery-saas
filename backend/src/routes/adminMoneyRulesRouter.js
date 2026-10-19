// Superadmin: who bears the cost when an order paid online is cancelled or not collected. Mounted under /api/admin.
//   GET /platform/money-rules       { rules, recommended }
//   PUT /platform/money-rules       { graceMinutes, accepted, preparing, ready, out_for_delivery, noShow }   or   { reset: true }  (the recommended rules)
// A shop may only be kinder than these (see services/moneyRules.js), so these are the most any shop can keep.
const express = require('express');
const moneyRules = require('../services/moneyRules');
const { wrap, httpError } = require('../middlewares/apiErrors');

const router = express.Router();

router.get('/platform/money-rules', wrap(async (req, res) => {
    res.json({ rules: await moneyRules.loadPlatform(true), recommended: moneyRules.RECOMMENDED });
}));

router.put('/platform/money-rules', wrap(async (req, res) => {
    let value;
    try { value = req.body?.reset === true ? { ...moneyRules.RECOMMENDED } : moneyRules.clean({ ...(await moneyRules.loadPlatform()), ...(req.body || {}) }); } catch (e) { throw httpError(e.status || 400, e.message); }
    res.json({ rules: await moneyRules.savePlatform(value), recommended: moneyRules.RECOMMENDED });
}));

module.exports = router;
