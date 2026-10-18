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

export function tr(text, vars) {
    if (typeof text !== 'string') return text;
    let s = book[text];
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
        book = bookFor(code);
        set({ lang: code, ready: true });
    },

    setLanguage: async (code) => {
        if (!LANGS.some((l) => l.code === code)) return;
        current = code;
        book = bookFor(code);
        try { await AsyncStorage.setItem(STORE_KEY, code); } catch (e) { /* kept for this run only */ }
        set({ lang: code });
        syncLanguage();
    },
}));
