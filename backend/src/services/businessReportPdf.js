// The monthly progress report as a neat A4 PDF (attached to the monthly email). Everything comes from the report object
// (services/businessReport.js). Standard PDF fonts cannot draw the rupee sign, so amounts use "Rs.".
const PDFDocument = require('pdfkit');

const INK = '#1f2933';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';
const GOOD = '#047857';
const WARN = '#b45309';
const L = 40;
const R = 555;
const W = R - L;

const rs = (n) => `Rs. ${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const change = (c) => (c === null || c === undefined ? 'no earlier period to compare' : `${c >= 0 ? '+' : ''}${c}% vs the period before`);

function kpi(doc, x, y, w, label, value, hint, color = INK) {
    doc.roundedRect(x, y, w, 62, 6).lineWidth(0.8).strokeColor(LINE).stroke();
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(label, x + 10, y + 9, { width: w - 20 });
    doc.font('Helvetica-Bold').fontSize(16).fillColor(color).text(value, x + 10, y + 22, { width: w - 20 });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(hint || '', x + 10, y + 45, { width: w - 20 });
}

function heading(doc, text) {
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(11.5).fillColor(INK).text(text, L, doc.y);
    doc.moveTo(L, doc.y + 2).lineTo(R, doc.y + 2).lineWidth(0.6).strokeColor(LINE).stroke();
    doc.moveDown(0.5);
}

function bars(doc, points, y, h) {
    const max = Math.max(1, ...points.map((p) => p.revenue));
    const slot = W / Math.max(points.length, 1);
    points.forEach((p, i) => {
        const bh = Math.max(1.5, (p.revenue / max) * h);
        doc.rect(L + i * slot + slot * 0.18, y + h - bh, slot * 0.64, bh).fillColor(p.revenue > 0 ? '#2563eb' : LINE).fill();
    });
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
    if (points.length) {
        doc.text(points[0].label, L, y + h + 4, { width: 100 });
        doc.text(points[points.length - 1].label, R - 100, y + h + 4, { width: 100, align: 'right' });
    }
}

function renderReportPdf(report, { shopName = 'Your shop', brandName = 'Your app' } = {}) {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `${shopName} - ${report.range.label}`, Author: brandName } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    const t = report.totals;
    doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text(shopName, L, 40);
    doc.font('Helvetica').fontSize(11).fillColor(MUTED).text(`Progress report - ${report.range.label}`, L, doc.y + 2);

    const kw = (W - 24) / 4;
    const ky = doc.y + 14;
    kpi(doc, L, ky, kw, 'Sales', rs(t.revenue), change(report.change.revenue), report.change.revenue >= 0 ? GOOD : WARN);
    kpi(doc, L + (kw + 8), ky, kw, 'Delivered orders', String(t.orders), change(report.change.orders));
    kpi(doc, L + (kw + 8) * 2, ky, kw, 'Average order', rs(t.avgOrder), change(report.change.avgOrder));
    kpi(doc, L + (kw + 8) * 3, ky, kw, 'Customers', String(report.customers.unique), `${report.customers.newCount} new, ${report.customers.repeatPct}% came back`);
    doc.y = ky + 78;

    heading(doc, report.series.kind === 'day' ? 'Sales day by day' : report.series.kind === 'week' ? 'Sales week by week' : 'Sales month by month');
    const cy = doc.y + 4;
    bars(doc, report.series.points, cy, 70);
    doc.y = cy + 92;

    heading(doc, 'What sells and what people like');
    doc.font('Helvetica').fontSize(9.5).fillColor(INK);
    const line = (k, v) => { doc.fillColor(MUTED).text(`${k}: `, L, doc.y, { continued: true }).fillColor(INK).text(v); };
    line('Best sellers', report.food.top.slice(0, 5).map((x) => `${x.name} (${x.quantity})`).join(', ') || 'none yet');
    line('Best rated', report.food.loved.slice(0, 3).map((x) => `${x.name} (${x.avg} stars)`).join(', ') || 'not enough ratings yet');
    if (report.food.attention.length) line('Needs a look', report.food.attention.slice(0, 3).map((x) => `${x.name} (${x.avg} stars)`).join(', '));
    line('Busiest time', report.busiest.hourLabel ? `${report.busiest.weekday}, around ${report.busiest.hourLabel}` : 'not enough orders yet');

    heading(doc, 'Delivery and money');
    const b = report.delivery.best;
    line('Best delivery partner', b ? `${b.name} (${b.deliveries} deliveries${b.avgMin ? `, about ${Math.round(b.avgMin)} min each` : ''})` : 'no deliveries yet');
    line('Orders cancelled', `${t.cancelled} of ${t.placed} (${t.cancelRate}%), about ${rs(t.cancelledLost)} of food not sold`);
    if (report.value.show) {
        doc.moveDown(0.4);
        line('What the app brought you', `${rs(report.value.revenue)} in sales from ${report.value.orders} orders`);
        line('Estimated marketplace commission avoided', `${rs(report.value.marketplaceCost)} (at ${report.value.commissionPct}%, an estimate)`);
        line('You paid for the app', rs(report.value.feeBilled));
    }

    if (report.tips.length) {
        heading(doc, 'What we suggest');
        report.tips.slice(0, 4).forEach((tip) => {
            doc.font('Helvetica-Bold').fontSize(9.5).fillColor(tip.tone === 'watch' ? WARN : INK).text(`- ${tip.title}`, L, doc.y);
            doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(tip.detail, L + 10, doc.y, { width: W - 10 });
            doc.moveDown(0.3);
        });
    }

    doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(GOOD).text(report.quote, L, doc.y + 8, { width: W, align: 'center' });
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(`${brandName}. Sales count delivered orders on the day they were delivered. Comparisons with other platforms are estimates.`, L, 800, { width: W, align: 'center' });
    doc.end();
    return done;
}

const pdfFileName = (shopName, period) => `${String(shopName).replace(/[^A-Za-z0-9]+/g, '-').slice(0, 30)}-report-${period}.pdf`;

module.exports = { renderReportPdf, pdfFileName };
