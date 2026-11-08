// Terms, privacy policies and About Us, for the apps. Mounted at /api/legal. No login: they are public (the same pages as web pages: /legal/terms ...).
//   GET  /api/legal/public/:key        { key, title, body }: customer_terms, privacy, owner_terms, owner_privacy, rider_terms, rider_privacy, staff_terms, staff_privacy, about_us
//   GET  /api/legal/info               { poweredBy, contactPhone, platformName, operatorName, email, address } for the "Powered by" line and the About Us page of the apps
const express = require('express');
const apiErrors = require('../middlewares/apiErrors');
const legal = require('../services/legal');
const PlatformSettings = require('../models/PlatformSettings');

const { wrap, httpError } = apiErrors;
const router = express.Router();

router.get('/public/:key', wrap(async (req, res) => {
    if (!legal.KEYS.includes(req.params.key)) throw httpError(404, 'Not found');
    res.set('Cache-Control', 'public, max-age=30');   // short: a published change shows within seconds
    res.json(await legal.readCurrent(req.params.key, { shopName: await legal.shopNameFor(req.headers['x-tenant-slug']) }));
}));

let infoCache = { at: 0, value: null };
router.get('/info', wrap(async (req, res) => {
    if (Date.now() - infoCache.at > 60000) {
        const b = (await PlatformSettings.findById('main').select('business').lean())?.business || {};
        infoCache = {
            at: Date.now(),
            value: {
                poweredBy: b.poweredBy || null, contactPhone: b.contactPhone || null,
                platformName: b.appName || 'Vivyaan', operatorName: b.legalName || null, email: b.email || null, address: b.address || null,
            },
        };
    }
    res.set('Cache-Control', 'public, max-age=60');
    res.json(infoCache.value);
}));

module.exports = router;
