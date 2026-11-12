// The two files a phone downloads to check that our app may open our https links straight (Android App Links, iPhone Universal Links).
// They are served on the QR address (QR_BASE_URL), because the printed table codes are https://<that address>/q/t/<shop>/<table>.
// A shop appears here only when the superadmin filled in its certificate fingerprint (Android) or its iPhone app id (Shop > Edit > Opening the app).
// Until the apps are built with the matching link settings (docs/smart-table-qr.md) these files do nothing, and the QR page works as before.
//   GET /.well-known/assetlinks.json
//   GET /.well-known/apple-app-site-association
const express = require('express');
const Tenant = require('../models/Tenant');
const { wrap } = require('../middlewares/apiErrors');

const router = express.Router();
router.use((req, res, next) => { res.set('Cache-Control', 'public, max-age=300'); next(); });

router.get('/assetlinks.json', wrap(async (req, res) => {
    const shops = await Tenant.find({ androidPackage: { $exists: true, $ne: '' }, 'appLinks.androidSha256.0': { $exists: true }, status: { $ne: 'suspended' } }).select('androidPackage appLinks.androidSha256').lean();
    res.json(shops.map((t) => ({
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: t.androidPackage, sha256_cert_fingerprints: t.appLinks.androidSha256 },
    })));
}));

router.get('/apple-app-site-association', wrap(async (req, res) => {
    const shops = await Tenant.find({ 'appLinks.iosAppId': { $exists: true, $ne: '' }, status: { $ne: 'suspended' } }).select('slug appLinks.iosAppId').lean();
    res.type('application/json').json({
        applinks: { apps: [], details: shops.map((t) => ({ appID: t.appLinks.iosAppId, paths: [`/q/t/${t.slug}/*`] })) },
    });
}));

module.exports = router;
