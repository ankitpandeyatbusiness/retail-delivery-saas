// Superadmin: send a message to the owners of all shops (or of chosen shops).
// Mounted inside adminRouter (after requireSuperAdmin):
//   POST /api/admin/messages      { title, body, tenantIds?: [shopId], sendEmail?: bool }   answers 202
//   GET  /api/admin/messages      the last 20
//   GET  /api/admin/messages/:id  progress
// (A message to ONE user still uses POST /tenants/:tid/notify.)
const express = require('express');
const mongoose = require('mongoose');
const apiErrors = require('../middlewares/apiErrors');
const Broadcast = require('../models/Broadcast');
const messages = require('../services/messageService');

const { wrap, httpError } = apiErrors;
const router = express.Router();

router.post('/messages', wrap(async (req, res) => {
    const b = await messages.startPlatform({ admin: req.admin, body: req.body });
    res.locals.auditAction = 'BROADCAST';
    res.locals.auditParams = { broadcastId: String(b._id), recipients: b.recipients, audience: b.audience };
    res.status(202).json(messages.view(b));
}));

router.get('/messages', wrap(async (req, res) => {
    res.json({ items: await messages.list({ senderType: 'superadmin', audience: 'owners' }) });
}));

router.get('/messages/:id', wrap(async (req, res) => {
    const b = mongoose.isValidObjectId(req.params.id)
        ? await Broadcast.findOne({ _id: req.params.id, senderType: 'superadmin', audience: 'owners' }).lean()
        : null;
    if (!b) throw httpError(404, 'Message not found');
    res.json(messages.view(b));
}));

router.use(apiErrors);
module.exports = router;