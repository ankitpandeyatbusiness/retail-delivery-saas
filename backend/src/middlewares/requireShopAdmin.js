const authenticate = require('./authMiddleware');
const User = require('../models/User');

// For the restaurant owner / staff. Use AFTER tenantRecognizer.
// authenticate already guarantees the token belongs to THIS shop and the session is alive.
// Then we re-read the role from the database on every call, so removing someone's admin role
// (or blocking them) works at once.
//
//   router.use(tenantRecognizer);
//   router.use(requireShopAdmin);                 // normal owner routes
//   router.use('/x', requireShopAdmin.allowBlocked, ...);   // still reachable while the owner is blocked

async function checkAdmin(req, res, next) {
    try {
        const user = await User.findById(req.auth.userId).select('role isBlocked phone');
        if (!user || user.isBlocked || user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
        req.shopUser = { id: user._id, phone: user.phone };
        next();
    } catch (e) {
        console.error('Shop admin check error:', e);
        res.status(500).json({ error: 'Could not verify access' });
    }
}

// Superadmin switched this shop's owner access off (for example, unpaid rent).
// Runs after checkAdmin, so only real owners ever see this message.
function blockedGate(req, res, next) {
    if (req.tenant.ownerBlocked) {
        return res.status(403).json({ error: 'Your shop panel is paused. Please contact support.', blocked: true });
    }
    // unpaid rent after grace: only the routes mounted with .allowBlocked stay open
    // (orders, billing, and later notifications)
    if (req.tenant.billing?.state === 'paused') {
        return res.status(403).json({
            error: 'Your shop is paused because a bill is unpaid. You can finish current orders and open Billing.',
            paused: true,
        });
    }
    next();
}

module.exports = [authenticate, checkAdmin, blockedGate];
module.exports.allowBlocked = [authenticate, checkAdmin];