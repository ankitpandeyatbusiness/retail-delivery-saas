// Writes the English letters left in a spoken line (a customer's name, a dish) in the script of the voice that reads it, so a Hindi or Marathi voice
// reads "अनिल" and not "Anil" with an English accent. Hindi and Marathi use Devanagari; Gujarati and Bengali get the same sounds in their own script
// (the four scripts keep their letters in the same order, so the Devanagari spelling is moved by a fixed distance).
//
// This is a sound-by-sound writer, not a dictionary: "Ankit" -> "अंकित", "Priya" -> "प्रिया", "Pandey" -> "पंदे", "Paneer" -> "पनीर". A spelling may differ a
// little from the way a person would write it, but the voice says it the way the name sounds. What is left as it is: codes and numbers ("B7K2QX", "#1042"),
// short capital words ("UPI", "QR", "PIN") and units ("Rs", "kg").

const KEEP = new Set(['rs', 'kg', 'gm', 'ml', 'am', 'pm', 'ok', 'upi', 'qr', 'pin', 'gst', 'otp', 'sms', 'wifi', 'whatsapp']);
const MATRA = { a: '', aa: 'ा', i: 'ि', ee: 'ी', ii: 'ी', u: 'ु', oo: 'ू', e: 'े', ai: 'ै', o: 'ो', au: 'ौ' };
const INDEP = { a: 'अ', aa: 'आ', i: 'इ', ee: 'ई', ii: 'ई', u: 'उ', oo: 'ऊ', e: 'ए', ai: 'ऐ', o: 'ओ', au: 'औ' };
const CONS = {
    ksh: 'क्ष', chh: 'छ', kh: 'ख', gh: 'घ', ch: 'च', jh: 'झ', th: 'थ', dh: 'ध', ph: 'फ', bh: 'भ', sh: 'श', ck: 'क',
    k: 'क', g: 'ग', j: 'ज', t: 'त', d: 'द', n: 'न', p: 'प', b: 'ब', m: 'म', y: 'य', r: 'र', l: 'ल', v: 'व', w: 'व', s: 'स', h: 'ह', f: 'फ', z: 'ज', q: 'क', x: 'क्स',
};
const CONS_LONG = ['ksh', 'chh', 'kh', 'gh', 'ch', 'jh', 'th', 'dh', 'ph', 'bh', 'sh', 'ck'];
const VOWELS_LONG = ['aa', 'ai', 'au', 'ee', 'ii', 'oo', 'ou'];

// one lower-case word into sounds: { c: 'devanagari consonant', key } or { v: 'a'|'aa'|... }
function sounds(w) {
    const out = [];
    let i = 0;
    const last = () => out[out.length - 1];
    while (i < w.length) {
        const rest = w.slice(i);
        if (rest === 'ey') { out.push({ v: 'e' }); break; }   // "Pandey" ends like "पंडे"
        let v = VOWELS_LONG.find((s) => rest.startsWith(s));
        if (v === 'ou') v = 'au';
        if (v) { out.push({ v }); i += (v === 'au' && rest.startsWith('ou')) ? 2 : v.length; continue; }
        if ('aeiou'.includes(w[i])) { out.push({ v: w[i] }); i += 1; continue; }
        if (w[i] === 'y' && i === w.length - 1 && last() && last().c) { out.push({ v: 'ee' }); i += 1; continue; }   // "Sunny" ends like "सनी"
        let key = CONS_LONG.find((s) => rest.startsWith(s));
        if (!key) key = w[i];
        if (!CONS[key] && key !== 'c') { i += 1; continue; }   // a sign we do not know: skipped
        const dev = key === 'c' ? (/[eiy]/.test(w[i + 1] || '') ? 'स' : 'क') : CONS[key];
        // a doubled letter ("Butter", "Anna") is said once
        if (last() && last().c && last().key === key) { i += key.length; continue; }
        out.push({ c: dev, key });
        i += key.length;
    }
    return out;
}

// the sounds of a word written in Devanagari
function devanagari(w) {
    const s = sounds(w.toLowerCase());
    if (!s.length) return w;
    const vowelCount = s.filter((x) => x.v).length;
    let out = '';
    let state = 'none';   // none | C (a consonant waiting for its vowel) | V (a vowel or a consonant that has one)
    for (let k = 0; k < s.length; k += 1) {
        const x = s[k];
        const next = s[k + 1];
        if (x.c) {
            // n or m before another consonant is the nasal dot over the sound before it ("Ankit" -> "अंकित")
            if ((x.key === 'n' || x.key === 'm') && state === 'V' && next && next.c && next.key !== 'h' && next.key !== 'y') { out += 'ं'; continue; }
            if (state === 'C') out += '्';   // two consonants together ("Street", "Priya")
            out += x.c;
            state = 'C';
        } else if (state === 'C') {
            let m = x.v;
            if (m === 'a') {
                const end = k === s.length - 1;
                const afterY = next && next.c && next.key === 'y';
                // a name ending in "a" ends in a long sound ("Sita", "Meera"); a short word with one "a" has a long one too ("Raj", "Ram")
                if (end && s.length > 2) m = 'aa';
                else if (vowelCount === 1 && !afterY && s.length >= 3) m = 'aa';
            }
            out += MATRA[m] || '';
            state = 'V';
        } else {
            out += INDEP[x.v];
            state = 'V';
        }
    }
    return out;
}

// the Devanagari spelling moved into the letters of Gujarati or Bengali
function shift(dev, code) {
    return [...dev].map((ch) => {
        const cp = ch.codePointAt(0);
        if (cp < 0x900 || cp > 0x97f) return ch;
        if (code === 'bn' && cp === 0x935) return 'ব';   // Bengali has no separate "v": it uses "b"
        if (code === 'bn' && cp === 0x92f) return 'য়';   // and its "ya" is a letter of its own
        return String.fromCodePoint(cp + (code === 'gu' ? 0x180 : 0x80));
    }).join('');
}

export function inScript(text, code) {
    if (!text || !['hi', 'mr', 'gu', 'bn'].includes(code)) return text;
    return String(text).replace(/[A-Za-z0-9]+/g, (tok) => {
        if (/\d/.test(tok) || tok.length < 2) return tok;                    // a code or a number, or one lone letter
        if (tok === tok.toUpperCase() && tok.length <= 5) return tok;        // UPI, QR, PIN
        if (KEEP.has(tok.toLowerCase())) return tok;
        const dev = devanagari(tok);
        return code === 'gu' || code === 'bn' ? shift(dev, code) : dev;
    });
}
