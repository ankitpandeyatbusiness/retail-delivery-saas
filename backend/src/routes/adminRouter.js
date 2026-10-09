const express = require('express');
const mongoose = require('mongoose');

const SuperAdmin = require('../models/SuperAdmin');
const Tenant = require('../models/Tenant');
const Category = require('../models/Category');
const Product = require('../models/Product');
const Banner = require('../models/Banner');
const Coupon = require('../models/Coupon');
const User = require('../models/User');
const Collection = require('../models/Collection');
const { pickBrandColors } = require('../services/logoColors');

const O = require('../config/tenantOptions');
const { getPreset } = require('../config/homePresets');
const { validateSettings, resolveConfig, DEFAULTS } = require('../services/tenantConfigService');
const { signAdminToken } = require('../services/superAdminToken');
const requireSuperAdmin = require('../middlewares/requireSuperAdmin');
const { invalidateTenant } = require('../middlewares/tenantRecognizer');
const { getAvailability, invalidateAvailability, applyAutoHide } = require('../services/availability');
const { foodRuleError } = require('../services/foodRules');
const keepOwnerPause = require('../utils/keepOwnerPause');
const { shopState } = require('../utils/shopState');
const auditTrail = require('../middlewares/auditTrail');
const apiErrors = require('../middlewares/apiErrors');
const { wrap, httpError } = apiErrors;
const loadTenant = require('../middlewares/loadTenant');   // change the file name if yours is different
const loadFullTenant = require('../middlewares/loadFullTenant');
const crud = require('../utils/crud');
// The food mode lives at config.home.foodMode (same place the catalog code reads it)
const getFoodMode = (tenant) => resolveConfig(tenant).home.foodMode;

const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28];

const admin = express.Router();

/* ------------------------------ helpers ------------------------------ */
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pickFields = (fields, body) =>
    Object.fromEntries(fields.filter((f) => body?.[f] !== undefined).map((f) => [f, body[f]]));

const SLUG_RE = /^[a-z0-9-]{3,40}$/;
const RESERVED_SLUGS = ['admin', 'api', 'www'];
const TENANT_FIELDS = ['name', 'tagline', 'logo', 'colors', 'heroImages', 'status', 'androidPackage', 'phone', 'address', 'delivery', 'business', 'subscription'];

/* ------------------------------ login (public) ------------------------------ */
// Simple in-memory brake: 5 wrong tries per IP per 15 minutes.
// (Per server instance. Use a shared store like Redis if you run several servers.)
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const blocked = (ip) => { const a = attempts.get(ip); return !!a && a.resetAt > Date.now() && a.count >= MAX_FAILS; };
const recordFail = (ip) => {
    const now = Date.now();
    if (attempts.size > 5000) for (const [k, v] of attempts) if (v.resetAt <= now) attempts.delete(k);
    const a = attempts.get(ip);
    if (!a || a.resetAt <= now) attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    else a.count += 1;
};

admin.post('/auth/login', wrap(async (req, res) => {
    const ip = req.ip;
    if (blocked(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });

    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const account = email ? await SuperAdmin.findOne({ email }) : null;

    const ok = account ? await account.verifyPassword(password) : (await SuperAdmin.dummyVerify(password), false);
    if (!ok || !account.isActive) {
        recordFail(ip);
        return res.status(401).json({ error: 'Wrong email or password' });
    }

    attempts.delete(ip);
    account.lastLoginAt = new Date();
    await account.save();
    auditTrail.record({
        actorType: 'superadmin', actorId: account._id, actorLabel: account.email,
        action: 'LOGIN /api/admin/auth/login', method: 'POST', path: '/api/admin/auth/login', status: 200, ip,
    });
    res.json({ token: signAdminToken(account), admin: { email: account.email, name: account.name || null } });
}));

/* ------------------------------ everything below needs a superadmin ------------------------------ */
admin.use(requireSuperAdmin);
admin.use(auditTrail('superadmin'));   // records every change a superadmin makes

admin.use(require('./adminOrdersRouter'));
admin.use(require('./adminUsersRouter'));
admin.use(require('./adminAccessRouter'));
admin.use(require('./adminPlatformRouter'));
admin.use(require('./adminBillingRouter'));
admin.use(require('./adminSubscriptionRouter'));
admin.use(require('./adminAuditRouter'));
admin.use(require('./adminSmsRouter'));
admin.use(require('./adminNotifyRouter'));

// any change to a shop's data refreshes that shop's cached counts
admin.use('/tenants/:tid', (req, res, next) => {
    if (req.method !== 'GET') res.on('finish', () => invalidateAvailability(req.params.tid));
    next();
});

admin.get('/me', (req, res) => res.json({ email: req.admin.email, name: req.admin.name || null }));

// Everything the panel needs to draw its form: allowed values, defaults, and a starting template per shop type
admin.get('/options', (req, res) => {
    res.json({
        options: O,
        defaults: DEFAULTS,
        presets: Object.fromEntries(O.SHOP_TYPES.map((t) => [t, getPreset(t)])),
    });
});

// Live preview: send a draft, get back what the app would receive. Nothing is saved.
// (This is the config BEFORE auto-hide, so it can show a filter the real app hides for lack of data.)
admin.post('/preview-config', (req, res) => {
    const body = req.body || {};
    const { errors } = validateSettings(body.settings);
    const config = resolveConfig({
        ...pickFields(TENANT_FIELDS, body),
        name: body.name || 'Preview',
        settings: body.settings,
    });
    res.json({ config, errors });
});

/* ------------------------------ tenants ------------------------------ */
admin.get('/tenants', wrap(async (req, res) => {
    const filter = {};
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
        const re = new RegExp(esc(req.query.q.trim().slice(0, 40)), 'i');
        filter.$or = [{ name: re }, { slug: re }];
    }
    const items = await Tenant.find(filter)
        .sort({ createdAt: -1 })
        .limit(200)
        .select('slug name status androidPackage createdAt updatedAt ownerBlocked ownerBlockedReason maintenance settings.orders.acceptingOrders billing.state billing.graceEndsAt')
        .lean();
    res.json({
        items: items.map((t) => {
            const { settings, maintenance, ownerBlockedReason, ...rest } = t;
            return { ...rest, state: shopState(t) };
        }),
    });
}));

admin.post('/tenants', wrap(async (req, res) => {
    const body = req.body || {};
    const slug = String(body.slug || '').trim().toLowerCase();
    if (!SLUG_RE.test(slug)) throw httpError(400, 'slug must be 3-40 characters: lowercase letters, numbers and hyphens');
    if (RESERVED_SLUGS.includes(slug)) throw httpError(400, 'This slug is reserved');

    const v = validateSettings(body.settings || {});
    if (!v.ok) return res.status(400).json({ error: 'Invalid settings', errors: v.errors });

    const tenant = new Tenant({ slug, ...pickFields(TENANT_FIELDS, body), settings: v.clean });
    await tenant.save();
    invalidateTenant(slug); // clears a cached "not found" for this slug
    res.status(201).json({
        tenant,
        // what you need to build this tenant's app
        appBuild: { APP_TENANT: slug, androidPackage: tenant.androidPackage || null },
    });
}));

admin.get('/tenants/:tid', wrap(async (req, res) => {
    if (!isId(req.params.tid)) throw httpError(404, 'Tenant not found');
    const tenant = await Tenant.findById(req.params.tid).lean();
    if (!tenant) throw httpError(404, 'Tenant not found');
    res.json({ tenant, resolved: resolveConfig(tenant), state: shopState(tenant) });
}));

// Send only what changed. `settings`, if sent, REPLACES the whole settings document (the panel sends its full form).
// `business`, if sent, REPLACES the whole business object: send legalName, gstin and fssai together.
admin.put('/tenants/:tid', wrap(async (req, res) => {
    if (!isId(req.params.tid)) throw httpError(404, 'Tenant not found');
    const tenant = await Tenant.findById(req.params.tid);
    if (!tenant) throw httpError(404, 'Tenant not found');

    const body = req.body || {};
    if (body.slug !== undefined && String(body.slug).toLowerCase() !== tenant.slug) {
        throw httpError(400, 'slug cannot be changed: it is built into the tenant\'s app');
    }

    // --- REPLACEMENT STARTS HERE ---
    req.auditBefore = pickFields([...TENANT_FIELDS, 'settings'], tenant.toObject());   // for the audit log
    const updates = pickFields(TENANT_FIELDS, body);
    for (const [key, value] of Object.entries(updates)) {
        // Deep merge for nested objects (delivery, business, subscription, colors, address)
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            for (const [subKey, subValue] of Object.entries(value)) {
                tenant.set(`${key}.${subKey}`, subValue);
            }
        } else {
            // Normal assignment for flat fields (name, phone, heroImages array)
            tenant.set(key, value);
        }
    }
    // --- REPLACEMENT ENDS HERE ---

    if (body.settings !== undefined) {
        const v = validateSettings(body.settings);
        if (!v.ok) return res.status(400).json({ error: 'Invalid settings', errors: v.errors });
        tenant.set('settings', keepOwnerPause(tenant.settings, v.clean));
        tenant.markModified('settings');
    }
    await tenant.save();
    invalidateTenant(tenant.slug); // app sees the change immediately on this server

    res.json({ tenant, resolved: resolveConfig(tenant.toObject()) });
}));

// Logo colours. Send the image itself as the request body (Content-Type: image/png, image/jpeg or image/webp).
//   no query       -> only suggests colours, saves nothing
//   ?apply=empty   -> fills colour slots that are still empty
//   ?apply=replace -> overwrites the saved colours
// A colour set in the panel's brand settings always wins, so it is skipped.
admin.post('/tenants/:tid/logo-colors',
    loadTenant,
    express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '1mb' }),
    wrap(async (req, res) => {
        if (!Buffer.isBuffer(req.body) || !req.body.length) {
            throw httpError(400, 'Send the logo image (PNG, JPG or WebP, up to 1 MB) as the request body');
        }
        const image = req.body;
        req.body = { note: 'image left out of the audit log' };

        let suggested;
        try { suggested = await pickBrandColors(image); } catch (e) { throw httpError(400, 'Could not read this image'); }
        if (!suggested) {
            return res.json({ suggested: null, message: 'No usable colour in this logo. Set the colour by hand.' });
        }

        const mode = req.query.apply;
        if (!mode) return res.json({ suggested });
        if (mode !== 'empty' && mode !== 'replace') throw httpError(400, 'apply must be "empty" or "replace"');

        const tenant = await Tenant.findById(req.tenantDoc._id);
        req.auditBefore = { colors: JSON.parse(JSON.stringify(tenant.colors || {})) };
        const applied = [];
        const skipped = [];
        for (const k of ['primary', 'primaryLight', 'primaryDark']) {
            const panelColor = tenant.settings?.brand?.colors?.[k];
            const savedColor = tenant.get(`colors.${k}`);
            if (panelColor || (savedColor && mode === 'empty')) { skipped.push(k); continue; }
            tenant.set(`colors.${k}`, suggested[k]);
            applied.push(k);
        }
        if (applied.length) {
            await tenant.save();
            invalidateTenant(tenant.slug);
        }
        res.json({ suggested, applied, skipped });
    }));

/* ------------------------------ per-tenant data (categories, products, banners, coupons) ------------------------------ */



const dateCheck = (d) => {
    if (d.startsAt && d.endsAt && new Date(d.endsAt) < new Date(d.startsAt)) throw httpError(400, 'endsAt must be after startsAt');
};

admin.use('/tenants/:tid/collections', loadTenant, crud(Collection, {
    fields: ['kind', 'title', 'subtitle', 'image', 'productIds', 'startsAt', 'endsAt', 'sortOrder', 'isActive'],
    sort: { sortOrder: 1, _id: 1 },
    searchField: 'title',
    softDelete: false,
    check: async (d, req) => {
        dateCheck(d);
        const ids = Array.isArray(d.productIds) ? d.productIds.map(String) : [];
        if (ids.some((x) => !isId(x))) throw httpError(400, 'productIds must be valid ids');
        if (ids.length) {
            const n = await Product.countDocuments({ _id: { $in: ids }, tenantId: req.tenantDoc._id });
            if (n !== new Set(ids).size) throw httpError(400, 'Every product must belong to this shop');
        }
    },
}));

admin.use('/tenants/:tid/categories', loadTenant, crud(Category, {
    fields: ['name', 'image', 'sortOrder', 'isActive'],
    sort: { sortOrder: 1, _id: 1 },
    searchField: 'name',
    softDelete: true,
}));

// Bulk menu import. The panel reads the CSV and sends rows as JSON.
// Columns: name, category, price, type (veg/nonveg/egg), mrp, eggless (yes/no), gstRate, description
// Default is a PREVIEW. Add ?dryRun=false to really save. Nothing is saved if any row has a problem.
// (Kept above the products crud so the two can never get in each other's way.)
admin.post('/tenants/:tid/products/import', loadTenant, wrap(async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows || !rows.length) throw httpError(400, 'Send "rows": a list of items');
    if (rows.length > 300) throw httpError(400, 'Import at most 300 items at a time');
    const dryRun = req.query.dryRun !== 'false';

    const tenant = await Tenant.findById(req.tenantDoc._id).lean();
    const foodMode = getFoodMode(tenant);
    const cats = await Category.find({ tenantId: tenant._id }).select('name').lean();
    const catByName = new Map(cats.map((c) => [c.name.trim().toLowerCase(), c._id]));
    const catNameById = new Map(cats.map((c) => [String(c._id), c.name.trim().toLowerCase()]));
    const existing = new Set((await Product.find({ tenantId: tenant._id }).select('name categoryId').lean())
        .map((p) => `${catNameById.get(String(p.categoryId))}|${p.name.trim().toLowerCase()}`));

    const TYPE = { veg: true, nonveg: false, 'non-veg': false, egg: false };
    const YES = ['yes', 'y', 'true', '1'];
    const errors = [];
    const items = [];
    const newCategories = new Map();   // lowercase name -> name as first written ("Sweets" and "sweets" count once)

    rows.forEach((r, i) => {
        const fail = (message) => errors.push({ row: i + 1, message });
        const name = String(r.name || '').trim();
        const category = String(r.category || '').trim();
        const price = Number(r.price);
        const isVeg = TYPE[String(r.type || '').trim().toLowerCase()];
        if (!name) return fail('Name is missing');
        if (!category) return fail('Category is missing');
        if (!Number.isFinite(price) || price < 0) return fail('Price must be a number');
        if (isVeg === undefined) return fail('Type must be veg, nonveg or egg');
        const key = `${category.toLowerCase()}|${name.toLowerCase()}`;
        if (existing.has(key)) return fail(`"${name}" already exists in "${category}"`);

        const item = {
            name, category, price, isVeg,
            isEggless: YES.includes(String(r.eggless || '').trim().toLowerCase()),
            description: r.description ? String(r.description).trim() : undefined,
            mrp: r.mrp !== undefined && r.mrp !== '' ? Number(r.mrp) : undefined,
            gstRate: r.gstRate !== undefined && r.gstRate !== '' ? Number(r.gstRate) : undefined,
        };
        if (item.mrp !== undefined && !Number.isFinite(item.mrp)) return fail('MRP must be a number');
        if (item.gstRate !== undefined && !GST_RATES.includes(item.gstRate)) return fail(`GST rate must be one of: ${GST_RATES.join(', ')}`);
        const problem = foodRuleError(foodMode, item);
        if (problem) return fail(problem);

        existing.add(key);   // only remember this item once the row is fully valid
        if (!catByName.has(category.toLowerCase()) && !newCategories.has(category.toLowerCase())) {
            newCategories.set(category.toLowerCase(), category);
        }
        items.push(item);
    });

    if (errors.length) return res.status(400).json({ error: 'Fix these rows and try again', errors });
    if (dryRun) {
        return res.json({ ok: true, preview: true, willCreate: items.length, newCategories: [...newCategories.values()] });
    }

    for (const [key, name] of newCategories) {
        const c = await Category.create({ tenantId: tenant._id, name });
        catByName.set(key, c._id);
    }
    await Product.insertMany(items.map(({ category, ...p }) => ({
        ...p, tenantId: tenant._id, categoryId: catByName.get(category.toLowerCase()),
    })));
    res.status(201).json({ ok: true, created: items.length, newCategories: [...newCategories.values()] });
}));

admin.use('/tenants/:tid/products', loadTenant, crud(Product, {
    fields: [
        'categoryId', 'name', 'description', 'image', 'price', 'mrp',
        'isVeg', 'isEggless', 'isSugarFree', 'isJain', 'spiceLevel',
        'isBestseller', 'isNewArrival', 'isGiftPack', 'serves', 'calories', 'prepTimeMin',
        'optionGroups', 'sizes', 'weightOptions', 'addOns',
        'isAvailable', 'isActive', 'sortOrder', 'gstRate',
    ],
    sort: { sortOrder: 1, _id: 1 },
    searchField: 'name',
    softDelete: true,
    check: async (d, req) => {
        const ok = d.categoryId && isId(String(d.categoryId)) &&
            await Category.exists({ _id: d.categoryId, tenantId: req.tenantDoc._id });
        if (!ok) throw httpError(400, 'categoryId must be a category of this shop');
        const tenant = await Tenant.findById(req.tenantDoc._id).lean();
        const problem = foodRuleError(getFoodMode(tenant), d);
        if (problem) throw httpError(400, problem);
    },
}));

// Shows the panel what is hidden from the app and why ("No item has a weight option group")
admin.get('/tenants/:tid/availability', loadTenant, wrap(async (req, res) => {
    const tenant = await Tenant.findById(req.tenantDoc._id).lean();
    const { availability, hidden } = applyAutoHide(resolveConfig(tenant), await getAvailability(tenant._id));
    res.json({ availability, hidden });
}));

// Make someone the owner of this shop. They log in with phone + OTP as usual.
admin.post('/tenants/:tid/owners', loadTenant, wrap(async (req, res) => {
    const phone = String(req.body?.phone || '').trim();
    if (!/^[6-9]\d{9}$/.test(phone)) throw httpError(400, 'Enter a valid 10-digit mobile number');
    const u = await User.findOneAndUpdate(
        { tenantId: req.tenantDoc._id, phone },
        { $set: { role: 'admin' } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    res.status(201).json({ ok: true, userId: u._id });
})); 

admin.use('/tenants/:tid/banners', loadTenant, crud(Banner, {
    fields: ['title', 'subtitle', 'image', 'couponCode', 'firstOrderOnly', 'startsAt', 'endsAt', 'sortOrder', 'isActive'],
    sort: { sortOrder: 1, _id: 1 },
    searchField: 'title',
    softDelete: false,
    check: dateCheck,
}));

admin.use('/tenants/:tid/coupons', loadTenant, crud(Coupon, {
    // usedCount is deliberately NOT editable: only real orders change it
    fields: [
        'code', 'description', 'discountType', 'discountValue', 'maxDiscount', 'minOrder',
        'firstOrderOnly', 'usageLimitPerUser', 'totalUsageLimit', 'isPublic', 'startsAt', 'endsAt', 'isActive',
    ],
    sort: { _id: -1 },
    searchField: 'code',
    softDelete: true,
    check: (d) => {
        if (d.discountType === 'percent' && d.discountValue > 100) throw httpError(400, 'A percent coupon cannot be more than 100');
        dateCheck(d);
    },
}));

// The owner's shop routes, used by the superadmin for any shop: /api/admin/tenants/:tid/shop/...
// Login (requireSuperAdmin) and the audit log (auditTrail('superadmin')) already ran above.
admin.use('/tenants/:tid/shop', loadFullTenant, require('./shopRouter'));
// the superadmin acts as one rider: /api/admin/tenants/:tid/riders/:rid/orders ...
const riderRoutes = require('./riderRouter');
admin.use('/tenants/:tid/riders/:rid', loadFullTenant, riderRoutes.asRider, riderRoutes.core);

admin.use(apiErrors);   // keep this LAST

module.exports = admin;