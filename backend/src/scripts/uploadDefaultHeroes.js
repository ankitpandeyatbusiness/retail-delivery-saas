// Puts the platform default hero images in the bucket at defaults/hero/ (shown for any shop with no hero images).
//   node src/scripts/uploadDefaultHeroes.js                 -> 3 neutral generated placeholders
//   node src/scripts/uploadDefaultHeroes.js <folder>        -> your own images (jpg, png, webp), in file name order
// Files already in defaults/hero/ that are not part of this upload are deleted, so the folder always matches what you sent.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const storage = require('../services/adapters/storage');
const { toWebp } = require('../services/imageProcessor');
const { PREFIX } = require('../services/defaultHeroes');

const W = 1067;
const H = 1600;

// soft dark gradients with a few light circles: neutral under any shop's colours, the brand name sits on top
const PLACEHOLDERS = [
    ['#1f2430', '#3a4256', '#8a93a8'],
    ['#241f2e', '#463a5c', '#a393c4'],
    ['#1c2a2a', '#2f4f4f', '#7fb3a8'],
];
const svg = ([a, b, c]) => Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="0.6" stop-color="${b}"/><stop offset="1" stop-color="${a}"/></linearGradient></defs>` +
    `<rect width="100%" height="100%" fill="url(#g)"/>` +
    `<circle cx="${W * 0.78}" cy="${H * 0.28}" r="${W * 0.42}" fill="${c}" fill-opacity="0.16"/>` +
    `<circle cx="${W * 0.18}" cy="${H * 0.52}" r="${W * 0.3}" fill="${c}" fill-opacity="0.10"/>` +
    `<circle cx="${W * 0.62}" cy="${H * 0.74}" r="${W * 0.22}" fill="${c}" fill-opacity="0.12"/>` +
    `</svg>`);

(async () => {
    if (process.env.STORAGE_MOCK === 'true') throw new Error('STORAGE_MOCK is true: this would not reach the real bucket');
    const folder = process.argv[2];
    let inputs;
    if (folder) {
        const names = fs.readdirSync(folder).filter((n) => /\.(png|jpe?g|webp)$/i.test(n))
            .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
        if (!names.length) throw new Error(`No images in ${folder}`);
        inputs = names.map((n) => fs.readFileSync(path.join(folder, n)));
    } else {
        const sharp = require('sharp');
        inputs = await Promise.all(PLACEHOLDERS.map((p) => sharp(svg(p)).png().toBuffer()));
    }

    const keys = [];
    for (let i = 0; i < inputs.length; i += 1) {
        const img = await toWebp(inputs[i], { maxSide: 1600 });
        const key = `${PREFIX}hero-${i + 1}.webp`;
        await storage.put({ key, buffer: img.buffer, contentType: 'image/webp' });
        keys.push(key);
        console.log(`upload ${key}  ${img.width}x${img.height}  ${img.bytes} bytes`);
    }
    for (const o of await storage.list(PREFIX)) {
        if (!keys.includes(o.key)) { await storage.remove(o.key); console.log(`delete ${o.key}`); }
    }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
