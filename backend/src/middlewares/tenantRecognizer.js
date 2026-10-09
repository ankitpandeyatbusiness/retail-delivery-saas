const { LRUCache } = require('lru-cache');
const Tenant = require('../models/Tenant');
const { isMaintenanceOn, maintenanceBody } = require('../utils/maintenance');

const SLUG_RE = /^[a-z0-9-]{3,40}$/;
const cache = new LRUCache({ max: 1000, ttl: 60 * 1000 });

// ownerBlocked and maintenance are needed here: the config and the maintenance check read them.
// (ownerBlockedReason is deliberately NOT selected, so it can never reach an app.)
const FIELDS =
    '_id name slug tagline logo colors heroImages status androidPackage ' +
    'homeConfig delivery settings phone address business ownerBlocked maintenance updatedAt billing.state billing.graceEndsAt';

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

        // Routes that set req.allowFrozenShop (order history and cancel) skip these two checks,
        // so customers are never locked out of their own live orders.
        if (!req.allowFrozenShop) {
            // Hard suspension. Customers are never told the real reason.
            if (tenant.status && tenant.status !== 'active') {
                return res.status(402).json({ error: 'This shop is not accepting orders right now' });
            }

            // Maintenance for this one shop (the whole-platform switch is handled by platformGate)
            if (isMaintenanceOn(tenant.maintenance)) {
                res.set('Retry-After', '300');
                return res.status(503).json(maintenanceBody(tenant.maintenance));
            }
        }

        // Unpaid rent after grace: customers get the normal "not accepting orders" answer.
        // A copy is used, so the cached shop object is never changed.
        req.tenant = tenant.billing?.state === 'paused'
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
tenantRecognizer.invalidateTenant = (slug) => cache.delete(String(slug).trim().toLowerCase());

module.exports = tenantRecognizer;