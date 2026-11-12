// One-off: make a shop's favicon (the website's browser-tab icon) from its app icon, and save it the same way an upload from the superadmin app does.
//   node src/scripts/makeFavicon.js <slug>
// Reads tenants/<slug>/branding/icon.png from the media bucket, makes a 256 px square PNG with transparent rounded corners (the app icon has white ones), stores it as
// tenants/<slug>/branding/favicon.png, writes the Media record and sets Tenant.favicon. Safe to run again: the same name is overwritten.
require('dotenv').config();
const mongoose = require('mongoose');
const storage = require('../services/adapters/storage');
const { toPng } = require('../services/imageProcessor');
const Media = require('../models/Media');
const Tenant = require('../models/Tenant');

const [slug] = process.argv.slice(2);

// The app icon is saved without transparency (the iOS icon must not have any), so its rounded corners sit on a white square. A browser tab would show those
// white corners. They are found from the four corners (white pixels joined to a corner) and made transparent; the edge pixels, which are part red and part
// white, get the matching partial transparency, so the rounded edge stays smooth.
async function clearWhiteCorners(buffer) {
    const sharp = require('sharp');
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = info.width; const h = info.height;
    const minC = (i) => Math.min(data[i], data[i + 1], data[i + 2]);
    const isWhite = (i) => minC(i) >= 245;
    const outside = new Uint8Array(w * h);
    const stack = [];
    for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) if (isWhite((y * w + x) * 4)) { outside[y * w + x] = 1; stack.push(y * w + x); }
    if (!stack.length) return buffer;   // no white corners: the icon already has a clean shape
    while (stack.length) {
        const p = stack.pop(); const x = p % w; const y = (p - x) / w;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const q = ny * w + nx;
            if (!outside[q] && isWhite(q * 4)) { outside[q] = 1; stack.push(q); }
        }
    }
    // the colour of the icon at its edge (its darkest channel): a pure icon pixel has alpha 1, a white one 0
    let edgeMin = 255;
    for (let p = 0; p < w * h; p += 97) if (!outside[p]) edgeMin = Math.min(edgeMin, minC(p * 4));
    const out = Buffer.from(data);
    for (let p = 0; p < w * h; p += 1) {
        const i = p * 4;
        if (outside[p]) { out[i + 3] = 0; continue; }
        // within 3 pixels of the outside: a blended edge pixel
        const x = p % w; const y = (p - x) / w;
        let near = false;
        for (let dy = -3; dy <= 3 && !near; dy += 1) for (let dx = -3; dx <= 3; dx += 1) {
            const nx = x + dx; const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < w && ny < h && outside[ny * w + nx]) { near = true; break; }
        }
        if (!near) continue;
        const a = Math.max(0, Math.min(1, (255 - minC(i)) / Math.max(1, 255 - edgeMin)));
        if (a >= 0.999) continue;
        out[i + 3] = Math.round(a * 255);
        if (a > 0.02) for (let c = 0; c < 3; c += 1) out[i + c] = Math.max(0, Math.min(255, Math.round((data[i + c] - 255 * (1 - a)) / a)));
    }
    return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

(async () => {
    if (!/^[a-z0-9-]{3,40}$/.test(slug || '')) throw new Error('usage: makeFavicon.js <slug>');
    if (process.env.STORAGE_MOCK === 'true') throw new Error('STORAGE_MOCK is true: this would not reach the real bucket');
    await mongoose.connect(process.env.MONGODB_URI);
    const tenant = await Tenant.findOne({ slug }).select('_id slug');
    if (!tenant) throw new Error(`Tenant "${slug}" not found in this database`);

    const iconKey = `tenants/${slug}/branding/icon.png`;
    const raw = await storage.get(iconKey);   // throws when the shop has no app icon yet
    const img = await toPng(await clearWhiteCorners(raw), { size: 256, square: true });

    const key = `tenants/${slug}/branding/favicon.png`;
    await storage.put({ key, buffer: img.buffer, contentType: 'image/png' });
    const url = `${storage.publicUrl(key)}?v=${Date.now()}`;   // same name, new picture: bust the cache
    await Media.deleteOne({ key });
    await Media.create({
        tenantId: tenant._id, key, url, kind: 'favicon', refType: 'favicon',
        bytes: img.bytes, width: img.width, height: img.height,
        uploadedBy: { type: 'script', id: 'makeFavicon', label: 'made from the app icon' },
    });
    await Tenant.updateOne({ _id: tenant._id }, { $set: { favicon: url } });
    console.log(`favicon  ${key}  ${img.width}x${img.height}  ${Math.round(img.bytes / 1024)} KB`);
    console.log(`url      ${url}`);
})().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
