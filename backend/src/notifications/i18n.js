// Writes a text the server sends (a push title or body) in the person's language, before it leaves.
// The translations come from the app's own translation list: locales/<code>.json is made by mobile/scripts/i18nBuild.js.
// A text is found exactly, or by a pattern with values ("Order #{v1} accepted" for "Order #1042 accepted"); the values
// (order numbers, amounts, names, dishes) are put back as they are. Bhojpuri falls back to Hindi; anything else stays English.
// The same rules as the app (mobile/src/i18n/index.js), so the push and the inbox read the same.
const path = require('path');
const fs = require('fs');

const CODES = ['hi', 'bho', 'mr', 'gu', 'bn'];
const FALLBACK = { bho: 'hi' };
const SLOT = /\{(v\d+)\}/g;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const firstWord = (s) => (String(s).match(/^\S+/) || [''])[0];
const patternKey = (en) => (en.split('{v')[0].match(/^(\S+)\s/) || ['', ''])[1];

const cache = {};   // code -> { book, patterns }

function load(code) {
    if (cache[code]) return cache[code];
    let own = {};
    try { own = JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', `${code}.json`), 'utf8')); } catch (e) { own = {}; }
    const book = FALLBACK[code] ? { ...load(FALLBACK[code]).book, ...own } : own;
    const patterns = new Map();
    for (const [en, to] of Object.entries(book)) {
        if (!en.includes('{v') || typeof to !== 'string' || !to) continue;
        const names = [...en.matchAll(SLOT)].map((m) => m[1]);
        if (!names.length || en.replace(SLOT, '').replace(/[^A-Za-z]/g, '').length < 8) continue;
        const re = new RegExp(`^${en.split(SLOT).map((part, i) => (i % 2 ? '(.*?)' : escapeRe(part))).join('')}$`);
        const key = patternKey(en);
        if (!patterns.has(key)) patterns.set(key, []);
        patterns.get(key).push({ re, names, to, fixed: en.replace(SLOT, '').length });
    }
    for (const list of patterns.values()) list.sort((a, b) => b.fixed - a.fixed);
    cache[code] = { book, patterns };
    return cache[code];
}

// text in the language `code`; the English text when there is no translation (or no text, or English)
function translate(text, code) {
    if (typeof text !== 'string' || !text || !CODES.includes(code)) return text;
    const { book, patterns } = load(code);
    if (typeof book[text] === 'string' && book[text]) return book[text];
    for (const p of [...(patterns.get(firstWord(text)) || []), ...(patterns.get('') || [])]) {
        const m = p.re.exec(text);
        if (m) return p.to.replace(SLOT, (all, name) => { const i = p.names.indexOf(name); return i >= 0 ? m[i + 1] : all; });
    }
    return text;
}

module.exports = { translate, CODES };
