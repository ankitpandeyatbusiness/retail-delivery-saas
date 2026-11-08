// The terms, privacy policies and About Us texts, edited in the superadmin app. Mounted inside adminRouter (after requireSuperAdmin).
// Everybody who is a superadmin can read; only the supreme admin changes anything. Publishing shows the text in every app and web page at once.
//
//   GET    /api/admin/legal-pages                      every document: { key, title, audience, currentNo, publishedAt, publishedBy, hasDraft, versions }
//   GET    /api/admin/legal-pages/:key                 one: draft (starts as what is shown now), current, history, the {{names}} that can be used, blanks, preview
//   GET    /api/admin/legal-pages/:key/versions/:no    an old text
//   PUT    /api/admin/legal-pages/:key/draft           (supreme) { title?, body }   save the draft
//   POST   /api/admin/legal-pages/:key/discard         (supreme) throw the draft away
//   POST   /api/admin/legal-pages/:key/publish         (supreme) the draft becomes the text everybody sees
//   POST   /api/admin/legal-pages/:key/restore/:no     (supreme) an old version becomes the draft (then publish it)
const express = require('express');
const legal = require('../services/legal');
const { requireSupreme } = require('../middlewares/supremeAdmin');
const { wrap } = require('../middlewares/apiErrors');

const router = express.Router();
const by = (req) => String(req.admin?.name || req.admin?.email || req.admin?._id || 'admin').slice(0, 120);

router.get('/legal-pages', wrap(async (req, res) => { res.json({ items: await legal.list() }); }));
router.get('/legal-pages/:key', wrap(async (req, res) => { res.json(await legal.getFull(req.params.key)); }));
router.get('/legal-pages/:key/versions/:no', wrap(async (req, res) => { res.json(await legal.version(req.params.key, req.params.no)); }));

router.put('/legal-pages/:key/draft', requireSupreme, wrap(async (req, res) => { res.json(await legal.saveDraft(req.params.key, req.body || {}, by(req))); }));
router.post('/legal-pages/:key/discard', requireSupreme, wrap(async (req, res) => { res.json(await legal.discardDraft(req.params.key)); }));
router.post('/legal-pages/:key/publish', requireSupreme, wrap(async (req, res) => { res.status(201).json(await legal.publish(req.params.key, by(req))); }));
router.post('/legal-pages/:key/restore/:no', requireSupreme, wrap(async (req, res) => { res.json(await legal.restore(req.params.key, req.params.no, by(req))); }));

module.exports = router;
