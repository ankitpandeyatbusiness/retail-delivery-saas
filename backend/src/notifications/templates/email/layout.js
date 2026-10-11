// The ONE look of every email. Tables and inline styles only, so it works in Gmail, Outlook and on phones.
// compose() returns { subject, html, text }. Every dynamic value is escaped here.
const IST = 'Asia/Kolkata';
const FONT = 'Arial,Helvetica,sans-serif';

const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const nl2br = (s) => esc(s).replace(/\r?\n/g, '<br>');
const hex = (c) => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? c : '#1d4ed8');
const safeUrl = (u) => (/^https?:\/\/[^\s"'<>]+$/i.test(u || '') ? u : '');
const present = (v) => v !== null && v !== undefined && v !== '';

const rs = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric' }) : '');
const dateTime = (d) => (d ? new Date(d).toLocaleString('en-IN', {
    timeZone: IST, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
}) : '');
const monthLabel = (period) => new Date(`${period}-01T00:00:00+05:30`)
    .toLocaleString('en-IN', { timeZone: IST, month: 'long', year: 'numeric' });

// ctx = { brand: { name, color, logoUrl }, footer: { legalName, address, gstin }, panelUrl }
// rows = [[label, value]] (a row with an empty value is left out)
// promo = true adds the "stop promotional messages" note
function compose({ ctx = {}, subject, preheader = '', heading, paragraphs = [], rows = [], button = null, note = '', promo = false }) {
    const brand = ctx.brand || {};
    const footer = ctx.footer || {};
    const color = hex(brand.color);
    const brandName = brand.name || 'Our app';
    const logo = safeUrl(brand.logoUrl);
    const link = button ? safeUrl(button.url) : '';
    const shown = rows.filter(([, v]) => present(v)).map(([k, v]) => [k, String(v)]);
    const paras = paragraphs.filter(present);
    const unsub = promo
        ? `You are receiving this promotional message because you use ${brandName}. To stop promotional messages, switch off Promotions in the app settings.`
        : '';
    const legal = [footer.legalName, footer.address, footer.gstin ? `GSTIN: ${footer.gstin}` : ''].filter(Boolean);

    const logoHtml = logo
        ? `<img src="${esc(logo)}" alt="${esc(brandName)}" height="40" style="display:block;border:0;height:40px;max-width:220px;">`
        : `<span style="font-family:${FONT};font-size:22px;font-weight:bold;color:${color};">${esc(brandName)}</span>`;

    const parasHtml = paras.map((p) => `<p style="margin:0 0 14px 0;font-family:${FONT};font-size:15px;line-height:24px;color:#374151;">${nl2br(p)}</p>`).join('');

    const tableHtml = shown.length
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 18px 0;border:1px solid #e5e7eb;border-radius:6px;">${shown.map(([k, v], i) => `<tr><td style="padding:11px 14px;font-family:${FONT};font-size:13px;color:#6b7280;${i ? 'border-top:1px solid #e5e7eb;' : ''}">${esc(k)}</td><td align="right" style="padding:11px 14px;font-family:${FONT};font-size:14px;font-weight:bold;color:#111827;${i ? 'border-top:1px solid #e5e7eb;' : ''}">${esc(v)}</td></tr>`).join('')
        }</table>`
        : '';

    const buttonHtml = link
        ? `<table role="presentation" class="btn" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 6px 0;"><tr><td bgcolor="${color}" style="border-radius:6px;"><a href="${esc(link)}" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">${esc(button.label)}</a></td></tr></table>`
        : '';

    const noteHtml = note
        ? `<p style="margin:18px 0 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:#6b7280;">${nl2br(note)}</p>`
        : '';

    const small = (t) => `<p style="margin:0 0 6px 0;font-family:${FONT};font-size:12px;line-height:18px;color:#6b7280;">${esc(t)}</p>`;
    const footerHtml = [...legal.map(small), small('This is an automated message. Please do not reply to it.'), unsub ? small(unsub) : ''].join('');

    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${esc(subject)}</title>
<style>@media only screen and (max-width:620px){.wrap{width:100%!important}.pad{padding:22px 18px!important}.btn a{display:block!important;text-align:center!important}}</style></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f3f4f6;font-size:1px;line-height:1px;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f4f6"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:8px;">
<tr><td height="6" bgcolor="${color}" style="height:6px;line-height:6px;font-size:0;border-radius:8px 8px 0 0;">&nbsp;</td></tr>
<tr><td class="pad" style="padding:24px 32px 8px 32px;">${logoHtml}</td></tr>
<tr><td class="pad" style="padding:8px 32px 28px 32px;">
<h1 style="margin:0 0 16px 0;font-family:${FONT};font-size:22px;line-height:30px;color:#111827;">${esc(heading)}</h1>
${parasHtml}${tableHtml}${buttonHtml}${noteHtml}
</td></tr>
<tr><td class="pad" style="padding:20px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;border-radius:0 0 8px 8px;">${footerHtml}</td></tr>
</table></td></tr></table></body></html>`;

    const lines = [heading, '', ...paras.flatMap((p) => [p, ''])];
    if (shown.length) lines.push(...shown.map(([k, v]) => `${k}: ${v}`), '');
    if (link) lines.push(`${button.label}: ${link}`, '');
    if (note) lines.push(note, '');
    lines.push('--', ...legal, 'This is an automated message. Please do not reply to it.');
    if (unsub) lines.push(unsub);

    return { subject: String(subject).slice(0, 150), html, text: lines.join('\n') };
}

module.exports = { compose, esc, rs, day, dateTime, monthLabel };