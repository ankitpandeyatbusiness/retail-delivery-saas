// The owner's services: bulk order, tiffin, party booking, or anything he makes up. Mounted under /api/shop/services.
//   GET /templates   GET /   POST /  { kind?, name?, ... }   GET /:id   PATCH /:id   DELETE /:id
//   POST /reorder { ids }   POST /:id/recommended (put our recommended questions back)
//   POST /:id/copy-question { questionId, toServiceId }
const express = require('express');
const mongoose = require('mongoose');
const apiErrors = require('../middlewares/apiErrors');
const ShopService = require('../models/ShopService');
const svc = require('../services/shopServices');

const { wrap, httpError } = apiErrors;
const router = express.Router();
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);

const mine = async (req) => {
    if (!isId(req.params.id)) throw httpError(404, 'Service not found');
    const doc = await ShopService.findOne({ _id: req.params.id, tenantId: req.tenant._id });
    if (!doc) throw httpError(404, 'Service not found');
    return doc;
};

router.get('/templates', wrap(async (req, res) => { res.json({ items: svc.templateList(await svc.loadDefaults()), types: svc.TYPES }); }));

// a starter service as it would be made, without saving it: the owner saves it from the editor
router.get('/new/:kind', wrap(async (req, res) => { res.json(svc.newDoc(req.params.kind, await svc.loadDefaults())); }));

router.get('/', wrap(async (req, res) => {
    const items = await ShopService.find({ tenantId: req.tenant._id }).sort({ sortOrder: 1, createdAt: 1 }).lean();
    res.json({ items });
}));

router.post('/', wrap(async (req, res) => {
    const body = req.body || {};
    const base = svc.newDoc(body.kind, await svc.loadDefaults());
    const edits = svc.cleanService({ ...body, name: body.name || base.name || 'My service' }, { partial: true });
    const last = await ShopService.findOne({ tenantId: req.tenant._id }).sort({ sortOrder: -1 }).select('sortOrder').lean();
    const doc = await ShopService.create({ ...base, ...edits, tenantId: req.tenant._id, sortOrder: (last?.sortOrder ?? -1) + 1 });
    res.status(201).json(doc.toObject());
}));

router.get('/:id', wrap(async (req, res) => { res.json((await mine(req)).toObject()); }));

router.patch('/:id', wrap(async (req, res) => {
    const doc = await mine(req);
    doc.set(svc.cleanService(req.body || {}, { partial: true }));
    await doc.save();
    res.json(doc.toObject());
}));

router.delete('/:id', wrap(async (req, res) => {
    const doc = await mine(req);
    await doc.deleteOne();
    res.json({ ok: true });
}));

router.post('/reorder', wrap(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(isId) : [];
    await ShopService.bulkWrite(ids.map((id, i) => ({ updateOne: { filter: { _id: id, tenantId: req.tenant._id }, update: { $set: { sortOrder: i } } } })));
    res.json({ ok: true });
}));

// "Use recommended settings": our questions for this kind come back and the owner's own questions stay where they are.
router.post('/:id/recommended', wrap(async (req, res) => {
    const doc = await mine(req);
    const ours = svc.recommendedFor(doc.kind, await svc.loadDefaults());
    const own = doc.questions.filter((q) => !q.recommended).map((q) => q.toObject());
    doc.questions = svc.cleanQuestions([...ours, ...own]);
    await doc.save();
    res.json(doc.toObject());
}));

router.post('/:id/copy-question', wrap(async (req, res) => {
    const from = await mine(req);
    const { questionId, toServiceId } = req.body || {};
    const q = from.questions.find((x) => x.id === questionId);
    if (!q) throw httpError(404, 'Question not found');
    if (!isId(String(toServiceId))) throw httpError(404, 'Service not found');
    const to = await ShopService.findOne({ _id: toServiceId, tenantId: req.tenant._id });
    if (!to) throw httpError(404, 'Service not found');
    to.questions = svc.cleanQuestions([...to.questions.map((x) => x.toObject()), { ...q.toObject(), id: '', recommended: false }]);
    await to.save();
    res.json(to.toObject());
}));

module.exports = router;
