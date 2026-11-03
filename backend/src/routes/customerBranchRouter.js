// A customer of a brand signs in ONCE and uses any branch. Mounted at /api/customer-branch.
//   POST /session   { slug }   (x-tenant-slug = the branch the customer is in now, Bearer token of that branch)
//        -> the same phone gets an account at the other branch (made on first use) and a session there:
//           { success, slug, name, user, accessToken, refreshToken }
// The accounts stay separate on purpose: orders, addresses, points and coupons of one branch are never seen by another.
// Only customers use this. An owner switches with /api/brand/switch; staff and riders stay in their own branch.
const express = require('express');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const authController = require('../controllers/authController');
const { hashPhone } = require('../utils/phoneHash');
const apiErrors = require('../middlewares/apiErrors');

const { wrap, httpError } = apiErrors;
const router = express.Router();
const SLUG_RE = /^[a-z0-9-]{3,40}$/;

router.use(tenantRecognizer);
router.use(authenticate);

router.post('/session', wrap(async (req, res) => {
    if (!req.tenant.brandId) throw httpError(403, 'This shop has no other branches');
    const slug = String((req.body && req.body.slug) || '').trim().toLowerCase();
    if (!SLUG_RE.test(slug)) throw httpError(400, 'Choose a branch');

    const me = await User.findById(req.auth.userId).select('role isBlocked phone name language email').lean();
    if (!me || me.isBlocked) throw httpError(403, 'This account cannot sign in');
    if (me.role !== 'customer') throw httpError(403, 'Only customers switch branches here');

    const target = await Tenant.findOne({ slug, brandId: req.tenant.brandId });
    if (!target) throw httpError(404, 'That branch is not part of this brand');
    if (target.status === 'suspended') throw httpError(403, 'That branch is not taking orders right now');

    let user = await User.findOne({ tenantId: target._id, phone: me.phone });
    if (user && user.role !== 'customer') throw httpError(409, 'This number has a job at that branch, so it cannot order there as a customer.');
    if (user && user.isBlocked) throw httpError(403, 'This account cannot sign in there');
    if (!user) {
        try {
            user = await User.create({
                tenantId: target._id, phone: me.phone, role: 'customer', phoneHash: hashPhone(target._id, me.phone),
                ...(me.name && { name: me.name }), ...(me.language && { language: me.language }), ...(me.email && { email: me.email }),
            });
        } catch (e) {
            if (e && e.code === 11000) user = await User.findOne({ tenantId: target._id, phone: me.phone });   // made a moment ago by a parallel call
            else throw e;
        }
    }
    await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
    const { accessToken, refreshToken } = await authController.issueSession(user, target, req, req.ip);
    res.json({
        success: true, slug: target.slug, name: target.name,
        user: { id: user._id, phone: user.phone, name: user.name || null, role: user.role },
        accessToken, refreshToken,
    });
}));

router.use(apiErrors);
module.exports = router;
