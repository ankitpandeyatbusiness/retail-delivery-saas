const express = require('express');
const crypto = require('crypto');
const tenantRouter = express.Router();
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const { resolveConfig, brandingIcon } = require('../services/tenantConfigService');
const { getAvailability, applyAutoHide } = require('../services/availability');
const { getDefaultHeroUrls } = require('../services/defaultHeroes');

// Small and fast: used at app start for colors, name and hero images
tenantRouter.get('/theme', tenantRecognizer, async (req, res) => {
    const t = req.tenant;
    const c = resolveConfig(t);
    // a shop with no hero images of its own shows the platform defaults from the bucket (defaults/hero/)
    const heroImages = t.heroImages?.length ? t.heroImages : await getDefaultHeroUrls();
    res.json({
        name: t.name,
        tagline: t.tagline,
        phone: t.phone || null,   // the shop's own number (the owner sets it; the Account page has a Call the shop block)
        logo: t.logo,
        icon: brandingIcon(t.slug),   // the shop's app icon (square): the website's tab icon. null when the media storage is not set up
        colors: c.brand.colors,
        fontStyle: c.brand.fontStyle,
        buttonShape: c.brand.buttonShape,
        look: c.brand.lightLook,   // the old single field, for apps built before light and dark were separate
        lightLook: c.brand.lightLook,
        darkLook: c.brand.darkLook,
        motion: c.brand.motion,
        headerStyle: c.brand.headerStyle,
        tabBarStyle: c.brand.tabBarStyle,
        categoryStyle: c.brand.categoryStyle,
        categoryScroll: c.brand.categoryScroll === true,
        filterStyle: c.brand.filterStyle,
        locationStyle: c.brand.locationStyle,
        heroImages,
    });
});

// The website's "Add to Home Screen" identity for THIS shop (name, colours, icon). The hosting Worker serves it as /manifest.webmanifest on the shop's
// address, asking with the shop's slug (deploy/cloudflare/worker.js). Small and cacheable.
tenantRouter.get('/manifest', tenantRecognizer, (req, res) => {
    const t = req.tenant;
    const c = resolveConfig(t);
    const icon = brandingIcon(t.slug) || t.logo || '/icons/icon-1024.png';   // the platform icon on the website itself when the shop has none
    const name = String(t.name || 'Shop').slice(0, 45);
    const manifest = {
        id: '/',
        name,
        short_name: name.length > 12 ? name.slice(0, 12).trim() : name,
        description: String(t.tagline || 'Order online').slice(0, 130),
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#111111',
        theme_color: (c.brand.colors && c.brand.colors.primary) || '#111111',
        icons: [
            { src: icon, sizes: '1024x1024', type: 'image/png', purpose: 'any' },
            { src: icon, sizes: '1024x1024', type: 'image/png', purpose: 'maskable' },
        ],
    };
    res.set('Cache-Control', 'public, max-age=300');
    res.type('application/manifest+json').send(JSON.stringify(manifest));
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
        // a branch of a brand tells the app the brand and its own city (the app then shows the branch chooser); any other shop: null
        let branch = null;
        if (t.brandId) {
            const brand = await require('../models/Brand').findById(t.brandId).select('name').lean();
            branch = { brand: (brand && brand.name) || null, city: t.branchCity || (t.address && t.address.city) || null };
        }
        // Changes whenever what the app would see changes (settings, menu data, or open/closed),
        // so the app knows when to refetch.
        const version = crypto.createHash('sha1').update(JSON.stringify({ config, delivery })).digest('hex').slice(0, 12);
        // a planned maintenance that touches this shop within 48 hours: the apps show a banner (services/maintenancePlans.js). Not part of the version.
        const maintenanceNotice = await require('../services/maintenancePlans').noticeFor(t._id).catch(() => null);
        // What the badge on every screen shows: phase 'on' (maintenance now; draining = only finishing running orders) or 'upcoming' (planned, announced)
        let maintenance = null;
        try {
            const st = await require('../services/maintenanceState').stateOf(t);
            if (st.on) maintenance = { phase: 'on', scope: st.scope, message: st.message, until: st.until, since: st.since, draining: st.draining };
            else if (maintenanceNotice) maintenance = { phase: 'upcoming', message: maintenanceNotice.message, startAt: maintenanceNotice.startAt, until: maintenanceNotice.endAt };
        } catch (e) { /* the badge is optional */ }
        // what the plan allows, so the apps can hide what is not in it (the server refuses anyway). No plan name, dates or prices here: customers read this too.
        const pl = require('../services/planService').viewOf(t);
        const plan = pl.id ? { features: pl.features, limits: pl.limits } : null;
        // the web / app switch for the client that asked (the website sends x-client: web)
        const sw = require('../services/channelSwitch');
        const channel = sw.forConfig(t, sw.isWeb(req) ? 'web' : 'app');
        res.json({ version, config, homeConfig: config.home, delivery, branch, maintenanceNotice, maintenance, plan, channel });
    } catch (e) {
        console.error('Config error:', e);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

module.exports = tenantRouter;