// One-off: make a shop's favicon (the website's browser-tab icon) from its app icon, and save it the same way an upload from the superadmin app does.
//   node src/scripts/makeFavicon.js <slug>
// Reads tenants/<slug>/branding/icon.png from the media bucket, makes a 256 px square PNG (transparency kept), stores it as
// tenants/<slug>/branding/favicon.png, writes the Media record and sets Tenant.favicon. Safe to run again: the same name is overwritten.
require('dotenv').config();
const mongoose = require('mongoose');
const storage = require('../services/adapters/storage');
const { toPng } = require('../services/imageProcessor');
const Media = require('../models/Media');
const Tenant = require('../models/Tenant');

const [slug] = process.argv.slice(2);

(async () => {
    if (!/^[a-z0-9-]{3,40}$/.test(slug || '')) throw new Error('usage: makeFavicon.js <slug>');
    if (process.env.STORAGE_MOCK === 'true') throw new Error('STORAGE_MOCK is true: this would not reach the real bucket');
    await mongoose.connect(process.env.MONGODB_URI);
    const tenant = await Tenant.findOne({ slug }).select('_id slug');
    if (!tenant) throw new Error(`Tenant "${slug}" not found in this database`);

    const iconKey = `tenants/${slug}/branding/icon.png`;
    const raw = await storage.get(iconKey);   // throws when the shop has no app icon yet
    const img = await toPng(raw, { size: 256, square: true });

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
