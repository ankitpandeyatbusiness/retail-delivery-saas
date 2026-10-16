// Superadmin: the support inbox (requests from shop owners). Mounted in adminRouter after requireSuperAdmin.
//   GET   /api/admin/support?status=open|answered|resolved|all&q=&tenantId=&page=   -> { items, counts, page, hasMore }
//   GET   /api/admin/support/counts                  -> { open, answered, resolved, unread }   (for the badge)
//   GET   /api/admin/support/settings                -> the contact card owners see
//   PUT   /api/admin/support/settings                { phone?, whatsapp?, email?, hours?, replyPromise? }
//   GET   /api/admin/support/:id                     the conversation with private notes, the shop and the owner (marks it read)
//   POST  /api/admin/support/:id/reply               { message, photos?, resolve? }
//   POST  /api/admin/support/:id/note                { message }   private to the team
//   PATCH /api/admin/support/:id                     { status?, priority? }
const express = require('express');
const support = require('../services/supportService');
const apiErrors = require('../middlewares/apiErrors');

const { wrap } = apiErrors;
const router = express.Router();

router.get('/support/settings', wrap(async (req, res) => { res.json(await support.getInfo()); }));
router.put('/support/settings', wrap(async (req, res) => { res.json(await support.setInfo(req.body)); }));
router.get('/support/counts', wrap(async (req, res) => { res.json(await support.adminCounts()); }));

router.get('/support', wrap(async (req, res) => {
    res.json(await support.adminList({
        status: req.query.status, q: req.query.q, tenantId: req.query.tenantId,
        page: Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 500),
    }));
}));
router.get('/support/:id', wrap(async (req, res) => { res.json(await support.adminGet(req.params.id)); }));
router.post('/support/:id/reply', wrap(async (req, res) => { res.json(await support.adminReply({ id: req.params.id, body: req.body, admin: req.admin })); }));
router.post('/support/:id/note', wrap(async (req, res) => { res.json(await support.adminNote({ id: req.params.id, body: req.body, admin: req.admin })); }));
router.patch('/support/:id', wrap(async (req, res) => { res.json(await support.adminSet({ id: req.params.id, body: req.body })); }));

router.use(apiErrors);
module.exports = router;
