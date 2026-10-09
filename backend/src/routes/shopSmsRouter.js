// Owner view of the SMS wallet. Reads req.tenant, so it is also mounted for the superadmin.
//   GET  /wallet
//   GET  /transactions?type=topup&page=1&limit=20
//   GET  /topup/options        packs and min/max
//   POST /topup                { amountPaise } -> QR
//   GET  /topups               last 10 top-ups

const express = require('express');
const apiErrors = require('../middlewares/apiErrors');
const wallet = require('../services/smsWalletService');
const topups = require('../services/smsTopupService');
const SmsTransaction = require('../models/SmsTransaction');
const SmsTopup = require('../models/SmsTopup');

const { wrap, httpError } = apiErrors;
const router = express.Router();
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const actorOf = (req) => req.actor || { type: 'owner', id: String(req.auth?.userId || ''), label: req.shopUser?.phone || 'shop owner' };

router.get('/wallet', wrap(async (req, res) => {
    res.json(await wallet.status(req.tenant._id));
}));

router.get('/transactions', wrap(async (req, res) => {
    const page = clamp(parseInt(req.query.page, 10) || 1, 1, 1000);
    const limit = clamp(parseInt(req.query.limit, 10) || 20, 1, 50);
    const filter = { tenantId: req.tenant._id };
    if (req.query.type !== undefined) {
        if (!['topup', 'debit', 'refund', 'adjust'].includes(req.query.type)) throw httpError(400, 'Unknown type');
        filter.type = req.query.type;
    }
    const items = await SmsTransaction.find(filter)
        .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit + 1)
        .select('type amountPaise balanceAfter purpose note createdAt').lean();
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    res.json({ items, page, hasMore });
}));

router.get('/topup/options', wrap(async (req, res) => {
    res.json(await topups.options());
}));

router.post('/topup', wrap(async (req, res) => {
    const t = await topups.create({
        tenantId: req.tenant._id,
        amountPaise: req.body?.amountPaise,
        actor: actorOf(req),
    });
    res.status(201).json({
        id: t._id, amountPaise: t.amountPaise, status: 'pending',
        upiString: t.upiString, imageUrl: t.imageUrl, expiresAt: t.expiresAt,
    });
}));

router.get('/topups', wrap(async (req, res) => {
    const items = await SmsTopup.find({ tenantId: req.tenant._id })
        .sort({ createdAt: -1 }).limit(10)
        .select('amountPaise status expiresAt paidAt createdAt').lean();
    res.json({ items: items.map((t) => topups.view(t)) });
}));

router.use(apiErrors);
module.exports = router;