// Write-protection for a demo session (opened with the private demo login). The demo person may LOOK at everything and play with
// the cart, addresses, favourites, profile and alert settings, but nothing real may happen: no order, payment, booking, bulk order,
// inquiry, chat message, upload, push registration or anything else that reaches a real shop, customer or rider.
// Everything NOT listed here is refused, so a route added later is safe by default.
const ALLOWED = [
    /^\/api\/auth\//,                     // sign out, refresh, language, devices
    /^\/api\/cart(\/|\?|$)/,
    /^\/api\/addresses(\/|\?|$)/,
    /^\/api\/favourites(\/|\?|$)/,
    /^\/api\/me(\/|\?|$)/,                // profile, preferences, alert settings
    /^\/api\/orders\/quote(\/|\?|$)/,     // the price check only; the order itself is refused
    /^\/api\/demo\//,                     // the panel switcher (phase 2)
];
const BLOCKED_INSIDE_ALLOWED = [/^\/api\/me\/uploads(\/|\?|$)/];   // a photo upload stores a real file

const MESSAGE = 'This is a demo. Nothing real is sent or paid. Sign in with your own number to use it for real.';

function isAllowed(method, url) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
    if (BLOCKED_INSIDE_ALLOWED.some((re) => re.test(url))) return false;
    return ALLOWED.some((re) => re.test(url));
}

// Inside the demo shop itself everything is pretend, so the owner, cook, waiter and rider may really work there. Only what reaches
// the outside world stays refused: online payments, money in or out, uploads, device and push registration, deleting the account.
const OUTSIDE = /\/(pay|pay-bill|topup|top-up|checkout|razorpay|uploads?|devices?|push|webpush|sms-setup|payments)(\/|\?|$)/i;
function isAllowedInDemoShop(method, url) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
    if (method === 'POST' && /^\/api\/me\/uploads\/(sign|confirm)(\?|$)/.test(url)) return true;   // a complaint photo: small, kept only until the demo resets
    if (method === 'DELETE' && /^\/api\/me(\?|$)/.test(url)) return false;
    return !OUTSIDE.test(url);
}

// called by authMiddleware once the session is known; answers 403 itself and returns false when refused
function check(req, res, isDemo, tenant) {
    if (!isDemo) return true;
    if (tenant && tenant.isDemo ? isAllowedInDemoShop(req.method, req.originalUrl) : isAllowed(req.method, req.originalUrl)) return true;
    res.status(403).json({ error: MESSAGE, demo: true });
    return false;
}

module.exports = { check, isAllowed, isAllowedInDemoShop, MESSAGE };
