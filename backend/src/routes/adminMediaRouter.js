// Superadmin: the images uploaded for one shop. Mounted inside adminRouter (after requireSuperAdmin):
//   GET /api/admin/tenants/:tid/media?kind=hero|logo|banner|icon|adaptive|splash...
// The upload itself goes through /api/admin/tenants/:tid/shop/uploads (sign, confirm, hero-order, delete).
// This list is what the panel needs to show the pictures and to reorder or delete them (they are addressed by id).
const express = require('express');
const Media = require('../models/Media');
const loadTenant = require('../middlewares/loadTenant');
const media = require('../services/mediaService');
const { wrap, httpError } = require('../middlewares/apiErrors');

const router = express.Router();

router.get('/tenants/:tid/media', loadTenant, wrap(async (req, res) => {
    const filter = { tenantId: req.tenantDoc._id, kind: { $in: [...media.SUPER_KINDS] } };
    if (req.query.kind !== undefined) {
        if (typeof req.query.kind !== 'string' || !media.SUPER_KINDS.has(req.query.kind)) throw httpError(400, 'Unknown kind');
        filter.kind = req.query.kind;
    }
    const rows = await Media.find(filter).sort({ createdAt: 1, _id: 1 }).limit(100).lean();
    res.json({
        items: rows.map((m) => ({
            id: m._id, kind: m.kind, url: m.url, refId: m.refId || null,
            width: m.width || null, height: m.height || null, bytes: m.bytes || null, createdAt: m.createdAt,
        })),
    });
}));

module.exports = router;
