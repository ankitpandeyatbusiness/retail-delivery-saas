// The defaults from events.js, plus changes from the database (NotificationRule), kept 60 seconds in memory.
// A rule for one shop wins over a rule for all shops. Only the fields set in a rule override the default.
const NotificationRule = require('../models/NotificationRule');
const { EVENTS, DEFAULT_EVENT } = require('./events');

const TTL_MS = 60 * 1000;
let cache = { at: 0, map: null };

async function load() {
    if (cache.map && Date.now() - cache.at < TTL_MS) return cache.map;
    const rows = await NotificationRule.find({}).lean();
    const map = new Map(rows.map((r) => [`${r.eventKey}:${r.tenantId || ''}`, r]));
    cache = { at: Date.now(), map };
    return map;
}

async function get(eventKey, tenantId) {
    const map = await load();
    const out = { ...(EVENTS[eventKey] || DEFAULT_EVENT) };
    const found = [map.get(`${eventKey}:`), tenantId ? map.get(`${eventKey}:${tenantId}`) : null].filter(Boolean);
    for (const r of found) {
        if (typeof r.enabled === 'boolean') out.enabled = r.enabled;
        if (Array.isArray(r.channels)) out.channels = r.channels;
        if (typeof r.alsoPush === 'boolean') out.alsoPush = r.alsoPush;
        if (typeof r.escalateSmsAfterSec === 'number') out.escalateSmsAfterSec = r.escalateSmsAfterSec;
    }
    return out;
}

const invalidate = () => { cache.at = 0; };

module.exports = { get, invalidate };