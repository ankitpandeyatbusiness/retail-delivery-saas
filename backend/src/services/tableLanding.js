// The page a table QR opens in a phone's browser ("smart table QR"). It decides what the guest sees, by phone type and by what the superadmin
// filled in for the shop (Shop > Edit > Opening the app: a Play Store link and an App Store link, both optional):
//
//   desktop computer              -> the shop's website, straight away
//   Android, app installed        -> the app opens on that table
//   Android, app NOT installed    -> Play Store link filled:  two buttons, "Open in the store" and "Continue in browser"
//                                    Play Store link empty:   the shop's website, straight away
//   iPhone / iPad: the same with the App Store link
//   (a phone type whose store link is empty goes straight to the website, even when the other type has a link)
//
// The Play Store link carries the table (Play "referrer"): after the guest installs and signs in, the app reads it and selects the table by
// itself (mobile/src/utils/customers/installReferrer.js). An iPhone cannot carry anything through the App Store, so after installing the app asks to
// scan the table QR again (a line on this page says so).
const { sign } = require('./tableQr');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const platformOf = (ua) => {
    const s = String(ua || '');
    if (/android/i.test(s)) return 'android';
    if (/iphone|ipad|ipod/i.test(s) || (/macintosh/i.test(s) && /mobile/i.test(s))) return 'ios';
    return 'other';
};

// the shop's website. SHOP_WEB_URL_TEMPLATE like https://{slug}.vivyaan.co.in, else the platform domain.
function shopWebBase(slug) {
    const tpl = String(process.env.SHOP_WEB_URL_TEMPLATE || '').trim();
    if (tpl) return tpl.replace('{slug}', slug).replace(/\/+$/, '');
    const domain = String(process.env.PLATFORM_WEB_DOMAIN || process.env.WEB_BASE_DOMAIN || 'vivyaan.co.in').replace(/^\.+/, '');
    return `https://${slug}.${domain}`;
}

// the table the guest sits at, in the Play Store link (the app reads it back after the install)
function withReferrer(playUrl, { slug, table, k }) {
    try {
        const u = new URL(playUrl);
        u.searchParams.set('referrer', `shop=${slug}&table=${table}&k=${k}`);
        return u.toString();
    } catch (e) { return playUrl; }
}

// what the page will do, decided here so it can be tested without a browser
function plan({ t, table, k, ua }) {
    const platform = platformOf(ua);
    const links = (t && t.appLinks) || {};
    const web = `${shopWebBase(t.slug)}/?table=${encodeURIComponent(table)}&k=${encodeURIComponent(k)}`;
    const store = platform === 'android' ? (links.playStoreUrl ? withReferrer(links.playStoreUrl, { slug: t.slug, table, k }) : '')
        : platform === 'ios' ? (links.appStoreUrl || '') : '';
    const deep = `${t.slug}://table/${table}?k=${encodeURIComponent(k)}`;
    const intent = `intent://table/${table}?k=${encodeURIComponent(k)}#Intent;scheme=${t.slug};${t.androidPackage ? `package=${t.androidPackage};` : ''}end`;
    return {
        platform, web, store, deep, intent,
        tryApp: platform !== 'other',                       // a phone first tries to open the app
        choice: platform !== 'other' && !!store,            // and, when the app is not there, offers the store or the browser
        straightToWeb: platform === 'other',                // a computer never sees the page
    };
}

function html({ t, table, k, ua }) {
    const p = plan({ t, table, k, ua });
    const data = JSON.stringify({ tryApp: p.tryApp, choice: p.choice, web: p.web, open: p.platform === 'android' ? p.intent : p.deep, direct: p.straightToWeb }).replace(/</g, '\\u003c');
    const ios = p.platform === 'ios';
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t.name)} · Table ${esc(table)}</title>
<style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f6f6;color:#222}
.c{background:#fff;border-radius:20px;padding:28px 24px;max-width:340px;width:88%;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.08)}
h1{font-size:22px;margin:0 0 4px}p{color:#666;margin:6px 0 18px}a.b{display:block;padding:14px;border-radius:14px;background:#111;color:#fff;text-decoration:none;font-weight:700;margin-top:10px}
a.g{background:#eee;color:#111}.n{font-size:12px;color:#888;margin-top:14px}#choice{display:none}</style></head>
<body><div class="c"><h1>${esc(t.name)}</h1><p>Table ${esc(table)}</p>
<div id="wait"><p>Opening…</p></div>
<div id="choice"><a class="b" id="store" href="${esc(p.store || '#')}">Open in the store</a><a class="b g" id="web" href="${esc(p.web)}">Continue in browser</a>${ios ? '<p class="n">After you install the app, open it and scan this table\'s QR code again.</p>' : ''}</div>
<noscript><a class="b" href="${esc(p.web)}">Continue in browser</a></noscript></div>
<script>(function(){var c=${data};
if(c.direct){location.replace(c.web);return;}
function done(){return document.hidden;}
if(c.tryApp){setTimeout(function(){location.href=c.open;},150);}
setTimeout(function(){
 if(done())return;   /* the app opened: nothing more to do */
 if(c.choice){document.getElementById('wait').style.display='none';document.getElementById('choice').style.display='block';}
 else{location.replace(c.web);}
},1800);})();</script></body></html>`;
}

module.exports = { html, plan, platformOf, shopWebBase, withReferrer, sign };
