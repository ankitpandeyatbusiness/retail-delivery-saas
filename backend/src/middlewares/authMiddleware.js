const tokenService = require('../services/tokenService');
const Session = require('../models/Session');

// Use AFTER tenantRecognizer on any protected route:
//   router.use(tenantRecognizer);
//   router.get('/orders', authenticate, ordersController.list);
module.exports = async function authenticate(req, res, next) {
    if (!req.tenant) {
        return res.status(500).json({ error: 'Tenant not resolved' });
    }

    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    let decoded;
    try {
        decoded = tokenService.verifyAccessToken(token);
    } catch (e) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // A token issued for shop A must never work against shop B
    if (String(decoded.tid) !== String(req.tenant._id)) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    try {
        // Logout, a blocked user, or a stolen-token kill deletes the session,
        // so the access token stops working immediately.
        const alive = await Session.exists({
            _id: decoded.sid,
            userId: decoded.sub,
            tenantId: req.tenant._id,
        });
        if (!alive) return res.status(401).json({ error: 'Session ended' });
    } catch (e) {
        return res.status(500).json({ error: 'Could not verify session' });
    }

    req.auth = { userId: decoded.sub, tenantId: decoded.tid, sessionId: decoded.sid };
    next();
};