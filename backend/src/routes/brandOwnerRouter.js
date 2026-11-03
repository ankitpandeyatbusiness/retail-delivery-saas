// The brand owner's own routes, used from the owner app of ANY branch of the brand. Mounted at /api/brand.
// Needs the usual headers (x-tenant-slug of the branch the owner is in, Bearer token of that branch).
//   GET  /me         the brand and its branches (the branch switcher's list)
//   POST /switch     { slug }                      sign in to another branch of the brand: returns that branch's tokens
//   POST /managers   { slug, phone }               make a phone the manager (owner panel) of one branch
//   POST /move       { fromSlug, toSlug, userId }  move a manager, cook, waiter or rider to another branch (not with live work)
const express = require('express');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const User = require('../models/User');
const Brand = require('../models/Brand');
const Tenant = require('../models/Tenant');
const brands = require('../services/brandService');
const owners = require('../services/ownerService');
const panel = require('../services/brandPanel');
const authController = require('../controllers/authController');
const apiErrors = require('../middlewares/apiErrors');

const { wrap, httpError } = apiErrors;
const router = express.Router();
const SLUG_RE = /^[a-z0-9-]{3,40}$/;

router.use(tenantRecognizer);
router.use(authenticate);

// only a brand owner of the brand this branch belongs to (re-read from the database on every call, like the shop admin check)
router.use(wrap(async (req, res, next) => {
    const user = await User.findById(req.auth.userId).select('role isBlocked phone name').lean();
    if (!user || user.isBlocked || user.role !== 'admin') throw httpError(403, 'Admin access required');
    if (!req.tenant.brandId) throw httpError(403, 'This shop is not part of a brand');
    const brand = await Brand.findById(req.tenant.brandId);
    if (!brand || !(brand.ownerPhones || []).includes(user.phone)) throw httpError(403, 'Only a brand owner can do this');
    req.brand = brand;
    req.brandUser = user;
    next();
}));

const branchBySlug = async (req, slug) => {
    const s = String(slug || '').trim().toLowerCase();
    if (!SLUG_RE.test(s)) throw httpError(400, 'Choose a branch');
    const t = await Tenant.findOne({ slug: s, brandId: req.brand._id });
    if (!t) throw httpError(404, 'That branch is not part of your brand');
    return t;
};

router.get('/me', wrap(async (req, res) => {
    const list = await Tenant.find({ brandId: req.brand._id }).sort({ createdAt: 1 }).select('slug name logo status branchCity address.city').lean();
    res.json({
        brand: { id: req.brand._id, name: req.brand.name },
        current: req.tenant.slug,
        branches: list.map((t) => ({ slug: t.slug, name: t.name, logo: t.logo || null, status: t.status, city: t.branchCity || (t.address && t.address.city) || null })),
    });
}));

// The "All branches" panel: read only, one row per branch (services/brandPanel.js)
//   GET /overview?range=today|7|30|90|2026-10        per-branch totals and the brand total
//   GET /orders?branch=<slug>&status=active|delivered,...&page=1&limit=20     orders of every branch (or one), each labelled with its branch
router.get('/overview', wrap(async (req, res) => { res.json(await panel.overview(req.brand, req.query.range)); }));
router.get('/orders', wrap(async (req, res) => { res.json(await panel.orders(req.brand, req.query)); }));

router.post('/switch', wrap(async (req, res) => {
    const target = await branchBySlug(req, req.body && req.body.slug);
    if (target.status === 'suspended') throw httpError(403, 'That branch is switched off');
    const { appoint } = owners;
    await appoint(target, req.brandUser.phone);   // the owner is an owner there too (made once, then it only reads)
    const user = await User.findOne({ tenantId: target._id, phone: req.brandUser.phone });
    if (!user || user.isBlocked) throw httpError(403, 'This account cannot sign in there');
    const { accessToken, refreshToken } = await authController.issueSession(user, target, req, req.ip);
    res.json({ success: true, slug: target.slug, name: target.name, accessToken, refreshToken });
}));

router.post('/managers', wrap(async (req, res) => {
    const target = await branchBySlug(req, req.body && req.body.slug);
    const r = await owners.appoint(target, String((req.body && req.body.phone) || '').trim());
    res.status(r.alreadyOwner ? 200 : 201).json({ ok: true, alreadyManager: r.alreadyOwner });
}));

router.post('/move', wrap(async (req, res) => {
    const b = req.body || {};
    const [fromTenant, toTenant] = [await branchBySlug(req, b.fromSlug), await branchBySlug(req, b.toSlug)];
    res.json(await brands.movePerson({ brand: req.brand, fromTenant, toTenant, userId: b.userId }));
}));

router.use(apiErrors);
module.exports = router;
