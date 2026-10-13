// Owner: send a message to his customers and riders. Mounted at /api/shop/messages (and through the superadmin shop mount).
//   POST /        { title, body, kind?: "info"|"promo", audience?: "customers"|"riders"|"both", sendEmail?: bool }
//                 answers 202; the sending runs in the background. 5 per day. Never by SMS.
//   GET  /        the last 20 broadcasts of this shop
//   GET  /:id     one broadcast with its progress (status, sent, failed)
const express = require('express');
const mongoose = require('mongoose');
const apiErrors = require('../middlewares/apiErrors');
const Broadcast = require('../models/Broadcast');
const messages = require('../services/messageService');

const { wrap, httpError } = apiErrors;
const router = express.Router();
const actorOf = (req) => req.actor || { type: 'owner', id: req.auth.userId, label: req.shopUser?.phone || 'shop owner' };

router.post('/', wrap(async (req, res) => {
    const b = await messages.startShop({ tenant: req.tenant, actor: actorOf(req), body: req.body });
    res.locals.auditAction = 'BROADCAST';   // one audit row per broadcast
    res.locals.auditParams = { broadcastId: String(b._id), recipients: b.recipients, audience: b.audience, kind: b.kind };
    res.status(202).json(messages.view(b));
}));

router.get('/', wrap(async (req, res) => {
    res.json({ items: await messages.list({ tenantId: req.tenant._id }) });
}));

router.get('/:id', wrap(async (req, res) => {
    const b = mongoose.isValidObjectId(req.params.id)
        ? await Broadcast.findOne({ _id: req.params.id, tenantId: req.tenant._id }).lean()
        : null;
    if (!b) throw httpError(404, 'Message not found');
    res.json(messages.view(b));
}));

router.use(apiErrors);
module.exports = router;