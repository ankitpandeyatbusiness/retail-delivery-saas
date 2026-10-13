// Superadmin: payment disputes of one shop, and his evidence notes. Mounted under /api/admin.
//   GET  /tenants/:tid/disputes
//   POST /tenants/:tid/disputes/:id/notes     { text }
const express = require('express');
const mongoose = require('mongoose');
const PaymentDispute = require('../models/PaymentDispute');
const Order = require('../models/Order');
const loadTenant = require('../middlewares/loadTenant');
const { wrap, httpError } = require('../middlewares/apiErrors');

const router = express.Router();
const MAX_NOTES = 50;

router.get('/tenants/:tid/disputes', loadTenant, wrap(async (req, res) => {
    const rows = await PaymentDispute.find({ tenantId: req.tenantDoc._id }).sort({ createdAt: -1 }).limit(100).lean();
    const orders = await Order.find({ _id: { $in: rows.map((d) => d.orderId) } }).select('orderNo').lean();
    const no = new Map(orders.map((o) => [String(o._id), o.orderNo]));
    res.json({ items: rows.map((d) => ({ ...d, id: d._id, _id: undefined, orderNo: no.get(String(d.orderId)) ?? null })) });
}));

router.post('/tenants/:tid/disputes/:id/notes', loadTenant, wrap(async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 500) throw httpError(400, 'Write a note of up to 500 characters');
    if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, 'Dispute not found');
    const by = String(req.actor?.label || req.admin?.email || 'superadmin').slice(0, 80);
    const d = await PaymentDispute.findOneAndUpdate(
        { _id: req.params.id, tenantId: req.tenantDoc._id, [`notes.${MAX_NOTES - 1}`]: { $exists: false } },
        { $push: { notes: { at: new Date(), by, text } } },
        { returnDocument: 'after' },
    );
    if (!d) throw httpError(404, 'Dispute not found, or it already has the maximum number of notes');
    res.status(201).json({ ok: true, notes: d.notes });
}));

module.exports = router;