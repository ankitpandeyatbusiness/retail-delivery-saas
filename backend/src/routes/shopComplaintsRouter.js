// Owner: complaints of his customers. Mounted at /api/shop/complaints
//   GET   /?status=open|in_progress|resolved&page=
//   PATCH /:id   { ownerReply?, resolution?: refund_full|refund_partial|no_refund, refundPaise? }
const express = require('express');
const apiErrors = require('../middlewares/apiErrors');
const complaints = require('../services/complaintService');

const { wrap } = apiErrors;
const router = express.Router();
const actorOf = (req) => req.actor || { type: 'owner', id: req.auth.userId, label: req.shopUser?.phone || 'shop owner' };

router.get('/', wrap(async (req, res) => {
    res.json(await complaints.ownerList({ tenantId: req.tenant._id, query: req.query }));
}));

router.patch('/:id', wrap(async (req, res) => {
    const out = await complaints.decide({ tenant: req.tenant, id: req.params.id, actor: actorOf(req), body: req.body });
    res.locals.auditAction = 'COMPLAINT_DECISION';
    res.locals.auditParams = { complaintId: String(out.id), resolution: out.resolution, refundPaise: out.refundPaise };
    res.json(out);
}));

router.use(apiErrors);
module.exports = router;