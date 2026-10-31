// The Soundbox speaks English, Hindi (its own hand-written lines from the server), or Marathi, Gujarati and Bengali.
// For those three the English line is translated here, with the app's translations:
//   1. the whole line ("Minimum order is ₹200")
//   2. the line as "title. body" (most alerts are said that way), each part translated as a whole
//   3. sentence by sentence ("New delivery order. 2 Butter Naan. Total 540 rupees. Cash on delivery.")
// A part with no translation is said as it is (dish names and people's names stay as they are anyway).
import { trIn } from '../../i18n';

export const LOCAL_VOICES = ['mr', 'gu', 'bn'];   // spoken from the English line, translated on the phone
const STOP = { mr: '. ', gu: '. ', bn: '। ' };

// one sentence: as it is, or without its full stop (most translations are kept without one; the stop is put back)
const one = (s, code) => {
    const t = s.trim();
    if (!t) return '';
    // without the stop first, so a value at the end ("...for table {v1}") does not take the full stop with it
    const bare = t.replace(/[.!?।]+$/, '');
    const out = bare !== t ? trIn(bare, code) : null;
    if (out) return `${out}${STOP[code].trim()}`;
    return trIn(t, code) || null;
};
const english = (s) => (String(s).match(/[A-Za-z]/g) || []).length;   // how much is still English (dish names count in every try)

// The line is tried whole, as "title. body" at every sentence end, and sentence by sentence; the try that leaves the least
// English wins (a pattern can match a whole line and keep a sentence as its value: that try loses to a better split).
export function localizeSpeech(text, code) {
    const line = String(text || '').trim();
    if (!line || !LOCAL_VOICES.includes(code)) return line;
    const ends = [...line.matchAll(/[.!?]\s+/g)].map((m) => m.index + 1);
    const tries = [];
    const whole = one(line, code);
    if (whole) tries.push(whole);
    for (const at of ends) {
        const head = one(line.slice(0, at), code);
        const tail = head && one(line.slice(at), code);
        if (head && tail) tries.push(`${head} ${tail}`);
    }
    tries.push(line.split(/(?<=[.!?])\s+/).map((p) => one(p, code) || p).join(' '));
    return tries.reduce((best, t) => (english(t) < english(best) ? t : best));
}
