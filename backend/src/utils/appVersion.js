// "1.10.0" is newer than "1.9.0" (numbers, not text). A version we cannot read never blocks anybody.
const RE = /^v?(\d{1,4})(?:\.(\d{1,4}))?(?:\.(\d{1,4}))?(?:\.(\d{1,4}))?/;

function parse(v) {
    if (typeof v !== 'string') return null;
    const m = RE.exec(v.trim());
    if (!m) return null;
    return [1, 2, 3, 4].map((i) => Number(m[i] || 0));
}

// true only when `have` is clearly older than `min`
function isOlder(have, min) {
    const a = parse(have);
    const b = parse(min);
    if (!a || !b) return false;
    for (let i = 0; i < 4; i += 1) if (a[i] !== b[i]) return a[i] < b[i];
    return false;
}

module.exports = { parse, isOlder };