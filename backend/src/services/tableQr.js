// Table QR stickers. Each table's QR holds a link that is SIGNED by the server, so nobody can invent a table number or print a
// sticker for another shop. The link opens a small page; the page opens the shop's app on that table, or the Play Store when the app is not installed.
const publicBase = require('../utils/publicBase');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { DEFAULTS } = require('./tenantConfigService');

const secret = () => process.env.PHONE_HASH_SECRET || 'dev-only-secret';
const sign = (tenantId, what) => crypto.createHmac('sha256', secret()).update(`tq:${tenantId}:${what}`).digest('base64url').slice(0, 12);
const check = (tenantId, what, k) => {
    const a = Buffer.from(sign(tenantId, what)); const b = Buffer.from(String(k || ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tableCount = (t) => ({ ...DEFAULTS.orders.dineIn, ...(t?.settings?.orders?.dineIn || {}) }).tableCount;

const baseUrl = publicBase;   // PUBLIC_BASE_URL locally, the real address in production (utils/publicBase.js)
const tableUrl = (req, t, table) => `${baseUrl(req)}/api/dinein/t/${t.slug}/${table}?k=${sign(t._id, 'table:' + table)}`;
const printUrl = (req, t) => `${baseUrl(req)}/api/dinein/print/${t.slug}?k=${sign(t._id, 'print')}`;

// the page a scanned QR opens in the phone's browser
function landingHtml({ t, table, k, scheme }) {
    const deep = `${scheme}://table/${table}?k=${encodeURIComponent(k)}`;
    const play = t.androidPackage ? `https://play.google.com/store/apps/details?id=${encodeURIComponent(t.androidPackage)}` : '';
    // Android: open the app, and if it is not installed go to the Play Store by itself
    const intent = `intent://table/${table}?k=${encodeURIComponent(k)}#Intent;scheme=${scheme};${t.androidPackage ? `package=${t.androidPackage};` : ''}${play ? `S.browser_fallback_url=${encodeURIComponent(play)};` : ''}end`;
    const isAndroid = '/Android/i.test(navigator.userAgent)';
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t.name)} · Table ${esc(table)}</title>
<style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f6f6;color:#222}
.c{background:#fff;border-radius:20px;padding:28px 24px;max-width:340px;width:88%;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.08)}
h1{font-size:22px;margin:0 0 4px}p{color:#666;margin:6px 0 18px}a.b{display:block;padding:14px;border-radius:14px;background:#111;color:#fff;text-decoration:none;font-weight:700;margin-top:10px}
a.g{background:#eee;color:#111}</style></head><body><div class="c"><h1>${esc(t.name)}</h1><p>Table ${esc(table)}</p>
<a class="b" id="open" href="${esc(deep)}">Open in the app</a>${play ? `<a class="b g" href="${esc(play)}">Get the app</a>` : ''}</div>
<script>(function(){var a=${isAndroid};var go=a?${JSON.stringify(intent)}:${JSON.stringify(deep)};setTimeout(function(){location.href=go},250);
document.getElementById('open').addEventListener('click',function(e){e.preventDefault();location.href=go;});})();</script></body></html>`;
}

// every table's sticker on printable pages (open this link on a computer and press Print)
// size: small = about 12 a page, medium = 6 a page (2 across, table stand), large = one per page (wall / door)
const SIZES = { small: { box: 220, w: 240 }, medium: { box: 300, w: 350, big: true }, large: { box: 520, w: 600, page: true } };

async function printHtml(req, t, bar = true, size = 'small') {
    const z = SIZES[size] || SIZES.small;
    const n = tableCount(t);
    const cells = [];
    for (let i = 1; i <= n; i++) {
        const svg = await QRCode.toString(tableUrl(req, t, String(i)), { type: 'svg', margin: 1, errorCorrectionLevel: 'M', width: z.box });
        cells.push(`<div class="s"><div class="n">${esc(t.name)}</div>${svg}<div class="t">Table ${i}</div><div class="h">Scan to order from your table</div></div>`);
    }
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t.name)} · table QR stickers</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#fff}.bar{margin-bottom:16px}button{padding:10px 18px;font-size:15px;border-radius:10px;border:0;background:#111;color:#fff}
.g{display:flex;flex-wrap:wrap;gap:12px;${z.page ? 'justify-content:center' : ''}}.s{width:${z.w}px;max-width:100%;border:2px dashed #999;border-radius:14px;padding:12px;text-align:center;page-break-inside:avoid;${z.page ? 'page-break-after:always;margin:0 auto' : ''}}
.s svg{width:${z.box - 20}px;max-width:100%;height:auto}.n{font-weight:700;font-size:${z.page || z.big ? 20 : 16}px}.t{font-size:${z.page ? 44 : z.big ? 36 : 28}px;font-weight:900;margin-top:2px}.h{font-size:${z.page ? 18 : z.big ? 14 : 12}px;color:#555}
@media print{.bar{display:none}body{padding:0}}</style></head><body>${bar ? `<div class="bar"><button onclick="print()">Print stickers</button> ${n} tables</div>` : ''}<div class="g">${cells.join('')}</div></body></html>`;
}

module.exports = { sign, check, tableCount, tableUrl, printUrl, landingHtml, printHtml };
