// One-off: upload a shop's icon, adaptive icon and hero images from a local folder to the media bucket.
//   node src/scripts/uploadTenantBranding.js <slug> <folder>
//   folder files: icon.png, adaptive-foreground.png, splash.png (optional), hero-1.png, hero-2.png ...
// Same result as the upload API: tenants/<slug>/branding/..., a Media record per file, and the shop's
// heroImages list replaced by the uploaded heroes (their old hero files are deleted from the bucket).
// Safe to run again: fixed names are overwritten.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const storage = require('../services/adapters/storage');
const { toPng, toWebp } = require('../services/imageProcessor');
const Media = require('../models/Media');
const Tenant = require('../models/Tenant');

const [slug, folder] = process.argv.slice(2);
const FIXED = [
    { file: 'icon.png', kind: 'icon', key: 'icon.png', opts: { size: 1024, square: true, flatten: true } },
    { file: 'adaptive-foreground.png', kind: 'adaptive', key: 'adaptive-foreground.png', opts: { size: 1024, square: true } },
    { file: 'splash.png', kind: 'splash', key: 'splash.png', opts: { maxSide: 1600 } },
];
const stamp = () => `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(4).toString('hex')}`;

async function record(tenant, kind, key, img) {
    await Media.deleteOne({ key });
    return Media.create({
        tenantId: tenant._id, key, url: storage.publicUrl(key), kind, refType: kind,
        bytes: img.bytes, width: img.width, height: img.height,
        uploadedBy: { type: 'script', id: 'uploadTenantBranding', label: 'migration' },
    });
}

(async () => {
    if (!/^[a-z0-9-]{3,40}$/.test(slug || '') || !folder) throw new Error('usage: uploadTenantBranding.js <slug> <folder>');
    if (process.env.STORAGE_MOCK === 'true') throw new Error('STORAGE_MOCK is true: this would not reach the real bucket');
    // slug "default": the platform default app. Goes to defaults/branding/ with no shop and no Media record,
    // so the upload cleanup (which scans tenants/ only) never touches it.
    const isDefault = slug === 'default';
    let tenant = null;
    if (!isDefault) {
        await mongoose.connect(process.env.MONGODB_URI);
        tenant = await Tenant.findOne({ slug }).select('_id slug heroImages');
        if (!tenant) throw new Error(`Tenant "${slug}" not found in this database`);
    }
    const base = isDefault ? 'defaults/branding/' : `tenants/${slug}/branding/`;

    for (const f of FIXED) {
        const p = path.join(folder, f.file);
        if (!fs.existsSync(p)) { console.log(`skip   ${f.file} (not in folder)`); continue; }
        const img = await toPng(fs.readFileSync(p), f.opts);
        await storage.put({ key: base + f.key, buffer: img.buffer, contentType: 'image/png' });
        if (tenant) await record(tenant, f.kind, base + f.key, img);
        console.log(`upload ${base + f.key}  ${img.width}x${img.height}  ${img.bytes} bytes`);
    }

    const heroFiles = fs.readdirSync(folder).filter((n) => /^hero-\d+\.(png|jpe?g|webp)$/i.test(n))
        .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
    if (heroFiles.length && tenant) {   // heroes belong to a shop (the default ones use uploadDefaultHeroes.js)
        const urls = [];
        for (const name of heroFiles) {
            const img = await toWebp(fs.readFileSync(path.join(folder, name)), { maxSide: 1600 });
            const key = `${base}hero/${stamp()}.webp`;
            await storage.put({ key, buffer: img.buffer, contentType: 'image/webp' });
            const m = await record(tenant, 'hero', key, img);
            urls.push(m.url);
            console.log(`upload ${key}  ${img.width}x${img.height}  ${img.bytes} bytes`);
        }
        // the old hero files of this shop (from an earlier run or the panel) are removed for good
        const old = await Media.find({ tenantId: tenant._id, kind: 'hero', url: { $nin: urls } });
        for (const m of old) { await storage.remove(m.key).catch(() => { }); await m.deleteOne(); console.log(`delete ${m.key}`); }
        await Tenant.updateOne({ _id: tenant._id }, { $set: { heroImages: urls } });
        console.log(`heroImages set (${urls.length})`);
    }
    if (tenant) await mongoose.disconnect();
})().catch(async (e) => { console.error('FAILED:', e.message); try { await mongoose.disconnect(); } catch { } process.exit(1); });
