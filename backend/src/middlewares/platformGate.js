const PlatformSettings = require('../models/PlatformSettings');

// When you switch maintenance on for the whole platform, every shop's app gets a clear
// "we'll be back soon" answer. The superadmin side (/api/admin) and /health keep working,
// so you can still switch maintenance off.
//
// Put it in app.js BEFORE the routers:   app.use(platformGate);

let cache = { at: 0, value: null };

async function load() {
    if (Date.now() - cache.at < 15 * 1000) return cache.value;   // looks at the database at most every 15 seconds
    const doc = await PlatformSettings.findById('main').select('maintenance').lean();
    cache = { at: Date.now(), value: doc?.maintenance || null };
    return cache.value;
}

async function platformGate(req, res, next) {
    if (req.path === '/health' || req.path.startsWith('/api/admin')) return next();

    // Even during platform maintenance, customers can still see their orders, cancel an order,
    // and keep their login alive. Placing new orders, browsing and signing in stay blocked.
    const isOrderRead = req.method === 'GET' && (req.path === '/api/orders' || req.path.startsWith('/api/orders/'));
    const isOrderCancel = req.method === 'POST' && /^\/api\/orders\/[a-fA-F0-9]{24}\/cancel$/.test(req.path);
    const isRefresh = req.method === 'POST' && req.path === '/api/auth/refresh';
    if (isOrderRead || isOrderCancel || isRefresh) return next();
    try {
        const m = await load();
        const active = m && m.on && (!m.until || new Date(m.until) > new Date());
        if (active) {
            res.set('Retry-After', '300');
            return res.status(503).json({
                error: m.message || 'We are down for maintenance. Please try again soon.',
                maintenance: true,
                until: m.until || null,
            });
        }
    } catch (e) {
        console.error('Platform gate error:', e.message);   // if the check itself fails, let people through
    }
    next();
}

platformGate.invalidate = () => { cache.at = 0; };   // called right after you change the switch
module.exports = platformGate;