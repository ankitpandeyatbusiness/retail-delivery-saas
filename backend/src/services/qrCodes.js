// QR codes for printing: the public demo and the dine-in tables.
//
// The code never holds the destination. It holds a SHORT, PERMANENT address on our own server (QR_BASE_URL + /q/...), and the server decides
// where that address leads (routes/qrRedirectRouter.js). So a banner that is already printed keeps working when the website, the app link or
// the demo address changes.
//   <base>/q/demo              -> the public demo website
//   <base>/q/t/<shop>/<table>  -> that table of that shop (the shop's own landing page: the app, or the browser)
//
// Output: SVG and PDF are vector (sharp at any size, for banners); PNG at a chosen pixel size and DPI. Every code has the standard 4 module
// quiet zone and the highest error correction (H). A shop logo in the middle is allowed on TABLE codes only, and is optional. The demo code
// NEVER carries a logo.
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const publicBase = require('../utils/publicBase');
const { httpError } = require('../middlewares/apiErrors');

const QUIET = 4;                 // modules of empty border (the QR standard)
const LOGO_SHARE = 0.2;          // the logo covers at most this share of the code's width (level H can lose 30%)
const MM = 72 / 25.4;            // millimetres to PDF points
const FORMATS = ['svg', 'png', 'pdf'];

const baseOf = (req) => {
    const set = String(process.env.QR_BASE_URL || '').trim().replace(/\/+$/, '');
    return set || publicBase(req);
};
// a printed address must be one we keep for ever: on our own domain, https, not a test host
const isPermanent = (base) => /^https:\/\//i.test(base) && !/localhost|127\.|\.onrender\.com|\.vercel\.app|\.netlify\.app|ngrok/i.test(base);

const demoLink = (req) => `${baseOf(req)}/q/demo`;
const tableLink = (req, slug, table) => `${baseOf(req)}/q/t/${slug}/${table}`;
const demoDestination = () => {
    const set = String(process.env.DEMO_SITE_URL || '').trim().replace(/\/+$/, '');
    if (set) return set;
    const domain = String(process.env.PLATFORM_WEB_DOMAIN || process.env.WEB_BASE_DOMAIN || 'vivyaan.co.in').replace(/^\.+/, '');
    return `https://demo.${domain}`;
};

function checkOptions(o = {}) {
    const format = String(o.format || 'png').toLowerCase();
    if (!FORMATS.includes(format)) throw httpError(400, 'Choose svg, pdf or png');
    const num = (v, d, min, max, what) => {
        if (v === undefined || v === '') return d;
        const n = Number(v);
        if (!Number.isFinite(n) || n < min || n > max) throw httpError(400, `${what} must be from ${min} to ${max}`);
        return Math.round(n);
    };
    return { format, sizePx: num(o.sizePx, 1024, 128, 8192, 'Size in pixels'), dpi: num(o.dpi, 300, 72, 1200, 'DPI'), sizeMm: num(o.sizeMm, 100, 20, 2000, 'Size in millimetres') };
}

// the dark squares of the code as a grid
function matrixOf(text) {
    const q = QRCode.create(String(text), { errorCorrectionLevel: 'H' });
    const n = q.modules.size;
    const dark = (r, c) => !!q.modules.data[r * n + c];
    return { n, dark };
}

// ---- the logo: fetched once, made a small square PNG with a white rounded plate ----
let sharpLib;
const sharp = () => { if (sharpLib === undefined) { try { sharpLib = require('sharp'); } catch (e) { sharpLib = null; } } return sharpLib; };

async function logoPng(url) {
    const s = sharp();
    if (!s || !/^https:\/\//i.test(String(url || ''))) return null;
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return null;
        const raw = Buffer.from(await res.arrayBuffer());
        const SIZE = 320; const PAD = 28;
        const inner = await s(raw).resize(SIZE - PAD * 2, SIZE - PAD * 2, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
        const plate = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><rect width="${SIZE}" height="${SIZE}" rx="56" fill="#fff"/></svg>`);
        return await s(plate).composite([{ input: inner, left: PAD, top: PAD }]).png().toBuffer();
    } catch (e) { return null; }   // a missing logo never stops the QR from being made
}

// ---- SVG ----
function svgOf(text, { logo } = {}) {
    const { n, dark } = matrixOf(text);
    const total = n + QUIET * 2;
    let d = '';
    for (let r = 0; r < n; r += 1) {
        let c = 0;
        while (c < n) {
            if (!dark(r, c)) { c += 1; continue; }
            let end = c;
            while (end < n && dark(r, end)) end += 1;
            d += `M${c + QUIET} ${r + QUIET}h${end - c}v1h-${end - c}z`;   // one run of dark squares in a row
            c = end;
        }
    }
    let extra = '';
    if (logo) {
        const side = Math.floor(n * LOGO_SHARE);
        const x = (total - side) / 2;
        extra = `<image x="${x}" y="${x}" width="${side}" height="${side}" href="data:image/png;base64,${logo.toString('base64')}"/>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${d}" fill="#000"/>${extra}</svg>`;
}

// ---- PNG ----
async function pngOf(text, { sizePx, dpi, logo }) {
    const { n } = matrixOf(text);
    const scale = Math.max(1, Math.floor(sizePx / (n + QUIET * 2)));   // whole pixels per square: sharp edges
    let buf = await QRCode.toBuffer(String(text), { type: 'png', errorCorrectionLevel: 'H', margin: QUIET, scale });
    const s = sharp();
    if (!s) return buf;
    let img = s(buf);
    const exact = (n + QUIET * 2) * scale;
    if (logo) {
        const side = Math.floor(exact * LOGO_SHARE);
        const small = await s(logo).resize(side, side).png().toBuffer();
        img = s(buf).composite([{ input: small, left: Math.floor((exact - side) / 2), top: Math.floor((exact - side) / 2) }]);
    }
    if (exact !== sizePx) img = s(await img.png().toBuffer()).resize(sizePx, sizePx, { kernel: 'nearest' });   // the exact size asked
    return img.withMetadata({ density: dpi }).png().toBuffer();
}

// ---- PDF (vector) ----
function drawQr(doc, text, x, y, side, logo) {
    const { n, dark } = matrixOf(text);
    const unit = side / (n + QUIET * 2);
    doc.rect(x, y, side, side).fill('#FFFFFF');
    doc.fillColor('#000000');
    for (let r = 0; r < n; r += 1) {
        let c = 0;
        while (c < n) {
            if (!dark(r, c)) { c += 1; continue; }
            let end = c;
            while (end < n && dark(r, end)) end += 1;
            doc.rect(x + (c + QUIET) * unit, y + (r + QUIET) * unit, (end - c) * unit + 0.15, unit + 0.15);
            c = end;
        }
    }
    doc.fill('#000000');
    if (logo) {
        const ls = Math.floor(n * LOGO_SHARE) * unit;
        doc.image(logo, x + (side - ls) / 2, y + (side - ls) / 2, { width: ls, height: ls });
    }
}
function pdfBuffer(build, options) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument(options);
        const parts = [];
        doc.on('data', (b) => parts.push(b));
        doc.on('end', () => resolve(Buffer.concat(parts)));
        doc.on('error', reject);
        build(doc);
        doc.end();
    });
}
const pdfOf = (text, { sizeMm, logo }) => {
    const side = sizeMm * MM;
    return pdfBuffer((doc) => drawQr(doc, text, 0, 0, side, logo), { size: [side, side], margin: 0, info: { Title: 'QR code' } });
};

// every table of a shop on A4 pages, 2 across and 3 down, the table number under each code
const sheetOf = (tenant, links, { logo }) => pdfBuffer((doc) => {
    const W = doc.page.width; const H = doc.page.height;
    const cols = 2; const rows = 3; const cellW = W / cols; const cellH = H / rows;
    const side = Math.min(cellW - 60, cellH - 110);
    links.forEach((l, i) => {
        if (i > 0 && i % (cols * rows) === 0) doc.addPage();
        const k = i % (cols * rows);
        const cx = (k % cols) * cellW; const cy = Math.floor(k / cols) * cellH;
        doc.fillColor('#000000').font('Helvetica-Bold').fontSize(13).text(tenant.name, cx, cy + 14, { width: cellW, align: 'center' });
        drawQr(doc, l.url, cx + (cellW - side) / 2, cy + 34, side, logo);
        doc.fillColor('#000000').font('Helvetica-Bold').fontSize(28).text(`Table ${l.table}`, cx, cy + 34 + side + 4, { width: cellW, align: 'center' });
        doc.font('Helvetica').fontSize(10).fillColor('#444444').text('Scan to order from your table', cx, cy + 34 + side + 38, { width: cellW, align: 'center' });
    });
}, { size: 'A4', margin: 0, info: { Title: `${tenant.name} table QR codes` } });

const MIME = { svg: 'image/svg+xml', png: 'image/png', pdf: 'application/pdf' };

// the public demo's code. Never a logo.
async function demoCode(req, opts) {
    const o = checkOptions(opts);
    const text = demoLink(req);
    const body = o.format === 'svg' ? Buffer.from(svgOf(text)) : o.format === 'png' ? await pngOf(text, o) : await pdfOf(text, o);
    return { body, mime: MIME[o.format], name: `demo-qr.${o.format}`, link: text };
}

// one table of a shop, or (table "all", pdf) the whole sheet. logo = the shop's logo in the middle, only when asked.
async function tableCode(req, tenant, { table, logo: wantLogo, ...opts }) {
    const o = checkOptions(opts);
    const count = require('./tableQr').tableCount(tenant);
    const logo = wantLogo ? await logoPng(tenant.logo) : null;
    if (String(table) === 'all') {
        if (o.format !== 'pdf') throw httpError(400, 'All tables come as one PDF sheet. For svg or png pick one table.');
        const links = Array.from({ length: count }, (_, i) => ({ table: i + 1, url: tableLink(req, tenant.slug, i + 1) }));
        return { body: await sheetOf(tenant, links, { logo }), mime: MIME.pdf, name: `${tenant.slug}-table-qr-sheet.pdf`, logoUsed: !!logo };
    }
    const t = Number(table);
    if (!Number.isInteger(t) || t < 1 || t > count) throw httpError(400, `This shop has tables 1 to ${count}`);
    const text = tableLink(req, tenant.slug, t);
    const body = o.format === 'svg' ? Buffer.from(svgOf(text, { logo })) : o.format === 'png' ? await pngOf(text, { ...o, logo }) : await pdfOf(text, { ...o, logo });
    return { body, mime: MIME[o.format], name: `${tenant.slug}-table-${t}.${o.format}`, link: text, logoUsed: !!logo };
}

module.exports = { demoCode, tableCode, demoLink, tableLink, demoDestination, baseOf, isPermanent, checkOptions, svgOf, matrixOf, FORMATS };
