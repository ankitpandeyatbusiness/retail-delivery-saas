// What a customer sees and sends. Mounted at /api/services.
//   GET /                the shop's services that are switched on
//   GET /inquiries/mine  what this customer has sent
//   GET /inquiries/:id   one inquiry with its conversation
//   POST /inquiries/:id/messages  { text }   write again to the shop
//   GET /:id             one service with its questions
//   POST /:id/inquiries  { name, phone, message?, answers? }
const express = require('express');
const mongoose = require('mongoose');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const apiErrors = require('../middlewares/apiErrors');
const ShopService = require('../models/ShopService');
const ServiceInquiry = require('../models/ServiceInquiry');
const User = require('../models/User');
const svc = require('../services/shopServices');

const { wrap, httpError } = apiErrors;
const router = express.Router();
router.use(tenantRecognizer);
router.use(authenticate);

const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const publicView = (s) => ({ ...s, questions: (s.questions || []).filter((q) => q.enabled), quickReplies: undefined });

router.get('/', wrap(async (req, res) => {
    const items = await ShopService.find({ tenantId: req.tenant._id, isActive: true }).sort({ sortOrder: 1, createdAt: 1 }).lean();
    res.json({ items: items.map(publicView) });
}));

router.get('/inquiries/mine', wrap(async (req, res) => {
    const items = await ServiceInquiry.find({ tenantId: req.tenant._id, userId: req.auth.userId }).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ items });
}));

const tell = (event, ctx) => Promise.resolve().then(() => require('../notifications/center').notify(event, ctx)).catch((e) => console.error('Notification error:', e.message));
const mineInquiry = async (req) => {
    if (!isId(req.params.id)) throw httpError(404, 'Inquiry not found');
    const doc = await ServiceInquiry.findOne({ _id: req.params.id, tenantId: req.tenant._id, userId: req.auth.userId });
    if (!doc) throw httpError(404, 'Inquiry not found');
    return doc;
};
router.get('/inquiries/:id', wrap(async (req, res) => {
    const doc = await mineInquiry(req);
    if (doc.customerUnread) { doc.customerUnread = 0; await doc.save(); }
    const o = doc.toObject(); delete o.note; delete o.ownerUnread;
    res.json(o);
}));
router.post('/inquiries/:id/messages', wrap(async (req, res) => {
    const doc = await mineInquiry(req);
    if (doc.status === 'closed') throw httpError(400, 'This inquiry is closed');
    const text = String(req.body?.text || '').trim().slice(0, 1000);
    if (!text) throw httpError(400, 'Write a message first');
    doc.messages.push({ from: 'customer', text });
    doc.ownerUnread += 1;
    doc.lastMessageAt = new Date();
    await doc.save();
    tell('inquiry_customer_reply', { tenantId: doc.tenantId, vars: { name: doc.name, service: doc.serviceName }, data: { kind: 'inquiry', inquiryId: String(doc._id) } });
    res.json({ ok: true });
}));

const live = async (req) => {
    if (!isId(req.params.id)) throw httpError(404, 'This service is not available');
    const s = await ShopService.findOne({ _id: req.params.id, tenantId: req.tenant._id, isActive: true }).lean();
    if (!s) throw httpError(404, 'This service is not available');
    return s;
};

router.get('/:id', wrap(async (req, res) => {
    const [s, user] = await Promise.all([live(req), User.findById(req.auth.userId).select('name phone').lean()]);
    res.json({ ...publicView(s), me: { name: user?.name || '', phone: user?.phone || '' } });
}));

router.post('/:id/inquiries', wrap(async (req, res) => {
    const s = await live(req);
    const body = req.body || {};
    const name = String(body.name || '').trim().slice(0, 80);
    const phone = String(body.phone || '').trim().slice(0, 20);
    if (!name) throw httpError(400, 'Please enter your name');
    if (!/^[0-9+\-\s]{6,20}$/.test(phone)) throw httpError(400, 'Please enter your phone number');
    const { answers, guests } = svc.checkAnswers(s, body.answers);
    if (s.minGuests && guests && guests < s.minGuests) throw httpError(400, `This service needs at least ${s.minGuests} guests`);
    // one waiting inquiry per service per customer at a time, so a double tap does not send two
    const dup = await ServiceInquiry.findOne({ tenantId: req.tenant._id, userId: req.auth.userId, serviceId: s._id, status: 'new', createdAt: { $gt: new Date(Date.now() - 60 * 1000) } }).lean();
    if (dup) return res.json({ ok: true, id: dup._id });
    const doc = await ServiceInquiry.create({
        tenantId: req.tenant._id, serviceId: s._id, serviceName: s.name, userId: req.auth.userId, name, phone,
        message: String(body.message || '').trim().slice(0, 1000), answers, estimate: svc.estimateFor(s, guests),
    });
    if (doc.message) doc.messages.push({ from: 'customer', text: doc.message });
    doc.ownerUnread = 1;
    await doc.save();
    tell('inquiry_new', { tenantId: req.tenant._id, vars: { service: s.name, name, guests: guests || 0 }, data: { kind: 'inquiry', inquiryId: String(doc._id) } });
    res.status(201).json({ ok: true, id: doc._id });
}));

router.use(apiErrors);   // the real message for an expected error ("that table was just taken"), not "Something went wrong"
module.exports = router;
