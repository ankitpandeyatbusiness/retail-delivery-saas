// Builds a professional A4 invoice (PDF) from a saved order.
// Everything comes from the order itself (its own saved copy of prices, tax and seller details),
// so an old invoice never changes when the menu or the tax rate changes later.
//
// Needs:  npm install pdfkit
// Note: the standard PDF fonts cannot draw the rupee sign, so amounts are written as "Rs.".

const PDFDocument = require('pdfkit');

const INK = '#1f2933';
const MUTED = '#6b7280';
const LINE = '#d1d5db';
const SOFT = '#f3f4f6';
const BRAND = '#111827';

const PAGE_LEFT = 40;
const PAGE_RIGHT = 555;                 // A4 is 595pt wide, 40pt margins
const PAGE_BOTTOM = 770;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n) => (Number(n) || 0).toFixed(2);
const rs = (n) => `Rs. ${money(n)}`;

const TYPE_LABEL = { delivery: 'Delivery', pickup: 'Pickup', dine_in: 'Dine-in' };
const PAY_LABEL = { cod: 'Cash on delivery', upi: 'UPI', card: 'Card', wallet: 'Wallet' };

const istDateTime = (d) =>
    new Date(d).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
    });

/* ------------------------------ amount in words (Indian system) ------------------------------ */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
    'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below1000(n) {
    let s = '';
    if (n >= 100) { s += `${ONES[Math.floor(n / 100)]} Hundred `; n %= 100; }
    if (n >= 20) { s += `${TENS[Math.floor(n / 10)]} `; n %= 10; }
    if (n > 0) s += `${ONES[n]} `;
    return s;
}

function wholeInWords(n) {
    if (n === 0) return 'Zero';
    let s = '';
    const crore = Math.floor(n / 10000000); n %= 10000000;
    const lakh = Math.floor(n / 100000); n %= 100000;
    const thousand = Math.floor(n / 1000); n %= 1000;
    if (crore) s += `${below1000(crore)}Crore `;
    if (lakh) s += `${below1000(lakh)}Lakh `;
    if (thousand) s += `${below1000(thousand)}Thousand `;
    if (n) s += below1000(n);
    return s.trim();
}

function amountInWords(amount) {
    const total = Math.round((Number(amount) || 0) * 100);
    const rupees = Math.floor(total / 100);
    const paise = total % 100;
    let s = `Rupees ${wholeInWords(rupees)}`;
    if (paise) s += ` and ${wholeInWords(paise)} Paise`;
    return `${s} Only`;
}

/* ------------------------------ tax summary ------------------------------ */
// Groups the order's tax by GST rate. The coupon discount is shared across lines in exactly the same way
// the order was priced, so these numbers always match the saved order.
function taxBreakup(order) {
    const p = order.pricing || {};
    const mode = p.taxMode || 'none';
    if (mode === 'none') return { mode, rows: [], tax: 0 };

    const lines = order.items || [];
    const subtotal = lines.reduce((s, l) => s + (l.lineTotal || 0), 0);
    const discount = p.discount || 0;
    const groups = new Map();
    let left = discount;

    lines.forEach((l, i) => {
        const share = i === lines.length - 1 ? left : round2(subtotal ? (discount * l.lineTotal) / subtotal : 0);
        left = round2(left - share);
        const afterDiscount = Math.max((l.lineTotal || 0) - share, 0);
        const tax = l.tax || 0;
        const taxable = mode === 'inclusive' ? afterDiscount - tax : afterDiscount;
        const rate = l.gstRate || 0;
        const g = groups.get(rate) || { rate, taxable: 0, tax: 0 };
        g.taxable += taxable;
        g.tax += tax;
        groups.set(rate, g);
    });

    const rows = [...groups.values()]
        .sort((a, b) => a.rate - b.rate)
        .map((g) => ({ rate: g.rate, taxable: round2(g.taxable), tax: round2(g.tax) }));
    return { mode, rows, tax: round2(rows.reduce((s, r) => s + r.tax, 0)) };
}

/* ------------------------------ drawing ------------------------------ */
const COL = {
    no: { x: 40, w: 22 },
    item: { x: 66, w: 236 },
    qty: { x: 306, w: 36 },
    rate: { x: 346, w: 66 },
    gst: { x: 416, w: 44 },
    amount: { x: 464, w: 91 },
};

function drawTableHeader(doc, y) {
    doc.save().rect(PAGE_LEFT, y, PAGE_RIGHT - PAGE_LEFT, 22).fill(BRAND).restore();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
    doc.text('#', COL.no.x + 4, y + 7, { width: COL.no.w });
    doc.text('ITEM', COL.item.x, y + 7, { width: COL.item.w });
    doc.text('QTY', COL.qty.x, y + 7, { width: COL.qty.w, align: 'right' });
    doc.text('RATE', COL.rate.x, y + 7, { width: COL.rate.w, align: 'right' });
    doc.text('GST', COL.gst.x, y + 7, { width: COL.gst.w, align: 'right' });
    doc.text('AMOUNT', COL.amount.x, y + 7, { width: COL.amount.w - 6, align: 'right' });
    return y + 22;
}

function ensureSpace(doc, y, needed, withTableHeader) {
    if (y + needed <= PAGE_BOTTOM) return y;
    doc.addPage();
    return withTableHeader ? drawTableHeader(doc, 40) : 40;
}

function drawHeader(doc, order, tenant, titleText) {
    const seller = order.seller || {};
    const shopName = seller.name || tenant?.name || 'Shop';

    doc.font('Helvetica-Bold').fontSize(18).fillColor(BRAND).text(shopName, PAGE_LEFT, 40, { width: 300 });
    let y = doc.y + 2;

    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    const a = tenant?.address || {};
    const addr = [a.line, a.city, a.pincode].filter(Boolean).join(', ');
    if (addr) { doc.text(addr, PAGE_LEFT, y, { width: 300 }); y = doc.y; }
    if (tenant?.phone) { doc.text(`Phone: ${tenant.phone}`, PAGE_LEFT, y, { width: 300 }); y = doc.y; }
    if (seller.gstin) { doc.text(`GSTIN: ${seller.gstin}`, PAGE_LEFT, y, { width: 300 }); y = doc.y; }
    if (seller.fssai) { doc.text(`FSSAI Lic. No: ${seller.fssai}`, PAGE_LEFT, y, { width: 300 }); y = doc.y; }

    doc.font('Helvetica-Bold').fontSize(20).fillColor(BRAND)
        .text(titleText, 340, 40, { width: PAGE_RIGHT - 340, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
        .text(`Invoice No: INV-${order.orderNo}`, 340, 66, { width: PAGE_RIGHT - 340, align: 'right' })
        .text(`Order No: #${order.orderNo}`, 340, 79, { width: PAGE_RIGHT - 340, align: 'right' })
        .text(`Date: ${istDateTime(order.createdAt)}`, 340, 92, { width: PAGE_RIGHT - 340, align: 'right' });

    y = Math.max(y, 110) + 8;
    doc.moveTo(PAGE_LEFT, y).lineTo(PAGE_RIGHT, y).lineWidth(1).strokeColor(LINE).stroke();
    return y + 12;
}

function drawParties(doc, order, y) {
    const half = (PAGE_RIGHT - PAGE_LEFT) / 2;
    const c = order.customer || {};
    const ad = order.address || {};

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text('BILL TO', PAGE_LEFT, y);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(c.name || 'Customer', PAGE_LEFT, y + 13, { width: half - 10 });
    let ly = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor(INK);
    if (c.phone) { doc.text(`Phone: ${c.phone}`, PAGE_LEFT, ly, { width: half - 10 }); ly = doc.y; }
    if (order.orderType === 'delivery' && ad.line1) {
        const addr = [ad.line1, ad.line2, ad.landmark, ad.city, ad.pincode].filter(Boolean).join(', ');
        doc.fillColor(MUTED).text(addr, PAGE_LEFT, ly, { width: half - 10 });
        ly = doc.y;
    }
    if (order.orderType === 'dine_in' && order.tableNo) {
        doc.fillColor(MUTED).text(`Table: ${order.tableNo}`, PAGE_LEFT, ly, { width: half - 10 });
        ly = doc.y;
    }

    const rx = PAGE_LEFT + half + 10;
    const paid = order.payment?.status === 'paid';
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text('ORDER DETAILS', rx, y);
    doc.font('Helvetica').fontSize(9).fillColor(INK);
    doc.text(`Type: ${TYPE_LABEL[order.orderType] || order.orderType}`, rx, y + 13, { width: half - 10 });
    doc.text(`Payment: ${PAY_LABEL[order.payment?.method] || order.payment?.method || '-'}`, rx, doc.y, { width: half - 10 });
    doc.font('Helvetica-Bold').fillColor(paid ? '#047857' : '#b45309')
        .text(`Status: ${paid ? 'PAID' : 'PAYMENT PENDING'}`, rx, doc.y, { width: half - 10 });

    return Math.max(ly, doc.y) + 14;
}

function drawItems(doc, order, startY) {
    let y = drawTableHeader(doc, startY);
    const items = order.items || [];

    items.forEach((l, i) => {
        const extras = (l.selections || []).map((s) => s.name).join(', ');
        const noteText = l.note ? `Note: ${l.note}` : '';

        doc.font('Helvetica-Bold').fontSize(9.5);
        const nameH = doc.heightOfString(l.name || '', { width: COL.item.w });
        doc.font('Helvetica').fontSize(8);
        const extraH = extras ? doc.heightOfString(extras, { width: COL.item.w }) : 0;
        const noteH = noteText ? doc.heightOfString(noteText, { width: COL.item.w }) : 0;
        const rowH = Math.max(nameH + extraH + noteH + 12, 24);

        y = ensureSpace(doc, y, rowH, true);
        if (i % 2 === 1) doc.save().rect(PAGE_LEFT, y, PAGE_RIGHT - PAGE_LEFT, rowH).fill(SOFT).restore();

        doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(String(i + 1), COL.no.x + 4, y + 6, { width: COL.no.w });
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(l.name || '', COL.item.x, y + 6, { width: COL.item.w });
        let ty = y + 6 + nameH;
        doc.font('Helvetica').fontSize(8).fillColor(MUTED);
        if (extras) { doc.text(extras, COL.item.x, ty, { width: COL.item.w }); ty += extraH; }
        if (noteText) doc.text(noteText, COL.item.x, ty, { width: COL.item.w });

        doc.font('Helvetica').fontSize(9.5).fillColor(INK);
        doc.text(String(l.quantity), COL.qty.x, y + 6, { width: COL.qty.w, align: 'right' });
        doc.text(money(l.unitPrice), COL.rate.x, y + 6, { width: COL.rate.w, align: 'right' });
        doc.text(l.gstRate ? `${l.gstRate}%` : '-', COL.gst.x, y + 6, { width: COL.gst.w, align: 'right' });
        doc.text(money(l.lineTotal), COL.amount.x, y + 6, { width: COL.amount.w - 6, align: 'right' });

        y += rowH;
    });

    doc.moveTo(PAGE_LEFT, y).lineTo(PAGE_RIGHT, y).lineWidth(1).strokeColor(LINE).stroke();
    return y + 12;
}

function drawTaxTable(doc, order, tax, y) {
    if (!tax.rows.length) return y;
    const x = PAGE_LEFT;
    const cols = [
        { label: 'GST RATE', w: 70, align: 'left' },
        { label: 'TAXABLE VALUE', w: 100, align: 'right' },
        { label: 'CGST', w: 80, align: 'right' },
        { label: 'SGST', w: 80, align: 'right' },
        { label: 'TOTAL TAX', w: 85, align: 'right' },
    ];
    const width = cols.reduce((s, c) => s + c.w, 0);
    y = ensureSpace(doc, y, 40 + tax.rows.length * 18, false);

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text('TAX SUMMARY', x, y);
    y += 14;
    doc.save().rect(x, y, width, 18).fill(SOFT).restore();
    let cx = x;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(INK);
    cols.forEach((c) => { doc.text(c.label, cx + 4, y + 5, { width: c.w - 8, align: c.align }); cx += c.w; });
    y += 18;

    doc.font('Helvetica').fontSize(9).fillColor(INK);
    tax.rows.forEach((r) => {
        const cgst = round2(r.tax / 2);
        const sgst = round2(r.tax - cgst);
        const cells = [`${r.rate}%`, money(r.taxable), money(cgst), money(sgst), money(r.tax)];
        cx = x;
        cols.forEach((c, i) => { doc.text(cells[i], cx + 4, y + 5, { width: c.w - 8, align: c.align }); cx += c.w; });
        y += 18;
    });
    doc.moveTo(x, y).lineTo(x + width, y).lineWidth(0.5).strokeColor(LINE).stroke();
    return y + 14;
}

function drawTotals(doc, order, tax, y) {
    const p = order.pricing || {};
    const rows = [['Subtotal', rs(p.subtotal)]];
    if (p.discount) rows.push([p.couponCode ? `Discount (${p.couponCode})` : 'Discount', `- ${rs(p.discount)}`]);
    if (p.deliveryFee) rows.push(['Delivery fee', rs(p.deliveryFee)]);
    if (p.packagingCharge) rows.push(['Packaging charge', rs(p.packagingCharge)]);
    if (tax.mode === 'exclusive' && tax.tax) {
        const cgst = round2(tax.tax / 2);
        rows.push(['CGST', rs(cgst)], ['SGST', rs(round2(tax.tax - cgst))]);
    }
    if (p.tip) rows.push(['Tip', rs(p.tip)]);

    const boxX = 340;
    const boxW = PAGE_RIGHT - boxX;
    y = ensureSpace(doc, y, rows.length * 16 + 70, false);

    doc.font('Helvetica').fontSize(9.5).fillColor(INK);
    rows.forEach(([label, value]) => {
        doc.fillColor(MUTED).text(label, boxX, y, { width: boxW - 100 });
        doc.fillColor(INK).text(value, boxX + boxW - 100, y, { width: 100, align: 'right' });
        y += 16;
    });

    y += 4;
    doc.save().rect(boxX, y, boxW, 28).fill(BRAND).restore();
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff')
        .text('TOTAL', boxX + 10, y + 9, { width: 80 })
        .text(rs(p.total), boxX + boxW - 150, y + 9, { width: 140, align: 'right' });
    y += 28;

    if (tax.mode === 'inclusive' && tax.tax) {
        doc.font('Helvetica').fontSize(8).fillColor(MUTED)
            .text(`Total includes GST of ${rs(tax.tax)}`, boxX, y + 5, { width: boxW, align: 'right' });
        y += 16;
    }
    return y + 10;
}

function drawFooter(doc, order, y) {
    y = ensureSpace(doc, y, 90, false);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text('AMOUNT IN WORDS', PAGE_LEFT, y);
    doc.font('Helvetica').fontSize(9.5).fillColor(INK)
        .text(amountInWords(order.pricing?.total), PAGE_LEFT, y + 13, { width: PAGE_RIGHT - PAGE_LEFT });
    y = doc.y + 14;

    doc.moveTo(PAGE_LEFT, y).lineTo(PAGE_RIGHT, y).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
        .text('This is a computer generated invoice and does not need a signature.', PAGE_LEFT, y + 8, { width: PAGE_RIGHT - PAGE_LEFT, align: 'center' })
        .text('Thank you for your order!', PAGE_LEFT, doc.y + 2, { width: PAGE_RIGHT - PAGE_LEFT, align: 'center' });
}

function renderInvoice(doc, order, tenant) {
    const tax = taxBreakup(order);
    const title = tax.mode === 'none' ? 'INVOICE' : 'TAX INVOICE';

    let y = drawHeader(doc, order, tenant, title);
    y = drawParties(doc, order, y);
    y = drawItems(doc, order, y);
    y = drawTaxTable(doc, order, tax, y);
    y = drawTotals(doc, order, tax, y);
    drawFooter(doc, order, y);
}

/* ------------------------------ public ------------------------------ */
// Sends the PDF straight to the response. `order` is a saved order, `tenant` is the shop (for its address and phone).
function streamInvoice(res, order, tenant, { inline = false } = {}) {
    const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        info: { Title: `Invoice INV-${order.orderNo}`, Author: order.seller?.name || tenant?.name || 'Shop' },
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="Invoice-${order.orderNo}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    doc.pipe(res);
    renderInvoice(doc, order, tenant);
    doc.end();
}

module.exports = { streamInvoice, renderInvoice, taxBreakup, amountInWords };