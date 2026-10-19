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
const Order = require('../models/Order');
const Rider = require('../models/Rider');
const { ACTIVE_STATUSES } = require('../services/orderflow');
const { hashPhone } = require('../utils/phoneHash');
const { pickBrandColors } = require('../services/logoColors');

const O = require('../config/tenantOptions');
const { getPreset } = require('../config/homePresets');
const { validateSettings, resolveConfig, DEFAULTS } = require('../services/tenantConfigService');
const { signAdminToken } = require('../services/superAdminToken');
const requireSuperAdmin = require('../middlewares/requireSuperAdmin');
const { moneyGuard } = require('../middlewares/supremeAdmin');
const { isSupreme } = require('../config/supreme');
const { invalidateTenant } = require('../middlewares/tenantRecognizer');
const { getAvailability, invalidateAvailability, applyAutoHide } = require('../services/availability');
const { foodRuleError } = require('../services/foodRules');
const { applyItemRules } = require('../services/itemRules');
const { BUSINESS_TYPES } = require('../config/businessTypes');
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

// The picture shown for a shop in the panel: its app icon (the one customers see on their home screen), else its logo.
// Returns Map(tenantId string -> url).
const Media_ = require('../models/Media');
async function appIcons(tenants) {
    const rows = await Media_.find({ tenantId: { $in: tenants.map((t) => t._id) }, kind: 'icon' }).select('tenantId url createdAt').sort({ createdAt: 1 }).lean();
    const m = new Map(rows.map((r) => [String(r.tenantId), r.url]));
    for (const t of tenants) if (!m.has(String(t._id)) && t.logo) m.set(String(t._id), t.logo);
    return m;
}

const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28];

const admin = express.Router();

/* ------------------------------ helpers ------------------------------ */
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pickFields = (fields, body) =>
    Object.fromEntries(fields.filter((f) => body?.[f] !== undefined).map((f) => [f, body[f]]));

const SLUG_RE = /^[a-z0-9-]{3,40}$/;
const RESERVED_SLUGS = ['admin', 'api', 'www'];
const TENANT_FIELDS = ['businessType', 'name', 'tagline', 'logo', 'colors', 'status', 'androidPackage', 'phone', 'address', 'delivery', 'business', 'subscription', 'contact'];

/* ------------------------------ login (public) ------------------------------ */
const authRoutes = require('./adminAuthRouter');
admin.use('/auth', authRoutes);   // send-otp, verify-otp, login (password: off by default)

/* ------------------------------ everything below needs a superadmin ------------------------------ */
admin.use(requireSuperAdmin);
admin.use(auditTrail('superadmin'));   // records every change a superadmin makes
admin.use(moneyGuard);                 // changes that touch the platform's income: the supreme admin only (middlewares/supremeAdmin.js)

admin.use(require('./adminProfilePhotoRouter'));   // my profile picture
admin.use('/me', authRoutes.me);   // PUT /me/phones
admin.use(require('./adminLiveRouter'));   // live picture of a shop, phone reveal
admin.use(require('./adminMessagesRouter'));   // messages to the owners of all shops
admin.use(require('./adminComplaintsRouter'));   // all complaints
admin.use(require('./adminSupportRouter'));   // help & support requests from shop owners
admin.use(require('./adminReportRouter'));   // how the progress report is presented (commission used for the estimate...)
admin.use(require('./adminOrdersRouter'));
admin.use(require('./adminUsersRouter'));
admin.use(require('./adminTeamRouter'));
admin.use(require('./adminMediaRouter'));   // list a shop's uploaded images (hero, logo, build icons)   // other superadmins: add, rename, revoke, restore
admin.use(require('./adminAccessRouter'));
admin.use(require('./adminPlatformRouter'));
admin.use(require('./adminBillingRouter'));
admin.use(require('./adminSubscriptionRouter'));
admin.use(require('./adminTrackingRouter'));   // live tracking: server health and the sockets / polling / off switch (everyone looks, the supreme admin changes)
admin.use(require('./adminOperatorsRouter'));   // the companies that run the platform + Switch operator (everyone looks, the supreme admin changes)
admin.use(require('./adminLegalRouter'));   // terms, agreements and privacy (everyone reads, the supreme admin writes and sends)
admin.use(require('./adminSettlementRouter'));   // the common settlement sheet (everyone reads, the supreme admin changes)
admin.use(require('./adminGstRouter'));   // GST register (all superadmins read it) and credit notes
admin.use(require('./adminAuditRouter'));
admin.use(require('./adminSmsRouter'));
admin.use(require('./adminSmsProviderRouter'));
admin.use(require('./adminDevRouter'));   // Development details of one shop (read only) + developer notes
admin.use(require('./adminPaymentsRouter'));   // per-shop Razorpay keys, webhook secret, test connection, on/off
admin.use(require('./adminDisputesRouter'));
admin.use(require('./adminLedgerRouter'));
admin.use(require('./adminNotifyRouter'));
admin.use(require('./adminAlertsRouter'));
admin.use(require('./adminNotificationRulesRouter'));
admin.use(require('./adminInsightsRouter'));   // search, shop health, readiness, system, backups, exports
admin.use(require('./adminPlatformTaxRouter'));   // the one GST for all shops
admin.use(require('./adminPlatformPaymentsRouter'));   // my own Razorpay account
admin.use(require('./adminGeoRouter'));   // place search for the map picker
admin.use(require('./adminFinanceRouter'));   // profit and loss, receivables, expenses

// any change to a shop's data refreshes that shop's cached counts
admin.use('/tenants/:tid', (req, res, next) => {
    if (req.method !== 'GET') res.on('finish', () => invalidateAvailability(req.params.tid));
    next();
});

// admins added from the app have a hidden placeholder email (the model needs one): never show it
const shownEmail = (e) => (e && !e.endsWith('@superadmin.local') ? e : null);
admin.get('/me', (req, res) => res.json({ email: shownEmail(req.admin.email), name: req.admin.name || null, photo: req.admin.photo || null, supreme: isSupreme(req.admin) }));

// Everything the panel needs to draw its form: allowed values, defaults, and a starting template per shop type
admin.get('/options', (req, res) => {
    res.json({
        options: O,
        businessTypes: BUSINESS_TYPES,
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
        .select('_id slug name logo status androidPackage createdAt updatedAt ownerBlocked ownerBlockedReason maintenance settings.orders.acceptingOrders billing.state billing.graceEndsAt')
        .lean();
    const icons = await appIcons(items);
    res.json({
        items: items.map((t) => {
            const { settings, maintenance, ownerBlockedReason, ...rest } = t;
            return { ...rest, appIcon: icons.get(String(t._id)) || null, state: shopState(t) };
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

    const fields = pickFields(TENANT_FIELDS, body);
    if (fields.businessType && BUSINESS_TYPES[fields.businessType]?.status !== 'active') {
        throw httpError(400, 'This kind of business is not open yet');
    }
    if (fields.subscription && typeof fields.subscription === 'object') delete fields.subscription.monthlyFee;   // B18
    const tenant = new Tenant({ slug, ...fields, settings: v.clean });
    // who brought the shop decides the revenue split; only the supreme admin marks it
    if (isSupreme(req.admin) && ['owner', 'partner'].includes(body.broughtBy)) { tenant.broughtBy = body.broughtBy; tenant.broughtBySetAt = new Date(); }
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
    const icons = await appIcons([tenant]);
    res.json({ tenant, appIcon: icons.get(String(tenant._id)) || null, resolved: resolveConfig(tenant), state: shopState(tenant) });
}));

// heroImages is not a field here: hero images are uploaded (and deleted from the bucket) through
// /admin/tenants/:tid/shop/uploads, so a file can never be left behind in storage.
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
    if (updates.subscription && typeof updates.subscription === 'object') delete updates.subscription.monthlyFee;   // B18: billing does not use it
    for (const [key, value] of Object.entries(updates)) {
        // Deep merge for nested objects (delivery, business, subscription, colors, address)
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            for (const [subKey, subValue] of Object.entries(value)) {
                tenant.set(`${key}.${subKey}`, subValue);
            }
        } else {
            // Normal assignment for flat fields (name, phone)
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
    try { require('../services/realtime').toShop(tenant._id, 'menu:changed', {}); } catch (e) { /* the apps also refresh on their own */ }

    res.json({ tenant, resolved: resolveConfig(tenant.toObject()) });
}));

// Colours of a logo that has no shop yet (the new-shop wizard). Only suggests; nothing is saved.
admin.post('/logo-colors',
    express.raw({ type: () => true, limit: '8mb' }),
    wrap(async (req, res) => {
        if (!Buffer.isBuffer(req.body) || !req.body.length) {
            throw httpError(400, 'The logo picture did not arrive. Try again with a PNG, JPG or WebP picture (up to 8 MB).');
        }
        const image = req.body;
        req.body = { note: 'image left out of the audit log' };
        let suggested;
        try { suggested = await pickBrandColors(image); } catch (e) { throw httpError(400, 'That file is not a picture we can read. Use a PNG, JPG or WebP logo.'); }
        res.json({ suggested: suggested || null, message: suggested ? undefined : 'No usable colour in this logo. Set the colour by hand.' });
    }));

// Logo colours. Send the image itself as the request body (Content-Type: image/png, image/jpeg or image/webp).
//   no query       -> only suggests colours, saves nothing
//   ?apply=empty   -> fills colour slots that are still empty
//   ?apply=replace -> overwrites the saved colours
// A colour set in the panel's brand settings always wins, so it is skipped.
admin.post('/tenants/:tid/logo-colors',
    loadTenant,
    express.raw({ type: () => true, limit: '8mb' }),
    wrap(async (req, res) => {
        if (!Buffer.isBuffer(req.body) || !req.body.length) {
            throw httpError(400, 'The logo picture did not arrive. Try again with a PNG, JPG or WebP picture (up to 8 MB).');
        }
        const image = req.body;
        req.body = { note: 'image left out of the audit log' };

        let suggested;
        try { suggested = await pickBrandColors(image); } catch (e) { throw httpError(400, 'That file is not a picture we can read. Use a PNG, JPG or WebP logo.'); }
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
        'categoryId', 'categoryName', 'name', 'description', 'image', 'price', 'mrp',
        'isVeg', 'isEggless', 'isSugarFree', 'isJain', 'spiceLevel',
        'isBestseller', 'isNewArrival', 'isGiftPack', 'serves', 'calories', 'prepTimeMin', 'maxPerOrder',
        'optionGroups', 'sizes', 'weightOptions', 'addOns',
        'itemKind', 'sellBy', 'measure',
        'isAvailable', 'isActive', 'sortOrder',
    ],
    sort: { sortOrder: 1, _id: 1 },
    searchField: 'name',
    softDelete: true,
    check: async (d, req) => {
        const tenant = await Tenant.findById(req.tenantDoc._id).lean();
        await applyItemRules(d, tenant);
        const ok = d.categoryId && isId(String(d.categoryId)) &&
            await Category.exists({ _id: d.categoryId, tenantId: req.tenantDoc._id });
        if (!ok) throw httpError(400, 'categoryId must be a category of this shop');
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
    const tenantId = req.tenantDoc._id;
    const existing = await User.findOne({ tenantId, phone }).select('role isBlocked').lean();
    if (existing) {
        req.auditBefore = { role: existing.role };
        if (existing.role === 'admin') return res.status(200).json({ ok: true, userId: existing._id, alreadyOwner: true });
        if (existing.isBlocked) throw httpError(409, 'This number is blocked. Unblock it first, then add it as owner.');
        if (existing.role === 'rider') {
            const [rider, riding] = await Promise.all([
                Rider.findOne({ tenantId, userId: existing._id }).select('isActive').lean(),
                Order.exists({ tenantId, 'delivery.riderId': existing._id, status: { $in: ACTIVE_STATUSES } }),
            ]);
            if (rider?.isActive || riding) {
                throw httpError(409, 'This number is an active rider. Remove the rider first, then add the number as owner.');
            }
        }
        const busy = await Order.exists({ tenantId, userId: existing._id, status: { $in: ACTIVE_STATUSES } });
        if (busy) throw httpError(409, 'This person has an order in progress. Try again after it is delivered or cancelled.');
    }
    const u = await User.findOneAndUpdate(
        { tenantId, phone, isBlocked: { $ne: true } },
        { $set: { role: 'admin', phoneHash: hashPhone(tenantId, phone) } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    if (existing?.role === 'rider') await Rider.deleteMany({ tenantId, userId: u._id });   // an owner is not a rider
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