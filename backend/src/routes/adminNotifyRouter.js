// Superadmin messages and inbox.
//   POST /tenants/:tid/notify                    { title, body?, channel?: "app", userId? }  message to the owner (or one user)
//   POST /subscriptions/invoices/:id/resend      send the bill notice again
//   GET  /notifications                          superadmin inbox (late-order alerts) ?unread=true&page=1&limit=20
//   POST /notifications/read-all
//   POST /notifications/:id/read
// Mounted inside adminRouter, so login and the audit log already ran.
const express = require('express');
const mongoose = require('mongoose');
const loadTenant = require('../middlewares/loadTenant');
const apiErrors = require('../middlewares/apiErrors');
const notify = require('../services/notificationService');
const Notification = require('../models/Notification');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const User = require('../models/User');

const { wrap, httpError } = apiErrors;
const router = express.Router();
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const day = (d) => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });

router.post('/tenants/:tid/notify', loadTenant, wrap(async (req, res) => {
    const { channel = 'app', userId } = req.body || {};
    if (channel === 'sms') throw httpError(409, 'SMS messages need the SMS provider (DLT). Not available yet.');
    if (channel !== 'app') throw httpError(400, 'channel must be "app"');

    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!title || title.length > 120) throw httpError(400, 'Title is needed (up to 120 characters)');
    if (body.length > 300) throw httpError(400, 'Message can be up to 300 characters');

    const tenantId = req.tenantDoc._id;
    if (userId !== undefined) {
        if (!isId(userId) || !(await User.exists({ _id: userId, tenantId }))) throw httpError(404, 'User not found in this shop');
    }
    const p = { type: 'platform_message', title, body: body || undefined, data: { from: 'platform' } };
    const doc = userId ? await notify.toUser(tenantId, userId, p) : await notify.toOwner(tenantId, p);
    if (!doc) throw httpError(500, 'Could not send the message');
    res.status(201).json({ ok: true, id: doc._id, to: userId ? 'user' : 'owner' });
}));

router.post('/subscriptions/invoices/:id/resend', wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Invoice not found');
    const inv = await SubscriptionInvoice.findById(req.params.id).select('tenantId invoiceNo total status graceEndsAt dueDate').lean();
    if (!inv) throw httpError(404, 'Invoice not found');
    if (inv.status !== 'pending') throw httpError(409, 'Only an unpaid invoice can be sent again');

    const paused = inv.graceEndsAt && new Date(inv.graceEndsAt) <= new Date();
    const doc = await notify.toOwner(inv.tenantId, {
        type: paused ? 'shop_paused' : 'bill_issued',
        title: paused ? 'Your shop is paused' : 'Bill notice',
        body: paused
            ? `Invoice ${inv.invoiceNo} (Rs ${inv.total}) is unpaid, so new orders are stopped. Pay now to start again.`
            : `Invoice ${inv.invoiceNo}: Rs ${inv.total}. Please pay by ${day(inv.graceEndsAt || inv.dueDate)} to keep taking orders.`,
        data: { invoiceId: String(inv._id), prompt: 'bill' },
    });
    if (!doc) throw httpError(500, 'Could not send the notice');
    await SubscriptionInvoice.updateOne({ _id: inv._id }, { $set: { notifiedAt: new Date() } });
    res.json({ ok: true });
}));

/* ------------------------------ superadmin inbox ------------------------------ */
router.get('/notifications', wrap(async (req, res) => {
    const page = clamp(parseInt(req.query.page, 10) || 1, 1, 1000);
    const limit = clamp(parseInt(req.query.limit, 10) || 20, 1, 50);
    const base = { role: 'superadmin' };
    const filter = req.query.unread === 'true' ? { ...base, readAt: null } : base;

    const [items, unreadCount] = await Promise.all([
        Notification.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit + 1)
            .populate('tenantId', 'name slug').lean(),
        Notification.countDocuments({ ...base, readAt: null }),
    ]);
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    res.json({
        items: items.map((n) => ({
            id: n._id, type: n.type, title: n.title, body: n.body || null, data: n.data || null,
            read: !!n.readAt, createdAt: n.createdAt,
            shop: n.tenantId ? { id: n.tenantId._id, name: n.tenantId.name, slug: n.tenantId.slug } : null,
        })),
        unreadCount, page, hasMore,
    });
}));

router.post('/notifications/read-all', wrap(async (req, res) => {
    const out = await Notification.updateMany({ role: 'superadmin', readAt: null }, { $set: { readAt: new Date() } });
    res.json({ ok: true, marked: out.modifiedCount });
}));

router.post('/notifications/:id/read', wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Message not found');
    const filter = { _id: req.params.id, role: 'superadmin' };
    if (!(await Notification.exists(filter))) throw httpError(404, 'Message not found');
    await Notification.updateOne({ ...filter, readAt: null }, { $set: { readAt: new Date() } });
    res.json({ ok: true });
}));

router.use(apiErrors);
module.exports = router;