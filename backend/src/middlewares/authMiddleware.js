const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authMiddleware = async (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({ error: 'No token, authorization denied' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
        const user = await User.findById(decoded.userId);

        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        // THE GODFATHER BYPASS: 
        // If the user is a superadmin, they skip the tenant lock and can access any tenant's data.
        if (user.role !== 'superadmin') {
            // Normal users MUST belong to the tenant they are trying to access
            if (!user.tenantId || user.tenantId.toString() !== req.tenant._id.toString()) {
                return res.status(403).json({ error: 'User does not belong to this tenant' });
            }
        }

        req.user = user;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Token is not valid' });
    }
};

const adminMiddleware = (req, res, next) => {
    // A Superadmin can also do anything an Admin can do
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
        return res.status(403).json({ error: 'Access denied. Admin only.' });
    }
    next();
};

const riderMiddleware = (req, res, next) => {
    if (req.user.role !== 'rider') {
        return res.status(403).json({ error: 'Access denied. Rider only.' });
    }
    next();
};

// THE NEW GODFATHER MIDDLEWARE
// Use this on routes like "Create New Tenant", "View All Revenue", etc.
const superAdminMiddleware = (req, res, next) => {
    if (req.user.role !== 'superadmin') {
        return res.status(403).json({ error: 'Access denied. Superadmin only.' });
    }
    next();
};

module.exports = {
    authMiddleware,
    adminMiddleware,
    riderMiddleware,
    superAdminMiddleware
};