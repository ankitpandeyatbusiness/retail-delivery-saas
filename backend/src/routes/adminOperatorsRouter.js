// The companies that run the platform, and the "Switch operator" button. Mounted inside adminRouter.
// Everybody with a superadmin login can look; only the supreme admin changes anything (middlewares/supremeAdmin.js, path /operators).
//   GET    /operators                      the companies, which one is active, the last switches
//   GET    /operators/checklist?to=<id>    what to check before switching to that company
//   POST   /operators/from-live            { label }  save the company that is live now as a profile (do this first)
//   POST   /operators                      { label, business, settlementMode, notes }
//   PUT    /operators/:id                  { label, business, settlementMode, notes }   (the invoice prefix locks once bills use it)
//   PUT    /operators/:id/keys             { keyId, keySecret, webhookSecret? }   write only; never returned
//   DELETE /operators/:id                  (not the active one)
//   POST   /operators/:id/switch           { note, notify }   make it the active company; notify = tell every shop
const express = require('express');
const operators = require('../services/operators');
const messageService = require('../services/messageService');
const apiErrors = require('../middlewares/apiErrors');

const { wrap } = apiErrors;
const router = express.Router();
const by = (req) => req.admin.name || req.admin.email || 'Admin';

router.get('/operators', wrap(async (req, res) => { res.json(await operators.list()); }));
router.get('/operators/checklist', wrap(async (req, res) => { res.json(await operators.checklist(req.query.to)); }));
router.post('/operators/from-live', wrap(async (req, res) => { res.status(201).json(await operators.saveLive(req.body?.label, by(req))); }));
router.post('/operators', wrap(async (req, res) => { res.status(201).json(await operators.create(req.body || {}, by(req))); }));
router.put('/operators/:id', wrap(async (req, res) => { res.json(await operators.update(req.params.id, req.body || {})); }));
router.put('/operators/:id/keys', wrap(async (req, res) => {
    const body = req.body || {};
    const safe = { keyId: body.keyId, keySecret: body.keySecret, webhookSecret: body.webhookSecret };
    if (req.body) { delete req.body.keySecret; delete req.body.webhookSecret; }   // the activity log must never see a secret
    res.json(await operators.setKeys(req.params.id, safe));
}));
router.delete('/operators/:id', wrap(async (req, res) => { res.json(await operators.remove(req.params.id)); }));
router.post('/operators/:id/switch', wrap(async (req, res) => {
    const body = req.body || {};
    const out = await operators.switchTo(req.params.id, { note: body.note, notify: body.notify !== false }, req.admin,
        (msg) => messageService.startPlatform({ admin: req.admin, body: { ...msg, kind: 'info', sendEmail: true } }));
    res.json(out);
}));

router.use(apiErrors);
module.exports = router;
