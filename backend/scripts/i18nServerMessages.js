// Collects the fixed messages the server sends to the customer, owner and rider apps (httpError(status, 'text') and
// error: 'text'), into mobile/scripts/i18n-server.json, so they can be translated. The apps show a server message as it comes and
// the translation net (mobile/src/i18n/textPatch.js) translates the ones that match exactly. Messages with a value inside
// (made with ${...}) stay English. Superadmin-only files are left out.
//
//   node scripts/i18nServerMessages.js
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../src');
const OUT = path.resolve(__dirname, '../../mobile/scripts/i18n-server.json');
const SKIP = /(admin[A-Z]\w*Router|adminRouter|requireSuperAdmin|supreme|adminOtp|operators|settlement|agreements|superAdmin|platformInvoicing|legalTemplates|backup|adminAlerts|liveSnapshot\.js|apiErrors)/;

const files = [];
const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (!/(scripts|jobs|models|config)$/.test(p)) walk(p); } else if (/\.js$/.test(e.name) && !SKIP.test(p)) files.push(p);
    }
};
walk(SRC);

const found = new Set();
const unquote = (q, s) => s.split(`\\${q}`).join(q).split('\\n').join(' ');
const PATTERNS = [
    /httpError\(\s*\d{3}\s*,\s*'((?:[^'\\]|\\.)*)'/g,
    /httpError\(\s*\d{3}\s*,\s*"((?:[^"\\]|\\.)*)"/g,
    /httpError\(\s*\d{3}\s*,\s*`([^`$]*)`/g,
    /\berror:\s*'((?:[^'\\]|\\.)*)'/g,
    /\bmessage:\s*'((?:[^'\\]|\\.)*)'/g,
];
for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const re of PATTERNS) {
        for (const m of src.matchAll(re)) {
            const text = unquote("'", m[1]).trim();
            if (text.length < 8 || text.length > 220 || !/\s/.test(text) || !/^[A-Z"']/.test(text)) continue;   // a sentence, not a code
            if (/\$\{/.test(text)) continue;
            found.add(text);
        }
    }
}
const list = [...found].sort();
fs.writeFileSync(OUT, JSON.stringify(list, null, 1));
console.log(`${list.length} server messages -> ${path.relative(process.cwd(), OUT)}`);
