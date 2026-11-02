// The ticks of a chat message (sent, delivered, read) must always be seen on the message's own background, whatever colours the shop chose.
// So they are not fixed colours: each is picked from a short list as the first that has enough contrast against the background, and the
// "read" tick is never the same colour as the grey ones.
const hexOf = (c) => {
    const s = String(c || '').trim();
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
    if (!m) return null;
    const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const lin = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);

// WCAG contrast ratio, 1 to 21 (3 and more is enough for an icon)
export function contrast(a, b) {
    const A = hexOf(a); const B = hexOf(b);
    if (!A || !B) return 1;
    const x = lum(A); const y = lum(B);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const GREYS = ['#8696A0', '#667781', '#B8C0C7', '#FFFFFF', '#1F2933'];
const READS = ['#34B7F1', '#0A84FF', '#00C2A8', '#FFD60A', '#FFFFFF', '#111827'];

// -> { sent, delivered, read } colours for ticks drawn on `bg` (a #hex colour)
export function tickColors(bg) {
    const best = (list) => list.reduce((a, c) => (contrast(c, bg) > contrast(a, bg) ? c : a), list[0]);
    const grey = GREYS.find((c) => contrast(c, bg) >= 3) || best(GREYS);
    const read = READS.find((c) => c !== grey && contrast(c, bg) >= 3) || best(READS.filter((c) => c !== grey));
    return { sent: grey, delivered: grey, read };
}
