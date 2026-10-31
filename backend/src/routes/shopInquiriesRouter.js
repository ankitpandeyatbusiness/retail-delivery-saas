// The owner's Inquiries: what customers sent from the service forms, and the conversation with each. Mounted under /api/shop/inquiries.
//   GET /?status=new|replied|quoted|confirmed|rejected|closed|all   { items, counts, unread }
//   GET /:id            one inquiry with the whole conversation (opening it marks the customer's messages as read)
//   POST /:id/reply     { text, status? }   answer the customer (a push goes to him)
//   PATCH /:id          { status?, note? }
const express = require('express');
const mongoose = require('mongoose');
const apiErrors = require('../middlewares/apiErrors');
const ServiceInquiry = require('../models/ServiceInquiry');
const ShopService = require('../models/ShopService');

const { wrap, httpError } = apiErrors;
const router = express.Router();
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const STATUSES = ['new', 'replied', 'quoted', 'confirmed', 'rejected', 'closed'];
const tell = (event, ctx) => Promise.resolve().then(() => require('../notifications/center').notify(event, ctx)).catch((e) => console.error('Notification error:', e.message));

const mine = async (req) => {
    if (!isId(req.params.id)) throw httpError(404, 'Inquiry not found');
    const doc = await ServiceInquiry.findOne({ _id: req.params.id, tenantId: req.tenant._id });
    if (!doc) throw httpError(404, 'Inquiry not found');
    return doc;
};

router.get('/', wrap(async (req, res) => {
    const tenantId = req.tenant._id;
    const status = String(req.query.status || 'all');
    const where = { tenantId, ...(STATUSES.includes(status) ? { status } : {}) };
    const [items, byStatus, unread] = await Promise.all([
        ServiceInquiry.find(where).select('-answers -note').sort({ lastMessageAt: -1 }).limit(100).lean(),
        ServiceInquiry.aggregate([{ $match: { tenantId } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
        ServiceInquiry.countDocuments({ tenantId, ownerUnread: { $gt: 0 } }),
    ]);
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const r of byStatus) counts[r._id] = r.n;
    res.json({ items, counts, unread });
}));

router.get('/:id', wrap(async (req, res) => {
    const doc = await mine(req);
    if (doc.ownerUnread) { doc.ownerUnread = 0; await doc.save(); }
    const service = await ShopService.findById(doc.serviceId).select('quickReplies').lean();
    res.json({ ...doc.toObject(), quickReplies: service?.quickReplies || [] });
}));

router.post('/:id/reply', wrap(async (req, res) => {
    const doc = await mine(req);
    const text = String(req.body?.text || '').trim().slice(0, 1000);
    const images = require('../services/shopServices').cleanImages(req.body?.images);
    if (!text && !images.length) throw httpError(400, 'Write a reply first');
    const status = req.body?.status;
    if (status !== undefined && !STATUSES.includes(status)) throw httpError(400, 'Unknown status');
    doc.messages.push({ from: 'owner', text, ...(images.length ? { images } : {}) });
    doc.customerUnread += 1;
    doc.lastMessageAt = new Date();
    doc.status = status || (doc.status === 'new' ? 'replied' : doc.status);
    await doc.save();
    tell('inquiry_reply', { tenantId: doc.tenantId, userId: doc.userId, vars: { shop: req.tenant.name, service: doc.serviceName, text: (text || 'Sent a photo').slice(0, 140) }, data: { kind: 'inquiry', inquiryId: String(doc._id) } });
    res.json(doc.toObject());
}));

router.patch('/:id', wrap(async (req, res) => {
    const doc = await mine(req);
    const b = req.body || {};
    const before = doc.status;
    if (b.status !== undefined) { if (!STATUSES.includes(b.status)) throw httpError(400, 'Unknown status'); doc.status = b.status; }
    if (b.note !== undefined) doc.note = String(b.note).trim().slice(0, 1000);
    await doc.save();
    // the guest's screens load again (the conversation may have been ended or opened again)
    if (doc.status !== before) require('../services/realtime').toUser(doc.tenantId, doc.userId, 'notification', { id: 'ic' + Date.now(), type: 'inquiry_changed', title: null, body: null, data: { kind: 'inquiry', inquiryId: String(doc._id) } });
    res.json(doc.toObject());
}));

module.exports = router;
