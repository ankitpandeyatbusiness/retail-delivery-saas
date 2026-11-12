// Customer uploads: his own avatar, and photos for a complaint on his own order.
//   POST /api/me/uploads/sign     { kind: 'customer'|'complaint', refId?: orderId, contentType, bytes }
//   POST /api/me/uploads/confirm  { kind, refId?, key, replaces? }
//   DELETE /api/me/uploads/:id
const express = require('express');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const apiErrors = require('../middlewares/apiErrors');
const { takeSignSlot } = require('../middlewares/uploadLimit');
const media = require('../services/mediaService');

const { wrap } = apiErrors;
const router = express.Router();

router.use(tenantRecognizer);
router.use(authenticate);

const DAILY_SIGNS = 20;
const DEMO_DAILY_SIGNS = 6;
const DEMO_MAX_BYTES = 1500 * 1024;   // a demo photo is small; it is deleted when the demo resets (services/demoReset.js)

router.post('/sign', wrap(async (req, res) => {
    const actorId = String(req.auth.userId);
    try {
        if (req.sessionFlags && req.sessionFlags.demo) {
            if (Number(req.body && req.body.bytes) > DEMO_MAX_BYTES) { const err = new Error('In the demo a photo must be under 1.5 MB'); err.status = 400; throw err; }
            await takeSignSlot('rl_upload_demo', `upload:demo:${req.tenant._id}:${actorId}`, DEMO_DAILY_SIGNS);
        } else await takeSignSlot('rl_upload_c', `upload:c:${req.tenant._id}:${actorId}`, DAILY_SIGNS);
    } catch (e) {
        if (e.retryAfter) res.set('Retry-After', String(e.retryAfter));
        throw e;
    }
    const { kind, refId, contentType, bytes } = req.body || {};
    res.json(await media.sign({ tenant: req.tenant, actorId, kind, refId, contentType, bytes, allowed: media.CUSTOMER_KINDS }));
}));

router.post('/confirm', wrap(async (req, res) => {
    const actorId = String(req.auth.userId);
    const { kind, refId, key, replaces } = req.body || {};
    const doc = await media.confirm({
        tenant: req.tenant, actorId, kind, refId, key, replaces, allowed: media.CUSTOMER_KINDS,
        uploadedBy: { type: 'customer', id: actorId, label: '' },
    });
    res.status(201).json(doc);
}));

router.delete('/:id', wrap(async (req, res) => {
    res.json(await media.removeMedia({ tenant: req.tenant, id: req.params.id, allowed: media.CUSTOMER_KINDS, ownerId: String(req.auth.userId) }));
}));

router.use(apiErrors);

module.exports = router;