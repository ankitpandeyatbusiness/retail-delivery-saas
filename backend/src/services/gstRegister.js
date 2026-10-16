// The GST register of the platform's own documents for one month: every bill, SMS top-up invoice and credit note, with the
// buyer, the place of supply, the taxable value and the tax heads. This is what the business that issues them (the operator)
// files its returns from. Credit notes count as minus.
//   build({ month: '2026-10' })  ->  { month, rows, summary }
// Amounts are rupees. A bill that is cancelled shows its own row AND a credit note row, so the month nets out correctly.
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const CreditNote = require('../models/CreditNote');
const SmsTopup = require('../models/SmsTopup');
const { httpError } = require('../middlewares/apiErrors');

const IST_MS = 330 * 60000;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function range(month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) throw httpError(400, 'month must look like 2026-10');
    const from = new Date(`${month}-01T00:00:00+05:30`);
    const [y, m] = month.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    return { from, to: new Date(`${next}-01T00:00:00+05:30`) };
}

const heads = (doc, sign) => {
    const t = doc.taxSplit || {};
    const gstAmount = Number(doc.gstAmount) || 0;
    // old bills have no split: show all of their GST as CGST+SGST halves so the columns still add up
    const hasSplit = t.cgst || t.sgst || t.igst;
    const cgst = hasSplit ? t.cgst : round2(gstAmount / 2);
    const sgst = hasSplit ? t.sgst : round2(gstAmount - round2(gstAmount / 2));
    return { cgst: round2(sign * (cgst || 0)), sgst: round2(sign * (sgst || 0)), igst: round2(sign * (t.igst || 0)) };
};

function row(doc, { type, sign = 1, name, status, paidAt }) {
    const base = round2(sign * (Number(doc.baseAmount) || 0));
    const h = heads(doc, sign);
    return {
        type,
        docNo: doc.invoiceNo,
        date: doc.issueDate,
        buyer: doc.buyer?.legalName || name || '',
        buyerGstin: doc.buyer?.gstin || '',
        supply: doc.buyer?.gstin ? 'B2B' : 'B2C',
        placeOfSupply: doc.placeOfSupply?.name ? `${doc.placeOfSupply.name} (${doc.placeOfSupply.code})` : '',
        taxable: base,
        gstPercent: Number(doc.gstPercent) || 0,
        ...h,
        gst: round2(h.cgst + h.sgst + h.igst),
        total: round2(sign * (Number(doc.total) || 0)),
        status: status || '',
        paidAt: paidAt || null,
        against: doc.originalInvoiceNo || '',
    };
}

async function build({ month }) {
    const { from, to } = range(month);
    const [bills, topups, notes] = await Promise.all([
        SubscriptionInvoice.find({ issueDate: { $gte: from, $lt: to } }).sort({ issueDate: 1 }).lean(),
        SmsTopup.find({ 'invoice.issueDate': { $gte: from, $lt: to } }).select('invoice tenantId').lean(),
        CreditNote.find({ issueDate: { $gte: from, $lt: to } }).sort({ issueDate: 1 }).lean(),
    ]);
    const rows = [
        ...bills.map((i) => row(i, { type: i.kind === 'custom' ? 'Bill (custom)' : 'Bill (rent)', status: i.status, paidAt: i.paidAt })),
        ...topups.map((t) => row(t.invoice, { type: 'SMS top-up', status: 'paid', paidAt: t.invoice.paidAt })),
        ...notes.map((n) => row(n, { type: 'Credit note', sign: -1, status: 'credit note' })),
    ].sort((a, b) => new Date(a.date) - new Date(b.date) || String(a.docNo).localeCompare(String(b.docNo)));

    const sum = (key, list = rows) => round2(list.reduce((s, r) => s + r[key], 0));
    const unpaid = rows.filter((r) => r.type.startsWith('Bill') && r.status === 'pending');
    return {
        month,
        rows,
        summary: {
            documents: rows.length,
            taxable: sum('taxable'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), gst: sum('gst'), total: sum('total'),
            b2b: { documents: rows.filter((r) => r.supply === 'B2B').length, taxable: sum('taxable', rows.filter((r) => r.supply === 'B2B')), gst: sum('gst', rows.filter((r) => r.supply === 'B2B')) },
            b2c: { documents: rows.filter((r) => r.supply === 'B2C').length, taxable: sum('taxable', rows.filter((r) => r.supply === 'B2C')), gst: sum('gst', rows.filter((r) => r.supply === 'B2C')) },
            // GST that is due on bills issued this month but not yet paid by the shop: the operator pays the tax on the bill
            // even while the shop has not paid, so this is the cash to keep ready
            gstOnUnpaidBills: sum('gst', unpaid),
            unpaidBills: unpaid.length,
        },
    };
}

module.exports = { build, range };
