// Superadmin: the monthly app-rent invoices you send to shops.
// Mounted inside adminRouter (after requireSuperAdmin), so the URLs are:
//
//   GET   /api/admin/subscriptions/invoices        ?tenantId=  ?period=2026-10  ?status=paid|pending|overdue  ?page=1
//   GET   /api/admin/subscriptions/invoices/:id
//   GET   /api/admin/subscriptions/invoices/:id/pdf     (?view=1 opens it in the browser)
//   PATCH /api/admin/subscriptions/invoices/:id/status  body { "status": "paid", "paymentMode": "upi", "paymentRef": "...", "note": "..." }
//                                                       or { "status": "pending" } to undo
//   POST  /api/admin/subscriptions/invoices/generate    body { "period": "2026-10", "tenantId": "optional" }
//         (invoices are also created automatically every month)

const express = require('express');
const mongoose = require('mongoose');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const Tenant = require('../models/Tenant');
const { generateForPeriod, periodOf, withOverdue, PERIOD_RE } = require('../services/subscriptionService');
const { streamSubscriptionInvoice } = require('../services/subscriptionInvoicePdf');
const { wrap, httpError } = require('../middlewares/apiErrors');

const router = express.Router();
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const MODES = SubscriptionInvoice.schema.path('paymentMode').enumValues;
const cleanText = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

async function findInvoice(req) {
    const inv = isId(req.params.id) ? await SubscriptionInvoice.findById(req.params.id).lean() : null;
    if (!inv) throw httpError(404, 'Invoice not found');
    return inv;
}

router.get('/subscriptions/invoices', wrap(async (req, res) => {
    const page = clamp(parseInt(req.query.page, 10) || 1, 1, 1000);
    const limit = clamp(parseInt(req.query.limit, 10) || 20, 1, 50);
    const filter = {};

    if (req.query.tenantId !== undefined) {
        if (!isId(req.query.tenantId)) throw httpError(400, 'Invalid tenantId');
        filter.tenantId = req.query.tenantId;
    }
    if (req.query.period !== undefined) {
        if (!PERIOD_RE.test(String(req.query.period))) throw httpError(400, 'period must look like 2026-10');
        filter.period = req.query.period;
    }
    const s = req.query.status;
    if (s === 'overdue') { filter.status = 'pending'; filter.dueDate = { $lt: new Date() }; }
    else if (s === 'paid' || s === 'pending') filter.status = s;
    else if (s !== undefined && s !== '') throw httpError(400, 'status must be paid, pending or overdue');

    const items = await SubscriptionInvoice.find(filter)
        .sort({ issueDate: -1, _id: -1 }).skip((page - 1) * limit).limit(limit + 1).lean();
    const hasMore = items.length > limit;
    if (hasMore) items.pop();

    const shops = await Tenant.find({ _id: { $in: [...new Set(items.map((i) => String(i.tenantId)))] } }).select('name slug').lean();
    const byId = new Map(shops.map((t) => [String(t._id), t]));
    res.json({
        items: items.map((i) => withOverdue({ ...i, shopName: byId.get(String(i.tenantId))?.name || 'Unknown shop' })),
        page,
        hasMore,
    });
}));

// Registered before the /:id routes so "generate" is never read as an id (different method anyway)
router.post('/subscriptions/invoices/generate', wrap(async (req, res) => {
    const period = req.body?.period || periodOf(new Date());
    if (!PERIOD_RE.test(String(period))) throw httpError(400, 'period must look like 2026-10');
    if (period > periodOf(new Date())) throw httpError(400, 'You cannot create an invoice for a future month');

    let tenantId;
    if (req.body?.tenantId !== undefined) {
        if (!isId(req.body.tenantId)) throw httpError(400, 'Invalid tenantId');
        tenantId = req.body.tenantId;
    }
    res.status(201).json(await generateForPeriod({ period, tenantId }));
}));

router.get('/subscriptions/invoices/:id', wrap(async (req, res) => {
    res.json(withOverdue(await findInvoice(req)));
}));

router.get('/subscriptions/invoices/:id/pdf', wrap(async (req, res) => {
    streamSubscriptionInvoice(res, await findInvoice(req), { inline: req.query.view === '1' });
}));

router.patch('/subscriptions/invoices/:id/status', wrap(async (req, res) => {
    await findInvoice(req);   // 404 if it does not exist
    const status = req.body?.status;
    if (status !== 'paid' && status !== 'pending') throw httpError(400, 'status must be paid or pending');

    let update;
    if (status === 'paid') {
        const mode = req.body.paymentMode;
        if (mode !== undefined && !MODES.includes(mode)) throw httpError(400, `paymentMode must be one of: ${MODES.join(', ')}`);
        const set = { status, paidAt: new Date(), markedBy: req.admin.email };
        if (mode) set.paymentMode = mode;
        const ref = cleanText(req.body.paymentRef, 60);
        if (ref) set.paymentRef = ref;
        const note = cleanText(req.body.note, 200);
        if (note) set.note = note;
        update = { $set: set };
    } else {
        update = {
            $set: { status, markedBy: req.admin.email },
            $unset: { paidAt: 1, paymentMode: 1, paymentRef: 1 },
        };
    }
    const inv = await SubscriptionInvoice.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
    res.json(withOverdue(inv));
}));

module.exports = router;