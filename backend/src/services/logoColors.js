const sharp = require('sharp');

const rgbToHsl = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
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

const hslToRgb = (h, s, l) => {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
};

const toHex = (h, s, l) =>
    `#${hslToRgb(h, s, l).map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

// contrast of a colour against white text (4.5 or more is easy to read)
const contrastWithWhite = (h, s, l) => {
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const [r, g, b] = hslToRgb(h, s, l);
    return 1.05 / (0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) + 0.05);
};

/**
 * input: image Buffer or file path (png, jpg, webp).
 * returns { primary, primaryLight, primaryDark } or null when the logo has no usable colour
 * (all white, black or grey, or fully transparent).
 */
async function pickBrandColors(input) {
    const { data, info } = await sharp(input)
        .resize(64, 64, { fit: 'inside' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    // 24 colour families of 15 degrees; red sits in the middle of family 0 so it is not split in two
    const bins = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
    for (let i = 0; i < data.length; i += info.channels) {
        if (data[i + 3] < 128) continue;                           // transparent
        const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
        if (s < 0.25 || l < 0.12 || l > 0.92) continue;            // grey, near black, near white
        const bin = bins[Math.floor(((h + 7.5) % 360) / 15)];
        bin.w += s;
        bin.r += data[i] * s; bin.g += data[i + 1] * s; bin.b += data[i + 2] * s;
    }

    const best = bins.reduce((a, b) => (b.w > a.w ? b : a));
    if (best.w === 0) return null;

    let [h, s, l] = rgbToHsl(best.r / best.w, best.g / best.w, best.b / best.w);
    s = Math.min(s, 0.85);                                         // soften neon colours
    l = Math.min(Math.max(l, 0.3), 0.5);                           // not too pale, not too dark
    while (contrastWithWhite(h, s, l) < 4.5 && l > 0.15) l -= 0.02; // white text must stay readable

    return {
        primary: toHex(h, s, l),
        primaryLight: toHex(h, s, Math.min(l + 0.07, 0.6)),
        primaryDark: toHex(h, s, Math.max(l - 0.07, 0.1)),
    };
}

module.exports = { pickBrandColors };