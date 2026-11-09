const { LRUCache } = require('lru-cache');
const Tenant = require('../models/Tenant');
const maintenanceState = require('../services/maintenanceState');
const { isOlder } = require('../utils/appVersion');
const { noteAppVersion } = require('../services/appVersionTracker');

const SLUG_RE = /^[a-z0-9-]{3,40}$/;
const cache = new LRUCache({ max: 1000, ttl: 60 * 1000 });

// ownerBlocked and maintenance are needed here: the config and the maintenance check read them.
// (ownerBlockedReason is deliberately NOT selected, so it can never reach an app.)
const FIELDS =
    '_id name slug businessType tagline logo colors heroImages status androidPackage ' +
    'homeConfig delivery settings phone address business ownerBlocked maintenance updatedAt billing.state billing.graceEndsAt stats.rating brandId branchCity plan androidPackage';

const tenantRecognizer = async (req, res, next) => {
    const raw = req.headers['x-tenant-slug'];
    if (!raw) return res.status(400).json({ error: 'Missing tenant' });

    const slug = String(raw).trim().toLowerCase();
    if (!SLUG_RE.test(slug)) return res.status(404).json({ error: 'Tenant not found' });

    try {
        let tenant = cache.get(slug);
        if (tenant === undefined) {
            tenant = await Tenant.findOne({ slug }).select(FIELDS).lean();
            cache.set(slug, tenant || false); // cache misses too
        }
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

        // Remember which app version this is (for the superadmin's Development details). Customer routes only.
        if (!req.originalUrl.startsWith('/api/admin')) noteAppVersion(tenant._id, req.headers);

        // An app older than the shop's minimum version must update first.
        // A missing or unreadable x-app-version header is allowed. The superadmin routes are never blocked.
        const minVersion = tenant.settings?.app?.minVersion;
        if (minVersion && !req.originalUrl.startsWith('/api/admin') && isOlder(req.headers['x-app-version'], minVersion)) {
            return res.status(426).json({ error: 'Please update the app', updateRequired: true, minVersion });
        }

        // Routes that set req.allowFrozenShop (order history and cancel) skip these two checks,
        // so customers are never locked out of their own live orders.
        if (!req.allowFrozenShop) {
            // Hard suspension. Customers are never told the real reason.
            if (tenant.status && tenant.status !== 'active') {
                return res.status(402).json({ error: 'This shop is not accepting orders right now' });
            }

            // Maintenance for this one shop (the whole-platform switch is handled by platformGate, by the same rule): a shop that still has work running
            // refuses only NEW work; a shop with nothing running refuses every change (reading always works)
            const blocked = await maintenanceState.decide(req, tenant);
            if (blocked) {
                res.set('Retry-After', '300');
                return res.status(503).json(blocked);
            }
        }

        // The web / app switch (services/channelSwitch.js): a customer cannot START an order, booking or inquiry on a channel the supreme admin switched off. Reads still work.
        if (!req.allowFrozenShop) {
            const off = require('../services/channelSwitch').refusal(req, tenant);
            if (off) return res.status(409).json(off);
        }

        // Unpaid rent after grace: customers get the normal "not accepting orders" answer.
        // A copy is used, so the cached shop object is never changed.
        req.tenant = (tenant.billing?.state === 'paused' || tenant.plan?.paused)
            ? { ...tenant, settings: { ...tenant.settings, orders: { ...tenant.settings?.orders, acceptingOrders: false } } }
            : tenant;
        next();
    } catch (error) {
        console.error('Tenant recognition error:', error);
        res.status(500).json({ error: 'Tenant recognition failed' });
    }
};

// The superadmin save endpoints call this so changes show up immediately on this server.
// (With several server instances, others catch up within 60 seconds.)
// A change of the shop's settings (by the superadmin or the owner) also reaches the shop's OPEN apps at once: a quiet "shop:changed" message to everyone of the
// shop (customers, owner, cook, waiter, riders). The apps reload the shop's settings; if the shop was closed or paused meanwhile, they show it within seconds.
// A burst of saves sends one message (not more than one a second per shop).
const lastTold = new Map();
function tellApps(tenantId) {
    try {
        const key = String(tenantId);
        const now = Date.now();
        if (now - (lastTold.get(key) || 0) < 1000) return;
        lastTold.set(key, now);
        if (lastTold.size > 2000) lastTold.clear();
        require('../services/realtime').toShop(tenantId, 'shop:changed', {});
    } catch (e) { /* the apps catch up on their next request */ }
}
tenantRecognizer.tellApps = tellApps;
// the shop of a slug, from the same cache (the platform gate needs it to know whether the shop still has work running)
tenantRecognizer.lookup = async (slug) => {
    const key = String(slug).trim().toLowerCase();
    let tenant = cache.get(key);
    if (tenant === undefined) { tenant = await Tenant.findOne({ slug: key }).select(FIELDS).lean(); cache.set(key, tenant || false); }
    return tenant || null;
};
tenantRecognizer.invalidateTenant = (slug) => {
    const key = String(slug).trim().toLowerCase();
    const was = cache.get(key);
    cache.delete(key);
    if (was && was._id) tellApps(was._id);
    else Tenant.findOne({ slug: key }).select('_id').lean().then((t) => { if (t) tellApps(t._id); }).catch(() => { });
};

module.exports = tenantRecognizer;