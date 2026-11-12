// "The best colours" for a shop, worked out from ONE colour: its main colour (from the logo, or picked by hand).
// Nobody has to be a designer: the main colour decides the rest.
//
//   main          the colour itself, made just dark enough that white text on it is easy to read (contrast 4.5+)
//   primaryLight  a lighter shade of it (soft backgrounds)
//   primaryDark   a darker shade (pressed buttons)
//   accent        a second colour for offer tags, picked so it is clearly different from the main one
//   error         the alert colour: always a red (people read red as "problem"), made deeper when the brand is red itself
//   text          a very dark tone of the main colour: never pure black, always easy to read
//   background    a very light tone of the main colour: never harsh pure white
const HEX = /^#[0-9a-fA-F]{6}$/;

const toHsl = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h * 60, s, l];
};

const toHex = (h, s, l) => {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return `#${[f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
};

// contrast of a colour against white text (4.5 or more is easy to read)
const contrastWhite = (h, s, l) => {
    const lin = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    const hex = toHex(h, s, l);
    const r = lin(parseInt(hex.slice(1, 3), 16));
    const g = lin(parseInt(hex.slice(3, 5), 16));
    const b = lin(parseInt(hex.slice(5, 7), 16));
    return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
};

const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

const ACCENTS = ['#F59E0B', '#14B8A6', '#6366F1', '#EC4899', '#10B981'];   // amber first: it suits food best

export function bestPalette(main) {
    const base = HEX.test(main || '') ? main : '#E23744';
    const [h0, s0, l0] = toHsl(base);
    const h = s0 < 0.1 ? 215 : h0;   // a grey has no hue: build on a calm slate blue instead of red
    // a grey or near-grey brand colour has no hue to build on: give it a small amount of colour so the shades differ
    const s = Math.min(Math.max(s0, 0.35), 0.9);
    let l = Math.min(Math.max(l0, 0.25), 0.55);
    while (contrastWhite(h, s, l) < 4.5 && l > 0.15) l -= 0.02;

    const redBrand = hueGap(h, 0) < 25;
    const accent = ACCENTS.find((c) => hueGap(toHsl(c)[0], h) >= 40) || ACCENTS[0];
    return {
        primary: toHex(h, s, l),
        primaryLight: toHex(h, s, Math.min(l + 0.07, 0.62)),
        primaryDark: toHex(h, s, Math.max(l - 0.07, 0.1)),
        accent,
        error: redBrand ? '#8F1D1D' : '#C62828',
        text: toHex(h, Math.min(s, 0.22), 0.11),
        background: toHex(h, Math.min(s, 0.3), 0.975),
    };
}

// does white text read easily on this colour? (used to warn about a hard-to-read main colour)
export const readableOnWhiteText = (main) => {
    if (!HEX.test(main || '')) return true;
    const [h, s, l] = toHsl(main);
    return contrastWhite(h, s, l) >= 4.5;
};

// ---- gradient combinations: light -> main -> dark (+ an accent) ----
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const lightnessOf = (hex) => toHsl(hex)[2];

// darken a colour (a little at a time) until white text on it reads easily; a colour that already does is left alone
const fitStop = (hex, min) => {
    if (!HEX.test(hex || '')) return hex;
    let [h, s, l] = toHsl(hex);
    let guard = 0;
    while (contrastWhite(h, s, l) < min && l > 0.08 && guard < 80) { l -= 0.012; guard += 1; }
    return toHex(h, s, l);
};

// one combination, made readable: the main colour easy under white text (4.5), the light end readable for big white headings (about 2.6 to 3), the dark end darker than the main one
export function fitCombo({ light, primary, dark, accent }) {
    const p = fitStop(primary, 4.5);
    let lt = fitStop(light, 2.6);
    let dk = fitStop(dark, 4.5);
    // the light end must really be lighter than the main colour (or the run would be flat): if fitting darkened it too far, lift it just above the main colour, keeping its own hue
    if (lightnessOf(lt) < lightnessOf(p) + 0.03) { const [lh, ls] = toHsl(HEX.test(light || '') ? light : p); lt = toHex(lh, ls, Math.min(lightnessOf(p) + 0.06, 0.68)); }
    if (lightnessOf(dk) > lightnessOf(p)) { const [h, s, l] = toHsl(p); dk = toHex(h, s, Math.max(l - 0.1, 0.08)); }
    return { light: lt, primary: p, dark: dk, accent };
}

// every colour the app uses, from a combination: the three shades and the accent from the combination, and text, page and alert worked out from its main colour
export function comboColours(combo) {
    const c = fitCombo(combo);
    const best = bestPalette(c.primary);
    return { primary: c.primary, primaryLight: c.light, primaryDark: c.dark, accent: c.accent || best.accent, error: best.error, text: best.text, background: best.background };
}

// shades of the main colour, dark to light, to pick the light and dark colours from
export function shadesOf(main) {
    const base = HEX.test(main || '') ? main : '#E23744';
    const [h, s0] = toHsl(base);
    const s = Math.min(Math.max(s0, 0.3), 0.9);
    return [0.16, 0.22, 0.28, 0.34, 0.4, 0.46, 0.52, 0.58, 0.64, 0.7].map((l) => toHex(h, s, l));
}

// six combinations worked out from ONE main colour, to pick from: the plain shades, then the same colour with a warmer, cooler, duo, bolder or softer run
const RECOMMENDED = [
    ['Classic', 0, 0, 1, 0.07, 0.07],
    ['Warm glow', -22, 8, 1.05, 0.14, 0.16],
    ['Cool shift', 24, -8, 1.05, 0.14, 0.16],
    ['Duo', 38, -26, 1.1, 0.16, 0.22],
    ['Bold', 0, 0, 1.2, 0.1, 0.24],
    ['Soft', -8, 6, 0.8, 0.12, 0.12],
];
export function recommendedCombos(main) {
    const b = bestPalette(main);
    const [h, s, l] = toHsl(b.primary);
    return RECOMMENDED.map(([name, dhLight, dhDark, sat, up, down]) => ({
        name,
        group: 'For you',
        ...fitCombo({
            light: toHex((h + dhLight + 360) % 360, clamp(s * sat, 0.2, 0.95), clamp(l + up, 0.1, 0.66)),
            primary: b.primary,
            dark: toHex((h + dhDark + 360) % 360, clamp(s * sat, 0.2, 0.95), clamp(l - down, 0.08, 0.5)),
            accent: b.accent,
        }),
    }));
}

export const PALETTE_LABELS = [
    ['primary', 'Main'], ['primaryLight', 'Light'], ['primaryDark', 'Dark'], ['accent', 'Accent'],
    ['error', 'Alert'], ['text', 'Text'], ['background', 'Page'],
];
