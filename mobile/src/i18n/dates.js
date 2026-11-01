// Month names, day names and AM/PM inside a date text ("5 Nov, 9:18 PM", "Mon, 12 Jan", "November 2026") written in the person's language.
// The app draws dates in many places (lists, cards, sheets, charts, receipts); each builds its text its own way, so this runs on the finished
// text: once on whatever a Text draws, and once on what Date.toLocaleString / toLocaleDateString / toLocaleTimeString return.
import { tr, getLang } from './index';

const MON = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
const DOW = 'Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:r(?:s(?:day)?)?)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?';
const FULL = { Sept: 'September', Tues: 'Tue', Thur: 'Thu', Thurs: 'Thu' };
const word = (w) => tr(FULL[w] || w);

// inside ordinary text only where the words clearly belong to a date (a number next to them), so "May I help" or "Sun" alone is left alone
const IN_TEXT = [
    [new RegExp('\\b(\\d{1,2})(st|nd|rd|th)?,? (' + MON + ')\\b', 'g'), (m, d, s, mo) => d + ' ' + word(mo)],
    [new RegExp('\\b(' + MON + ') (\\d{1,2}|\\d{4})\\b', 'g'), (m, mo, n) => word(mo) + ' ' + n],
    [new RegExp('\\b(' + DOW + '),? (?=\\d)', 'g'), (m, d) => word(d) + ', '],
    [new RegExp('\\b(' + DOW + '),', 'g'), (m, d) => word(d) + ','],
    [new RegExp('(\\d ?)(AM|PM|am|pm)\\b', 'g'), (m, n, ap) => n + tr(ap.toUpperCase())],
];
// what a Date prints is only a date, so every month, day and AM/PM word in it is translated
const IN_DATE = [
    [new RegExp('\\b(' + MON + ')\\b', 'g'), (m, mo) => word(mo)],
    [new RegExp('\\b(' + DOW + ')\\b', 'g'), (m, d) => word(d)],
    [/\b(AM|PM|am|pm)\b/g, (m, ap) => tr(ap.toUpperCase())],
];

const run = (text, rules) => rules.reduce((s, [re, fn]) => s.replace(re, fn), text);

export function localizeDatesInText(text) {
    if (typeof text !== 'string' || getLang() === 'en' || !/\d/.test(text)) return text;
    return run(text, IN_TEXT);
}
export function localizeDateOutput(text) {
    if (typeof text !== 'string' || getLang() === 'en') return text;
    return run(text, IN_DATE);
}
