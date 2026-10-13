// Direct-to-R2 uploads for the owner and the superadmin (reads req.tenant).
//   POST   /sign     { kind, refId?, contentType, bytes } -> { uploadUrl, key, method, headers }
//   (app sends the raw file to uploadUrl with PUT)
//   POST   /confirm  { key, kind, refId?, replaces? }     -> Media record (final WebP url is in .url)
//   DELETE /:id
const express = require('express');
const apiErrors = require('../middlewares/apiErrors');
const { takeSignSlot } = require('../middlewares/uploadLimit');
const media = require('../services/mediaService');

const { wrap } = apiErrors;
const router = express.Router();

const DAILY_SIGNS = 50;
const actor = (req) => String(req.auth?.userId || req.actor?.id || 'admin');
const who = (req) => req.actor || { type: 'owner', id: String(req.auth?.userId || ''), label: req.shopUser?.phone || '' };

router.post('/sign', wrap(async (req, res) => {
    try {
        await takeSignSlot('rl_upload', `upload:${req.tenant._id}`, DAILY_SIGNS);
    } catch (e) {
        if (e.retryAfter) res.set('Retry-After', String(e.retryAfter));
        throw e;
    }
    const { kind, refId, contentType, bytes } = req.body || {};
    res.json(await media.sign({ tenant: req.tenant, actorId: actor(req), kind, refId, contentType, bytes, allowed: media.OWNER_KINDS }));
}));

router.post('/confirm', wrap(async (req, res) => {
    const { kind, refId, key, replaces } = req.body || {};
    const doc = await media.confirm({
        tenant: req.tenant, actorId: actor(req), kind, refId, key, replaces, allowed: media.OWNER_KINDS, uploadedBy: who(req),
    });
    res.status(201).json(doc);
}));

router.delete('/:id', wrap(async (req, res) => {
    res.json(await media.removeMedia({ tenant: req.tenant, id: req.params.id, allowed: media.OWNER_KINDS }));
}));

router.use(apiErrors);

module.exports = router;