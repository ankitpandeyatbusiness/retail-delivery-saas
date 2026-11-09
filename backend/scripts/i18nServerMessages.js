// Collects the fixed messages the server sends to the customer, owner and rider apps (httpError(status, 'text') and
// error: 'text'), into mobile/scripts/i18n-server.json, so they can be translated. The apps show a server message as it comes and
// the translation net (mobile/src/i18n/textPatch.js) translates the ones that match exactly or match a pattern.
// Messages with a value inside (made with ${...}) are saved as patterns with {v1}, {v2}... Superadmin-only files are left out.
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
    /\bmessage\s*=\s*'((?:[^'\\]|\\.)*)'/g,   // a message set with = (services/channelSwitch.js)
    // the first sentence of an either/or message: httpError(409, n === 1 ? 'One sentence' : `Other ${n} sentence`)
    /(?:httpError\(\s*\d{3}\s*,|\b(?:error|message):)\s*[^,'"`?]+\?\s*'((?:[^'\\]|\\.)*)'/g,
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
// Messages with values inside: each ${...} becomes {v1}, {v2}... The app matches a message against these patterns
// (mobile/src/i18n/index.js) and puts the values back into the translated sentence.
const toPattern = (raw) => {
    let out = '';
    let n = 0;
    for (let i = 0; i < raw.length; i += 1) {
        if (raw[i] === '\\' && i + 1 < raw.length) { out += raw[i + 1] === 'n' ? ' ' : raw[i + 1]; i += 1; continue; }
        if (raw[i] === '$' && raw[i + 1] === '{') {
            let depth = 1;
            let j = i + 2;
            for (; j < raw.length && depth; j += 1) { if (raw[j] === '{') depth += 1; else if (raw[j] === '}') depth -= 1; }
            if (depth) return null;
            n += 1;
            out += `{v${n}}`;
            i = j - 1;
            continue;
        }
        out += raw[i];
    }
    return out.trim();
};
const literal = (p) => p.replace(/\{v\d+\}/g, '').replace(/[^A-Za-z]/g, '');
const TEMPLATE = [
    /httpError\(\s*\d{3}\s*,\s*`((?:[^`\\]|\\.)*)`/g,
    /\b(?:error|message):\s*`((?:[^`\\]|\\.)*)`/g,
    // the second sentence of an either/or message (see PATTERNS)
    /(?:httpError\(\s*\d{3}\s*,|\b(?:error|message):)\s*[^,'"`?]+\?\s*'(?:[^'\\]|\\.)*'\s*:\s*`((?:[^`\\]|\\.)*)`/g,
];
const patterns = new Set();
for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const re of TEMPLATE) {
        for (const m of src.matchAll(re)) {
            if (!m[1].includes('${')) continue;
            const p = toPattern(m[1]);
            if (!p || p.length > 220 || !/^[A-Z"'₹{]/.test(p) || literal(p).length < 8 || /\{v\d+\}\{v\d+\}/.test(p) || /Razorpay/.test(p)) continue;   // a sentence with enough fixed words to be matched safely
            patterns.add(p);
        }
    }
}

// Push and inbox texts: the patterns of templates/texts.js, and the title/body of the notifications that services and jobs
// write themselves (ring(..., { title: `Table ${t}: ...` })). Speech lines (speech:, speechHi:) are not collected here.
for (const p of require('../src/notifications/templates/textPatterns')) patterns.add(p);
const pushFiles = [];
const walkAll = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walkAll(p); else if (/\.js$/.test(e.name) && !SKIP.test(p) && !/templates/.test(p)) pushFiles.push(p);
    }
};
['services', 'jobs', 'notifications'].forEach((d) => walkAll(path.join(SRC, d)));
// also a body written as a variable: body = cond ? `template` : 'text' (services/planLifecycle.js)
const NOTE_FIXED = /(?:\b(?:title|body):\s*|\bbody\s*=\s*|`\s*:\s*)'((?:[^'\\]|\\.)*)'/g;
const NOTE_TEMPLATE = /(?:\b(?:title|body):\s*|\bbody\s*=\s*[^`'\n?]*\?\s*)`((?:[^`\\]|\\.)*)`/g;
for (const f of pushFiles) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(NOTE_FIXED)) {
        const text = unquote("'", m[1]).trim();
        if (text.length >= 8 && /\s/.test(text) && /^[A-Z"'₹]/.test(text)) found.add(text);
    }
    for (const m of src.matchAll(NOTE_TEMPLATE)) {
        const p = m[1].includes('${') ? toPattern(m[1]) : m[1].trim();
        if (!p || p.length > 220 || /\{v\d+\}\{v\d+\}/.test(p) || literal(p).length < 8) continue;
        (p.includes('{v') ? patterns : found).add(p);
    }
}

const list = [...found, ...patterns].sort();
fs.writeFileSync(OUT, JSON.stringify(list, null, 1));
console.log(`${found.size} fixed + ${patterns.size} with values = ${list.length} server messages -> ${path.relative(process.cwd(), OUT)}`);
