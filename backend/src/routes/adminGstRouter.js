// The platform's GST papers. Everyone with a superadmin login can read them (the operator files his returns from them).
//   GET /api/admin/platform/gst-register?month=2026-10             the month's bills, top-up invoices and credit notes + totals
//   GET /api/admin/platform/gst-register?month=2026-10&format=xlsx  the same as an Excel file
//   GET /api/admin/subscriptions/credit-notes/:id/pdf              a credit note (?view=1 opens it in the browser)
const express = require('express');
const mongoose = require('mongoose');
const gstRegister = require('../services/gstRegister');
const CreditNote = require('../models/CreditNote');
const { streamSubscriptionInvoice } = require('../services/subscriptionInvoicePdf');
const { buildSheet, XLSX_TYPE } = require('../services/xlsxExport');
const apiErrors = require('../middlewares/apiErrors');

const { wrap, httpError } = apiErrors;
const router = express.Router();

router.get('/platform/gst-register', wrap(async (req, res) => {
    const out = await gstRegister.build({ month: req.query.month });
    if (req.query.format !== 'xlsx') return res.json(out);
    const buf = await buildSheet({
        title: `GST register ${out.month}`,
        subtitle: `${out.summary.documents} documents  ·  taxable Rs ${out.summary.taxable.toFixed(2)}  ·  GST Rs ${out.summary.gst.toFixed(2)}  ·  credit notes are minus`,
        total: true,
        columns: [
            { header: 'Date', key: 'date', kind: 'date' },
            { header: 'Type', key: 'type' },
            { header: 'Document no', key: 'docNo' },
            { header: 'Against bill', key: 'against' },
            { header: 'Buyer', key: 'buyer' },
            { header: 'Buyer GSTIN', key: 'buyerGstin' },
            { header: 'B2B / B2C', key: 'supply', kind: 'center' },
            { header: 'Place of supply', key: 'placeOfSupply' },
            { header: 'Taxable value', key: 'taxable', kind: 'money' },
            { header: 'GST %', key: 'gstPercent', kind: 'int' },
            { header: 'CGST', key: 'cgst', kind: 'money' },
            { header: 'SGST', key: 'sgst', kind: 'money' },
            { header: 'IGST', key: 'igst', kind: 'money' },
            { header: 'Total', key: 'total', kind: 'money' },
            { header: 'Status', key: 'status', kind: 'status' },
            { header: 'Paid on', key: 'paidAt', kind: 'date' },
        ],
        rows: out.rows,
    });
    res.set('Content-Type', XLSX_TYPE);
    res.set('Content-Disposition', `attachment; filename="gst-register-${out.month}.xlsx"`);
    return res.send(buf);
}));

router.get('/subscriptions/credit-notes/:id/pdf', wrap(async (req, res) => {
    const note = mongoose.isValidObjectId(req.params.id) ? await CreditNote.findById(req.params.id).lean() : null;
    if (!note) throw httpError(404, 'Credit note not found');
    streamSubscriptionInvoice(res, note, { inline: req.query.view === '1', creditNote: true });
}));

router.use(apiErrors);
module.exports = router;
