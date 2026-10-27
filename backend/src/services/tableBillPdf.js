// The detailed bill of one table visit as a PDF, for the guest who started the bill (the one who shared the PIN): every round with the guest's
// name, what was ordered, who paid it and how, the GST by rate, and what each guest ordered, paid and still owes.
// It is a summary of the visit; every served round still has its own tax invoice (services/invoiceService.js).
// The GST follows what each round was really charged: inside the price, or added on top (the dish's own switch).
const PDFDocument = require('pdfkit');
const Order = require('../models/Order');
const TableSession = require('../models/TableSession');
const { HIDE_UNPAID } = require('./onlineOrder');
const invoice = require('./invoiceService');

const DEAD = ['cancelled', 'undelivered'];
const INK = '#1f2933';
const MUTED = '#6b7280';
const LINE = '#d1d5db';
const SOFT = '#f3f4f6';
const BRAND = '#111827';
const OK = '#15803d';
const WARN = '#b45309';
const LEFT = 40;
const RIGHT = 555;
const BOTTOM = 770;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const rs = (n) => `Rs. ${(Number(n) || 0).toFixed(2)}`;
const VIA = { cash: 'cash', upi: 'UPI at the counter', online: 'online' };
const when = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
const clock = (d) => new Date(d).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
// the standard PDF fonts cannot draw every letter: keep what they can, so a name never breaks the page
const safe = (s) => String(s || '').replace(/[^\x20-\x7E -ÿ]/g, '').trim() || 'Guest';

// who may have this bill: the guest who started it (older bills: the first guest on it)
const startedBy = (s) => String((s.startedBy || (s.customers || [])[0]) || '');

// everything the PDF says, as plain data (so it can be checked without drawing)
async function dataFor(session, tenant) {
    const bill = await require('./tableBill').billOf(session, { owner: false });
    const orders = await Order.find({ tenantId: session.tenantId, tableSessionId: session._id, status: { $nin: DEAD }, ...HIDE_UNPAID }).sort({ createdAt: 1 }).lean();
    const byId = new Map(orders.map((o) => [String(o._id), o]));
    const rates = new Map();
    let onTop = 0;
    let included = 0;
    let subtotal = 0;
    let discount = 0;
    const rounds = bill.rounds.map((r, i) => {
        const o = byId.get(r.id) || { items: [], pricing: {} };
        const t = invoice.taxBreakup(o);
        for (const row of t.rows) {
            const g = rates.get(row.rate) || { rate: row.rate, taxable: 0, tax: 0 };
            g.taxable += row.taxable; g.tax += row.tax; rates.set(row.rate, g);
        }
        onTop += t.onTop || 0; included += t.included || 0;
        subtotal += o.pricing?.subtotal || 0; discount += o.pricing?.discount || 0;
        return {
            n: i + 1, orderNo: r.orderNo, at: r.at, by: safe(r.by?.name), total: r.total, paid: r.paid,
            paidBy: r.paidBy ? safe(r.paidBy.name) : null, paidVia: r.paidVia || null, paidAt: r.paidAt || null,
            items: (o.items || []).map((l) => ({ name: safe(l.name), qty: l.quantity, amount: l.lineTotal, gst: l.gstRate || 0 })),
        };
    });
    const starterId = startedBy(session);
    const starter = (bill.shares || []).find((x) => x.userId === starterId);
    return {
        shop: { name: safe(orders[0]?.seller?.name || tenant?.name || 'Shop'), gstin: orders[0]?.seller?.gstin || '', fssai: orders[0]?.seller?.fssai || '', phone: tenant?.phone || '', address: [tenant?.address?.line, tenant?.address?.city, tenant?.address?.pincode].filter(Boolean).join(', ') },
        table: session.table, label: session.label || '', openedAt: session.openedAt, closedAt: session.closedAt || null, startedBy: starter ? safe(starter.name) : 'Guest',
        people: (bill.shares || []).map((x) => ({ name: safe(x.name), ordered: x.total, paid: x.paid, due: x.due })),
        rounds,
        tax: { rows: [...rates.values()].sort((a, b) => a.rate - b.rate).map((g) => ({ rate: g.rate, taxable: round2(g.taxable), tax: round2(g.tax) })), onTop: round2(onTop), included: round2(included) },
        subtotal: round2(subtotal), discount: round2(discount), tip: bill.tip || 0, total: bill.total, paid: round2(bill.total - bill.due), due: bill.due,
    };
}

function ensure(doc, y, need) {
    if (y + need <= BOTTOM) return y;
    doc.addPage();
    return 40;
}

function render(doc, d) {
    doc.font('Helvetica-Bold').fontSize(18).fillColor(BRAND).text(d.shop.name, LEFT, 40, { width: 300 });
    let y = doc.y + 2;
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    for (const line of [d.shop.address, d.shop.phone ? `Phone: ${d.shop.phone}` : '', d.shop.gstin ? `GSTIN: ${d.shop.gstin}` : '', d.shop.fssai ? `FSSAI Lic. No: ${d.shop.fssai}` : ''].filter(Boolean)) { doc.text(line, LEFT, y, { width: 300 }); y = doc.y; }
    doc.font('Helvetica-Bold').fontSize(20).fillColor(BRAND).text('TABLE BILL', 340, 40, { width: RIGHT - 340, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
        .text(`Table ${d.table}${d.label ? ` - Bill ${d.label}` : ''}`, 340, 66, { width: RIGHT - 340, align: 'right' })
        .text(`Seated: ${when(d.openedAt)}`, 340, 79, { width: RIGHT - 340, align: 'right' })
        .text(d.closedAt ? `Closed: ${when(d.closedAt)}` : 'Bill still open', 340, 92, { width: RIGHT - 340, align: 'right' })
        .text(`Bill started by: ${d.startedBy}`, 340, 105, { width: RIGHT - 340, align: 'right' });
    y = Math.max(y, 122) + 8;
    doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(1).strokeColor(LINE).stroke();
    y += 12;

    if (d.people.length > 1) {
        y = ensure(doc, y, 30 + d.people.length * 16);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('WHO ORDERED AND WHO PAID', LEFT, y);
        y += 14;
        for (const p of d.people) {
            doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(p.name, LEFT, y, { width: 200 });
            doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(`ordered ${rs(p.ordered)}`, 250, y, { width: 110, align: 'right' });
            doc.fillColor(OK).text(`paid ${rs(p.paid)}`, 365, y, { width: 90, align: 'right' });
            doc.fillColor(p.due > 0 ? WARN : MUTED).text(p.due > 0 ? `left ${rs(p.due)}` : '-', 460, y, { width: RIGHT - 460, align: 'right' });
            y += 16;
        }
        y += 8;
    }

    for (const r of d.rounds) {
        y = ensure(doc, y, 60 + r.items.length * 15);
        doc.save().rect(LEFT, y, RIGHT - LEFT, 20).fill(SOFT).restore();
        doc.font('Helvetica-Bold').fontSize(10).fillColor(BRAND).text(`Round ${r.n} - ${r.by}`, LEFT + 6, y + 5, { width: 300 });
        doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`#${r.orderNo} - ${clock(r.at)}`, 340, y + 6, { width: RIGHT - 346, align: 'right' });
        y += 26;
        for (const it of r.items) {
            y = ensure(doc, y, 15);
            doc.font('Helvetica').fontSize(10).fillColor(INK).text(`${it.qty} x ${it.name}`, LEFT + 6, y, { width: 360 });
            doc.text(it.gst ? `GST ${it.gst}%` : '', 400, y, { width: 70, align: 'right' });
            doc.text(rs(it.amount), 470, y, { width: RIGHT - 476, align: 'right' });
            y += 15;
        }
        y = ensure(doc, y, 30);
        doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('Round total', LEFT + 6, y + 2, { width: 300 });
        doc.text(rs(r.total), 470, y + 2, { width: RIGHT - 476, align: 'right' });
        y += 16;
        const status = r.paid ? `PAID${r.paidBy ? ` by ${r.paidBy}` : ''}${r.paidVia ? ` (${VIA[r.paidVia] || r.paidVia})` : ' (at the counter)'}${r.paidAt ? `, ${when(r.paidAt)}` : ''}` : 'NOT PAID';
        doc.font('Helvetica-Bold').fontSize(9).fillColor(r.paid ? OK : WARN).text(status, LEFT + 6, y, { width: RIGHT - LEFT - 12 });
        y = doc.y + 10;
    }

    if (d.tax.rows.length) {
        y = ensure(doc, y, 50 + d.tax.rows.length * 15);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('GST BY RATE', LEFT, y);
        y += 14;
        doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED);
        for (const [label, x, w] of [['RATE', LEFT, 60], ['TAXABLE VALUE', 110, 110], ['CGST', 240, 90], ['SGST', 340, 90], ['TOTAL GST', 440, RIGHT - 440]]) doc.text(label, x, y, { width: w, align: x === LEFT ? 'left' : 'right' });
        y += 14;
        doc.font('Helvetica').fontSize(10).fillColor(INK);
        for (const g of d.tax.rows) {
            const cgst = round2(g.tax / 2);
            for (const [v, x, w] of [[`${g.rate}%`, LEFT, 60], [rs(g.taxable), 110, 110], [rs(cgst), 240, 90], [rs(round2(g.tax - cgst)), 340, 90], [rs(g.tax), 440, RIGHT - 440]]) doc.text(v, x, y, { width: w, align: x === LEFT ? 'left' : 'right' });
            y += 15;
        }
        y += 6;
    }

    y = ensure(doc, y, 150);
    const bx = 340;
    const bw = RIGHT - bx;
    const rows = [['Subtotal', rs(d.subtotal)]];
    if (d.discount) rows.push(['Discount', `- ${rs(d.discount)}`]);
    if (d.tax.onTop) rows.push(['GST added on top', rs(d.tax.onTop)]);
    if (d.tip) rows.push(['Tip for the waiter', rs(d.tip)]);
    doc.font('Helvetica').fontSize(10);
    for (const [k, v] of rows) { doc.fillColor(MUTED).text(k, bx, y, { width: bw - 100 }); doc.fillColor(INK).text(v, bx + bw - 100, y, { width: 100, align: 'right' }); y += 16; }
    y += 4;
    doc.save().rect(bx, y, bw, 28).fill(BRAND).restore();
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff').text('TOTAL', bx + 10, y + 9, { width: 80 }).text(rs(d.total + d.tip), bx + bw - 150, y + 9, { width: 140, align: 'right' });
    y += 34;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(OK).text('Paid', bx, y, { width: bw - 100 }).text(rs(d.paid), bx + bw - 100, y, { width: 100, align: 'right' });
    y += 16;
    doc.fillColor(d.due > 0 ? WARN : MUTED).text('Still to pay', bx, y, { width: bw - 100 }).text(rs(d.due), bx + bw - 100, y, { width: 100, align: 'right' });
    y += 20;
    if (d.tax.included) { doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`Total includes GST of ${rs(d.tax.included)}`, bx, y, { width: bw, align: 'right' }); y += 14; }
    y = ensure(doc, y + 10, 40);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('This is the summary of the whole table visit. Each round that was served also has its own tax invoice in the app. This document is computer generated.', LEFT, y, { width: RIGHT - LEFT });
}

// sends the PDF straight to the response
async function stream(res, session, tenant, { inline = false } = {}) {
    const d = await dataFor(session, tenant);
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Table ${d.table} bill`, Author: d.shop.name } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="Table-${String(d.table).replace(/[^\w-]/g, '')}-bill.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    doc.pipe(res);
    render(doc, d);
    doc.end();
}

// the starter's latest finished visit (for the "download" on his bill screen after the table was freed): within two days
async function lastFor(tenantId, userId) {
    const rows = await TableSession.find({ tenantId, status: 'closed', walkout: { $ne: true }, kind: { $ne: 'pickup' }, closedAt: { $gte: new Date(Date.now() - 2 * 86400000) }, $or: [{ startedBy: userId }, { startedBy: { $exists: false }, customers: userId }, { startedBy: { $exists: false }, 'left.userId': userId }] }).sort({ closedAt: -1 }).limit(5).lean();
    return rows.find((s) => startedBy(s) === String(userId)) || null;
}

// the visit is over: the guest who started it is told his detailed bill is ready
function notifyReady(s) {
    const id = startedBy(s);
    if (!id) return;
    Promise.resolve().then(() => require('../notifications/center').notify('table_bill_ready', { tenantId: s.tenantId, userId: id, vars: { table: s.table }, data: { kind: 'table_bill', sessionId: String(s._id), table: s.table } })).catch((e) => console.error('Notification error:', e.message));
}

module.exports = { dataFor, stream, render, startedBy, lastFor, notifyReady };
