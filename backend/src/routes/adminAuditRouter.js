// Superadmin: read the audit log. Mounted inside adminRouter (after requireSuperAdmin).
//
//   GET /api/admin/audit-logs
//     ?tenantId=...        only one shop
//     ?actorType=owner     or superadmin
//     ?actorId=...         one person
//     ?q=products          part of the action, e.g. "coupons", "owners", "PUT"
//     ?from=2026-10-01&to=2026-10-31
//     ?page=1&limit=20

const express = require('express');
const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const { wrap, httpError } = require('../middlewares/apiErrors');

const router = express.Router();
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const dayStart = (s) => (DATE_ONLY.test(s) ? new Date(`${s}T00:00:00+05:30`) : new Date(s));
const dayEnd = (s) => (DATE_ONLY.test(s) ? new Date(`${s}T23:59:59.999+05:30`) : new Date(s));

router.get('/audit-logs', wrap(async (req, res) => {
    const page = clamp(parseInt(req.query.page, 10) || 1, 1, 1000);
    const limit = clamp(parseInt(req.query.limit, 10) || 20, 1, 50);
    const filter = {};

    if (req.query.tenantId !== undefined) {
        if (!isId(req.query.tenantId)) throw httpError(400, 'Invalid tenantId');
        filter.tenantId = req.query.tenantId;
    }
    if (req.query.actorId !== undefined) {
        if (!isId(req.query.actorId)) throw httpError(400, 'Invalid actorId');
        filter.actorId = req.query.actorId;
    }
    if (['superadmin', 'owner', 'rider', 'system'].includes(req.query.actorType)) filter.actorType = req.query.actorType;
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
        filter.action = new RegExp(esc(req.query.q.trim().slice(0, 40)), 'i');
    }

    const from = req.query.from ? dayStart(String(req.query.from)) : null;
    const to = req.query.to ? dayEnd(String(req.query.to)) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) throw httpError(400, 'Invalid date');
    if (from || to) filter.at = { ...(from && { $gte: from }), ...(to && { $lte: to }) };

    const items = await AuditLog.find(filter).sort({ at: -1 }).skip((page - 1) * limit).limit(limit + 1).lean();
    const hasMore = items.length > limit;
    if (hasMore) items.pop();

    // show the owner's phone number instead of a bare id
    const ownerIds = [...new Set(items.filter((i) => i.actorType === 'owner').map((i) => String(i.actorId)))];
    const owners = ownerIds.length ? await User.find({ _id: { $in: ownerIds } }).select('phone name').lean() : [];
    const byId = new Map(owners.map((u) => [String(u._id), u]));

    res.json({
        items: items.map((i) => {
            const u = byId.get(String(i.actorId));
            return u ? { ...i, actorPhone: u.phone, actorName: u.name || null } : i;
        }),
        page,
        hasMore,
    });
}));

module.exports = router;