// Use AFTER requireSuperAdmin.
//   requireSupreme   only the supreme admin may go on (403 for every other superadmin)
//   moneyGuard       one place that lists every CHANGE (not a read) that touches the platform's income. Reads stay open to all.
const { isSupreme } = require('../config/supreme');

const MESSAGE = 'Only the supreme admin can do this. You can view it.';

function requireSupreme(req, res, next) {
    if (isSupreme(req.admin)) return next();
    return res.status(403).json({ error: MESSAGE, supremeOnly: true });
}

// paths are relative to /api/admin
const MONEY = [
    /^\/platform\/(business|billing|tax|payments|sms|operators|agreements|settlement)(\/|$)/,
    /^\/subscriptions\//,                                   // generate, mark paid, void, waive, extend the grace
    /^\/tenants\/[^/]+\/(billing|invoices|sms|sms-provider)(\/|$)/,   // a shop's fee plan, go-live, custom bills, SMS wallet and prices
    /^\/finance\//,                                         // the platform's expenses
    /^\/settlement(\/|$)/,
    /^\/operators(\/|$)/,
    /^\/agreements(\/|$)/,
];

function moneyGuard(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    if (isSupreme(req.admin)) return next();
    const path = req.path;
    // the one change anybody may make on the sheet: an "I have paid" note
    if (req.method === 'POST' && /^\/settlement\/entries\/[^/]+\/claim$/.test(path)) return next();
    if (MONEY.some((re) => re.test(path))) return res.status(403).json({ error: MESSAGE, supremeOnly: true });
    // a shop's fee plan can also arrive inside the shop form
    if (/^\/tenants(\/[^/]+)?$/.test(path) && req.body && typeof req.body === 'object' && req.body.subscription !== undefined) {
        return res.status(403).json({ error: MESSAGE, supremeOnly: true });
    }
    return next();
}

module.exports = { requireSupreme, moneyGuard, MESSAGE };
