// A shop owner's view of THEIR OWN rent invoices. Mounted in shopRouter BEFORE the normal owner check,
// using requireShopAdmin.allowBlocked, so an owner who is blocked can still see and download what they owe.
//
//   GET /api/shop/subscription/invoices          ?status=paid|pending  ?page=1   (also returns what is due)
//   GET /api/shop/subscription/invoices/:id/pdf  (?view=1 opens it in the browser)

const express = require('express');
const mongoose = require('mongoose');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const { withOverdue } = require('../services/subscriptionService');
const { streamSubscriptionInvoice } = require('../services/subscriptionInvoicePdf');
const { wrap, httpError } = require('../middlewares/apiErrors');

const router = express.Router();
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

// the shop always comes from the logged-in owner's token, never from the request
router.get('/invoices', wrap(async (req, res) => {
    const page = clamp(parseInt(req.query.page, 10) || 1, 1, 1000);
    const limit = clamp(parseInt(req.query.limit, 10) || 20, 1, 50);
    const filter = { tenantId: req.tenant._id };
    if (req.query.status === 'paid' || req.query.status === 'pending') filter.status = req.query.status;

    const [items, owed] = await Promise.all([
        SubscriptionInvoice.find(filter).sort({ issueDate: -1, _id: -1 }).skip((page - 1) * limit).limit(limit + 1).lean(),
        SubscriptionInvoice.aggregate([
            { $match: { tenantId: req.tenant._id, status: 'pending' } },
            { $group: { _id: null, amount: { $sum: '$total' }, count: { $sum: 1 } } },
        ]),
    ]);
    const hasMore = items.length > limit;
    if (hasMore) items.pop();

    res.json({
        // internal fields (who marked it, private note) are not shown to the shop
        items: items.map(({ markedBy, note, ...inv }) => withOverdue(inv)),
        due: { amount: owed[0]?.amount || 0, count: owed[0]?.count || 0 },
        page,
        hasMore,
    });
}));

router.get('/invoices/:id/pdf', wrap(async (req, res) => {
    const inv = isId(req.params.id)
        ? await SubscriptionInvoice.findOne({ _id: req.params.id, tenantId: req.tenant._id }).lean()
        : null;
    if (!inv) throw httpError(404, 'Invoice not found');
    streamSubscriptionInvoice(res, inv, { inline: req.query.view === '1' });
}));

module.exports = router;