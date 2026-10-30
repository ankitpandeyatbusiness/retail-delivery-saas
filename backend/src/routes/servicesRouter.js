// What a customer sees and sends. Mounted at /api/services.
//   GET /                the shop's services that are switched on
//   GET /inquiries/mine  what this customer has sent
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
    res.status(201).json({ ok: true, id: doc._id });
}));

module.exports = router;
