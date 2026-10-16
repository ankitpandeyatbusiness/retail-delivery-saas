// A shop owner's view of THEIR OWN rent invoices. Mounted in shopRouter BEFORE the normal owner check,
// using requireShopAdmin.allowBlocked, so an owner who is blocked can still see and download what they owe.
//
//   GET /api/shop/subscription/invoices          ?status=paid|pending  ?page=1   (also returns what is due)
//   POST /api/shop/subscription/invoices/:id/pay  -> { upiString, imageUrl, amountPaise, expiresAt }  pay a pending bill by UPI QR
//   GET /api/shop/subscription/invoices/:id/pdf  (?view=1 opens it in the browser)

const express = require('express');
const mongoose = require('mongoose');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const { withOverdue } = require('../services/subscriptionService');
const { streamSubscriptionInvoice } = require('../services/subscriptionInvoicePdf');
const CreditNote = require('../models/CreditNote');
const rentPayments = require('../services/rentPaymentService');
const platformCheckout = require('../services/platformCheckout');
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

// Pay this bill online: returns a UPI QR (the same one again while it is still open).
// Works while the shop is paused, because this router is mounted with allowBlocked.
router.post('/invoices/:id/pay', wrap(async (req, res) => {
    const qr = await rentPayments.createQr({ tenantId: req.tenant._id, invoiceId: req.params.id });
    res.status(201).json(qr);
}));

// Pay this bill with a UPI app or a card (Razorpay checkout in the app), the way a customer pays an order.
//   POST /invoices/:id/pay/start   -> { keyId, rzpOrderId, amountPaise, currency, description }
//   POST /invoices/:id/pay/verify  { razorpay_order_id, razorpay_payment_id, razorpay_signature } -> { paid }
router.post('/invoices/:id/pay/start', wrap(async (req, res) => {
    res.status(201).json(await platformCheckout.startRent({ tenantId: req.tenant._id, invoiceId: req.params.id }));
}));
router.post('/invoices/:id/pay/verify', wrap(async (req, res) => {
    res.json(await platformCheckout.verifyRent({ tenantId: req.tenant._id, invoiceId: req.params.id, proof: req.body }));
}));

router.get('/invoices/:id/pdf', wrap(async (req, res) => {
    const inv = isId(req.params.id)
        ? await SubscriptionInvoice.findOne({ _id: req.params.id, tenantId: req.tenant._id }).lean()
        : null;
    if (!inv) throw httpError(404, 'Invoice not found');
    streamSubscriptionInvoice(res, inv, { inline: req.query.view === '1' });
}));

// a credit note the platform issued to this shop when a bill was cancelled
router.get('/credit-notes/:id/pdf', wrap(async (req, res) => {
    const note = isId(req.params.id) ? await CreditNote.findOne({ _id: req.params.id, tenantId: req.tenant._id }).lean() : null;
    if (!note) throw httpError(404, 'Credit note not found');
    streamSubscriptionInvoice(res, note, { inline: req.query.view === '1', creditNote: true });
}));

module.exports = router;