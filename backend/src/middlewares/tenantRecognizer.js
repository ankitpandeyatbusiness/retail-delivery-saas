const Tenant = require('../models/Tenant');

const tenantRecognizer = async (req, res, next) => {
    // Mobile app must send this header on EVERY request
    const slug = req.headers['x-tenant-slug'];

    if (!slug) {
        return res.status(400).json({ error: 'Missing x-tenant-slug header' });
    }

    try {
        const tenant = await Tenant.findOne({ slug });
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

        // Attach tenant to the request object for downstream use
        req.tenant = tenant;
        next();
    } catch (error) {
        res.status(500).json({ error: 'Tenant recognition failed' });
    }
};

module.exports = tenantRecognizer;