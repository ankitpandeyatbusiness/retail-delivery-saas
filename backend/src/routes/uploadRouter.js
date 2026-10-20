// Direct-to-R2 uploads for the owner and the superadmin (reads req.tenant).
//   POST   /sign     { kind, refId?, contentType, bytes } -> { uploadUrl, key, method, headers }
//   (app sends the raw file to uploadUrl with PUT)
//   POST   /confirm  { key, kind, refId?, replaces? }     -> Media record (final WebP url is in .url)
//   PUT    /hero-order { ids }                            -> new order of the hero images
//   DELETE /:id                                           -> deletes the file from the bucket for good
// kinds: owner and superadmin: logo, product, category, banner, collection, rider, order, hero (max 5; added to the shop's hero list on confirm)
//        superadmin only: icon, adaptive, splash (PNG, stored at tenants/<slug>/branding/, read by the app build)
const express = require('express');
const apiErrors = require('../middlewares/apiErrors');
const { takeSignSlot } = require('../middlewares/uploadLimit');
const media = require('../services/mediaService');

const { wrap } = apiErrors;
const router = express.Router();

const DAILY_SIGNS = 50;
const actor = (req) => String(req.auth?.userId || req.actor?.id || 'admin');
const who = (req) => req.actor || { type: 'owner', id: String(req.auth?.userId || ''), label: req.shopUser?.phone || '' };
// icon / splash / adaptive are built into the app, so only the superadmin may upload them
const allowedFor = (req) => (req.actor?.type === 'superadmin' ? media.SUPER_KINDS : media.OWNER_KINDS);

router.post('/sign', wrap(async (req, res) => {
    try {
        await takeSignSlot('rl_upload', `upload:${req.tenant._id}`, DAILY_SIGNS);
    } catch (e) {
        if (e.retryAfter) res.set('Retry-After', String(e.retryAfter));
        throw e;
    }
    const { kind, refId, contentType, bytes } = req.body || {};
    res.json(await media.sign({ tenant: req.tenant, actorId: actor(req), kind, refId, contentType, bytes, allowed: allowedFor(req) }));
}));

router.post('/confirm', wrap(async (req, res) => {
    const { kind, refId, key, replaces } = req.body || {};
    const doc = await media.confirm({
        tenant: req.tenant, actorId: actor(req), kind, refId, key, replaces, allowed: allowedFor(req), uploadedBy: who(req),
    });
    res.status(201).json(doc);
}));

// PUT /hero-order  { ids: [mediaId, ...] }  -> every hero image once, in the order the app shows them
router.put('/hero-order', wrap(async (req, res) => {
    res.json(await media.reorderHeroes({ tenant: req.tenant, ids: req.body?.ids }));
}));

// GET /hero -> the shop's login / home pictures in the order the app shows them: { items: [{ id, url }], max }
router.get('/hero', wrap(async (req, res) => {
    const [rows, t] = await Promise.all([
        require('../models/Media').find({ tenantId: req.tenant._id, kind: 'hero' }).select('url').lean(),
        require('../models/Tenant').findById(req.tenant._id).select('heroImages').lean(),
    ]);
    const order = t?.heroImages || [];
    const at = (u) => { const i = order.indexOf(u); return i < 0 ? 999 : i; };
    rows.sort((a, b) => at(a.url) - at(b.url));
    res.json({ items: rows.map((m) => ({ id: String(m._id), url: m.url })), max: 5 });
}));

// a deleted hero image (or icon / splash) is removed from the bucket for good
router.delete('/:id', wrap(async (req, res) => {
    res.json(await media.removeMedia({ tenant: req.tenant, id: req.params.id, allowed: allowedFor(req) }));
}));

router.use(apiErrors);

module.exports = router;