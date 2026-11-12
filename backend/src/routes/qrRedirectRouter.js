// The short, permanent addresses that the printed QR codes hold. Mounted at /q. The server decides where each one leads, so a printed
// banner or sticker never goes stale: change the destination here (or in the environment) and every printed code follows.
//   GET /q/demo                -> the public demo website
//   GET /q/t/:slug/:table      -> the landing page of that table (opens the shop's app, or the browser)
const express = require('express');
const Tenant = require('../models/Tenant');
const qr = require('../services/qrCodes');
const tableQr = require('../services/tableQr');
const { wrap } = require('../middlewares/apiErrors');

const router = express.Router();
router.use(require('../middlewares/publicRateLimit').make({ points: 120, duration: 60 }));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });   // never cached: a changed destination works at once

router.get('/demo', (req, res) => res.redirect(302, qr.demoDestination()));

router.get('/t/:slug/:table', wrap(async (req, res) => {
    const slug = String(req.params.slug || '').toLowerCase();
    const table = String(req.params.table || '');
    const t = /^[a-z0-9-]{3,40}$/.test(slug) ? await Tenant.findOne({ slug, status: { $ne: 'suspended' } }).select('_id slug name androidPackage settings').lean() : null;
    const n = Number(table);
    if (!t || !Number.isInteger(n) || n < 1 || n > tableQr.tableCount(t)) return res.status(404).type('text/plain').send('This QR code is not valid.');
    return res.redirect(302, tableQr.tableUrl(req, t, String(n)));
}));

module.exports = router;
