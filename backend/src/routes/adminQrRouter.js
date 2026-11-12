// Superadmin: QR codes for the public demo and for a shop's tables. Mounted inside adminRouter (after requireSuperAdmin). Read only: any superadmin may download.
//   GET /api/admin/qr/info                          { base, permanent, warning, demo: { link, destination } }
//   GET /api/admin/qr/demo?format=svg|pdf|png&sizePx=&dpi=&sizeMm=
//   GET /api/admin/qr/tables/:tenantId?table=<n>|all&format=&logo=1&sizePx=&dpi=&sizeMm=
//       table=all with format=pdf is the whole sheet (A4, 6 to a page, the number under each code). logo=1 puts the shop's logo in the middle (optional).
const express = require('express');
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const qr = require('../services/qrCodes');
const tableQr = require('../services/tableQr');
const { wrap, httpError } = require('../middlewares/apiErrors');

const router = express.Router();

const send = (res, f) => {
    res.set('Content-Type', f.mime);
    res.set('Content-Disposition', `attachment; filename="${f.name}"`);
    res.set('Cache-Control', 'no-store');
    if (f.link) res.set('X-QR-Link', f.link);
    res.send(f.body);
};

router.get('/qr/info', wrap(async (req, res) => {
    const base = qr.baseOf(req);
    const permanent = qr.isPermanent(base);
    res.json({
        base, permanent,
        warning: permanent ? null : 'This address is a temporary one. Do NOT print banners yet: set QR_BASE_URL on the server to your own domain first, then download the codes again.',
        demo: { link: qr.demoLink(req), destination: qr.demoDestination() },
    });
}));

router.get('/qr/demo', wrap(async (req, res) => { send(res, await qr.demoCode(req, req.query)); }));

router.get('/qr/tables/:tenantId', wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.tenantId)) throw httpError(404, 'Shop not found');
    const t = await Tenant.findById(req.params.tenantId).select('slug name logo settings').lean();
    if (!t) throw httpError(404, 'Shop not found');
    if (!tableQr.tableCount(t) || !(t.settings?.orders?.dineIn?.enabled)) throw httpError(409, 'Dine in is not switched on for this shop');
    send(res, await qr.tableCode(req, t, { table: req.query.table || 'all', logo: req.query.logo === '1' || req.query.logo === 'true', ...req.query }));
}));

module.exports = router;
