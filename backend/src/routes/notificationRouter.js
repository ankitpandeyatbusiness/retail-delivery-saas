// Inbox routes. Two versions of the same routes:
//   mine -> /api/notifications            a customer or a rider reads his own messages
//   shop -> /api/shop/notifications       the owner side of one shop (also mounted for the superadmin)
//
//   GET  /                ?unread=true&page=1&limit=20   returns { items, unreadCount, page, hasMore }
//   POST /read-all
//   POST /:id/read
//   DELETE /              clear all (customer / rider inbox only)
const express = require('express');
const mongoose = require('mongoose');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const apiErrors = require('../middlewares/apiErrors');
const Notification = require('../models/Notification');
const User = require('../models/User');
const i18n = require('../notifications/i18n');
const DeviceToken = require('../models/DeviceToken');
const realtime = require('../services/realtime');
const webPush = require('../services/adapters/webPush');

const { wrap, httpError } = apiErrors;
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

// allowClear: DELETE / removes the person's whole inbox. Only for customers and riders (`mine`):
// the owner inbox is read by the escalation job, so the shop side is never cleared this way.
// tell(req, event, payload): says something to every device of whoever is reading this inbox (one person, or the owner side of the shop), so a message
// read or cleared on one phone or browser shows as read on the others at once ('notification:read': { ids } or { all: true }, and unread = what is left).
function inbox(rawFilterOf, { allowClear = false, softClear = false, tell = () => { } } = {}) {
    const r = express.Router();
    // softClear (the owner side): cleared messages are hidden from every list and count
    const filterOf = softClear ? (req) => ({ ...rawFilterOf(req), clearedAt: null }) : rawFilterOf;

    r.get('/', wrap(async (req, res) => {
        const page = clamp(parseInt(req.query.page, 10) || 1, 1, 1000);
        const limit = clamp(parseInt(req.query.limit, 10) || 20, 1, 50);
        const filter = filterOf(req);
        const q = req.query.unread === 'true' ? { ...filter, readAt: null } : filter;

        const [items, unreadCount] = await Promise.all([
            Notification.find(q).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit + 1).lean(),
            Notification.countDocuments({ ...filter, readAt: null }),
        ]);
        const hasMore = items.length > limit;
        if (hasMore) items.pop();
        // the inbox reads in the person's own language, like the push that told him (the texts are saved in English)
        const lang = (await User.findById(req.auth?.userId).select('language').lean().catch(() => null))?.language || 'en';
        res.json({
            items: items.map((n) => ({
                id: n._id, type: n.type, title: i18n.translate(n.title, lang), body: n.body ? i18n.translate(n.body, lang) : null,
                data: n.data || null, read: !!n.readAt, createdAt: n.createdAt,
            })),
            unreadCount, page, hasMore,
        });
    }));

    r.post('/read-all', wrap(async (req, res) => {
        const out = await Notification.updateMany({ ...filterOf(req), readAt: null }, { $set: { readAt: new Date() } });
        tell(req, 'notification:read', { all: true, unread: 0 });
        res.json({ ok: true, marked: out.modifiedCount });
    }));

    r.post('/:id/read', wrap(async (req, res) => {
        if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, 'Message not found');
        const filter = { _id: req.params.id, ...filterOf(req) };
        if (!(await Notification.exists(filter))) throw httpError(404, 'Message not found');
        await Notification.updateOne({ ...filter, readAt: null }, { $set: { readAt: new Date() } });
        tell(req, 'notification:read', { ids: [String(req.params.id)], unread: await Notification.countDocuments({ ...filterOf(req), readAt: null }) });
        res.json({ ok: true });
    }));

    if (softClear) {
        // Clear all: hides the owner's messages (marks them read first, so no SMS is sent for them later)
        r.delete('/', wrap(async (req, res) => {
            const now = new Date();
            await Notification.updateMany({ ...filterOf(req), readAt: null }, { $set: { readAt: now } });
            const out = await Notification.updateMany(filterOf(req), { $set: { clearedAt: now } });
            tell(req, 'notification:read', { all: true, unread: 0, cleared: true });
            res.json({ ok: true, cleared: out.modifiedCount });
        }));
    }

    if (allowClear) {
        // Clear all: deletes every message of this person (filter is always tenant + user, never wider)
        r.delete('/', wrap(async (req, res) => {
            const out = await Notification.deleteMany(filterOf(req));
            tell(req, 'notification:read', { all: true, unread: 0, cleared: true });
            res.json({ ok: true, deleted: out.deletedCount });
        }));
    }

    return r;
}

const mine = express.Router();
mine.use((req, res, next) => { req.allowFrozenShop = true; next(); });   // messages stay readable if a shop is frozen
mine.use(tenantRecognizer);
mine.use(authenticate);
// Register this phone for push. The app calls it after login, and again when the push token changes.
// Body: { "token": "<fcm token>", "platform": "android", "loudAlerts": true }
//   loudAlerts (optional): false = the owner switched Soundbox off on this phone, so it gets no loud new-order sound
mine.post('/devices', wrap(async (req, res) => {
    const { token, platform, loudAlerts } = req.body || {};
    if (typeof token !== 'string' || token.length < 20 || token.length > 4096) throw httpError(400, 'Invalid device token');
    if (platform !== undefined && !['android', 'ios', 'web'].includes(platform)) throw httpError(400, 'Invalid platform');
    if (loudAlerts !== undefined && typeof loudAlerts !== 'boolean') throw httpError(400, 'loudAlerts must be true or false');

    const who = { tenantId: req.tenant._id, userId: req.auth.userId };
    await DeviceToken.findOneAndUpdate(
        { token },
        { $set: { ...who, ...(platform && { platform }), ...(loudAlerts !== undefined && { loudAlerts }), lastSeenAt: new Date() } },   // a phone moves to whoever logs in on it now
        { upsert: true },
    );
    // keep the newest 10 phones per person
    const extra = await DeviceToken.find(who).sort({ lastSeenAt: -1 }).skip(10).select('_id').lean();
    if (extra.length) await DeviceToken.deleteMany({ _id: { $in: extra.map((e) => e._id) } });
    res.status(201).json({ ok: true });
}));

// Call this on logout so the phone stops getting messages. Body: { "token": "<fcm token>" }
mine.post('/devices/remove', wrap(async (req, res) => {
    const token = req.body?.token;
    if (typeof token !== 'string') throw httpError(400, 'Invalid device token');
    await DeviceToken.deleteOne({ token, tenantId: req.tenant._id, userId: req.auth.userId });
    res.json({ ok: true });
}));

// ---- BROWSER push (the website; services/adapters/webPush.js). The switch is "Also notify me on this browser", off until the person turns it on. ----
//   GET  /web-push                { publicKey | null, enabled }   publicKey null = the server has no browser push set up: the website hides the switch
//   POST /web-push/subscribe      { subscription: { endpoint, keys: { p256dh, auth } } }   turns it on for this browser
//   POST /web-push/unsubscribe    { endpoint }                                              turns it off for this browser
// The phone app keeps priority: a person with a phone only gets the browser push while this is on; a person with no phone gets it once subscribed.
mine.get('/web-push', wrap(async (req, res) => {
    const me = await User.findOne({ _id: req.auth.userId, tenantId: req.tenant._id }).select('alsoWebPush').lean();
    res.json({ publicKey: webPush.publicKey(), enabled: !!(me && me.alsoWebPush) });
}));

mine.post('/web-push/subscribe', wrap(async (req, res) => {
    if (!webPush.configured()) throw httpError(409, 'Browser notifications are not set up yet');
    const sub = req.body && req.body.subscription;
    const endpoint = sub && sub.endpoint;
    const keys = sub && sub.keys;
    if (typeof endpoint !== 'string' || !endpoint.toLowerCase().startsWith('https://') || endpoint.length > 2000) throw httpError(400, 'Invalid subscription');
    if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' || keys.p256dh.length > 200 || keys.auth.length > 100) throw httpError(400, 'Invalid subscription');

    const who = { tenantId: req.tenant._id, userId: req.auth.userId };
    await DeviceToken.findOneAndUpdate(
        { token: endpoint },
        { $set: { ...who, platform: 'web', webKeys: { p256dh: keys.p256dh, auth: keys.auth }, lastSeenAt: new Date() } },   // a browser moves to whoever uses it now
        { upsert: true },
    );
    await User.updateOne({ _id: req.auth.userId, tenantId: req.tenant._id }, { $set: { alsoWebPush: true } });
    const extra = await DeviceToken.find(who).sort({ lastSeenAt: -1 }).skip(10).select('_id').lean();
    if (extra.length) await DeviceToken.deleteMany({ _id: { $in: extra.map((e) => e._id) } });
    res.status(201).json({ ok: true, enabled: true });
}));

mine.post('/web-push/unsubscribe', wrap(async (req, res) => {
    const endpoint = req.body && req.body.endpoint;
    if (typeof endpoint !== 'string') throw httpError(400, 'Invalid subscription');
    const who = { tenantId: req.tenant._id, userId: req.auth.userId };
    await DeviceToken.deleteOne({ token: endpoint, platform: 'web', ...who });
    // the last browser of this person is gone: the switch is off
    const left = await DeviceToken.exists({ ...who, platform: 'web' });
    if (!left) await User.updateOne({ _id: req.auth.userId, tenantId: req.tenant._id }, { $set: { alsoWebPush: false } });
    res.json({ ok: true, enabled: !!left });
}));

mine.use(inbox((req) => ({ tenantId: req.tenant._id, userId: req.auth.userId }), { allowClear: true, tell: (req, ev, p) => realtime.toUser(req.tenant._id, req.auth.userId, ev, p) }));
mine.use(apiErrors);

const shop = express.Router();
shop.use(inbox((req) => ({ tenantId: req.tenant._id, role: 'owner' }), { softClear: true, tell: (req, ev, p) => realtime.toOwner(req.tenant._id, ev, p) }));
shop.use(apiErrors);

module.exports = { mine, shop };