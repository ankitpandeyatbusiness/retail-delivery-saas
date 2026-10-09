// Owner: the activity log of his own shop.
//   GET /api/shop/activity
//     ?actorType=owner|rider|superadmin|system
//     ?q=riders          part of the action
//     ?from=2026-10-01&to=2026-10-31
//     ?page=1&limit=20
// The shop is always taken from req.tenant, never from the request. The superadmin's email,
// the IP address and the request bodies are not shown to the owner.

const express = require('express');
const AuditLog = require('../models/AuditLog');
const { wrap, httpError } = require('../middlewares/apiErrors');

const router = express.Router();
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const dayStart = (s) => (DATE_ONLY.test(s) ? new Date(`${s}T00:00:00+05:30`) : new Date(s));
const dayEnd = (s) => (DATE_ONLY.test(s) ? new Date(`${s}T23:59:59.999+05:30`) : new Date(s));

router.get('/', wrap(async (req, res) => {
    const page = clamp(parseInt(req.query.page, 10) || 1, 1, 1000);
    const limit = clamp(parseInt(req.query.limit, 10) || 20, 1, 50);
    const filter = { tenantId: req.tenant._id };

    if (['owner', 'rider', 'superadmin', 'system'].includes(req.query.actorType)) filter.actorType = req.query.actorType;
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
        filter.action = new RegExp(esc(req.query.q.trim().slice(0, 40)), 'i');
    }
    const from = req.query.from ? dayStart(String(req.query.from)) : null;
    const to = req.query.to ? dayEnd(String(req.query.to)) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) throw httpError(400, 'Invalid date');
    if (from || to) filter.at = { ...(from && { $gte: from }), ...(to && { $lte: to }) };

    const items = await AuditLog.find(filter)
        .select('at actorType actorLabel action method status params')
        .sort({ at: -1 }).skip((page - 1) * limit).limit(limit + 1).lean();
    const hasMore = items.length > limit;
    if (hasMore) items.pop();

    res.json({
        items: items.map((i) => ({
            ...i,
            actorLabel: i.actorType === 'superadmin' ? 'Platform support' : i.actorType === 'system' ? 'Automatic' : i.actorLabel,
        })),
        page,
        hasMore,
    });
}));

module.exports = router;