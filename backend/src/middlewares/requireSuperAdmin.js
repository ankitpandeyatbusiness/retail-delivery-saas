const { verifyAdminToken, signAdminToken, needsRenewal } = require('../services/superAdminToken');
const SuperAdmin = require('../models/SuperAdmin');

// Use on every /api/admin route except login.
// Unlike customer routes this does NOT use tenantRecognizer: the admin works across all tenants.
module.exports = async function requireSuperAdmin(req, res, next) {
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'Authentication required' });

    let decoded;
    try {
        decoded = verifyAdminToken(token);
    } catch (e) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
        // Re-check on every call, so deactivating an admin takes effect immediately
        const admin = await SuperAdmin.findById(decoded.sub).select('_id email name isActive photo phones legalRole');
        if (!admin || !admin.isActive) return res.status(401).json({ error: 'Account disabled' });
        req.admin = admin;
        // a working admin stays logged in: the app swaps its token for this one
        if (needsRenewal(decoded)) { res.set('x-renewed-token', signAdminToken(admin)); res.set('Access-Control-Expose-Headers', 'x-renewed-token'); }
        next();
    } catch (e) {
        console.error('Admin auth error:', e);
        res.status(500).json({ error: 'Could not verify admin' });
    }
};