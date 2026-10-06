const express = require('express');
const crypto = require('crypto');
const tenantRouter = express.Router();
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const { resolveConfig } = require('../services/tenantConfigService');
const { getAvailability, applyAutoHide } = require('../services/availability');

// Small and fast: used at app start for colors, name and hero images
tenantRouter.get('/theme', tenantRecognizer, (req, res) => {
    const t = req.tenant;
    const c = resolveConfig(t);
    res.json({
        name: t.name,
        tagline: t.tagline,
        logo: t.logo,
        colors: c.brand.colors,
        fontStyle: c.brand.fontStyle,
        buttonShape: c.brand.buttonShape,
        heroImages: t.heroImages,
    });
});

// Everything the app needs to draw itself. Options that have no data yet (e.g. the Weight filter when
// no item has weights) are removed here, so the app never shows an empty filter or strip.
// `homeConfig` and `delivery` are kept so the current frontend keeps working.
tenantRouter.get('/config', tenantRecognizer, async (req, res) => {
    try {
        const t = req.tenant;
        const { config } = applyAutoHide(resolveConfig(t), await getAvailability(t._id));
        const delivery = {
            latitude: t.delivery?.latitude ?? null,
            longitude: t.delivery?.longitude ?? null,
            radiusKm: t.delivery?.radiusKm ?? null,
            minOrder: config.orders.minOrder,
        };
        // Changes whenever what the app would see changes (settings, menu data, or open/closed),
        // so the app knows when to refetch.
        const version = crypto.createHash('sha1').update(JSON.stringify({ config, delivery })).digest('hex').slice(0, 12);
        res.json({ version, config, homeConfig: config.home, delivery });
    } catch (e) {
        console.error('Config error:', e);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

module.exports = tenantRouter;