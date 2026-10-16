// Help & support for the shop owner. Mounted at /api/shop/support, open even while the shop is paused or blocked.
//   GET  /info                 -> { phone, whatsapp, email, hours, replyPromise }   the platform's contact card
//   GET  /?status=open|resolved&page=      his requests (and how many have a new reply)
//   POST /                     { category, subject, message, photos?, appVersion?, platform? }   a new request
//   GET  /:id                  the conversation (marks it read)
//   POST /:id/reply            { message, photos? }   also reopens a request resolved less than 7 days ago
//   POST /:id/resolve          he is done
//   POST /:id/rate             { stars: 1..5, comment? }   after it is resolved
// Pictures are uploaded first with /api/shop/support/uploads/sign and /confirm (refId: any short id) and sent as links.
const express = require('express');
const support = require('../services/supportService');
const media = require('../services/mediaService');
const { takeSignSlot } = require('../middlewares/uploadLimit');
const apiErrors = require('../middlewares/apiErrors');

const { wrap, httpError } = apiErrors;
const router = express.Router();

// only the owner himself; a platform person who opens the shop panel answers from the support inbox instead
router.use((req, res, next) => {
    if (!req.auth?.userId || req.actor?.type === 'superadmin') return next(httpError(403, 'Only the shop owner can use this. Platform staff answer from the support inbox.'));
    return next();
});

// Pictures for a request. Its own upload route (kind "support" only), so it still works while the shop is paused for rent.
//   POST /uploads/sign     { refId, contentType, bytes }      POST /uploads/confirm  { refId, key }
const PICTURE = new Set(['support']);
router.post('/uploads/sign', wrap(async (req, res) => {
    try {
        await takeSignSlot('rl_upload_support', `upload:support:${req.tenant._id}`, 30);
    } catch (e) {
        if (e.retryAfter) res.set('Retry-After', String(e.retryAfter));
        throw e;
    }
    const { refId, contentType, bytes } = req.body || {};
    res.json(await media.sign({ tenant: req.tenant, actorId: String(req.auth.userId), kind: 'support', refId, contentType, bytes, allowed: PICTURE }));
}));
router.post('/uploads/confirm', wrap(async (req, res) => {
    const { refId, key } = req.body || {};
    const doc = await media.confirm({
        tenant: req.tenant, actorId: String(req.auth.userId), kind: 'support', refId, key, allowed: PICTURE,
        uploadedBy: { type: 'owner', id: String(req.auth.userId), label: '' },
    });
    res.status(201).json(doc);
}));

router.get('/info', wrap(async (req, res) => { res.json(await support.getInfo()); }));

router.get('/', wrap(async (req, res) => {
    res.json(await support.ownerList({ tenantId: req.tenant._id, status: req.query.status, page: Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 500) }));
}));

router.post('/', wrap(async (req, res) => {
    res.status(201).json(await support.create({ tenant: req.tenant, userId: req.auth.userId, body: req.body }));
}));

router.get('/:id', wrap(async (req, res) => { res.json(await support.ownerGet({ tenantId: req.tenant._id, id: req.params.id })); }));

router.post('/:id/reply', wrap(async (req, res) => {
    res.json(await support.ownerReply({ tenant: req.tenant, userId: req.auth.userId, id: req.params.id, body: req.body }));
}));

router.post('/:id/resolve', wrap(async (req, res) => { res.json(await support.ownerResolve({ tenantId: req.tenant._id, id: req.params.id })); }));

router.post('/:id/rate', wrap(async (req, res) => { res.json(await support.ownerRate({ tenantId: req.tenant._id, id: req.params.id, body: req.body })); }));

router.use(apiErrors);
module.exports = router;
