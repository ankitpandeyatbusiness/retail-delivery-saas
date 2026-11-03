// A4 PDF of the brand's monthly statement (services/brandStatement.js): one line per branch, the multi-branch discount, GST, what is unpaid,
// and the SMS wallet. It is NOT a tax invoice: the tax invoices are the separate bills of each branch, and this page only adds them up.
// Standard PDF fonts cannot draw the rupee sign, so amounts use "Rs.".
const PDFDocument = require('pdfkit');
const PlatformSettings = require('../models/PlatformSettings');
const { monthLabel } = require('./subscriptionService');

const INK = '#1f2933';
const MUTED = '#6b7280';
const LINE = '#d1d5db';
const BRAND = '#111827';
const GREEN = '#047857';
const RED = '#b91c1c';
const L = 40;
const R = 555;

const rs = (n) => `Rs. ${(Number(n) || 0).toFixed(2)}`;
const day = (d) => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
const safeName = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, '-');

// columns of the table: [title, x, width, align]
const COLS = [['Branch', L, 118, 'left'], ['Bill no.', 160, 92, 'left'], ['Orders', 254, 34, 'right'], ['Rent', 292, 50, 'right'], ['Discount', 344, 50, 'right'], ['GST', 396, 42, 'right'], ['Total', 440, 58, 'right'], ['Status', 500, 55, 'right']];
const cell = (doc, i, text, y, opts = {}) => {
    const [, x, w, align] = COLS[i];
    doc.text(String(text), x, y, { width: w, align, lineBreak: false, ellipsis: true, ...opts });
};

function render(doc, st, seller) {
    // letterhead
    doc.font('Helvetica-Bold').fontSize(18).fillColor(BRAND).text('Brand statement', L, 40);
    doc.font('Helvetica').fontSize(11).fillColor(MUTED).text(`${st.brand.name} - ${monthLabel(st.period)}`, L, 63);
    if (seller && seller.legalName) {
        doc.font('Helvetica').fontSize(9).fillColor(MUTED).text([seller.legalName, seller.gstin && `GSTIN: ${seller.gstin}`].filter(Boolean).join('  |  '), L, 40, { width: R - L, align: 'right' });
    }
    doc.moveTo(L, 88).lineTo(R, 88).strokeColor(LINE).stroke();

    // the table
    let y = 100;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED);
    COLS.forEach((c, i) => cell(doc, i, c[0], y));
    y += 16;
    doc.moveTo(L, y - 3).lineTo(R, y - 3).strokeColor(LINE).stroke();

    for (const b of st.branches) {
        if (y > 740) { doc.addPage(); y = 50; }
        const i = b.invoice;
        const name = b.city ? `${b.name} (${b.city})` : b.name;
        doc.font('Helvetica-Bold').fontSize(9).fillColor(INK);
        cell(doc, 0, name, y);
        doc.font('Helvetica').fontSize(9).fillColor(INK);
        if (i) {
            cell(doc, 1, i.invoiceNo, y);
            cell(doc, 2, i.orders ?? '', y);
            cell(doc, 3, i.rent.toFixed(2), y);
            cell(doc, 4, i.discount ? `-${i.discount.toFixed(2)}` : '-', y);
            cell(doc, 5, i.gst.toFixed(2), y);
            cell(doc, 6, i.total.toFixed(2), y);
            doc.fillColor(i.status === 'paid' ? GREEN : RED);
            cell(doc, 7, i.status === 'paid' ? 'Paid' : 'Unpaid', y);
        } else {
            doc.fillColor(MUTED);
            cell(doc, 1, 'No bill this month', y, { width: 200 });
        }
        y += 18;
        doc.moveTo(L, y - 4).lineTo(R, y - 4).strokeColor('#eef0f2').stroke();
    }

    // totals
    y += 8;
    const t = st.totals;
    const rows = [['Rent before discount', rs(t.rent)], ['Multi-branch discount', t.discount ? `-${rs(t.discount)}` : rs(0)], ['GST', rs(t.gst)]];
    doc.font('Helvetica').fontSize(9.5);
    rows.forEach(([k, v]) => {
        doc.fillColor(MUTED).text(k, 340, y, { width: 120 });
        doc.fillColor(INK).text(v, 440, y, { width: 115, align: 'right' });
        y += 16;
    });
    y += 4;
    doc.save().rect(340, y, R - 340, 28).fill(BRAND).restore();
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff')
        .text('TOTAL', 350, y + 9, { width: 80 })
        .text(rs(t.total), 400, y + 9, { width: 145, align: 'right' });
    y += 28 + 14;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(t.unpaidCount ? RED : GREEN)
        .text(t.unpaidCount ? `Unpaid: ${rs(t.unpaid)} (${t.unpaidCount} ${t.unpaidCount === 1 ? 'bill' : 'bills'})` : 'All bills are paid', 340, y, { width: R - 340, align: 'right' });
    y += 30;

    // the SMS wallet
    if (y > 650) { doc.addPage(); y = 50; }
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text('SMS WALLET (ONE FOR ALL BRANCHES)', L, y);
    y += 14;
    doc.font('Helvetica').fontSize(9.5).fillColor(INK);
    if (st.smsWallet) { doc.text(`Balance now: ${rs(st.smsWallet.balancePaise / 100)}`, L, y); y += 15; }
    for (const b of st.branches) {
        doc.fillColor(MUTED).text(`${b.name}: about ${b.sms.count} SMS this month`, L, y, { width: R - L });
        y += 14;
    }
    doc.fillColor(MUTED).fontSize(8.5).text('SMS numbers are approximate and for information only: the wallet is prepaid.', L, y + 2, { width: R - L });

    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
        .text('This statement adds up the separate bills of each branch. The tax invoices are the bills themselves. Computer generated; no signature needed.', L, 790, { width: R - L, align: 'center' });
}

async function sellerOf() {
    const p = await PlatformSettings.findById('main').select('business').lean();
    return (p && p.business) || null;
}

function streamStatement(res, st, seller, { inline = false } = {}) {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Brand statement ${st.brand.name} ${st.period}`, Author: (seller && seller.legalName) || 'Platform' } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="Statement-${safeName(st.brand.name)}-${st.period}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    doc.pipe(res);
    render(doc, st, seller);
    doc.end();
}

module.exports = { streamStatement, sellerOf, day };
