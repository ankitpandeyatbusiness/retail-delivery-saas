// Notes which app version a shop's customers are really running. Never slows or breaks a request.
const { LRUCache } = require('lru-cache');
const AppVersionSeen = require('../models/AppVersionSeen');

const recent = new LRUCache({ max: 5000, ttl: 10 * 60 * 1000 });   // one write per row per 10 minutes
const clean = (v, n) => String(v || '').replace(/[^0-9A-Za-z._+-]/g, '').slice(0, n);

function noteAppVersion(tenantId, headers) {
    try {
        const version = clean(headers['x-app-version'], 20);
        if (!version) return;
        const build = clean(headers['x-app-build'], 20);
        const platform = clean(headers['x-app-platform'], 12).toLowerCase();
        const osVersion = clean(headers['x-app-os'], 20);
        const key = `${tenantId}|${version}|${build}|${platform}`;
        if (recent.has(key)) return;
        recent.set(key, true);
        AppVersionSeen.updateOne(
            { tenantId, version, build, platform },
            { $set: { lastSeenAt: new Date(), osVersion }, $setOnInsert: { firstSeenAt: new Date() } },
            { upsert: true },
        ).catch(() => { });
    } catch (_) { /* tracking must never break a request */ }
}

module.exports = { noteAppVersion };
