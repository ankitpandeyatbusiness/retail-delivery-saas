// Languages for the customer, owner and rider apps.
//
//   tr('Start duty')                  the text in the person's language; English when there is no translation
//   tr('Order #{no} is ready', { no: 5 })   {name} placeholders are filled in
//   tl('Item missing')                a marker for a text in a module-level list: it returns the English text as it is, and the
//                                     screen shows tr(label) when it draws it (so the language can change later)
//
// The KEY is the English text exactly as written, so a text that has no translation yet simply shows in English and nothing can
// break. Bhojpuri falls back to Hindi, then English. Changing the language redraws the whole app (App.js uses the language as a key).
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import hi from './locales/hi';
import bho from './locales/bho';
import mr from './locales/mr';
import gu from './locales/gu';
import bn from './locales/bn';

export const LANGS = [
    { code: 'en', name: 'English', native: 'English' },
    { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
    { code: 'bho', name: 'Bhojpuri', native: 'भोजपुरी', beta: true },
    { code: 'mr', name: 'Marathi', native: 'मराठी' },
    { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી' },
    { code: 'bn', name: 'Bengali', native: 'বাংলা' },
];

const BOOKS = { hi, bho, mr, gu, bn };
const FALLBACK = { bho: 'hi' };   // a Bhojpuri text that is missing is shown in Hindi, not in English
const STORE_KEY = 'app_language';

let current = 'en';
let book = {};
const bookFor = (code) => (code === 'en' ? {} : { ...(BOOKS[FALLBACK[code]] || {}), ...(BOOKS[code] || {}) });

// Server messages with values inside ("Minimum order is ₹200") are kept as patterns with {v1}, {v2}...
// ("Minimum order is ₹{v1}"). A text with no exact translation is matched against them: the sentence is translated and the
// values are put back. Patterns are grouped by their first word, and answers are remembered, so a screen stays fast.
let patterns = new Map();   // first word -> [{ re, names, to }]
let seen = new Map();       // text -> translated text, or null when nothing matched
const SLOT = /\{(\w+)\}/g;   // any {name}: {v1} of the server messages, and the named slots of the terms and privacy pages ({effectiveDate}, {platformName}...)
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const firstWord = (s) => (String(s).match(/^\S+/) || [''])[0];
// a pattern is found by its first word when that word is fixed text; one that starts with a value is tried for every text
const patternKey = (en) => (en.split(/\{\w+\}/)[0].match(/^(\S+)\s/) || ['', ''])[1];
function buildPatterns(b) {
    const map = new Map();
    for (const [en, to] of Object.entries(b)) {
        if (!/\{\w+\}/.test(en) || typeof to !== 'string' || !to) continue;
        const names = [...en.matchAll(SLOT)].map((m) => m[1]);
        if (!names.length || en.replace(SLOT, '').replace(/[^A-Za-z]/g, '').length < 8) continue;   // enough fixed words to be matched safely
        // a value may be empty: an optional part at the start ("Spice: a table is free") then simply is not there
        const re = new RegExp(`^${en.split(SLOT).map((part, i) => (i % 2 ? '(.*?)' : escapeRe(part))).join('')}$`);
        const key = patternKey(en);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push({ re, names, to, fixed: en.replace(SLOT, '').length });
    }
    for (const list of map.values()) list.sort((a, b) => b.fixed - a.fixed);   // the pattern with the most fixed words is tried first
    return map;
}
function matchPattern(map, text) {
    for (const p of [...(map.get(firstWord(text)) || []), ...(map.get('') || [])]) {
        const m = p.re.exec(text);
        if (m) return p.to.replace(SLOT, (all, name) => { const i = p.names.indexOf(name); return i >= 0 ? m[i + 1] : all; });
    }
    return null;
}
function fromPattern(text) {
    if (seen.has(text)) return seen.get(text);
    const out = matchPattern(patterns, text);
    if (seen.size > 500) seen.clear();
    seen.set(text, out);
    return out;
}
const useBook = (b) => { book = b; patterns = buildPatterns(b); seen = new Map(); };

// A text in one chosen language, whatever language the app shows (the Soundbox voice can speak another language).
// null when there is no translation.
const otherBooks = {};
export function trIn(text, code) {
    if (typeof text !== 'string' || !text || !BOOKS[code]) return null;
    if (!otherBooks[code]) { const b = bookFor(code); otherBooks[code] = { b, p: buildPatterns(b) }; }
    const { b, p } = otherBooks[code];
    return (typeof b[text] === 'string' && b[text]) || matchPattern(p, text);
}

export function tr(text, vars) {
    if (typeof text !== 'string') return text;
    let s = book[text];
    if ((typeof s !== 'string' || s === '') && patterns.size && /[A-Za-z]/.test(text)) s = fromPattern(text);
    if (typeof s !== 'string' || s === '') s = text;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
    return s;
}

export const tl = (text) => text;
export const getLang = () => current;

// the phone's own language, when we have it; else English
const detect = () => {
    try {
        const base = String(Intl.DateTimeFormat().resolvedOptions().locale || 'en').toLowerCase().split(/[-_]/)[0];
        return LANGS.some((l) => l.code === base) ? base : 'en';
    } catch (e) { return 'en'; }
};

// tells the server which language this person reads, so notifications and emails come in it. Best effort.
export async function syncLanguage() {
    try {
        const user = require('../store/common/useAuthStore').useAuthStore.getState().user;
        if (!user) return;
        const api = require('../api/common/client').default;
        await api.put('/auth/language', { language: current });
    } catch (e) { /* tried again at the next start */ }
}

export const useLang = create((set) => ({
    lang: 'en',
    ready: false,

    // once at start (App.js): the saved choice, else the phone's language, else English
    hydrate: async () => {
        let saved = null;
        try { saved = await AsyncStorage.getItem(STORE_KEY); } catch (e) { /* use the phone's language */ }
        const code = LANGS.some((l) => l.code === saved) ? saved : detect();
        current = code;
        useBook(bookFor(code));
        set({ lang: code, ready: true });
    },

    setLanguage: async (code) => {
        if (!LANGS.some((l) => l.code === code)) return;
        current = code;
        useBook(bookFor(code));
        try { await AsyncStorage.setItem(STORE_KEY, code); } catch (e) { /* kept for this run only */ }
        set({ lang: code });
        syncLanguage();
    },
}));
