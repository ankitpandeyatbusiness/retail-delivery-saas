// The live feed: one short line for everything that happens in a shop.
//   liveFeed.emit(tenantId, 'orders', { type: 'order.accepted', orderNo: 1042, ... })
// It never throws and never waits. It is saved (FeedEvent) and pushed live to superadmin sockets.
// Phone numbers and secrets are removed from every payload before anything is stored or sent.
const mongoose = require('mongoose');
const FeedEvent = require('../models/FeedEvent');
const realtime = require('./realtime');

const CATEGORIES = ['orders', 'riders', 'billing', 'sms', 'settings', 'logins', 'complaints', 'messages'];
const OWNER_CATEGORIES = ['orders', 'riders', 'billing', 'sms', 'complaints', 'messages'];   // the owner never sees logins or settings lines

const SECRET_KEY = /phone|mobile|otp|token|secret|^pin$|address|email|password|authorization/i;
const PHONE_IN_TEXT = /(?<!\d)[6-9]\d{9}(?!\d)/g;

function scrub(v, depth = 0) {
    if (v === null || v === undefined) return undefined;
    if (v instanceof Date) return v;
    if (v._bsontype) return String(v);
    if (typeof v === 'string') return v.replace(PHONE_IN_TEXT, '[phone]').slice(0, 200);
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v !== 'object' || depth >= 3) return undefined;
    if (Array.isArray(v)) return v.slice(0, 20).map((x) => scrub(x, depth + 1)).filter((x) => x !== undefined);
    const out = {};
    for (const [k, val] of Object.entries(v)) {
        if (SECRET_KEY.test(k)) continue;
        const c = scrub(val, depth + 1);
        if (c !== undefined) out[k] = c;
    }
    return out;
}

const wire = (e) => ({ id: String(e._id), at: e.at, tenantId: String(e.tenantId), category: e.category, type: e.type, data: e.data });

function emit(tenantId, category, payload = {}) {
    try {
        if (!tenantId || !CATEGORIES.includes(category)) return null;
        const { type, ...rest } = payload || {};
        const event = {
            _id: new mongoose.Types.ObjectId(),
            at: new Date(),
            tenantId,
            category,
            type: String(type || category).slice(0, 40),
            data: scrub(rest) || {},
        };
        realtime.toAdmin(tenantId, 'feed:event', wire(event));
        FeedEvent.create(event).catch((e) => console.error('Feed save error:', e.message));
        return event;
    } catch (e) {
        console.error('Feed error:', e.message);
        return null;
    }
}

// the newest lines of one shop. The owner gets fewer categories.
async function recent(tenantId, { owner = false, limit = 50 } = {}) {
    const filter = { tenantId };
    if (owner) filter.category = { $in: OWNER_CATEGORIES };
    const rows = await FeedEvent.find(filter).sort({ at: -1, _id: -1 }).limit(limit).lean();   // _id breaks a tie when two lines share the same millisecond
    return rows.map(wire);
}

module.exports = { emit, recent, scrub, CATEGORIES, OWNER_CATEGORIES };