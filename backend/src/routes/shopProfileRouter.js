// The shop owner's own profile. Mounted at /api/shop/profile (open even while the shop is paused or blocked: it is his own account).
//   GET /api/shop/profile    -> { id, phone, name, email, avatarUrl, avatarId }
//   PUT /api/shop/profile    { name?, email? }   email "" removes it. The registered phone can NOT be changed here.
// The profile picture is uploaded with /api/me/uploads (kind "customer", the one picture of this person) and shown here.
const express = require('express');
const User = require('../models/User');
const Media = require('../models/Media');
const edit = require('../services/userEditService');
const apiErrors = require('../middlewares/apiErrors');

const { wrap, httpError } = apiErrors;
const router = express.Router();

const avatarOf = (tenantId, userId) => Media.findOne({ tenantId, kind: 'customer', refId: String(userId) }).select('url').lean();
const view = (u, avatar) => ({
    id: u._id, phone: u.phone, name: u.name || null, email: u.email || null,
    avatarUrl: avatar?.url || null, avatarId: avatar?._id || null,
});

// only the owner himself: a platform person who opens the shop panel has no profile of his own here
const me = async (req) => {
    if (!req.auth?.userId || req.actor?.type === 'superadmin') throw httpError(403, 'Only the shop owner can open his profile');
    const u = await User.findOne({ _id: req.auth.userId, tenantId: req.tenant._id }).lean();
    if (!u) throw httpError(404, 'Account not found');
    return u;
};

router.get('/', wrap(async (req, res) => {
    const u = await me(req);
    res.json(view(u, await avatarOf(req.tenant._id, u._id)));
}));

router.put('/', wrap(async (req, res) => {
    const u = await me(req);
    const b = req.body || {};
    if (b.phone !== undefined) throw httpError(400, 'Your registered mobile number cannot be changed here. Please contact support.');
    if (Object.keys(b).some((k) => !['name', 'email'].includes(k))) throw httpError(400, 'You can change only your name and email');
    if (b.name !== undefined) {
        const name = typeof b.name === 'string' ? b.name.trim() : '';
        if (name.length < 2 || name.length > 80) throw httpError(400, 'Name must be 2 to 80 characters');
        b.name = name;
    }
    // the same rules as the platform's edit (the OLD email address is told when the login email changes)
    const r = await edit.applyProfile({ tenantId: req.tenant._id, user: u, body: b, phoneHint: 'Your registered mobile number cannot be changed here.' });
    req.auditBefore = r.before;
    res.json(view(r.user, await avatarOf(req.tenant._id, r.user._id)));
}));

router.use(apiErrors);
module.exports = router;
