// The receipt of a table booking deposit, as a PDF: the same document for the guest and for the owner.
// It is a RECEIPT for the booking amount paid online, not a tax invoice: GST, if any, is on the final dine-in bill. (If the shop's CA says the
// deposit needs its own tax invoice, this is the place to add it.) The shop's name and GSTIN are the ones saved when the guest paid.
const PDFDocument = require('pdfkit');
const { httpError } = require('../middlewares/apiErrors');

const INK = '#1f2933';
const MUTED = '#6b7280';
const LINE = '#d1d5db';
const SOFT = '#f3f4f6';
const BRAND = '#111827';
const OK = '#15803d';
const WARN = '#b45309';
const LEFT = 40;
const RIGHT = 555;

const rs = (n) => `Rs. ${(Number(n) || 0).toFixed(2)}`;
const when = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
const day = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
const safe = (s) => String(s || '').replace(/[^\x20-\x7E -ÿ]/g, '').trim();   // the standard PDF fonts cannot draw every letter

// what became of the deposit, in plain words
function outcome(b) {
    const d = b.deposit || {};
    switch (d.status) {
        case 'adjusted': return { text: 'Taken off your table bill', tone: OK };
        case 'kept': return { text: b.status === 'no_show' ? 'Kept by the restaurant (the table was not used)' : b.status === 'cancelled' ? 'Kept by the restaurant (cancelled after the free cancellation time)' : 'Kept by the restaurant as the booking amount', tone: WARN };
        case 'refunded': return { text: `Refunded${d.refundedAt ? ` on ${when(d.refundedAt)}` : ''}`, tone: OK };
        case 'refunding': case 'refund_failed': return { text: 'Refund on its way to you', tone: WARN };
        default: return { text: b.rules?.depositMode === 'keep' ? 'Held. The restaurant keeps it as the booking amount.' : 'Held. It will be taken off your table bill.', tone: INK };
    }
}

// everything the receipt says, as plain data (so it can be checked without drawing)
function dataFor(b, tenant) {
    if (!b.payment?.rzpPaymentId) throw httpError(404, 'No deposit was paid for this booking');
    const seller = b.seller || {};
    return {
        shop: { name: safe(seller.name || tenant?.business?.legalName || tenant?.name || 'Shop'), gstin: seller.gstin || tenant?.business?.gstin || '', fssai: seller.fssai || tenant?.business?.fssai || '', phone: tenant?.phone || '', address: [tenant?.address?.line, tenant?.address?.city, tenant?.address?.pincode].filter(Boolean).join(', ') },
        receiptNo: `BK-${b.code}`,
        table: b.table || '', code: b.code, name: safe(b.name) || 'Guest', phone: b.phone, date: b.date, time: b.time, party: b.party, note: safe(b.note),
        amount: b.deposit?.amount || 0, paidAt: b.payment.paidAt || null, paymentId: b.payment.rzpPaymentId,
        status: b.status, outcome: outcome(b), refundId: b.deposit?.refundId || '', refundHours: b.rules?.refundHours,
        cancelNote: safe(b.cancelNote),
    };
}

function render(doc, d) {
    doc.font('Helvetica-Bold').fontSize(18).fillColor(BRAND).text(d.shop.name, LEFT, 40, { width: 300 });
    let y = doc.y + 2;
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    for (const line of [d.shop.address, d.shop.phone ? `Phone: ${d.shop.phone}` : '', d.shop.gstin ? `GSTIN: ${d.shop.gstin}` : '', d.shop.fssai ? `FSSAI Lic. No: ${d.shop.fssai}` : ''].filter(Boolean)) { doc.text(line, LEFT, y, { width: 300 }); y = doc.y; }
    doc.font('Helvetica-Bold').fontSize(20).fillColor(BRAND).text('BOOKING RECEIPT', 300, 40, { width: RIGHT - 300, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
        .text(`Receipt no: ${d.receiptNo}`, 300, 66, { width: RIGHT - 300, align: 'right' })
        .text(d.paidAt ? `Paid on: ${when(d.paidAt)}` : '', 300, 79, { width: RIGHT - 300, align: 'right' });
    y = Math.max(y, 100) + 8;
    doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(1).strokeColor(LINE).stroke();
    y += 14;

    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('YOUR TABLE', LEFT, y);
    y += 14;
    const rows = [['Guest', d.name], ['Phone', d.phone], ['Date', day(d.date)], ['Time', d.time], ['Guests', String(d.party)], ...(d.table ? [['Table', d.table]] : []), ['Booking code', d.code]];
    if (d.note) rows.push(['Note', d.note]);
    for (const [k, v] of rows) {
        doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(k, LEFT, y, { width: 120 });
        doc.font('Helvetica-Bold').fillColor(INK).text(v, LEFT + 130, y, { width: 300 });
        y = Math.max(y, doc.y) + 5;
    }
    y += 8;

    doc.save().rect(LEFT, y, RIGHT - LEFT, 34).fill(BRAND).restore();
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#ffffff').text('BOOKING AMOUNT PAID', LEFT + 12, y + 11, { width: 260 }).text(rs(d.amount), RIGHT - 190, y + 11, { width: 178, align: 'right' });
    y += 46;

    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('Paid online', LEFT, y, { width: 120 });
    doc.font('Helvetica-Bold').fillColor(INK).text(`Payment ID ${d.paymentId}`, LEFT + 130, y, { width: 330 });
    y = doc.y + 5;
    doc.font('Helvetica').fillColor(MUTED).text('What happened to it', LEFT, y, { width: 120 });
    doc.font('Helvetica-Bold').fillColor(d.outcome.tone).text(d.outcome.text, LEFT + 130, y, { width: 330 });
    y = doc.y + 5;
    if (d.refundId) {
        doc.font('Helvetica').fillColor(MUTED).text('Refund ID', LEFT, y, { width: 120 });
        doc.font('Helvetica-Bold').fillColor(INK).text(d.refundId, LEFT + 130, y, { width: 330 });
        y = doc.y + 5;
    }
    if (d.cancelNote) {
        doc.font('Helvetica').fillColor(MUTED).text('Restaurant note', LEFT, y, { width: 120 });
        doc.font('Helvetica-Bold').fillColor(INK).text(d.cancelNote, LEFT + 130, y, { width: 330 });
        y = doc.y + 5;
    }
    y += 12;
    doc.save().rect(LEFT, y, RIGHT - LEFT, 44).fill(SOFT).restore();
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(
        `${d.refundHours !== undefined ? `Full refund if you cancel at least ${d.refundHours} hour${d.refundHours === 1 ? '' : 's'} before the booking, and always if the restaurant cancels. ` : ''}This is a receipt for a booking amount paid online, not a tax invoice. GST, if any, is charged on your final dine-in bill. This document is computer generated.`,
        LEFT + 10, y + 8, { width: RIGHT - LEFT - 20 },
    );
}

// sends the PDF straight to the response
function stream(res, booking, tenant, { inline = false } = {}) {
    const d = dataFor(booking, tenant);
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Booking receipt ${d.receiptNo}`, Author: d.shop.name } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="Booking-${String(d.code).replace(/[^\w-]/g, '')}-receipt.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    doc.pipe(res);
    render(doc, d);
    doc.end();
}

module.exports = { dataFor, render, stream, outcome };
