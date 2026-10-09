// A4 PDF for the monthly app-rent invoice (you -> a shop). Everything is read from the saved invoice,
// so an old PDF never changes. Standard PDF fonts cannot draw the rupee sign, so amounts use "Rs.".

const PDFDocument = require('pdfkit');
const { amountInWords } = require('./invoiceService');

const INK = '#1f2933';
const MUTED = '#6b7280';
const LINE = '#d1d5db';
const BRAND = '#111827';
const GREEN = '#047857';
const AMBER = '#b45309';
const RED = '#b91c1c';
const L = 40;
const R = 555;

const money = (n) => (Number(n) || 0).toFixed(2);
const rs = (n) => `Rs. ${money(n)}`;
const day = (d) => new Date(d).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
});
// invoice numbers contain "/" which is not allowed in a file name
const safeName = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, '-');

function drawParty(doc, title, p, x, y, w) {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text(title, x, y);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(p?.legalName || '-', x, y + 13, { width: w });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    [p?.address, p?.gstin && `GSTIN: ${p.gstin}`, p?.phone && `Phone: ${p.phone}`, p?.email && `Email: ${p.email}`]
        .filter(Boolean)
        .forEach((line) => doc.text(line, x, doc.y, { width: w }));
    return doc.y;
}

function drawTotals(doc, inv, y) {
    const bx = 340;
    const bw = R - bx;
    const rows = [['Amount', rs(inv.baseAmount)]];
    if (inv.gstAmount) rows.push([`GST @ ${inv.gstPercent}%`, rs(inv.gstAmount)]);

    doc.font('Helvetica').fontSize(9.5);
    rows.forEach(([k, v]) => {
        doc.fillColor(MUTED).text(k, bx, y, { width: bw - 100 });
        doc.fillColor(INK).text(v, bx + bw - 100, y, { width: 100, align: 'right' });
        y += 16;
    });
    y += 4;
    doc.save().rect(bx, y, bw, 28).fill(BRAND).restore();
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff')
        .text('TOTAL', bx + 10, y + 9, { width: 80 })
        .text(rs(inv.total), bx + bw - 150, y + 9, { width: 140, align: 'right' });
    return y + 28 + 18;
}

function render(doc, inv) {
    const s = inv.seller || {};
    const paid = inv.status === 'paid';
    const isVoid = inv.status === 'void';
    const title = inv.gstPercent > 0 && s.gstin ? 'TAX INVOICE' : 'INVOICE';

    // header
    doc.font('Helvetica-Bold').fontSize(20).fillColor(BRAND).text(title, L, 40);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(isVoid ? RED : paid ? GREEN : AMBER)
        .text(isVoid ? 'VOID' : paid ? 'PAID' : 'PAYMENT PENDING', L, 66);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    [`Invoice No: ${inv.invoiceNo}`, `Issue date: ${day(inv.issueDate)}`, `Due date: ${day(inv.dueDate)}`, inv.period ? `Billing month: ${inv.period}` : 'Custom invoice']
        .forEach((t, i) => doc.text(t, 340, 40 + i * 13, { width: R - 340, align: 'right' }));

    let y = 106;
    doc.moveTo(L, y).lineTo(R, y).lineWidth(1).strokeColor(LINE).stroke();
    y += 12;

    // from / bill to
    const a = drawParty(doc, 'FROM', s, L, y, 235);
    const b = drawParty(doc, 'BILL TO', inv.buyer, 310, y, 245);
    y = Math.max(a, b) + 18;

    // one line item
    doc.save().rect(L, y, R - L, 22).fill(BRAND).restore();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff')
        .text('DESCRIPTION', L + 6, y + 7, { width: 330 })
        .text('SAC', 376, y + 7, { width: 70 })
        .text('AMOUNT', 450, y + 7, { width: R - 456, align: 'right' });
    y += 22;
    // new invoices have lineItems; old ones fall back to description + baseAmount
    const items = inv.lineItems?.length
        ? inv.lineItems
        : [{ description: inv.description || 'App subscription', amount: inv.baseAmount }];
    items.forEach((it) => {
        const text = it.qty > 1 ? `${it.description} (${it.qty} x ${money(it.rate)})` : (it.description || '-');
        doc.font('Helvetica').fontSize(9.5);
        const h = doc.heightOfString(text, { width: 330 });
        doc.fillColor(INK)
            .text(text, L + 6, y + 8, { width: 330 })
            .text(s.sacCode || '-', 376, y + 8, { width: 70 })
            .text(money(it.amount), 450, y + 8, { width: R - 456, align: 'right' });
        y += Math.max(h, 12) + 16;
    });
    y += 6;
    doc.moveTo(L, y).lineTo(R, y).lineWidth(1).strokeColor(LINE).stroke();
    y += 12;

    y = drawTotals(doc, inv, y);

    // amount in words
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text('AMOUNT IN WORDS', L, y);
    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(amountInWords(inv.total), L, y + 13, { width: R - L });
    y = doc.y + 14;

    // paid details, or how to pay
    if (paid) {
        const via = [inv.paymentMode && inv.paymentMode.replace('_', ' '), inv.paymentRef && `Ref ${inv.paymentRef}`]
            .filter(Boolean).join(', ');
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(GREEN)
            .text(`Paid${inv.paidAt ? ` on ${day(inv.paidAt)}` : ''}${via ? ` (${via})` : ''}`, L, y, { width: R - L });
    } else if (!isVoid && s.paymentInstructions) {
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text('HOW TO PAY', L, y);
        doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(s.paymentInstructions, L, y + 13, { width: R - L });
    }

    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
        .text('This is a computer generated invoice and does not need a signature.', L, 780, { width: R - L, align: 'center' });

    if (isVoid) {
        doc.save().rotate(-30, { origin: [300, 420] })
            .font('Helvetica-Bold').fontSize(110).fillColor(RED).opacity(0.15)
            .text('VOID', 130, 370).restore();
        if (inv.voidReason) {
            doc.font('Helvetica').fontSize(9.5).fillColor(RED).text(`Void reason: ${inv.voidReason}`, L, y, { width: R - L });
        }
    }
}

// Sends the PDF straight to the response. `inv` is a saved SubscriptionInvoice (plain object).
function streamSubscriptionInvoice(res, inv, { inline = false } = {}) {
    const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        info: { Title: `Invoice ${inv.invoiceNo}`, Author: inv.seller?.legalName || 'Platform' },
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="Invoice-${safeName(inv.invoiceNo)}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    doc.pipe(res);
    render(doc, inv);
    doc.end();
}

module.exports = { streamSubscriptionInvoice };