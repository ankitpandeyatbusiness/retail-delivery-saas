// Search for the shop menu. Forgiving: it finds a word even when it is only part of a longer word, when the first letters are typed,
// and when the spelling is a little off ("custmer", "reffer"). Every word typed has to be found somewhere in the entry
// (its name, what it says under the name, the words hidden inside that screen, or its section).

export const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, ' ').replace(/\s+/g, ' ').trim();

// edit distance (a swapped pair of letters counts as one slip), given up on above max
function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev2 = null;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i += 1) {
        const cur = [i];
        let low = i;
        for (let j = 1; j <= b.length; j += 1) {
            let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
            cur[j] = v;
            if (v < low) low = v;
        }
        if (low > max) return max + 1;
        prev2 = prev;
        prev = cur;
    }
    return prev[b.length];
}

// how well one typed word fits one word of the entry: 0 = not at all, 100 = the same
function wordScore(q, w) {
    if (q === w) return 100;
    if (q.length >= 2 && w.startsWith(q)) return 85;
    if (q.length >= 3 && w.includes(q)) return 65;
    // a longer word with the same first letter may have two slips ("copun" for coupon)
    const tol = q.length <= 3 ? 0 : q.length >= 5 && q[0] === w[0] ? 2 : q.length <= 5 ? 1 : 2;
    if (!tol) return 0;
    const d = lev(q, w, tol);
    if (d <= tol) return 55 - d * 10;
    const dp = lev(q, w.slice(0, q.length), tol);   // typed only the start of the word, with a slip
    return dp <= tol ? 45 - dp * 10 : 0;
}

// fields: [[text, weight], ...]. -> 0 when a typed word is nowhere, else a score (bigger = better)
export function matchScore(query, fields) {
    const qs = norm(query).split(' ').filter(Boolean);
    if (!qs.length) return 0;
    const prepared = fields.map(([text, weight]) => [[...new Set(norm(text).split(' ').filter(Boolean))], weight]);
    let total = 0;
    for (const q of qs) {
        let best = 0;
        for (const [words, weight] of prepared) {
            for (const w of words) {
                const sc = wordScore(q, w) * weight;
                if (sc > best) best = sc;
            }
        }
        if (!best) return 0;
        total += best;
    }
    return total;
}

// entries: [{ title, subtitle, words, group, ... }] -> the ones that fit, best first
export function searchMenu(entries, query, titleOf = (e) => e.title) {
    return entries
        .map((e) => ({ e, sc: matchScore(query, [[titleOf(e), 1], [e.subtitle, 0.8], [e.words, 0.7], [e.group, 0.55]]) }))
        .filter((x) => x.sc > 0)
        .sort((a, b) => b.sc - a.sc)
        .map((x) => x.e);
}
