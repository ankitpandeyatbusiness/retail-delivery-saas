const express = require('express');
const tenantRouter = express.Router();
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const { resolveHomeConfig } = require('../services/homeConfigService');

tenantRouter.get('/theme', tenantRecognizer, (req, res) => {
    const t = req.tenant;
    res.json({
        name: t.name,
        tagline: t.tagline,
        logo: t.logo,
        colors: t.colors,
        heroImages: t.heroImages,
    });
});

// NEW: everything the home screen needs to draw itself
tenantRouter.get('/config', tenantRecognizer, (req, res) => {
    const t = req.tenant;
    res.json({
        version: new Date(t.updatedAt).getTime(), // lets the app know when its cache is old
        homeConfig: resolveHomeConfig(t),
        delivery: {
            latitude: t.delivery?.latitude ?? null,
            longitude: t.delivery?.longitude ?? null,
            radiusKm: t.delivery?.radiusKm ?? null,
            minOrder: t.delivery?.minOrder ?? 0,
        },
    });
});

module.exports = tenantRouter;