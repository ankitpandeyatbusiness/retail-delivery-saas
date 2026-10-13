// Photo uploads: sign -> app sends the raw file -> confirm converts it to WebP and stores it under the final key.
const crypto = require('crypto');
const mongoose = require('mongoose');
const { httpError } = require('../middlewares/apiErrors');
const storage = require('./adapters/storage');
const { toWebp } = require('./imageProcessor');
const Media = require('../models/Media');
const Product = require('../models/Product');
const Order = require('../models/Order');

const MAX_BYTES = 5 * 1024 * 1024;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const REF_RE = /^[a-zA-Z0-9_-]{1,40}$/;
const MAX_COMPLAINT_PHOTOS = 3;

const OWNER_KINDS = new Set(['logo', 'product', 'category', 'banner', 'collection', 'rider', 'order']);
const CUSTOMER_KINDS = new Set(['customer', 'complaint']);

// ref: needs a refId. fixed: one file name that is overwritten. max: longest side in pixels.
const KINDS = {
    logo: { max: 1600 },
    product: { ref: true, max: 1600 },
    category: { max: 1600 },
    banner: { max: 1600 },
    collection: { max: 1600 },
    rider: { ref: true, fixed: true, max: 512 },
    order: { ref: true, max: 1600 },
    customer: { fixed: true, max: 512 },
    complaint: { ref: true, max: 1600 },
};
const FOLDER = { logo: 'logo', category: 'categories', banner: 'banners', collection: 'collections' };

const ist = () => new Date(Date.now() + 330 * 60 * 1000);
const ymd = () => ist().toISOString().slice(0, 10).replace(/-/g, '');
const ym = () => ist().toISOString().slice(0, 7);
const shortId = () => crypto.randomBytes(4).toString('hex');
const cleanId = (v) => String(v || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'anon';
const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const rawPrefix = (tenant, actorId) => `tenants/${tenant.slug}/tmp/${cleanId(actorId)}/`;

// real file type from the first bytes
function sniff(b) {
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    return null;
}

async function plan({ tenant, kind, refId, actorId, allowed }) {
    const cfg = KINDS[kind];
    if (!cfg || !allowed.has(kind)) throw httpError(400, 'Unknown upload kind');
    if (kind === 'customer') {
        refId = cleanId(actorId);
    } else if (cfg.ref) {
        if (!REF_RE.test(String(refId || ''))) throw httpError(400, 'refId is required for this kind');
        refId = String(refId);
    } else {
        refId = undefined;
    }
    if (kind === 'complaint') {
        // the customer may add photos only to his own order, and at most 3
        if (!mongoose.isValidObjectId(refId) || !mongoose.isValidObjectId(actorId)) throw httpError(404, 'Order not found');
        const mine = await Order.exists({ _id: refId, tenantId: tenant._id, userId: actorId });
        if (!mine) throw httpError(404, 'Order not found');
        const count = await Media.countDocuments({ tenantId: tenant._id, kind: 'complaint', refId });
        if (count >= MAX_COMPLAINT_PHOTOS) throw httpError(400, `You can add up to ${MAX_COMPLAINT_PHOTOS} photos`);
    }
    return { cfg, refId };
}

// the final, readable key (N11)
async function finalKey(tenant, kind, refId) {
    const base = `tenants/${tenant.slug}/`;
    const stamp = `${ymd()}-${shortId()}.webp`;
    switch (kind) {
        case 'logo': case 'category': case 'banner': case 'collection':
            return `${base}${FOLDER[kind]}/${stamp}`;
        case 'product': {
            let name = '';
            if (mongoose.isValidObjectId(refId)) {
                const p = await Product.findOne({ _id: refId, tenantId: tenant._id }).select('name').lean();
                name = slugify(p && p.name);
            }
            return `${base}products/${refId}${name ? `-${name}` : ''}/${stamp}`;
        }
        case 'rider': return `${base}riders/${refId}/photo.webp`;
        case 'order': return `${base}orders/${ym()}/${refId}/${stamp}`;
        case 'customer': return `${base}customers/${refId}/avatar.webp`;
        case 'complaint': {
            const used = (await Media.find({ tenantId: tenant._id, kind: 'complaint', refId }).select('key').lean()).map((m) => m.key);
            let n = 1;
            while (used.some((k) => k.endsWith(`/photo-${n}.webp`))) n += 1;
            return `${base}complaints/${ym()}/${refId}/photo-${n}.webp`;
        }
        default: throw httpError(400, 'Unknown upload kind');
    }
}

async function sign({ tenant, actorId, kind, refId, contentType, bytes, allowed }) {
    const ext = EXT[contentType];
    if (!ext) throw httpError(400, 'Only jpeg, png or webp images are allowed');
    if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_BYTES) throw httpError(400, 'File must be between 1 byte and 5 MB');
    await plan({ tenant, kind, refId, actorId, allowed });

    const key = `${rawPrefix(tenant, actorId)}${crypto.randomUUID()}.${ext}`;
    const uploadUrl = await storage.presignPut({ key, contentType, bytes });
    return { uploadUrl, key, method: 'PUT', headers: { 'Content-Type': contentType }, expiresIn: 300 };
}

async function confirm({ tenant, actorId, kind, refId, key, replaces, uploadedBy, allowed }) {
    const p = await plan({ tenant, kind, refId, actorId, allowed });
    if (typeof key !== 'string' || !key.startsWith(rawPrefix(tenant, actorId))) throw httpError(400, 'Invalid key');
    try { storage.safeKey(key); } catch { throw httpError(400, 'Invalid key'); }

    const dropRaw = () => storage.remove(key).catch(() => { });
    const meta = await storage.head(key).catch(() => null);
    if (!meta) throw httpError(400, 'The file was not uploaded');
    if (meta.bytes > MAX_BYTES || !sniff(await storage.peek(key, 12))) {
        await dropRaw();
        throw httpError(400, 'Not a valid image (jpeg, png or webp, max 5 MB)');
    }

    let img;
    try {
        img = await toWebp(await storage.get(key), { maxSide: p.cfg.max });
    } catch (e) {
        await dropRaw();
        if (/sharp is not installed/.test(e.message)) throw e;
        throw httpError(400, 'Not a valid image (jpeg, png or webp, max 5 MB)');
    }

    const finalK = await finalKey(tenant, kind, p.refId);
    await storage.put({ key: finalK, buffer: img.buffer, contentType: 'image/webp' });
    await dropRaw();

    // fixed names are overwritten: only the record needs to go
    if (p.cfg.fixed) await Media.deleteOne({ key: finalK });

    if (replaces && mongoose.isValidObjectId(replaces)) {
        const filter = { _id: replaces, tenantId: tenant._id, kind };
        if (p.refId !== undefined) filter.refId = p.refId;
        const old = await Media.findOne(filter);
        if (old && old.key !== finalK) {
            await storage.remove(old.key).catch(() => { });
            await old.deleteOne();
        }
    }

    const url = `${storage.publicUrl(finalK)}${p.cfg.fixed ? `?v=${Date.now()}` : ''}`;   // new picture, same name: bust the cache
    return Media.create({
        tenantId: tenant._id,
        key: finalK,
        url,
        kind,
        refType: kind,
        refId: p.refId,
        bytes: img.bytes,
        width: img.width,
        height: img.height,
        uploadedBy,
    });
}

async function removeMedia({ tenant, id, allowed, ownerId }) {
    if (!mongoose.isValidObjectId(id)) throw httpError(400, 'Invalid id');
    const filter = { _id: id, tenantId: tenant._id, kind: { $in: [...allowed] } };
    if (ownerId) filter['uploadedBy.id'] = String(ownerId);
    const m = await Media.findOne(filter);
    if (!m) throw httpError(404, 'File not found');
    await storage.remove(m.key).catch(() => { });
    await m.deleteOne();
    return { ok: true };
}

module.exports = { OWNER_KINDS, CUSTOMER_KINDS, MAX_BYTES, sign, confirm, removeMedia, sniff, slugify };