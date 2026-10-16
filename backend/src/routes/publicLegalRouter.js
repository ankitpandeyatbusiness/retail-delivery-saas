// The Terms of Service and the Privacy Policy as plain web pages, for the store listing and for anybody to read:
//   GET /legal/terms     GET /legal/privacy
// They show the version that was last sent from the admin app (or the draft, with the names filled in, until one is sent).
const express = require('express');
const legal = require('../services/legal');
const { wrap } = require('../middlewares/apiErrors');

const router = express.Router();
const PAGES = { terms: 'customer_terms', privacy: 'privacy' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// "# heading", "- bullet", "1. numbered", else a paragraph
function html(text) {
    const out = [];
    let list = null;
    const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
    for (const raw of String(text).split('\n')) {
        const line = raw.trim();
        if (!line) { close(); continue; }
        let m;
        if ((m = line.match(/^#\s+(.*)$/))) { close(); out.push(`<h2>${esc(m[1])}</h2>`); } else if ((m = line.match(/^-\s+(.*)$/))) {
            if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; }
            out.push(`<li>${esc(m[1])}</li>`);
        } else if ((m = line.match(/^\d+\.\s+(.*)$/))) {
            if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; }
            out.push(`<li>${esc(m[1])}</li>`);
        } else { close(); out.push(`<p>${esc(line)}</p>`); }
    }
    close();
    return out.join('\n');
}

router.get('/:page', wrap(async (req, res) => {
    const key = PAGES[req.params.page];
    if (!key) return res.status(404).type('text/plain').send('Not found');
    const d = await legal.readCurrent(key);
    res.set('Cache-Control', 'public, max-age=300');
    return res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.title)}</title>
<style>body{font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:0 auto;padding:24px 16px;color:#1f2933}h2{font-size:1.15rem;margin:1.6em 0 .4em}h2:first-child{font-size:1.6rem;margin-top:0}li{margin:.3em 0}small{color:#6b7280}</style></head>
<body>${html(d.body)}<p><small>${d.no ? `Version ${d.no}${d.publishedAt ? `, ${new Date(d.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })}` : ''}` : 'Draft'}</small></p></body></html>`);
}));

module.exports = router;
