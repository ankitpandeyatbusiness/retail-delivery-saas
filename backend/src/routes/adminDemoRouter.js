// Supreme admin: the private demo login. Mounted inside adminRouter (after requireSuperAdmin).
//   GET    /api/admin/demo          { enabled, phone, hasOtp, setAt, lastLoginAt, logins }  (any superadmin may look; the OTP is never shown)
//   PUT    /api/admin/demo          { phone, otp, enabled? }  set or change the number and OTP  (supreme only)
//   PUT    /api/admin/demo/enabled  { enabled }               switch it on or off, keeping the number  (supreme only)
//   DELETE /api/admin/demo          remove it completely  (supreme only)
const express = require('express');
const demo = require('../services/demoMode');
const { requireSupreme } = require('../middlewares/supremeAdmin');
const { wrap, httpError } = require('../middlewares/apiErrors');

const router = express.Router();

router.get('/demo', wrap(async (req, res) => res.json(await demo.status())));

router.put('/demo', requireSupreme, wrap(async (req, res) => {
    try {
        res.json(await demo.set({ phone: req.body?.phone, otp: req.body?.otp, enabled: req.body?.enabled !== false }));
    } catch (e) { throw e.status ? httpError(e.status, e.message) : e; }
}));

router.put('/demo/enabled', requireSupreme, wrap(async (req, res) => {
    const cur = await demo.status();
    if (req.body?.enabled && !cur.hasOtp) throw httpError(400, 'Set the demo number and OTP first');
    res.json(await demo.setEnabled(!!req.body?.enabled));
}));

router.delete('/demo', requireSupreme, wrap(async (req, res) => res.json(await demo.clear())));

module.exports = router;
