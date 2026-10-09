// Inbox routes. Two versions of the same routes:
//   mine -> /api/notifications            a customer or a rider reads his own messages
//   shop -> /api/shop/notifications       the owner side of one shop (also mounted for the superadmin)
//
//   GET  /                ?unread=true&page=1&limit=20   returns { items, unreadCount, page, hasMore }
//   POST /read-all
//   POST /:id/read
const express = require('express');
const mongoose = require('mongoose');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const apiErrors = require('../middlewares/apiErrors');
const Notification = require('../models/Notification');
const DeviceToken = require('../models/DeviceToken');

const { wrap, httpError } = apiErrors;
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

function inbox(filterOf) {
    const r = express.Router();

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
        res.json({
            items: items.map((n) => ({
                id: n._id, type: n.type, title: n.title, body: n.body || null,
                data: n.data || null, read: !!n.readAt, createdAt: n.createdAt,
            })),
            unreadCount, page, hasMore,
        });
    }));

    r.post('/read-all', wrap(async (req, res) => {
        const out = await Notification.updateMany({ ...filterOf(req), readAt: null }, { $set: { readAt: new Date() } });
        res.json({ ok: true, marked: out.modifiedCount });
    }));

    r.post('/:id/read', wrap(async (req, res) => {
        if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, 'Message not found');
        const filter = { _id: req.params.id, ...filterOf(req) };
        if (!(await Notification.exists(filter))) throw httpError(404, 'Message not found');
        await Notification.updateOne({ ...filter, readAt: null }, { $set: { readAt: new Date() } });
        res.json({ ok: true });
    }));

    return r;
}

const mine = express.Router();
mine.use((req, res, next) => { req.allowFrozenShop = true; next(); });   // messages stay readable if a shop is frozen
mine.use(tenantRecognizer);
mine.use(authenticate);
// Register this phone for push. The app calls it after login, and again when the push token changes.
// Body: { "token": "<fcm token>", "platform": "android" }
mine.post('/devices', wrap(async (req, res) => {
    const { token, platform } = req.body || {};
    if (typeof token !== 'string' || token.length < 20 || token.length > 4096) throw httpError(400, 'Invalid device token');
    if (platform !== undefined && !['android', 'ios', 'web'].includes(platform)) throw httpError(400, 'Invalid platform');

    const who = { tenantId: req.tenant._id, userId: req.auth.userId };
    await DeviceToken.findOneAndUpdate(
        { token },
        { $set: { ...who, ...(platform && { platform }), lastSeenAt: new Date() } },   // a phone moves to whoever logs in on it now
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

mine.use(inbox((req) => ({ tenantId: req.tenant._id, userId: req.auth.userId })));
mine.use(apiErrors);

const shop = express.Router();
shop.use(inbox((req) => ({ tenantId: req.tenant._id, role: 'owner' })));
shop.use(apiErrors);

module.exports = { mine, shop };