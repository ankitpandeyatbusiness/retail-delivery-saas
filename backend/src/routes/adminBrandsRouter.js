// Brands with branches. Everybody with a superadmin login can look; only the supreme admin changes anything. Mounted inside adminRouter.
//   GET    /brands/settings                the multi-branch discount: the suggested % and the most any brand may get
//   PUT    /brands/settings                { defaultDiscountPercent?, maxDiscountPercent? }   (supreme admin)
//   GET    /brands                         the brands with their branch counts
//   POST   /brands                         { name, notes? }   (a brand can have as many branches as you like)
//   GET    /brands/:id                     the brand, its branches, each with the go-live checklist and orders this month
//   PUT    /brands/:id                     { name?, notes?, discountPercent? }   discountPercent: rent discount for the 2nd branch onward (0 = off, never above the cap)
//   POST   /brands/:id/branches            { tenantId } (a shop that already exists) or { name, slug, city, managerPhone?, copyFromTenantId? } (a new branch)
//   POST   /brands/:id/branches/:tid/area-lock   { locked: true|false }  lock or unlock the map pin and delivery radius (supreme admin): a branch manager cannot change a locked area
//   PUT    /brands/:id/free-start          { on, freeOrders?, freeMonths? }  "New branches get a free start": on = one shared free pool for the brand, off = no free time for a new branch (supreme admin)
//   POST   /brands/:id/bulk/waive-late-fees  { tenantIds: [..] | 'all', reason }                       waive every unpaid late fee of the chosen branches (supreme admin)
//   POST   /brands/:id/bulk/mark-paid        { tenantIds, paymentMode?, paymentRef?, receivedBy, note? }  mark every unpaid bill of the chosen branches paid by hand
//   POST   /brands/:id/bulk/mark-unpaid      { tenantIds, period }                                  put the paid rent bills of a month back to unpaid
//   DELETE /brands/:id/branches/:tid       take a branch out of the brand (the shop stays, as a normal shop)
//   POST   /brands/:id/owners              { phone, ownSlug? }  appoint a brand owner (any superadmin): owner of every branch, can switch between them
//   DELETE /brands/:id/owners/:phone       take the brand-owner job away (they lose the owner panel in every branch)
//   POST   /brands/:id/move                { fromTenantId, toTenantId, userId }  move a manager, cook, waiter or rider (any superadmin)
//   POST   /brands/:id/menu/push           { fromTenantId, productIds, toTenantIds, prices? }  push dishes from one branch to others (supreme admin)
//   GET    /brands/:id/statement?period=2026-10   the brand's monthly statement (everyone looks)
//   GET    /brands/:id/statement.pdf?period=2026-10   the same as a PDF (?view=1 opens it in the browser)
//   POST   /brands/:id/settings/push       { fromTenantId, toTenantIds, sections }  copy settings groups (hours, orders, features, look...) of one branch onto others (supreme admin)
//   POST   /brands/:id/extras/push         { fromTenantId, kind, ids, toTenantIds }  push coupons, banners or collections (supreme admin)
//   DELETE /brands/:id                     only when it has no branches
const express = require('express');
const mongoose = require('mongoose');
const Brand = require('../models/Brand');
const PlatformSettings = require('../models/PlatformSettings');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const brands = require('../services/brandService');
const wallet = require('../services/smsWalletService');
const { requireSupreme } = require('../middlewares/supremeAdmin');
const { hashPhone } = require('../utils/phoneHash');
const { invalidateTenant } = require('../middlewares/tenantRecognizer');
const apiErrors = require('../middlewares/apiErrors');

const { wrap, httpError } = apiErrors;
const router = express.Router();
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const SLUG_RE = /^[a-z0-9-]{3,40}$/;
const RESERVED = ['admin', 'api', 'www'];

// the supreme admin changes brands; appointing a brand owner and moving a person are open to every superadmin (as adding a shop owner is today)
const OPEN = /^\/brands\/[^/]+\/(owners(\/[^/]+)?|move)$/;
router.use('/brands', (req, res, next) => (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || OPEN.test(`/brands${req.path}`) ? next() : requireSupreme(req, res, next)));

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

const pct = (v, what) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw httpError(400, `${what} must be a number from 0 to 100`);
    return Math.round(n * 100) / 100;
};
const discountSettings = async () => {
    const p = await PlatformSettings.findById('main').select('brand').lean();
    return { defaultDiscountPercent: (p && p.brand && p.brand.defaultDiscountPercent) ?? 10, maxDiscountPercent: (p && p.brand && p.brand.maxDiscountPercent) ?? 15 };
};

router.get('/brands/settings', wrap(async (req, res) => { res.json(await discountSettings()); }));
router.put('/brands/settings', wrap(async (req, res) => {
    const b = req.body || {};
    const cur = await discountSettings();
    const next = {
        defaultDiscountPercent: b.defaultDiscountPercent === undefined ? cur.defaultDiscountPercent : pct(b.defaultDiscountPercent, 'The suggested discount'),
        maxDiscountPercent: b.maxDiscountPercent === undefined ? cur.maxDiscountPercent : pct(b.maxDiscountPercent, 'The cap'),
    };
    if (next.defaultDiscountPercent > next.maxDiscountPercent) throw httpError(400, 'The suggested discount cannot be above the cap');
    req.auditBefore = cur;
    await PlatformSettings.updateOne({ _id: 'main' }, { $set: { 'brand.defaultDiscountPercent': next.defaultDiscountPercent, 'brand.maxDiscountPercent': next.maxDiscountPercent } }, { upsert: true, setDefaultsOnInsert: true });
    res.json(next);
}));

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
        ...(typeof b.notes === 'string' && { notes: b.notes.trim().slice(0, 500) }),
        createdBy: req.admin.name || req.admin.email,
    });
    res.status(201).json({ brand });
}));

router.get('/brands/:id', loadBrand, wrap(async (req, res) => {
    const branches = await Tenant.find({ brandId: req.brand._id }).sort({ createdAt: 1 })
        .select('_id slug name logo status branchCity address.city delivery payments.enabled payments.keyId billing.isLive billing.state createdAt').lean();
    const orders = await brands.ordersThisMonth(branches.map((t) => t._id));
    const stats = await require('../services/shopListStats').forShops(await Tenant.find({ brandId: req.brand._id }).select('_id brandId status createdAt billing.isLive billing.goLiveAt').lean());
    const items = [];
    for (const t of branches) {
        items.push({
            id: t._id, slug: t.slug, name: t.name, logo: t.logo || null, status: t.status,
            city: t.branchCity || (t.address && t.address.city) || null,
            billingState: (t.billing && t.billing.state) || 'free',
            ordersThisMonth: orders.get(String(t._id)) || 0,
            closed: t.status !== 'active',
            ordersToday: stats.get(String(t._id))?.ordersToday || 0, owed: stats.get(String(t._id))?.owed || 0, overdue: stats.get(String(t._id))?.overdue || 0, lastOrderAt: stats.get(String(t._id))?.lastOrderAt || null,
            checklist: await brands.checklist(t),
            area: { locked: !!(t.delivery && t.delivery.locked), by: (t.delivery && t.delivery.locationBy) || null },   // the pin and radius: locked by the head office? who changed them last?
            razorpayKeyId: (t.payments && t.payments.keyId) || null,   // the key id is not secret; the secret is never returned
        });
    }
    res.json({ brand: req.brand, plan: await require('../services/brandPlan').summary(req.brand), branches: items, freeStart: await require('../services/brandFreePool').view(req.brand) });
}));

router.put('/brands/:id', loadBrand, wrap(async (req, res) => {
    const b = req.body || {};
    req.auditBefore = { name: req.brand.name };
    if (b.name !== undefined) req.brand.name = cleanName(b.name);
    if (b.discountPercent !== undefined) {
        const d = b.discountPercent === null ? 0 : pct(b.discountPercent, 'The discount');
        const cap = (await discountSettings()).maxDiscountPercent;
        if (d > cap) throw httpError(400, `The discount cannot be above ${cap}% (the platform cap). Raise the cap first.`);
        req.auditBefore = { ...req.auditBefore, discountPercent: req.brand.discountPercent };
        req.brand.discountPercent = d;
    }
    if (typeof b.notes === 'string') req.brand.notes = b.notes.trim().slice(0, 500);
    await req.brand.save();
    res.json({ brand: req.brand });
}));

// How many shops are free for THIS brand, and the free extras you allow. { includedBranches: 2 | null (the platform default), freeExtra: 0 }  Supreme only (money). Audit logged.
router.put('/brands/:id/locations', loadBrand, wrap(async (req, res) => {
    const b = req.body || {};
    const set = {};
    if (b.includedBranches !== undefined) {
        if (b.includedBranches !== null && !(Number.isInteger(b.includedBranches) && b.includedBranches >= 0 && b.includedBranches <= 50)) throw httpError(400, 'Free branches must be a whole number from 0 to 50');
        set['locations.includedBranches'] = b.includedBranches === null ? undefined : b.includedBranches;
    }
    if (b.freeExtra !== undefined) {
        if (!(Number.isInteger(b.freeExtra) && b.freeExtra >= 0 && b.freeExtra <= 50)) throw httpError(400, 'Free extra shops must be a whole number from 0 to 50');
        set['locations.freeExtra'] = b.freeExtra;
    }
    if (!Object.keys(set).length) throw httpError(400, 'Send includedBranches and/or freeExtra');
    req.auditBefore = { locations: req.brand.locations || {} };
    const $set = {}; const $unset = {};
    for (const [k, v] of Object.entries(set)) { if (v === undefined) $unset[k] = 1; else $set[k] = v; }
    await Brand.updateOne({ _id: req.brand._id }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) });
    const fresh = await Brand.findById(req.brand._id);
    res.json(await require('../services/brandPlan').summary(fresh));
}));

// Make every branch follow the main shop's plan now (a brand whose branches had plans of their own). Supreme only.
router.post('/brands/:id/sync-plan', loadBrand, wrap(async (req, res) => {
    req.auditBefore = { action: 'brand plan sync' };
    const r = await require('../services/brandPlan').syncPlan(req.brand._id);
    res.json({ ...r, summary: await require('../services/brandPlan').summary(await Brand.findById(req.brand._id)) });
}));

router.get('/brands/:id/statement.pdf', loadBrand, wrap(async (req, res) => {
    const pdf = require('../services/brandStatementPdf');
    const st = await require('../services/brandStatement').build(req.brand, req.query.period);
    pdf.streamStatement(res, st, await pdf.sellerOf(), { inline: req.query.view === '1' });
}));

router.get('/brands/:id/statement', loadBrand, wrap(async (req, res) => { res.json(await require('../services/brandStatement').build(req.brand, req.query.period)); }));

router.post('/brands/:id/branches', loadBrand, wrap(async (req, res) => {
    const b = req.body || {};
    await require('../services/brandPlan').assertRoomForBranch(req.brand);   // 3 shops are free; more need the brand owner's payment first (or a free one from you)
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
        // the brand has one SMS wallet: money this shop kept in its own wallet moves into it
        wallet.forgetHolders();
        const keeper = await wallet.holderOf(t._id);
        if (String(keeper) !== String(t._id)) await wallet.transfer(t._id, keeper, `Moved into the wallet of ${req.brand.name}`).catch((e) => console.error('Wallet move error:', e.message));
        const problems = await brands.giveOwnersAccess(req.brand, t);
        await require('../services/brandPlan').syncPlan(req.brand._id);   // the new branch carries the brand's plan
        return res.status(201).json({ branch: { id: t._id, slug: t.slug, name: t.name }, ...(problems.length && { problems }) });
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
    const freeStart = await require('../services/brandFreePool').applyToNewBranch(req.brand, tenant._id);   // pooled with the brand's free start, or no free time
    const problems = await brands.giveOwnersAccess(req.brand, tenant);
    // the starting menu: a copy of the branch we copied the look from (each branch edits its own from now on)
    const menu = base && b.copyMenu !== false ? await require('../services/menuSync').copyMenu({ fromTenantId: b.copyFromTenantId, toTenantId: tenant._id }) : null;
    const extras = menu ? await require('../services/extrasSync').copyExtras({ fromTenantId: b.copyFromTenantId, toTenantId: tenant._id }) : null;   // after the dishes: a collection needs them
    await require('../services/brandPlan').syncPlan(req.brand._id);   // the new branch carries the brand's plan
    res.status(201).json({ branch: { id: tenant._id, slug, name }, appBuild: { APP_TENANT: slug }, freeStart, ...(menu && { menu }), ...(extras && { extras }), ...(problems.length && { problems }) });
}));

router.put('/brands/:id/free-start', loadBrand, wrap(async (req, res) => {
    const b = req.body || {};
    if (typeof b.on !== 'boolean') throw httpError(400, 'on must be true or false');
    const num = (v, what) => {
        if (v === undefined || v === null) return undefined;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0 || n > 1000) throw httpError(400, `${what} must be a whole number from 0 to 1000`);
        return n;
    };
    const pool = require('../services/brandFreePool');
    req.auditBefore = { freeStart: req.brand.freeStart };
    if (b.on) await pool.enable(req.brand, { freeOrders: num(b.freeOrders, 'Free orders'), freeMonths: num(b.freeMonths, 'Free months') });
    else await pool.disable(req.brand);
    const fresh = await Brand.findById(req.brand._id);
    res.json({ freeStart: await pool.view(fresh) });
}));

// the supreme admin's bulk money actions (services/brandBulkBilling.js): one row per branch, what was done and what was skipped
const bulk = (name) => wrap(async (req, res) => {
    const b = req.body || {};
    const svc = require('../services/brandBulkBilling');
    req.auditBefore = { action: name, tenantIds: b.tenantIds === undefined ? 'all' : b.tenantIds };
    let out;
    if (name === 'waive-late-fees') out = await svc.waiveLateFees(req.brand, b.tenantIds, { reason: b.reason, by: req.admin.email });
    else if (name === 'mark-paid') out = await svc.markPaid(req.brand, b.tenantIds, b, req.admin);
    else out = await svc.markUnpaid(req.brand, b.tenantIds, b, req.admin);
    res.json(out);
});
router.post('/brands/:id/bulk/waive-late-fees', loadBrand, bulk('waive-late-fees'));
router.post('/brands/:id/bulk/mark-paid', loadBrand, bulk('mark-paid'));
router.post('/brands/:id/bulk/mark-unpaid', loadBrand, bulk('mark-unpaid'));

router.post('/brands/:id/branches/:tid/area-lock', loadBrand, wrap(async (req, res) => {
    if (!isId(req.params.tid)) throw httpError(404, 'Branch not found');
    if (typeof (req.body && req.body.locked) !== 'boolean') throw httpError(400, 'locked must be true or false');
    const t = await Tenant.findOne({ _id: req.params.tid, brandId: req.brand._id });
    if (!t) throw httpError(404, 'Branch not found');
    req.auditBefore = { locked: !!(t.delivery && t.delivery.locked) };
    t.set('delivery.locked', req.body.locked);
    t.set('delivery.lockedBy', req.body.locked ? (req.admin.name || req.admin.email || 'Superadmin') : undefined);
    t.set('delivery.lockedAt', req.body.locked ? new Date() : undefined);
    await t.save();
    invalidateTenant(t.slug);
    res.json({ ok: true, locked: req.body.locked });
}));

router.delete('/brands/:id/branches/:tid', loadBrand, wrap(async (req, res) => {
    if (!isId(req.params.tid)) throw httpError(404, 'Branch not found');
    const t = await Tenant.findOne({ _id: req.params.tid, brandId: req.brand._id });
    if (!t) throw httpError(404, 'Branch not found');
    // if this branch holds the brand's SMS wallet, the money and the job go to the next branch first
    if (String(await wallet.holderOf(t._id)) === String(t._id)) {
        const next = await Tenant.findOne({ brandId: req.brand._id, _id: { $ne: t._id } }).sort({ createdAt: 1, _id: 1 }).select('_id').lean();
        if (next) {
            await wallet.transfer(t._id, next._id, `Moved to the next wallet branch of ${req.brand.name}`);
            await Brand.updateOne({ _id: req.brand._id }, { $set: { smsWalletTenantId: next._id } });
        } else {
            await Brand.updateOne({ _id: req.brand._id }, { $unset: { smsWalletTenantId: 1 } });
        }
        wallet.forgetHolders();
    }
    t.brandId = undefined;
    t.branchCity = undefined;
    await t.save();
    invalidateTenant(t.slug);
    res.json({ ok: true });
}));

const b_own = (req) => !!(req.body && req.body.ownSlug);
router.post('/brands/:id/owners', loadBrand, wrap(async (req, res) => {
    const phone = String((req.body && req.body.phone) || '').trim();
    if (!/^[6-9]\d{9}$/.test(phone)) throw httpError(400, 'Enter a valid 10-digit mobile number');
    if ((req.brand.ownerPhones || []).includes(phone)) return res.json({ brand: req.brand, alreadyOwner: true });
    if (req.brand.ownerPhones.length >= 3) throw httpError(409, 'A brand can have up to 3 owners.');
    const branches = await Tenant.find({ brandId: req.brand._id });
    // refuse before changing anything: a worker of a branch cannot be a brand owner until the job is removed
    for (const t of branches) {
        const job = await User.findOne({ tenantId: t._id, phone, role: { $in: ['rider', 'kitchen', 'waiter'] } }).select('role').lean();
        if (job) throw httpError(409, `This number works as ${job.role} at ${t.name}. Remove that job first.`);
    }
    // optional: the branch he manages himself (it always notifies him)
    let own = null;
    if (b_own(req)) {
        own = branches.find((t) => t.slug === String(req.body.ownSlug));
        if (!own) throw httpError(404, 'That branch is not part of this brand');
    }
    req.brand.ownerPhones.push(phone);
    if (own) req.brand.ownerNotify.push({ phone, all: false, ownTenantId: own._id, branches: {} });
    await req.brand.save();
    const problems = [];
    for (const t of branches) {
        try { await require('../services/ownerService').appoint(t, phone); } catch (e) { problems.push(`${t.name}: ${e.message}`); }
    }
    res.status(201).json({ brand: req.brand, ...(problems.length && { problems }) });
}));

router.delete('/brands/:id/owners/:phone', loadBrand, wrap(async (req, res) => {
    const phone = String(req.params.phone || '');
    if (!(req.brand.ownerPhones || []).includes(phone)) throw httpError(404, 'This number is not an owner of the brand');
    req.brand.ownerPhones = req.brand.ownerPhones.filter((p) => p !== phone);
    req.brand.ownerNotify = req.brand.ownerNotify.filter((p) => p.phone !== phone);
    await req.brand.save();
    const ids = (await Tenant.find({ brandId: req.brand._id }).select('_id').lean()).map((t) => t._id);
    const Session = require('../models/Session');
    const users = await User.find({ tenantId: { $in: ids }, phone, role: 'admin' }).select('_id').lean();
    await User.updateMany({ _id: { $in: users.map((u) => u._id) } }, { $set: { role: 'customer' } });
    await Session.deleteMany({ userId: { $in: users.map((u) => u._id) } });
    res.json({ brand: req.brand });
}));

router.post('/brands/:id/move', loadBrand, wrap(async (req, res) => {
    const b = req.body || {};
    if (![b.fromTenantId, b.toTenantId, b.userId].every(isId)) throw httpError(400, 'Choose the person and both branches');
    const [fromTenant, toTenant] = await Promise.all([Tenant.findById(b.fromTenantId), Tenant.findById(b.toTenantId)]);
    if (!fromTenant || !toTenant) throw httpError(404, 'Branch not found');
    res.json(await brands.movePerson({ brand: req.brand, fromTenant, toTenant, userId: b.userId }));
}));

router.post('/brands/:id/menu/push', loadBrand, wrap(async (req, res) => {
    const b = req.body || {};
    if (!isId(b.fromTenantId) || !Array.isArray(b.toTenantIds) || !b.toTenantIds.every(isId)) throw httpError(400, 'Choose the branches');
    const ids = [b.fromTenantId, ...b.toTenantIds];
    if ((await Tenant.countDocuments({ _id: { $in: ids }, brandId: req.brand._id })) !== new Set(ids).size) throw httpError(404, 'A chosen branch is not part of this brand');
    if (b.toTenantIds.includes(b.fromTenantId)) throw httpError(400, 'Choose other branches');
    res.json(await require('../services/menuSync').push({ fromTenantId: b.fromTenantId, productIds: b.productIds, toTenantIds: b.toTenantIds, prices: b.prices || 'keep' }));
}));

router.post('/brands/:id/settings/push', requireSupreme, loadBrand, wrap(async (req, res) => {
    const b = req.body || {};
    if (!isId(b.fromTenantId) || !Array.isArray(b.toTenantIds) || !b.toTenantIds.every(isId)) throw httpError(400, 'Choose the branches');
    req.auditBefore = { from: b.fromTenantId, sections: b.sections };
    res.json(await require('../services/settingsSync').apply({ brandId: req.brand._id, fromTenantId: b.fromTenantId, toTenantIds: b.toTenantIds, sections: b.sections }));
}));

router.post('/brands/:id/extras/push', loadBrand, wrap(async (req, res) => {
    const b = req.body || {};
    if (!isId(b.fromTenantId) || !Array.isArray(b.toTenantIds) || !b.toTenantIds.every(isId)) throw httpError(400, 'Choose the branches');
    const ids = [b.fromTenantId, ...b.toTenantIds];
    if ((await Tenant.countDocuments({ _id: { $in: ids }, brandId: req.brand._id })) !== new Set(ids).size) throw httpError(404, 'A chosen branch is not part of this brand');
    if (b.toTenantIds.includes(b.fromTenantId)) throw httpError(400, 'Choose other branches');
    res.json(await require('../services/extrasSync').push({ fromTenantId: b.fromTenantId, kind: b.kind, ids: b.ids, toTenantIds: b.toTenantIds }));
}));

router.delete('/brands/:id', loadBrand, wrap(async (req, res) => {
    if (await Tenant.exists({ brandId: req.brand._id })) throw httpError(409, 'Take every branch out of this brand first.');
    await req.brand.deleteOne();
    res.json({ ok: true });
}));

router.use(apiErrors);
module.exports = router;
