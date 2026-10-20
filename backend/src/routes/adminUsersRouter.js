// Superadmin: find people in a shop, block or unblock them, and remove an owner.
// Mounted inside adminRouter (after requireSuperAdmin), so the URLs are:
//
//   GET    /api/admin/tenants/:tid/users?q=...&role=customer&blocked=true&page=1
//   PATCH  /api/admin/tenants/:tid/users/:userId/block      body { "blocked": true }
//   GET    /api/admin/tenants/:tid/owners
//   DELETE /api/admin/tenants/:tid/owners/:userId           takes the owner role away

const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Session = require('../models/Session');
const loadTenant = require('../middlewares/loadTenant');
const { maskPhone } = require('../utils/phoneHash');
const edit = require('../services/userEditService');
const roleService = require('../services/userRoleService');
const { wrap, httpError } = require('../middlewares/apiErrors');

const router = express.Router();
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const view = (u) => ({
    id: u._id,
    phone: maskPhone(u.phone),   // the full number only through GET .../users/:userId/phone (audited)
    name: u.name || null,
    email: u.email || null,
    notes: u.notes || null,
    role: u.role,
    isBlocked: !!u.isBlocked,
    lastLoginAt: u.lastLoginAt || null,
    createdAt: u.createdAt,
});

// tenantId always comes from the URL, so you can only touch people of that shop
async function findUser(req) {
    const u = isId(req.params.userId)
        ? await User.findOne({ _id: req.params.userId, tenantId: req.tenantDoc._id })
        : null;
    if (!u) throw httpError(404, 'User not found');
    return u;
}

router.get('/tenants/:tid/users', loadTenant, wrap(async (req, res) => {
    const page = clamp(parseInt(req.query.page, 10) || 1, 1, 1000);
    const limit = clamp(parseInt(req.query.limit, 10) || 20, 1, 50);
    const filter = { tenantId: req.tenantDoc._id };

    if (['customer', 'rider', 'admin'].includes(req.query.role)) filter.role = req.query.role;
    if (req.query.blocked === 'true') filter.isBlocked = true;

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (/^\d{3,10}$/.test(q)) filter.phone = new RegExp(q);                       // part of a phone number
    else if (q) filter.name = new RegExp(esc(q.slice(0, 40)), 'i');               // part of a name

    const items = await User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit + 1).lean();
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    res.json({ items: items.map(view), page, hasMore });
}));

// Blocking also logs the person out everywhere, so it takes effect at once.
router.patch('/tenants/:tid/users/:userId/block', loadTenant, wrap(async (req, res) => {
    if (typeof req.body?.blocked !== 'boolean') throw httpError(400, 'Send blocked: true or false');
    const user = await findUser(req);
    user.isBlocked = req.body.blocked;
    if (req.body.blocked) user.blockInfo = { at: new Date(), byType: 'platform', reason: typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 300) || undefined : undefined };
    else user.blockInfo = undefined;
    await user.save();
    if (user.isBlocked) await Session.deleteMany({ userId: user._id });
    res.json(view(user));
}));

// Move a person between customer, rider and owner. Refused while they are blocked or have an order in progress.
router.patch('/tenants/:tid/users/:userId/role', loadTenant, wrap(async (req, res) => {
    const user = (await findUser(req)).toObject();
    req.auditBefore = { role: user.role };
    const r = await roleService.changeRole({ tenantId: req.tenantDoc._id, user, role: req.body?.role });
    res.json({ ...view(r.user), unchanged: r.unchanged, sessionsEnded: !r.unchanged });
}));

// One person: masked phone, orders, Cash on delivery strikes, rider profile.
router.get('/tenants/:tid/users/:userId', loadTenant, wrap(async (req, res) => {
    const user = (await findUser(req)).toObject();
    res.json({ ...view(user), ...(await edit.detail(req.tenantDoc._id, user)) });
}));

// body { name?, email?, notes? }. An empty text clears the field. An owner's email change tells his OLD email.
router.patch('/tenants/:tid/users/:userId', loadTenant, wrap(async (req, res) => {
    const user = (await findUser(req)).toObject();
    const r = await edit.applyProfile({
        tenantId: req.tenantDoc._id, user, body: req.body, phoneHint: 'Use PATCH .../phone to change the phone number',
    });
    req.auditBefore = r.before;
    res.json(view(r.user));
}));

// body { phone, reason }. Superadmin only. The phone is unique per shop, the old logins end, the audit log keeps old and new.
router.patch('/tenants/:tid/users/:userId/phone', loadTenant, wrap(async (req, res) => {
    const user = (await findUser(req)).toObject();
    const r = await edit.changePhone({ tenantId: req.tenantDoc._id, user, phone: req.body?.phone, reason: req.body?.reason });
    req.auditBefore = r.before;
    res.json({ ...view(r.user), sessionsEnded: true });
}));

router.get('/tenants/:tid/owners', loadTenant, wrap(async (req, res) => {
    const items = await User.find({ tenantId: req.tenantDoc._id, role: 'admin' }).sort({ createdAt: 1 }).lean();
    res.json({ items: items.map(view) });
}));

// The role is re-read from the database on every owner request, so this works immediately.
router.delete('/tenants/:tid/owners/:userId', loadTenant, wrap(async (req, res) => {
    const user = await findUser(req);
    if (user.role !== 'admin') throw httpError(409, 'This person is not an owner');
    user.role = 'customer';
    await user.save();
    res.json(view(user));
}));

module.exports = router;