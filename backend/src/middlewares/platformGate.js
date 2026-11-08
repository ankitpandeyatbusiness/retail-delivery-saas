const { isMaintenanceOn } = require('../utils/maintenance');
const state = require('../services/maintenanceState');

// When you switch maintenance on for the whole platform, every shop goes the same way as with a shop's own switch (services/maintenanceState.js):
//   draining  the shop still has work running: no NEW order, request, booking or table visit; everything that finishes the running work keeps working
//   offline   nothing is running: every change is refused (the few that let a person finish or cancel an existing order, keep the sign-in alive and read
//             messages still work)
// Reading (GET) always works, so the apps can show the maintenance badge and the grey screen.
// The superadmin side (/api/admin), the webhooks and /health keep working, so you can still switch maintenance off.
//
// Put it in app.js BEFORE the routers:   app.use(platformGate);
const SLUG_RE = /^[a-z0-9-]{3,40}$/;

async function platformGate(req, res, next) {
    if (req.path === '/health' || req.path === '/health/ready' || req.path.startsWith('/api/admin') || req.path.startsWith('/api/webhooks')) return next();
    try {
        const pm = await state.platformMaintenance();
        if (!isMaintenanceOn(pm)) return next();   // (a shop's own switch is checked later, by tenantRecognizer)
        const slug = String(req.headers['x-tenant-slug'] || '').trim().toLowerCase();
        const tenant = SLUG_RE.test(slug) ? await require('./tenantRecognizer').lookup(slug) : null;
        const blocked = await state.decide(req, tenant || { _id: null, maintenance: null });
        if (blocked) {
            res.set('Retry-After', '300');
            return res.status(503).json(blocked);
        }
    } catch (e) {
        console.error('Platform gate error:', e.message);   // if the check itself fails, let people through
    }
    next();
}

platformGate.invalidate = () => { state.invalidatePlatform(); };   // called right after you change the switch
module.exports = platformGate;
