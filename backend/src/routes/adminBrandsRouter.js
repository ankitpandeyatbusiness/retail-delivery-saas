// Brands with branches. Everybody with a superadmin login can look; only the supreme admin changes anything. Mounted inside adminRouter.
//   GET    /brands                         the brands with their branch counts
//   POST   /brands                         { name, branchLimit?, notes? }
//   GET    /brands/:id                     the brand, its branches, each with the go-live checklist and orders this month
//   PUT    /brands/:id                     { name?, branchLimit?, notes? }
//   POST   /brands/:id/branches            { tenantId } (a shop that already exists) or { name, slug, city, managerPhone?, copyFromTenantId? } (a new branch)
//   DELETE /brands/:id/branches/:tid       take a branch out of the brand (the shop stays, as a normal shop)
//   DELETE /brands/:id                     only when it has no branches
const express = require('express');
const mongoose = require('mongoose');
const Brand = require('../models/Brand');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const brands = require('../services/brandService');
const { requireSupreme } = require('../middlewares/supremeAdmin');
const { hashPhone } = require('../utils/phoneHash');
const { invalidateTenant } = require('../middlewares/tenantRecognizer');
const apiErrors = require('../middlewares/apiErrors');

const { wrap, httpError } = apiErrors;
const router = express.Router();
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const SLUG_RE = /^[a-z0-9-]{3,40}$/;
const RESERVED = ['admin', 'api', 'www'];

router.use('/brands', (req, res, next) => (['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? next() : requireSupreme(req, res, next)));

const loadBrand = wrap(async (req, res, next) => {
    if (!isId(req.params.id)) throw httpError(404, 'Brand not found');
    req.brand = await Brand.findById(req.params.id);
    if (!req.brand) throw httpError(404, 'Brand not found');
    next();
});
const cleanName = (v) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s.length < 2 || s.length > 80) throw httpError(400, 'Brand name must be 2 to 80 characters');
    return s;
};
const cleanLimit = (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 100) throw httpError(400, 'Branch limit must be a whole number from 1 to 100');
    return n;
};

router.get('/brands', wrap(async (req, res) => {
    const [items, counts] = await Promise.all([
        Brand.find({}).sort({ createdAt: -1 }).limit(200).lean(),
        Tenant.aggregate([{ $match: { brandId: { $exists: true, $ne: null } } }, { $group: { _id: '$brandId', n: { $sum: 1 } } }]),
    ]);
    const n = new Map(counts.map((c) => [String(c._id), c.n]));
    res.json({ items: items.map((b) => ({ ...b, branchCount: n.get(String(b._id)) || 0 })) });
}));

router.post('/brands', wrap(async (req, res) => {
    const b = req.body || {};
    const brand = await Brand.create({
        name: cleanName(b.name),
        ...(b.branchLimit !== undefined && { branchLimit: cleanLimit(b.branchLimit) }),
        ...(typeof b.notes === 'string' && { notes: b.notes.trim().slice(0, 500) }),
        createdBy: req.admin.name || req.admin.email,
    });
    res.status(201).json({ brand });
}));

router.get('/brands/:id', loadBrand, wrap(async (req, res) => {
    const branches = await Tenant.find({ brandId: req.brand._id }).sort({ createdAt: 1 })
        .select('_id slug name logo status branchCity address.city delivery payments.enabled payments.keyId billing.isLive billing.state createdAt').lean();
    const orders = await brands.ordersThisMonth(branches.map((t) => t._id));
    const items = [];
    for (const t of branches) {
        items.push({
            id: t._id, slug: t.slug, name: t.name, logo: t.logo || null, status: t.status,
            city: t.branchCity || (t.address && t.address.city) || null,
            billingState: (t.billing && t.billing.state) || 'free',
            ordersThisMonth: orders.get(String(t._id)) || 0,
            checklist: await brands.checklist(t),
            razorpayKeyId: (t.payments && t.payments.keyId) || null,   // the key id is not secret; the secret is never returned
        });
    }
    res.json({ brand: req.brand, branches: items, canAdd: items.length < req.brand.branchLimit });
}));

router.put('/brands/:id', loadBrand, wrap(async (req, res) => {
    const b = req.body || {};
    req.auditBefore = { name: req.brand.name, branchLimit: req.brand.branchLimit };
    if (b.name !== undefined) req.brand.name = cleanName(b.name);
    if (b.branchLimit !== undefined) {
        const n = cleanLimit(b.branchLimit);
        const have = await Tenant.countDocuments({ brandId: req.brand._id });
        if (n < have) throw httpError(409, `This brand already has ${have} branches. Take one out first, or keep the limit at ${have} or more.`);
        req.brand.branchLimit = n;
    }
    if (typeof b.notes === 'string') req.brand.notes = b.notes.trim().slice(0, 500);
    await req.brand.save();
    res.json({ brand: req.brand });
}));

router.post('/brands/:id/branches', loadBrand, wrap(async (req, res) => {
    const b = req.body || {};
    const have = await Tenant.countDocuments({ brandId: req.brand._id });
    if (have >= req.brand.branchLimit) throw httpError(409, `The limit of ${req.brand.branchLimit} branches is reached. Raise the limit first.`);
    const city = typeof b.city === 'string' ? b.city.trim().slice(0, 60) : '';

    // an existing shop becomes a branch
    if (b.tenantId !== undefined) {
        if (!isId(b.tenantId)) throw httpError(400, 'Choose a shop');
        const t = await Tenant.findById(b.tenantId);
        if (!t) throw httpError(404, 'Shop not found');
        if (t.brandId) throw httpError(409, String(t.brandId) === String(req.brand._id) ? 'This shop is already a branch of this brand.' : 'This shop already belongs to another brand.');
        // its people must not also work at another branch of this brand
        const people = await User.find({ tenantId: t._id, role: { $in: brands.JOB_ROLES }, isBlocked: { $ne: true } }).select('phone').lean();
        t.brandId = req.brand._id;
        for (const p of people) await brands.assertOneBranch(t, p.phone);
        if (city) t.branchCity = city;
        await t.save();
        invalidateTenant(t.slug);
        return res.status(201).json({ branch: { id: t._id, slug: t.slug, name: t.name } });
    }

    // a new branch
    const slug = String(b.slug || '').trim().toLowerCase();
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (name.length < 2 || name.length > 80) throw httpError(400, 'Branch name must be 2 to 80 characters');
    if (!SLUG_RE.test(slug) || RESERVED.includes(slug)) throw httpError(400, 'slug must be 3-40 characters: lowercase letters, numbers and hyphens');
    if (!city) throw httpError(400, 'Enter the city of this branch');
    const managerPhone = b.managerPhone === undefined || b.managerPhone === '' ? null : String(b.managerPhone).trim();
    if (managerPhone && !/^[6-9]\d{9}$/.test(managerPhone)) throw httpError(400, 'Enter a valid 10-digit mobile number for the manager');
    if (await Tenant.exists({ slug })) throw httpError(409, 'This slug is already used');

    // the starting look and rules come from another branch of the brand (never its menu, stock or money keys: those are phases 5 and 6)
    let base = null;
    if (b.copyFromTenantId !== undefined) {
        if (!isId(b.copyFromTenantId)) throw httpError(400, 'Choose a branch to copy from');
        base = await Tenant.findOne({ _id: b.copyFromTenantId, brandId: req.brand._id }).select('businessType colors logo tagline settings').lean();
        if (!base) throw httpError(404, 'The branch to copy from is not in this brand');
    }
    const tenant = new Tenant({
        slug, name, brandId: req.brand._id, branchCity: city, address: { city },
        ...(base && { businessType: base.businessType, colors: base.colors, logo: base.logo, tagline: base.tagline, settings: base.settings || {} }),
    });
    if (managerPhone) await brands.assertOneBranch(tenant, managerPhone);
    await tenant.save();
    if (managerPhone) {
        await User.create({ tenantId: tenant._id, phone: managerPhone, role: 'admin', phoneHash: hashPhone(tenant._id, managerPhone) });
    }
    invalidateTenant(slug);
    res.status(201).json({ branch: { id: tenant._id, slug, name }, appBuild: { APP_TENANT: slug } });
}));

router.delete('/brands/:id/branches/:tid', loadBrand, wrap(async (req, res) => {
    if (!isId(req.params.tid)) throw httpError(404, 'Branch not found');
    const t = await Tenant.findOne({ _id: req.params.tid, brandId: req.brand._id });
    if (!t) throw httpError(404, 'Branch not found');
    t.brandId = undefined;
    t.branchCity = undefined;
    await t.save();
    invalidateTenant(t.slug);
    res.json({ ok: true });
}));

router.delete('/brands/:id', loadBrand, wrap(async (req, res) => {
    if (await Tenant.exists({ brandId: req.brand._id })) throw httpError(409, 'Take every branch out of this brand first.');
    await req.brand.deleteOne();
    res.json({ ok: true });
}));

router.use(apiErrors);
module.exports = router;
