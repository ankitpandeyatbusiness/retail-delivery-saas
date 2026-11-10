// Real-time sync between a person's devices (web phase 12). After ANY successful change a logged-in person makes (POST / PUT / PATCH / DELETE), their other
// phones and browsers are told "something of yours changed in <area>", and refetch what they show. One rule for the whole API, so no screen is forgotten.
//
//   event 'sync:changed'  { area, sid, at }     to the person's own devices (room user:<shop>:<id>), and for the owner side (/api/shop/...) to every owner device of the shop
//   area  'addresses', 'me', 'me/alerts', 'favourites', 'cart', 'orders', 'bookings', 'shop:products', 'rider', 'staff'...   (the first part of the address)
//   sid   the session that made the change: that device already shows it and ignores the event
//
// Not announced: the changes that already have their own live message (notifications read, chat), the things that happen many times a second (the rider's
// position), logins, uploads and the platform admin.
const realtime = require('../services/realtime');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SKIP = [
    /^\/api\/auth(\/|$)/, /^\/api\/notifications(\/|$)/, /^\/api\/chat(\/|$)/, /^\/api\/webhooks(\/|$)/, /^\/api\/admin(\/|$)/,
    /^\/api\/geo(\/|$)/, /^\/api\/rider\/(location|ping)(\/|$)/, /\/uploads?(\/|$)/, /^\/api\/me\/uploads(\/|$)/,
];

const pathOf = (url) => String(url || '').split('?')[0];
const shouldTell = (method, url) => MUTATING.has(method) && !SKIP.some((r) => r.test(pathOf(url))) && /^\/api\//.test(pathOf(url));

// "/api/shop/products/12" -> "shop:products"; "/api/me/alerts" -> "me/alerts"; "/api/addresses/5" -> "addresses"
function areaOf(url) {
    const seg = pathOf(url).replace(/^\/api\//, '').split('/').filter(Boolean);
    if (!seg.length) return 'api';
    if (seg[0] === 'shop' && seg[1]) return `shop:${seg[1]}`;
    if (seg[0] === 'me' && seg[1] === 'alerts') return 'me/alerts';
    return seg[0];
}

function syncNotify(req, res, next) {
    if (!MUTATING.has(req.method)) return next();
    res.on('finish', () => {
        try {
            if (res.statusCode < 200 || res.statusCode >= 300) return;
            if (!req.auth || !req.tenant || !shouldTell(req.method, req.originalUrl)) return;
            const url = pathOf(req.originalUrl);
            const payload = { area: areaOf(url), sid: String(req.auth.sessionId || ''), at: Date.now() };
            realtime.toUser(req.tenant._id, req.auth.userId, 'sync:changed', payload);
            if (/^\/api\/shop(\/|$)/.test(url)) realtime.toOwner(req.tenant._id, 'sync:changed', payload);   // the shop's other owners too
        } catch (e) { /* telling the other devices must never get in the way of the change itself */ }
    });
    next();
}

module.exports = syncNotify;
module.exports.shouldTell = shouldTell;
module.exports.areaOf = areaOf;
