// The order invoice (PDF) and the sales report. They get their own file so shopRouter can keep them OPEN
// while a shop is paused for unpaid rent (the owner still needs his invoices and numbers).
//   invoice  -> GET /api/shop/orders/:id/invoice   (?view=1 opens it in the browser)
//   reports  -> GET /api/shop/reports/sales        (?from&to&groupBy=day|month)
const express = require('express');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const { streamInvoice } = require('../services/invoiceService');
const { salesReport, parseRange } = require('../services/reportService');
const salesExport = require('../services/salesExport');
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
    res.json(await salesReport({ tenantId: req.tenant._id, from, to, groupBy: req.query.groupBy, topLimit: parseInt(req.query.topLimit, 10) || 10 }));
}));

// The same period as an Excel file: orders, sales by day, items sold. ?from&to (default the last 30 days, at most 366 days)
reports.get('/export', wrap(async (req, res) => {
    const { from, to } = parseRange(req.query);
    const { workbook } = await salesExport.build({ tenantId: req.tenant._id, from, to });
    const name = `sales-${new Date(from.getTime() + 330 * 60000).toISOString().slice(0, 10)}-to-${new Date(to.getTime() + 330 * 60000).toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    await workbook.xlsx.write(res);
    res.end();
}));

module.exports = { invoice, reports };