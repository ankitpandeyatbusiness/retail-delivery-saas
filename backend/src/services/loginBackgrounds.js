// Login backgrounds: the picture behind the desktop website's login page. They live on the CDN (the R2 bucket), never inside an app build.
//
// Bucket layout (one folder per business type, so a grocery store or a clothing shop can have its own set later):
//   defaults/login-bg/<businessType>/<name>.webp          e.g. defaults/login-bg/restaurant/food-doodles-dark.webp
//                       businessType = restaurant | general_store | stationery | garments   (config/businessTypes.js)
//                       name         = lower-case words with dashes, one picture per file name
//   defaults/login-bg/tmp/                                 raw uploads waiting to be converted (deleted right after)
//
// Which picture a shop shows:
//   1. the one the superadmin picked for THAT shop      Tenant.loginBg = "<businessType>/<name>.webp"
//   2. else the default of the shop's business type     PlatformSettings.loginBgDefaults[<businessType>] = "<name>.webp"
//   3. else the first picture of that type's folder
//   4. else none (the login page draws its plain dark background)
// Only the relative name is stored, so a change of the CDN address never breaks a saved choice.
// The folder is not under tenants/, so the upload cleanup never touches it.
const crypto = require('crypto');
const storage = require('./adapters/storage');
const { BUSINESS_TYPES } = require('../config/businessTypes');
const PlatformSettings = require('../models/PlatformSettings');
const Tenant = require('../models/Tenant');
const { toLoginBg } = require('./imageProcessor');
const { httpError } = require('../middlewares/apiErrors');

const PREFIX = 'defaults/login-bg/';
const TMP = `${PREFIX}tmp/`;
const FILE_RE = /^[a-z0-9][a-z0-9-]{0,58}\.webp$/;
const MAX_BYTES = 8 * 1024 * 1024;
const TTL_MS = 5 * 60 * 1000;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const types = () => Object.keys(BUSINESS_TYPES);
const isType = (t) => typeof t === 'string' && Object.prototype.hasOwnProperty.call(BUSINESS_TYPES, t);
const relOf = (type, file) => `${type}/${file}`;
const parseRel = (rel) => {
    const m = /^([a-z_]+)\/([a-z0-9][a-z0-9-]{0,58}\.webp)$/.exec(String(rel || ''));
    return m && isType(m[1]) ? { type: m[1], file: m[2] } : null;
};
const urlOf = (rel) => storage.publicUrl(`${PREFIX}${rel}`);
const slugName = (s) => String(s || '').toLowerCase().replace(/\.[a-z]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);

const cache = new Map();   // type -> { at, files }
const reset = () => cache.clear();

async function files(type) {
    const hit = cache.get(type);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.files;
    try {
        const rows = await storage.list(`${PREFIX}${type}/`);
        const list = rows
            .map((o) => ({ file: o.key.slice(`${PREFIX}${type}/`.length), bytes: o.size || 0, at: o.lastModified || null }))
            .filter((o) => FILE_RE.test(o.file))
            .sort((a, b) => a.file.localeCompare(b.file, 'en', { numeric: true }));
        cache.set(type, { at: Date.now(), files: list });
        return list;
    } catch (e) {
        console.error('Login backgrounds: could not list the bucket:', e.message);
        return hit ? hit.files : [];   // an old answer is better than none
    }
}

async function defaultsMap() {
    const s = await PlatformSettings.findById('main').select('loginBgDefaults').lean().catch(() => null);
    return (s && s.loginBgDefaults) || {};
}

// the file a business type shows when the shop has chosen nothing
async function defaultFile(type, map) {
    const m = map || await defaultsMap();
    const list = await files(type);
    if (m[type] && list.some((f) => f.file === m[type])) return m[type];
    return list.length ? list[0].file : null;
}

// the picture of a shop: { rel, url } or null. `tenant` needs businessType and loginBg.
async function resolveFor(tenant) {
    try {
        if (tenant && tenant.loginBg && parseRel(tenant.loginBg)) return { rel: tenant.loginBg, url: urlOf(tenant.loginBg) };
        const type = isType(tenant && tenant.businessType) ? tenant.businessType : 'restaurant';
        const file = await defaultFile(type);
        return file ? { rel: relOf(type, file), url: urlOf(relOf(type, file)) } : null;
    } catch (e) { return null; }
}

// everything for the superadmin: each business type with its pictures, which is the default and how many shops use each
async function overview() {
    const map = await defaultsMap();
    const used = new Map((await Tenant.aggregate([{ $match: { loginBg: { $type: 'string', $ne: '' } } }, { $group: { _id: '$loginBg', n: { $sum: 1 } } }])).map((r) => [r._id, r.n]));
    const out = [];
    for (const type of types()) {
        const list = await files(type);
        const def = await defaultFile(type, map);
        out.push({
            id: type, label: BUSINESS_TYPES[type].label, status: BUSINESS_TYPES[type].status,
            default: def,
            items: list.map((f) => ({ file: f.file, rel: relOf(type, f.file), url: urlOf(relOf(type, f.file)), bytes: f.bytes, isDefault: f.file === def, usedBy: used.get(relOf(type, f.file)) || 0 })),
        });
    }
    return out;
}

// step 1 of an upload: a one-time address to send the raw file to
async function sign({ contentType, bytes }) {
    const ext = EXT[contentType];
    if (!ext) throw httpError(400, 'Only jpeg, png or webp images are allowed');
    if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_BYTES) throw httpError(400, 'The picture must be between 1 byte and 8 MB');
    const key = `${TMP}${crypto.randomUUID()}.${ext}`;
    const uploadUrl = await storage.presignPut({ key, contentType, bytes });
    return { uploadUrl, key, method: 'PUT', headers: { 'Content-Type': contentType }, expiresIn: 300 };
}

const sniff = (b) => {
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
    if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true;
    return b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
};

// step 2: the raw file is checked, made into a light WebP (1400 px wide) and stored under its final name
async function confirm({ type, name, key }) {
    if (!isType(type)) throw httpError(400, 'Unknown business type');
    const slug = slugName(name);
    if (!slug) throw httpError(400, 'Give the picture a name (letters and numbers)');
    if (typeof key !== 'string' || !key.startsWith(TMP)) throw httpError(400, 'Invalid key');
    try { storage.safeKey(key); } catch { throw httpError(400, 'Invalid key'); }
    const drop = () => storage.remove(key).catch(() => { });
    const file = `${slug}.webp`;
    if ((await files(type)).some((f) => f.file === file)) { await drop(); throw httpError(409, 'A picture with this name already exists. Choose another name.'); }
    const meta = await storage.head(key).catch(() => null);
    if (!meta) throw httpError(400, 'The file was not uploaded');
    if (meta.bytes > MAX_BYTES || !sniff(await storage.peek(key, 12))) { await drop(); throw httpError(400, 'Not a valid image (jpeg, png or webp, max 8 MB)'); }
    let img;
    try { img = await toLoginBg(await storage.get(key)); } catch (e) {
        await drop();
        if (/sharp is not installed/.test(e.message)) throw e;
        throw httpError(400, 'Not a valid image (jpeg, png or webp, max 8 MB)');
    }
    await storage.put({ key: `${PREFIX}${type}/${file}`, buffer: img.buffer, contentType: 'image/webp' });
    await drop();
    reset();
    return { rel: relOf(type, file), file, url: urlOf(relOf(type, file)), bytes: img.bytes, width: img.width, height: img.height };
}

async function setDefault(type, file) {
    if (!isType(type)) throw httpError(400, 'Unknown business type');
    if (!(await files(type)).some((f) => f.file === file)) throw httpError(404, 'Picture not found');
    await PlatformSettings.updateOne({ _id: 'main' }, { $set: { [`loginBgDefaults.${type}`]: file } }, { upsert: true });
    return { type, file };
}

async function remove(type, file) {
    if (!isType(type) || !FILE_RE.test(String(file || ''))) throw httpError(400, 'Invalid picture');
    if (!(await files(type)).some((f) => f.file === file)) throw httpError(404, 'Picture not found');
    const map = await defaultsMap();
    if (map[type] === file) throw httpError(409, 'This is the default for this business type. Make another picture the default first.');
    if (await Tenant.exists({ loginBg: relOf(type, file) })) throw httpError(409, 'Some shops use this picture. Change their login background first.');
    await storage.remove(`${PREFIX}${type}/${file}`);
    reset();
}

// a shop's own choice (null = back to the default of its business type)
async function setForShop(tenantId, rel) {
    if (rel === null || rel === '') { await Tenant.updateOne({ _id: tenantId }, { $unset: { loginBg: 1 } }); return null; }
    const p = parseRel(rel);
    if (!p) throw httpError(400, 'Invalid picture');
    if (!(await files(p.type)).some((f) => f.file === p.file)) throw httpError(404, 'Picture not found');
    await Tenant.updateOne({ _id: tenantId }, { $set: { loginBg: rel } });
    return rel;
}

module.exports = { PREFIX, resolveFor, overview, sign, confirm, setDefault, remove, setForShop, parseRel, reset, defaultFile };
