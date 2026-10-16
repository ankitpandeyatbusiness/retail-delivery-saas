// Terms, agreements and the privacy policy, in the admin app. Mounted inside adminRouter.
// Everybody with a superadmin login can READ every document. Only the supreme admin writes or sends them (middlewares/supremeAdmin.js).
//   GET  /legal/status                  call when the admin app opens: { required, key, version, title, body }
//   POST /legal/accept                  { key, version }
//   GET  /legal/mine                    documents you may read + the version you agreed to
//   GET  /legal/doc/:key                the current version of any document
//   PUT  /legal/roles/:adminId          (supreme) { legalRole: "partner" | "team" }  which agreement that superadmin gets
//   GET  /agreements                    all documents with how many agreed
//   GET  /agreements/:key               one: draft, current version, history, blanks still to fill
//   GET  /agreements/:key/versions/:no  an old version, in full
//   GET  /agreements/:key/acceptances   who agreed to the current version and who has not
//   PUT  /agreements/:key/draft         (supreme) { title, body }
//   POST /agreements/:key/send          (supreme) { summary, askWhen: "now" | "free_ends", allowBlanks }   "Send new version"
//   POST /agreements/handover/:tid      (supreme) { handedOver: true | false }   the shop's owner and riders are asked on their 2nd visit after this
const express = require('express');
const mongoose = require('mongoose');
const legal = require('../services/legal');
const LegalDocument = require('../models/LegalDocument');
const SuperAdmin = require('../models/SuperAdmin');
const { requireSupreme } = require('../middlewares/supremeAdmin');
const apiErrors = require('../middlewares/apiErrors');

const { wrap, httpError } = apiErrors;
const router = express.Router();
const by = (req) => req.admin.name || req.admin.email || 'Admin';
const must = (key) => { if (!legal.KEYS.includes(key)) throw httpError(404, 'Unknown document'); return key; };

router.get('/legal/status', wrap(async (req, res) => { res.json(await legal.status({ who: 'admin', userId: req.admin._id, admin: req.admin })); }));

router.post('/legal/accept', wrap(async (req, res) => {
    const { key, version } = req.body || {};
    res.json(await legal.accept({ who: 'admin', userId: req.admin._id, admin: req.admin, key, version, name: by(req), phone: req.admin.phones?.[0] }));
}));

router.get('/legal/mine', wrap(async (req, res) => { res.json({ items: await legal.mine({ who: 'admin', userId: req.admin._id, admin: req.admin }) }); }));

router.get('/legal/doc/:key', wrap(async (req, res) => {
    const d = await legal.readCurrent(must(req.params.key));
    if (!d) throw httpError(404, 'This document has not been sent yet');
    res.json(d);
}));

router.put('/legal/roles/:adminId', requireSupreme, wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.adminId)) throw httpError(404, 'Superadmin not found');
    if (!['partner', 'team'].includes(req.body?.legalRole)) throw httpError(400, 'legalRole must be "partner" or "team"');
    const a = await SuperAdmin.findByIdAndUpdate(req.params.adminId, { $set: { legalRole: req.body.legalRole } }, { returnDocument: 'after' }).select('name email legalRole').lean();
    if (!a) throw httpError(404, 'Superadmin not found');
    res.json({ id: a._id, name: a.name, legalRole: a.legalRole });
}));

router.get('/agreements', wrap(async (req, res) => { res.json({ items: await legal.list() }); }));
router.get('/agreements/:key', wrap(async (req, res) => { res.json(await legal.getFull(must(req.params.key))); }));
router.get('/agreements/:key/acceptances', wrap(async (req, res) => { res.json(await legal.acceptances(must(req.params.key))); }));
router.get('/agreements/:key/versions/:no', wrap(async (req, res) => {
    const doc = await LegalDocument.findOne({ key: must(req.params.key) }).lean();
    const v = doc?.versions.find((x) => x.no === Number(req.params.no));
    if (!v) throw httpError(404, 'Version not found');
    res.json(v);
}));

router.put('/agreements/:key/draft', wrap(async (req, res) => { res.json(await legal.saveDraft(must(req.params.key), req.body || {}, by(req))); }));
router.post('/agreements/:key/send', wrap(async (req, res) => { res.status(201).json(await legal.publish(must(req.params.key), req.body || {}, by(req))); }));
router.post('/agreements/handover/:tid', wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.tid)) throw httpError(404, 'Shop not found');
    res.json(await legal.markHandover(req.params.tid, req.body?.handedOver !== false, by(req)));
}));

router.use(apiErrors);
module.exports = router;
