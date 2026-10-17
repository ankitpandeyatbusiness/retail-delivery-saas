// Superadmin team: who else can run the platform. Mounted inside adminRouter (after requireSuperAdmin):
//
//   GET  /api/admin/team                      everyone with superadmin access (your own row has isMe: true)
//   POST /api/admin/team                      { name?, phones: ["98..."] (1 or 2), email? }   add a superadmin
//   PATCH /api/admin/team/:id                 { name }                                         rename
//   POST /api/admin/team/:id/revoke           { tenantId?, role? }   take superadmin access away
//        With tenantId + role ("customer" | "rider" | "admin") the person is also given that role in that shop.
//   POST /api/admin/team/:id/restore          give superadmin access back
//
// Rules:
//   - Nobody can change their OWN role (revoke themselves). Another superadmin has to do it.
//   - Only the supreme admin can revoke or restore a superadmin, and the supreme admin can never be revoked.
//   - A revoked superadmin is logged out at once (the login is re-checked on every call).
//   - Phones of another superadmin cannot be edited here; the owner of the account changes them with OTP
//     proof (PUT /api/admin/me/phones), or you revoke and add again.
const express = require('express');
const mongoose = require('mongoose');
const SuperAdmin = require('../models/SuperAdmin');
const Tenant = require('../models/Tenant');
const roles = require('../services/userRoleService');
const { maskPhone } = require('../utils/phoneHash');
const { wrap, httpError } = require('../middlewares/apiErrors');
const { requireSupreme } = require('../middlewares/supremeAdmin');
const { isSupreme } = require('../config/supreme');

const router = express.Router();
const PHONE_RE = /^[6-9]\d{9}$/;
const PLACEHOLDER_DOMAIN = '@superadmin.local';
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);

const view = (a, meId) => {
    const me = String(a._id) === String(meId);
    return {
        id: a._id,
        name: a.name || null,
        photo: a.photo || null,
        email: a.email && !a.email.endsWith(PLACEHOLDER_DOMAIN) ? a.email : null,
        phones: me ? a.phones : (a.phones || []).map(maskPhone),   // other people's numbers stay masked
        isActive: !!a.isActive,
        legalRole: a.legalRole || 'team',
        isMe: me,
        lastLoginAt: a.lastLoginAt || null,
        createdAt: a.createdAt,
    };
};

const cleanName = (v) => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'string') throw httpError(400, 'Name must be text');
    const t = v.trim();
    if (t.length > 80) throw httpError(400, 'Name can be up to 80 characters');
    return t;
};

async function findTarget(req) {
    const a = isId(req.params.id) ? await SuperAdmin.findById(req.params.id) : null;
    if (!a) throw httpError(404, 'Superadmin not found');
    return a;
}

const notSelf = (req) => {
    if (String(req.params.id) === String(req.admin._id)) {
        throw httpError(403, 'You cannot change your own role. Ask another superadmin to do it.');
    }
};

router.get('/team', wrap(async (req, res) => {
    const items = await SuperAdmin.find({}).sort({ createdAt: 1 }).lean();
    res.json({ items: items.map((a) => view(a, req.admin._id)) });
}));

router.post('/team', wrap(async (req, res) => {
    const b = req.body || {};
    const raw = Array.isArray(b.phones) ? b.phones : (b.phone ? [b.phone] : []);
    const phones = [...new Set(raw.map((p) => String(p).trim()))];
    if (!phones.length || phones.length > 2 || !phones.every((p) => PHONE_RE.test(p))) {
        throw httpError(400, 'Send 1 or 2 valid 10-digit mobile numbers');
    }
    const name = cleanName(b.name);

    let email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw httpError(400, 'Enter a valid email address');
    if (!email) email = `${phones[0]}${PLACEHOLDER_DOMAIN}`;   // the model needs a label; login is by phone only

    if (await SuperAdmin.exists({ phones: { $in: phones } })) {
        throw httpError(409, 'One of these numbers already belongs to a superadmin');
    }
    if (await SuperAdmin.exists({ email })) throw httpError(409, 'This email is already used by a superadmin');

    const admin = await SuperAdmin.create({ email, name: name || undefined, phones, isActive: true });
    res.status(201).json(view(admin.toObject(), req.admin._id));
}));

router.patch('/team/:id', wrap(async (req, res) => {
    const a = await findTarget(req);
    const name = cleanName(req.body?.name);
    if (name === undefined) throw httpError(400, 'Send name');
    req.auditBefore = { name: a.name };
    a.name = name || undefined;
    await a.save();
    res.json(view(a.toObject(), req.admin._id));
}));

router.post('/team/:id/revoke', requireSupreme, wrap(async (req, res) => {
    notSelf(req);
    const a = await findTarget(req);
    if (isSupreme(a)) throw httpError(403, 'The supreme admin cannot be revoked');
    req.auditBefore = { isActive: a.isActive };

    // optional: give the person a shop role at the same time, so they can be a customer / rider / owner again
    const { tenantId, role } = req.body || {};
    let shopRole = null;
    if (tenantId !== undefined || role !== undefined) {
        if (!isId(String(tenantId || '')) || !roles.ROLES.includes(role)) {
            throw httpError(400, 'Send both tenantId and role (customer, rider or admin), or neither');
        }
        const tenant = await Tenant.findById(tenantId).select('_id name').lean();
        if (!tenant) throw httpError(404, 'Shop not found');
        // shop roles first: if one is refused (for example an order in progress) the superadmin access is left as it was
        for (const phone of a.phones) {
            await roles.setRoleByPhone({ tenantId: tenant._id, phone, role, name: a.name });
        }
        shopRole = { tenantId: tenant._id, shop: tenant.name, role };
    }

    a.isActive = false;
    await a.save();
    res.json({ ...view(a.toObject(), req.admin._id), shopRole });
}));

router.post('/team/:id/restore', requireSupreme, wrap(async (req, res) => {
    const a = await findTarget(req);
    req.auditBefore = { isActive: a.isActive };
    a.isActive = true;
    await a.save();
    res.json(view(a.toObject(), req.admin._id));
}));

module.exports = router;
