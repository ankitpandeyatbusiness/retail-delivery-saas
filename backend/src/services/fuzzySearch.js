// Typo-tolerant dish search. Customers rarely spell "biryani", "paneer" or "manchurian" the same way twice, so a
// plain substring match returns nothing for "briyani" or "panir". This ranks a shop's dishes against what was typed:
//
//   exact / contained word   -> best
//   word starts with typed   -> "pane" finds "paneer"        (as-you-type)
//   same consonant skeleton  -> "biriyani" = "briyani" = "biryani"
//   a few letters off        -> "chiken", "bargar", "pizzza" (edit distance, more forgiving on longer words)
//
// Pure functions, no database: the router hands in { _id, name, description } rows.

const MIN_SCORE = 0.55;

const normalize = (s) =>
    String(s || '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

const tokens = (s) => normalize(s).split(' ').filter(Boolean);

// How many letters may be wrong, by word length. Short words must be nearly exact or everything matches everything.
const allowed = (len) => (len <= 3 ? 0 : len <= 5 ? 1 : len <= 8 ? 2 : 3);

// Spellings that sound the same in the way Indian food names are usually typed.
const sound = (w) =>
    w
        .replace(/ph/g, 'f')
        .replace(/ck/g, 'k')
        .replace(/q/g, 'k')
        .replace(/w/g, 'v')
        .replace(/z/g, 'j')
        .replace(/x/g, 'ks')
        .replace(/(.)\1+/g, '$1')            // pizzza, kabaab
        .replace(/ee|ii/g, 'i')
        .replace(/oo|uu/g, 'u')
        .replace(/aa/g, 'a')
        .replace(/([tdbgk])h/g, '$1');       // thali/tali, dhosa/dosa, bhaji/baji ("ch" and "sh" are left alone)

// First letter + the consonants after it, so biryani / biriyani / briyani / beryani all become "brn".
const skeleton = (w) => {
    const s = sound(w);
    return s[0] + s.slice(1).replace(/[aeiouy]/g, '');
};

// Damerau-Levenshtein (swapping two neighbours, "pnaeer", counts as ONE mistake), with an early exit.
function distance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const prev2 = [];
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i += 1) {
        const cur = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
            cur[j] = v;
            if (v < rowMin) rowMin = v;
        }
        if (rowMin > max) return max + 1;
        prev2.length = 0;
        prev2.push(...prev);
        prev = cur;
    }
    return prev[b.length];
}

// 0..1 : how well one typed word matches one word of a dish name
function wordScore(q, w) {
    if (q === w) return 1;
    if (q.length >= 2 && w.startsWith(q)) return 0.92;
    if (q.length >= 3 && w.includes(q)) return 0.8;

    const tol = allowed(q.length);
    let best = 0;

    if (tol > 0) {
        const d = distance(q, w, tol);
        if (d <= tol) best = Math.max(best, 0.85 - 0.12 * d);
        // still typing, and a letter is already wrong: compare against the same-length start of the word
        if (w.length > q.length) {
            const dp = distance(q, w.slice(0, q.length), tol);
            if (dp <= tol) best = Math.max(best, 0.78 - 0.12 * dp);
        }
    }

    if (q.length >= 3 && w.length >= 3) {
        const sq = sound(q);
        const sw = sound(w);
        if (sq === sw) best = Math.max(best, 0.82);
        else {
            if (sw.startsWith(sq)) best = Math.max(best, 0.75);
            const kq = skeleton(q);
            const kw = skeleton(w);
            if (kq.length >= 3 && kq === kw) best = Math.max(best, 0.7);
            else if (kq.length >= 3 && kw.startsWith(kq)) best = Math.max(best, 0.62);
        }
    }
    return best;
}

// Score one dish for the typed text. 0 means "not a match".
function scoreName(queryTokens, queryJoined, name) {
    const nameTokens = tokens(name);
    if (!nameTokens.length) return 0;
    const nameJoined = nameTokens.join('');

    // the whole thing typed with no spaces ("buttermasala") or a straight substring
    if (nameJoined === queryJoined) return 1.2;
    if (nameJoined.includes(queryJoined) && queryJoined.length >= 3) return 1.05;

    let sum = 0;
    for (const q of queryTokens) {
        let best = 0;
        for (const w of nameTokens) {
            const s = wordScore(q, w);
            if (s > best) best = s;
            if (best === 1) break;
        }
        if (best === 0) return 0;      // every typed word has to find something
        sum += best;
    }
    let score = sum / queryTokens.length;

    // fewer extra words in the dish name = a closer match ("Paneer" before "Paneer Butter Masala Combo")
    return score - Math.min(0.08, Math.max(0, nameTokens.length - queryTokens.length) * 0.015);
}

// rows: [{ _id, name, description }]  ->  [{ _id, score }] best first, only real matches
function rank(term, rows) {
    const queryTokens = tokens(term);
    if (!queryTokens.length) return [];
    const queryJoined = queryTokens.join('');
    const out = [];

    for (const r of rows) {
        const score = scoreName(queryTokens, queryJoined, r.name);
        if (score >= MIN_SCORE) { out.push({ _id: r._id, score }); continue; }

        // description: exact words only (no guessing there), always ranked below any name match
        if (r.description) {
            const d = ` ${normalize(r.description)} `;
            if (queryTokens.every((q) => q.length >= 3 && d.includes(` ${q}`))) out.push({ _id: r._id, score: 0.3 });
        }
    }
    out.sort((a, b) => b.score - a.score);
    return out;
}

module.exports = { rank, normalize, wordScore, skeleton, distance, MIN_SCORE };
