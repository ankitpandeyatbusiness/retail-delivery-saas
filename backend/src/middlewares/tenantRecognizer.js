const { LRUCache } = require('lru-cache');
const Tenant = require('../models/Tenant');

const SLUG_RE = /^[a-z0-9-]{3,40}$/;
const cache = new LRUCache({ max: 1000, ttl: 60 * 1000 });

// Adjust to your real Tenant field names
const FIELDS = '_id name slug tagline logo colors heroImages status androidPackage homeConfig delivery updatedAt';

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
        if (tenant.status && tenant.status !== 'active') {
            return res.status(402).json({ error: 'Service unavailable for this store' });
        }

        req.tenant = tenant;
        next();
    } catch (error) {
        console.error('Tenant recognition error:', error);
        res.status(500).json({ error: 'Tenant recognition failed' });
    }
};

module.exports = tenantRecognizer;