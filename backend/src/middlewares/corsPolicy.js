// Which WEBSITES may call this API from a browser (CORS).
// The phone apps send no Origin header and are never affected. Logins use a Bearer token, not cookies, so this is a second
// lock, not the only one: a stranger's website still cannot make a visitor's browser read answers from the API.
//
// Allowed:
//   - the shops' own addresses:  https://<shop>.<PLATFORM_WEB_DOMAIN>  and  https://<PLATFORM_WEB_DOMAIN>   (default vivyaan.co.in)
//   - addresses listed in CORS_ORIGINS (comma separated, full origins like https://order.example.com): custom domains
//   - while developing (NODE_ENV is not production, or CORS_ALLOW_LOCAL=1): localhost and local-network addresses on any port
const cors = require('cors');

// one name for the platform's website domain everywhere: PLATFORM_WEB_DOMAIN (the same one services/channelSwitch.js uses). WEB_BASE_DOMAIN still works.
const BASE = String(process.env.PLATFORM_WEB_DOMAIN || process.env.WEB_BASE_DOMAIN || 'vivyaan.co.in').toLowerCase().replace(/^\.+/, '');
const LOCAL_RE = /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/i;

const listed = () => new Set(String(process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim().toLowerCase().replace(/\/+$/, '')).filter(Boolean));

function isAllowedOrigin(origin) {
    if (!origin) return true;                       // not a browser
    const o = String(origin).toLowerCase();
    if (listed().has(o)) return true;
    let u;
    try { u = new URL(o); } catch (e) { return false; }
    if (u.protocol === 'https:' && (u.hostname === BASE || u.hostname.endsWith('.' + BASE))) return true;
    const local = process.env.NODE_ENV !== 'production' || process.env.CORS_ALLOW_LOCAL === '1';
    return local && LOCAL_RE.test(o);
}

module.exports = cors({
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
    maxAge: 600,
});
module.exports.isAllowedOrigin = isAllowedOrigin;
