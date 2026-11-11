// What kind of device a request comes from, and roughly where. Used for the "Where you're logged in" list.
//
// Only a SHORT label and a place name (city, region, country) are kept with a session. The IP address itself is never stored
// (the session keeps only a hash of it).
//
// Place comes from, in this order:
//   1. Cloudflare headers (cf-ipcity, cf-region, cf-ipcountry): free once the site sits behind Cloudflare
//      (city and region need "Add visitor location headers" switched on in Cloudflare > Rules > Managed Transforms).
//   2. The geoip-lite package, only if it is installed (works offline, no outside service is called).
//   3. Nothing: the list then shows "Location not known".

const PLATFORMS = ['android', 'ios', 'web'];

// the app sends x-app-platform: android | ios | web (x-client-platform is also read). Anything else is guessed from the browser string.
function platformOf(req) {
    const h = String(req.headers['x-client-platform'] || req.headers['x-app-platform'] || '').toLowerCase();   // the app already sends x-app-platform
    if (PLATFORMS.includes(h)) return h;
    const ua = String(req.headers['user-agent'] || '');
    if (/okhttp|Dalvik|Expo/i.test(ua)) return 'android';
    if (/CFNetwork|Darwin/i.test(ua)) return 'ios';
    return 'web';
}

function browserOf(ua) {
    if (/Edg\//.test(ua)) return 'Edge';
    if (/OPR\/|Opera/.test(ua)) return 'Opera';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/SamsungBrowser/.test(ua)) return 'Samsung Internet';
    if (/Chrome\//.test(ua)) return 'Chrome';   // Brave also says Chrome: it cannot be told apart from the server side
    if (/Safari\//.test(ua)) return 'Safari';
    return 'Browser';
}

function systemOf(ua) {
    if (/Android/.test(ua)) return 'Android';
    if (/iPhone|iPad|iPod/.test(ua)) return 'iPhone';
    if (/Windows/.test(ua)) return 'Windows';
    if (/Mac OS X|Macintosh/.test(ua)) return 'Mac';
    if (/CrOS/.test(ua)) return 'Chromebook';
    if (/Linux/.test(ua)) return 'Linux';
    return '';
}

function labelOf(req, platform) {
    const ua = String(req.headers['user-agent'] || '');
    if (platform === 'android') return 'Android app';
    if (platform === 'ios') return 'iPhone app';
    const sys = systemOf(ua);
    return sys ? `${browserOf(ua)} on ${sys}` : browserOf(ua);
}

const clean = (v) => String(v || '').replace(/[^\p{L}\p{N} .,'-]/gu, '').trim().slice(0, 60);

const isLocalIp = (ip) => !ip || /^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:(127|10|192\.168)\.|fc|fd)/i.test(String(ip));

let geoLite; // undefined = not tried yet, null = not installed
function lookup(ip) {
    if (geoLite === undefined) { try { geoLite = require('geoip-lite'); } catch (e) { geoLite = null; } }
    if (!geoLite) return null;
    const g = geoLite.lookup(String(ip).replace(/^::ffff:/, ''));
    return g ? { city: g.city, region: g.region, country: g.country } : null;
}

function placeOf(req, ip) {
    const cfCity = clean(decodeURIComponent(String(req.headers['cf-ipcity'] || '')));
    const cfRegion = clean(req.headers['cf-region']);
    const cfCountry = clean(req.headers['cf-ipcountry']).toUpperCase();
    if (cfCity || cfRegion || (cfCountry && cfCountry !== 'XX' && cfCountry !== 'T1')) {
        return { city: cfCity, region: cfRegion, country: cfCountry === 'XX' || cfCountry === 'T1' ? '' : cfCountry };
    }
    if (isLocalIp(ip)) return { city: '', region: '', country: '', local: true };
    const g = lookup(ip);
    return g ? { city: clean(g.city), region: clean(g.region), country: clean(g.country).toUpperCase() } : { city: '', region: '', country: '' };
}

// { platform, deviceLabel, city, region, country } for one request
function describeClient(req, ip) {
    const platform = platformOf(req);
    const p = placeOf(req, ip || req.ip);
    return {
        platform,
        deviceLabel: labelOf(req, platform),
        city: p.city, region: p.region, country: p.country,
        ...(p.local ? { place: 'Local network' } : {}),
    };
}

// For a session saved BEFORE the device name was kept: work the name out from the browser string that was stored with it.
// { platform, deviceLabel } or null when there is nothing to go on.
function describeFromUserAgent(userAgent) {
    const ua = String(userAgent || '').trim();
    if (!ua) return null;
    const req = { headers: { 'user-agent': ua } };
    const platform = platformOf(req);
    return { platform, deviceLabel: labelOf(req, platform) };
}

module.exports = { describeClient, describeFromUserAgent, platformOf, PLATFORMS };
