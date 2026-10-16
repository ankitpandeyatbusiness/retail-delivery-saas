// Terms, agreements and the privacy policy, for the people of a shop (owner, rider, customer). Mounted at /api/legal.
//   GET  /api/legal/public/:key        no login: customer_terms or privacy (JSON). The same pages as HTML: /legal/terms, /legal/privacy
//   GET  /api/legal/info               no login: { poweredBy, contactPhone } for the "Powered by" line of the customer app (from the active company)
//   GET  /api/legal/status             call when the app opens. { required, key, version, title, body } - show the agree screen when required
//   POST /api/legal/accept             { key, version }
//   GET  /api/legal/mine               the documents you may read, and the version you agreed to
//   GET  /api/legal/doc/:key           read one (the current version): your own, the terms and the privacy policy
const express = require('express');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const apiErrors = require('../middlewares/apiErrors');
const legal = require('../services/legal');
const User = require('../models/User');
const PlatformSettings = require('../models/PlatformSettings');

const { wrap, httpError } = apiErrors;
const router = express.Router();

router.get('/public/:key', wrap(async (req, res) => {
    if (!legal.PUBLIC_KEYS.includes(req.params.key)) throw httpError(404, 'Not found');
    res.json(await legal.readCurrent(req.params.key));
}));

let infoCache = { at: 0, value: null };
router.get('/info', wrap(async (req, res) => {
    if (Date.now() - infoCache.at > 60000) {
        const b = (await PlatformSettings.findById('main').select('business').lean())?.business || {};
        infoCache = { at: Date.now(), value: { poweredBy: b.poweredBy || null, contactPhone: b.contactPhone || null } };
    }
    res.set('Cache-Control', 'public, max-age=60');
    res.json(infoCache.value);
}));

router.use(tenantRecognizer);
router.use(authenticate);

const me = async (req) => {
    const u = await User.findOne({ _id: req.auth.userId, tenantId: req.tenant._id }).select('role name phone isBlocked').lean();
    if (!u || u.isBlocked) throw httpError(403, 'Account not available');
    return u;
};

router.get('/status', wrap(async (req, res) => {
    const u = await me(req);
    res.json(await legal.status({ who: 'user', userId: u._id, role: u.role, tenant: req.tenant }));
}));

router.post('/accept', wrap(async (req, res) => {
    const u = await me(req);
    const { key, version } = req.body || {};
    res.json(await legal.accept({ who: 'user', userId: u._id, role: u.role, tenant: req.tenant, key, version, name: u.name, phone: u.phone }));
}));

router.get('/mine', wrap(async (req, res) => {
    const u = await me(req);
    res.json({ items: await legal.mine({ who: 'user', userId: u._id, role: u.role }) });
}));

router.get('/doc/:key', wrap(async (req, res) => {
    const u = await me(req);
    const own = legal.gateKeyFor({ who: 'user', role: u.role });
    if (!legal.PUBLIC_KEYS.includes(req.params.key) && req.params.key !== own) throw httpError(404, 'Not found');
    const d = await legal.readCurrent(req.params.key);
    if (!d) throw httpError(404, 'This document has not been published yet');
    res.json(d);
}));

router.use(apiErrors);
module.exports = router;
