// Direct-to-R2 uploads. Written once, mounted for the owner and for the superadmin (reads req.tenant).
//   POST   /sign     { kind, refId?, contentType, bytes }  -> { uploadUrl, key, url }
//   (app sends the file to uploadUrl with PUT)
//   POST   /confirm  { key, kind, refId?, replaces?, width?, height? } -> Media record
//   DELETE /:id

const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const apiErrors = require('../middlewares/apiErrors');
const { wrap, httpError } = apiErrors;
const storage = require('../services/adapters/storage');
const Media = require('../models/Media');

const MAX_BYTES = 5 * 1024 * 1024;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const REF_RE = /^[a-zA-Z0-9_-]{1,40}$/;
const ym = () => new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 7);

// folder layout (inside tenants/<slug>/)
const KINDS = {
    logo: { dir: () => 'logo' },
    product: { ref: true, dir: (r) => `products/${r}` },
    category: { dir: () => 'categories' },
    banner: { dir: () => 'banners' },
    collection: { dir: () => 'collections' },
    rider: { ref: true, dir: (r) => `riders/${r}` },
    order: { ref: true, dir: (r) => `orders/${ym()}/${r}` },
};

function plan(req, kind, refId) {
    const cfg = KINDS[kind];
    if (!cfg) throw httpError(400, 'Unknown upload kind');
    if (cfg.ref && !REF_RE.test(String(refId || ''))) throw httpError(400, 'refId is required for this kind');
    if (!cfg.ref) refId = undefined;
    return { cfg, refId, prefix: `tenants/${req.tenant.slug}/${cfg.dir(refId)}/` };
}

const who = (req) => req.actor || { type: 'owner', id: String(req.auth?.userId || ''), label: req.shopUser?.phone || '' };

// real file type from the first bytes
function sniff(b) {
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    return null;
}

const router = express.Router();

router.post('/sign', wrap(async (req, res) => {
    const { kind, refId, contentType, bytes } = req.body || {};
    const ext = EXT[contentType];
    if (!ext) throw httpError(400, 'Only jpeg, png or webp images are allowed');
    if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_BYTES) throw httpError(400, 'File must be between 1 byte and 5 MB');

    const p = plan(req, kind, refId);
    const key = `${p.prefix}${crypto.randomUUID()}.${ext}`;
    const uploadUrl = await storage.presignPut({ key, contentType, bytes });
    res.json({
        uploadUrl, key, url: storage.publicUrl(key),
        method: 'PUT', headers: { 'Content-Type': contentType }, expiresIn: 300,
    });
}));

router.post('/confirm', wrap(async (req, res) => {
    const { key, kind, refId, replaces, width, height } = req.body || {};
    const p = plan(req, kind, refId);
    if (typeof key !== 'string' || !key.startsWith(p.prefix)) throw httpError(400, 'Invalid key');
    storage.safeKey(key);

    const already = await Media.findOne({ key });
    if (already) return res.json(already);        // safe to repeat

    const meta = await storage.head(key).catch(() => null);
    if (!meta) throw httpError(400, 'The file was not uploaded');
    const type = meta.bytes <= MAX_BYTES ? sniff(await storage.peek(key, 12)) : null;
    if (!type) {
        await storage.remove(key).catch(() => { });
        throw httpError(400, 'Not a valid image (jpeg, png or webp, max 5 MB)');
    }

    if (replaces && mongoose.isValidObjectId(replaces)) {
        const old = await Media.findOne({ _id: replaces, tenantId: req.tenant._id });
        if (old) {
            await storage.remove(old.key).catch(() => { });
            await old.deleteOne();
        }
    }

    const num = (v) => (Number.isFinite(v) && v > 0 && v < 20000 ? Math.round(v) : undefined);
    const media = await Media.create({
        tenantId: req.tenant._id,
        key,
        url: storage.publicUrl(key),
        kind,
        refType: kind,
        refId: p.refId,
        bytes: meta.bytes,
        width: num(width),
        height: num(height),
        uploadedBy: who(req),
    });
    res.status(201).json(media);
}));

router.delete('/:id', wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, 'Invalid id');
    const m = await Media.findOne({ _id: req.params.id, tenantId: req.tenant._id });
    if (!m) throw httpError(404, 'File not found');
    await storage.remove(m.key).catch(() => { });
    await m.deleteOne();
    res.json({ ok: true });
}));

router.use(apiErrors);

module.exports = router;