// One-off: put a login background picture into the media bucket (the CDN), under its business type.
//   node src/scripts/uploadLoginBg.js <businessType> <name> <path-to-picture> [--default]
//   example: node src/scripts/uploadLoginBg.js restaurant food-doodles-dark ../mobile/assets/login/login_bg.png --default
// The picture is made into a light WebP (1400 px wide) and stored as defaults/login-bg/<businessType>/<name>.webp.
// --default also makes it the default of that business type (saved in the platform settings).
// The same thing is done from the superadmin app (More > Login backgrounds); this is for the very first picture, or a bulk import.
require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const storage = require('../services/adapters/storage');
const { toLoginBg } = require('../services/imageProcessor');
const { BUSINESS_TYPES } = require('../config/businessTypes');
const PlatformSettings = require('../models/PlatformSettings');
const { PREFIX } = require('../services/loginBackgrounds');

const [type, nameArg, file] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const makeDefault = process.argv.includes('--default');

(async () => {
    if (!type || !nameArg || !file) throw new Error('usage: uploadLoginBg.js <businessType> <name> <picture> [--default]');
    if (!BUSINESS_TYPES[type]) throw new Error(`Unknown business type "${type}". Use one of: ${Object.keys(BUSINESS_TYPES).join(', ')}`);
    if (process.env.STORAGE_MOCK === 'true') throw new Error('STORAGE_MOCK is true: this would not reach the real bucket');
    const slug = String(nameArg).toLowerCase().replace(/\.[a-z]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
    if (!slug) throw new Error('The name must have letters or numbers');
    if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
    const img = await toLoginBg(fs.readFileSync(file));
    const key = `${PREFIX}${type}/${slug}.webp`;
    await storage.put({ key, buffer: img.buffer, contentType: 'image/webp' });
    console.log(`uploaded ${key}  ${img.width}x${img.height}  ${Math.round(img.bytes / 1024)} KB`);
    console.log(`url      ${storage.publicUrl(key)}`);
    if (makeDefault) {
        await mongoose.connect(process.env.MONGODB_URI);
        await PlatformSettings.updateOne({ _id: 'main' }, { $set: { [`loginBgDefaults.${type}`]: `${slug}.webp` } }, { upsert: true });
        console.log(`default  ${type} -> ${slug}.webp`);
        await mongoose.disconnect();
    }
})().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
