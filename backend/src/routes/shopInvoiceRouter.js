// The order invoice (PDF) and the sales report. They get their own file so shopRouter can keep them OPEN
// while a shop is paused for unpaid rent (the owner still needs his invoices and numbers).
//   invoice  -> GET /api/shop/orders/:id/invoice   (?view=1 opens it in the browser)
//   reports  -> GET /api/shop/reports/sales        (?from&to&groupBy=day|month)
const express = require('express');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const { streamInvoice } = require('../services/invoiceService');
const { salesReport, parseRange } = require('../services/reportService');
const { wrap, httpError } = require('../middlewares/apiErrors');

const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);

const invoice = express.Router({ mergeParams: true });
invoice.get('/', wrap(async (req, res) => {
    const order = isId(req.params.id) ? await Order.findOne({ _id: req.params.id, tenantId: req.tenant._id }) : null;
    if (!order) throw httpError(404, 'Order not found');
    if (order.status !== 'delivered') throw httpError(409, 'The invoice is only available after delivery');
    streamInvoice(res, order, req.tenant, { inline: req.query.view === '1' });
}));

const reports = express.Router();
reports.get('/sales', wrap(async (req, res) => {
    const { from, to } = parseRange(req.query);
    res.json(await salesReport({ tenantId: req.tenant._id, from, to, groupBy: req.query.groupBy }));
}));

module.exports = { invoice, reports };