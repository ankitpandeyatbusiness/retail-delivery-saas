// The brand owner's own routes, used from the owner app of ANY branch of the brand. Mounted at /api/brand.
// Needs the usual headers (x-tenant-slug of the branch the owner is in, Bearer token of that branch).
//   GET  /me         the brand and its branches (the branch switcher's list)
//   GET  /statement?period=2026-10   the brand's monthly statement: a line per branch (rent, multi-branch discount, GST, status), the SMS wallet and SMS used per branch
//   GET  /notify-prefs               which branches' alerts reach his phone: { all, ownSlug, branches: [{ slug, name, own, open, explicit, on }] }
//   PUT  /notify-prefs               { all?, ownSlug?, branches?: { <slug>: true|false|null } }  -> the same view + warnings
//   GET  /notifications?branch=&page=   the owner inbox of every branch together, each row with its branch and silent: true when the branch is muted
//   GET  /customers?range=30         counts per branch (customers, new, ordered) and how many real people the brand has
//   GET  /complaints?branch=&status=&page=   complaints of every branch, each with its branch, and how many are open per branch
//   GET  /reviews?branch=&range=30&low=1&page=   dish ratings: average per branch and the newest ratings
//   GET  /statement.pdf?period=2026-10   the same statement as a PDF (?view=1 opens it in the browser)
//   GET  /dues                        what is unpaid in every branch (rent and late fees), one line per branch and the total
//   POST /dues/pay/start  { slug? }   pay ONE branch's dues (slug) or ALL branches' with a single payment -> { keyId, rzpOrderId, amountPaise, ... }
//   POST /dues/pay/verify { razorpay_order_id, razorpay_payment_id, razorpay_signature } -> { paid }
//   POST /switch     { slug }                      sign in to another branch of the brand: returns that branch's tokens
//   POST /menu/push  { productIds, toSlugs: 'all' | [slug], prices: 'keep'|'untouched'|'all' }   push dishes of THIS branch to other branches
//   POST /extras/push { kind: 'coupons'|'banners'|'collections', ids, toSlugs: 'all' | [slug] }   push coupons, banners or collections of THIS branch to other branches
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
const care = require('../services/brandCare');
const menuSync = require('../services/menuSync');
const extrasSync = require('../services/extrasSync');
const brandNotify = require('../services/brandNotify');
const Notification = require('../models/Notification');
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
    // Multi-branch (Pro): if ANY branch of the brand is on a plan with it, the brand tools work for the whole brand. Otherwise the owner can still LOOK at every branch
    // (the switch gives a view-only session) but the tools that change things are refused. Paying dues and switching always work.
    const gate = require('../services/featureGate');
    req.brandPro = (await Tenant.find({ brandId: brand._id }).select('plan').lean()).some((b) => gate.hasFeature(b, 'multiBranch'));
    if (!req.brandPro && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !/^\/(switch|dues)(\/|$)/.test(req.path)) {
        throw httpError(403, 'Branch tools are in the Pro plan. You can look at your branches, not change them. See Plan to upgrade.');
    }
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
        viewOnly: !!(req.sessionFlags && req.sessionFlags.viewOnly),   // this session can only look (see /switch)
        canManage: req.brandPro,                                       // the brand tools are open (some branch has multi-branch)
        branches: list.map((t) => ({ slug: t.slug, name: t.name, logo: t.logo || null, status: t.status, city: t.branchCity || (t.address && t.address.city) || null })),
    });
}));

// The "All branches" panel: read only, one row per branch (services/brandPanel.js)
//   GET /overview?range=today|7|30|90|2026-10        per-branch totals and the brand total
//   GET /orders?branch=<slug>&status=active|delivered,...&page=1&limit=20     orders of every branch (or one), each labelled with its branch
router.get('/overview', wrap(async (req, res) => { res.json(await panel.overview(req.brand, req.query.range)); }));
router.get('/orders', wrap(async (req, res) => { res.json(await panel.orders(req.brand, req.query)); }));
// the care side (services/brandCare.js): customers (counts only), complaints and dish ratings of every branch
router.get('/customers', wrap(async (req, res) => { res.json(await care.customers(req.brand, req.query.range || '30')); }));
router.get('/complaints', wrap(async (req, res) => { res.json(await care.complaints(req.brand, req.query)); }));
router.get('/reviews', wrap(async (req, res) => { res.json(await care.reviews(req.brand, req.query)); }));

router.get('/statement.pdf', wrap(async (req, res) => {
    const pdf = require('../services/brandStatementPdf');
    const st = await require('../services/brandStatement').build(req.brand, req.query.period);
    pdf.streamStatement(res, st, await pdf.sellerOf(), { inline: req.query.view === '1' });
}));
router.get('/statement', wrap(async (req, res) => { res.json(await require('../services/brandStatement').build(req.brand, req.query.period)); }));

router.get('/notify-prefs', wrap(async (req, res) => { res.json(await brandNotify.view(req.brand, req.brandUser.phone)); }));

router.put('/notify-prefs', wrap(async (req, res) => {
    const b = req.body || {};
    const branches = await Tenant.find({ brandId: req.brand._id }).select('_id slug name').lean();
    const bySlug = new Map(branches.map((t) => [t.slug, t]));
    const phone = req.brandUser.phone;
    let entry = req.brand.ownerNotify.find((p) => p.phone === phone);
    if (!entry) { req.brand.ownerNotify.push({ phone, all: false, branches: {} }); entry = req.brand.ownerNotify[req.brand.ownerNotify.length - 1]; }
    if (b.all !== undefined) {
        if (typeof b.all !== 'boolean') throw httpError(400, 'all must be true or false');
        entry.all = b.all;
    }
    if (b.ownSlug !== undefined) {
        if (b.ownSlug === null) entry.ownTenantId = undefined;
        else {
            const t = bySlug.get(String(b.ownSlug));
            if (!t) throw httpError(404, 'That branch is not part of your brand');
            entry.ownTenantId = t._id;
        }
    }
    const warnings = [];
    if (b.branches !== undefined) {
        if (!b.branches || typeof b.branches !== 'object' || Array.isArray(b.branches)) throw httpError(400, 'branches must be an object of slug: true | false | null');
        for (const [slug, v] of Object.entries(b.branches)) {
            const t = bySlug.get(slug);
            if (!t) throw httpError(404, `${slug} is not part of your brand`);
            if (v !== true && v !== false && v !== null) throw httpError(400, 'Each branch is true, false or null');
            if (v === null) entry.branches.delete(String(t._id)); else entry.branches.set(String(t._id), v);
            // muting a branch nobody else looks after: tell him
            if (v === false && !(await User.exists({ tenantId: t._id, role: 'admin', phone: { $ne: phone }, isBlocked: { $ne: true } }))) {
                warnings.push(`${t.name} has no other manager. Its new orders will not alert you or anyone else.`);
            }
        }
    }
    await req.brand.save();
    brandNotify.forget();
    res.json({ ...(await brandNotify.view(req.brand, phone)), warnings });
}));

router.get('/notifications', wrap(async (req, res) => {
    const branches = await Tenant.find({ brandId: req.brand._id }).select('slug name').lean();
    let scope = branches;
    if (req.query.branch) {
        scope = branches.filter((t) => t.slug === String(req.query.branch).toLowerCase());
        if (!scope.length) throw httpError(404, 'That branch is not part of your brand');
    }
    const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 1000);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 50);
    const rows = await Notification.find({ tenantId: { $in: scope.map((t) => t._id) }, role: 'owner', clearedAt: { $exists: false } })
        .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit + 1).select('tenantId type title body data readAt createdAt').lean();
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const view = await brandNotify.view(req.brand, req.brandUser.phone);
    const on = new Map(view.branches.map((b) => [b.slug, b.on]));
    const nameOf = new Map(branches.map((t) => [String(t._id), t]));
    res.json({
        page, hasMore,
        items: rows.map((n) => {
            const t = nameOf.get(String(n.tenantId));
            return {
                id: n._id, type: n.type, title: n.title, body: n.body || null, data: n.data || null, read: !!n.readAt, createdAt: n.createdAt,
                branch: t ? { slug: t.slug, name: t.name } : null,
                silent: !(t && (on.get(t.slug) || brandNotify.CRITICAL.has(n.type))),   // this branch is muted for him: it did not buzz his phone
            };
        }),
    });
}));

router.post('/switch', wrap(async (req, res) => {
    const target = await branchBySlug(req, req.body && req.body.slug);
    if (target.status === 'suspended') throw httpError(403, 'That branch is switched off');
    const { appoint } = owners;
    await appoint(target, req.brandUser.phone);   // the owner is an owner there too (made once, then it only reads)
    const user = await User.findOne({ tenantId: target._id, phone: req.brandUser.phone });
    if (!user || user.isBlocked) throw httpError(403, 'This account cannot sign in there');
    // no multi-branch anywhere in the brand: the other branches open VIEW ONLY; the branch this owner really works in (where his full session began) stays full
    const home = (req.sessionFlags && req.sessionFlags.homeTenantId) || req.tenant._id;
    const viewOnly = !req.brandPro && String(target._id) !== String(home);
    const { accessToken, refreshToken } = await authController.issueSession(user, target, req, req.ip, { viewOnly, homeTenantId: req.brandPro ? undefined : home });
    res.json({ success: true, viewOnly, slug: target.slug, name: target.name, user: { id: user._id, phone: user.phone, name: user.name || null, role: user.role }, accessToken, refreshToken });
}));

router.post('/menu/push', wrap(async (req, res) => {
    const b = req.body || {};
    const others = await Tenant.find({ brandId: req.brand._id, _id: { $ne: req.tenant._id } }).select('_id slug').lean();
    let targets = others;
    if (b.toSlugs !== 'all') {
        if (!Array.isArray(b.toSlugs) || !b.toSlugs.length) throw httpError(400, 'Choose the branches, or all');
        targets = others.filter((t) => b.toSlugs.includes(t.slug));
        if (targets.length !== new Set(b.toSlugs).size) throw httpError(404, 'A chosen branch is not part of your brand');
    }
    res.json(await menuSync.push({ fromTenantId: req.tenant._id, productIds: b.productIds, toTenantIds: targets.map((t) => t._id), prices: b.prices || 'keep' }));
}));

router.post('/extras/push', wrap(async (req, res) => {
    const b = req.body || {};
    const others = await Tenant.find({ brandId: req.brand._id, _id: { $ne: req.tenant._id } }).select('_id slug').lean();
    let targets = others;
    if (b.toSlugs !== 'all') {
        if (!Array.isArray(b.toSlugs) || !b.toSlugs.length) throw httpError(400, 'Choose the branches, or all');
        targets = others.filter((t) => b.toSlugs.includes(t.slug));
        if (targets.length !== new Set(b.toSlugs).size) throw httpError(404, 'A chosen branch is not part of your brand');
    }
    res.json(await extrasSync.push({ fromTenantId: req.tenant._id, kind: b.kind, ids: b.ids, toTenantIds: targets.map((t) => t._id) }));
}));

router.get('/dues', wrap(async (req, res) => {
    const duesSvc = require('../services/dues');
    const branches = await Tenant.find({ brandId: req.brand._id }).sort({ createdAt: 1, _id: 1 }).select('slug name').lean();
    const rows = [];
    for (const b of branches) {
        const d = await duesSvc.statement(b._id);
        rows.push({ slug: b.slug, name: b.name, count: d.count, rentTotal: d.rentTotal, lateFeeTotal: d.lateFeeTotal, grandTotal: d.grandTotal });
    }
    const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
    res.json({
        branches: rows, count: rows.reduce((s, r) => s + r.count, 0), grandTotal: round2(rows.reduce((s, r) => s + r.grandTotal, 0)),
        lateFeeTotal: round2(rows.reduce((s, r) => s + r.lateFeeTotal, 0)),
    });
}));
router.post('/dues/pay/start', wrap(async (req, res) => {
    const branches = await Tenant.find({ brandId: req.brand._id }).select('_id slug').lean();
    let scope = branches;
    if (req.body && req.body.slug) {
        scope = branches.filter((t) => t.slug === String(req.body.slug).toLowerCase());
        if (!scope.length) throw httpError(404, 'That branch is not part of your brand');
    }
    res.status(201).json(await require('../services/platformCheckout').startBrandDues({ brand: req.brand, tenantIds: scope.map((t) => t._id), actingTenantId: req.tenant._id }));
}));
router.post('/dues/pay/verify', wrap(async (req, res) => {
    res.json(await require('../services/platformCheckout').verifyBrandDues({ brand: req.brand, proof: req.body }));
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
