// The platform's GST papers. Everyone with a superadmin login can read them (the operator files his returns from them).
//   GET /api/admin/platform/gst-register?month=2026-10             the month's plan, extra shop, wallet and SMS top-up invoices + totals
//   GET /api/admin/platform/gst-register?month=2026-10&format=xlsx  the same as an Excel file
const express = require('express');
const gstRegister = require('../services/gstRegister');
const { buildSheet, XLSX_TYPE } = require('../services/xlsxExport');
const apiErrors = require('../middlewares/apiErrors');

const { wrap } = apiErrors;
const router = express.Router();

router.get('/platform/gst-register', wrap(async (req, res) => {
    const out = await gstRegister.build({ month: req.query.month });
    if (req.query.format !== 'xlsx') return res.json(out);
    const buf = await buildSheet({
        title: `GST register ${out.month}`,
        subtitle: `${out.summary.documents} documents  ·  taxable Rs ${out.summary.taxable.toFixed(2)}  ·  GST Rs ${out.summary.gst.toFixed(2)}`,
        total: true,
        columns: [
            { header: 'Date', key: 'date', kind: 'date' },
            { header: 'Type', key: 'type' },
            { header: 'Document no', key: 'docNo' },
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

router.use(apiErrors);
module.exports = router;
