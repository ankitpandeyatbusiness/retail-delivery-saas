// Superadmin: "I handled this by hand" marks for the Needs attention lists of the Money and Orders tabs. Mounted under /api/admin.
//   POST /handled            { kind, refId, note?, title? }   mark one item (it leaves the list)
//   POST /handled/:id/undo   take it back, in the first 10 minutes only
//   GET  /handled?scope=money|orders&kind=   the open marks, newest first
const express = require('express');
const handled = require('../services/handledMarks');
const { wrap } = require('../middlewares/apiErrors');

const router = express.Router();
const who = (req) => req.admin?.name || req.admin?.email || '';

router.post('/handled', wrap(async (req, res) => {
    const m = await handled.mark({ kind: req.body?.kind, refId: req.body?.refId, note: req.body?.note, title: req.body?.title, by: who(req) });
    res.status(201).json(handled.view(m));
}));
router.post('/handled/:id/undo', wrap(async (req, res) => {
    res.json({ ...handled.view(await handled.undo({ id: req.params.id, by: who(req) })), undone: true });
}));
router.get('/handled', wrap(async (req, res) => {
    const scope = ['money', 'orders'].includes(req.query.scope) ? req.query.scope : undefined;
    res.json({ items: await handled.list({ scope, kind: typeof req.query.kind === 'string' ? req.query.kind : undefined }) });
}));

module.exports = router;
