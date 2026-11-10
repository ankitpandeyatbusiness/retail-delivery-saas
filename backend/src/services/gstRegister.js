// The GST register of the platform's own documents for one month: every plan, extra shop, wallet and SMS top-up invoice, with the
// buyer, the place of supply, the taxable value and the tax heads. This is what the business that issues them (the operator)
// files its returns from.
//   build({ month: '2026-10' })  ->  { month, rows, summary }
// Amounts are rupees.
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
    // plans, extra shops, wallet top-ups and SMS top-ups: every paid document of the month (services/platformSales.js)
    const sales = await require('./platformSales').paid({ from, to });
    const TYPE = { plan: 'Plan', branch: 'Extra shop', wallet: 'Wallet top-up', sms: 'SMS top-up' };
    const rows = sales.map((x) => row({ ...(x.invoice || {}), invoiceNo: x.invoiceNo, issueDate: x.issueDate, baseAmount: x.baseAmount, gstAmount: x.gstAmount, gstPercent: x.gstPercent, total: x.total }, { type: TYPE[x.kind], status: 'paid', paidAt: x.paidAt }))
        .sort((p, q) => new Date(p.date) - new Date(q.date) || String(p.docNo).localeCompare(String(q.docNo)));

    const sum = (key, list = rows) => round2(list.reduce((s, r) => s + r[key], 0));
    return {
        month,
        rows,
        summary: {
            documents: rows.length,
            taxable: sum('taxable'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), gst: sum('gst'), total: sum('total'),
            b2b: { documents: rows.filter((r) => r.supply === 'B2B').length, taxable: sum('taxable', rows.filter((r) => r.supply === 'B2B')), gst: sum('gst', rows.filter((r) => r.supply === 'B2B')) },
            b2c: { documents: rows.filter((r) => r.supply === 'B2C').length, taxable: sum('taxable', rows.filter((r) => r.supply === 'B2C')), gst: sum('gst', rows.filter((r) => r.supply === 'B2C')) },
            gstOnUnpaidBills: 0,   // everything is prepaid: nothing is unpaid
            unpaidBills: 0,
        },
    };
}

module.exports = { build, range, row };
