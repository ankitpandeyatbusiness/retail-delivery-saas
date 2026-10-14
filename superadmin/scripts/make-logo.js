/*
 * Draws the app icon, Android adaptive icon and splash logo from src/theme/palette.js,
 * so the logo always matches the app colours.   Run:  npm run logo
 *
 * Output (assets/): icon.png, adaptive-foreground.png, adaptive-background.png, splash-icon.png
 */
const path = require('path');
const sharp = require('sharp');
const palette = require('../src/theme/palette');

const out = path.join(__dirname, '..', 'assets');
const [g1, g2, g3] = palette.brand.gradient;
const { awningA, awningB, badge: dot } = palette.logo;

// a lighter / darker version of a hex colour (amount -1..1)
const shade = (hex, amt) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt));
    return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};
const deep = shade(g2, -0.55);

const awning = [0, 1, 2, 3, 4].map((i) => {
    const x = 262 + i * 100;
    const c = i % 2 ? awningB : awningA;
    return `<rect x="${x}" y="318" width="100" height="82" fill="${c}"/><circle cx="${x + 50}" cy="400" r="50" fill="${c}"/>`;
}).join('');
const awningShadow = [0, 1, 2, 3, 4].map((i) => `<circle cx="${312 + i * 100}" cy="414" r="50" fill="${deep}" fill-opacity="0.3"/>`).join('');

const glyph = `
<g transform="translate(-43,-25)" filter="url(#shadow)">
  <path d="M292 420 H732 V696 a24 24 0 0 1 -24 24 H316 a24 24 0 0 1 -24 -24 Z" fill="#F4F1FF"/>
  <rect x="330" y="486" width="96" height="104" rx="14" fill="${shade(g1, 0.55)}"/>
  <rect x="598" y="486" width="96" height="104" rx="14" fill="${shade(g1, 0.55)}"/>
  <path d="M452 720 V560 a60 60 0 0 1 120 0 V720 Z" fill="url(#door)"/>
  <circle cx="548" cy="640" r="7" fill="#FFFFFF"/>
  ${awningShadow}
  ${awning}
  <rect x="262" y="272" width="500" height="52" rx="26" fill="#FFFFFF"/>
  <circle cx="748" cy="704" r="108" fill="#FFFFFF"/>
  <circle cx="748" cy="704" r="90" fill="url(#badge)"/>
  <polyline points="694,736 728,694 758,716 806,664" fill="none" stroke="#FFFFFF" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="806" cy="664" r="14" fill="${dot}"/>
</g>`;

const defs = `
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${g1}"/><stop offset="0.55" stop-color="${g2}"/><stop offset="1" stop-color="${g3}"/>
  </linearGradient>
  <radialGradient id="glow" cx="0.2" cy="0.12" r="0.8">
    <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.3"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="door" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${g1}"/><stop offset="1" stop-color="${shade(g2, -0.3)}"/></linearGradient>
  <linearGradient id="badge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(g2, -0.2)}"/><stop offset="1" stop-color="${deep}"/></linearGradient>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
    <feDropShadow dx="0" dy="22" stdDeviation="22" flood-color="${deep}" flood-opacity="0.4"/>
  </filter>
</defs>`;

const bgLayer = `
<rect width="1024" height="1024" fill="url(#bg)"/>
<rect width="1024" height="1024" fill="url(#glow)"/>
<circle cx="900" cy="130" r="300" fill="none" stroke="#FFFFFF" stroke-opacity="0.07" stroke-width="2"/>
<circle cx="900" cy="130" r="440" fill="none" stroke="#FFFFFF" stroke-opacity="0.06" stroke-width="2"/>
<circle cx="110" cy="940" r="260" fill="none" stroke="#FFFFFF" stroke-opacity="0.06" stroke-width="2"/>`;

const svg = (body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${defs}${body}</svg>`);

(async () => {
    await sharp(svg(bgLayer + glyph)).png().toFile(path.join(out, 'icon.png'));
    await sharp(svg(glyph)).png().toFile(path.join(out, 'adaptive-foreground.png'));
    await sharp(svg(bgLayer)).png().toFile(path.join(out, 'adaptive-background.png'));
    await sharp(svg(glyph)).png().toFile(path.join(out, 'splash-icon.png'));
    console.log(`Logo written to assets/ from palette (${g1} -> ${g2} -> ${g3})`);
})().catch((e) => { console.error(e); process.exit(1); });
