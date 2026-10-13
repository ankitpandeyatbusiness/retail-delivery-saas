// Owner (and superadmin) customer tools. Mounted at /api/shop/customers (also through the superadmin shop mount).
//   GET   /                       ?q=&page=&limit=    the customers of this shop (full phones: they are his own customers)
//   GET   /:userId                one customer with order numbers and Cash on delivery strikes
//   PATCH /:userId                { name?, email?, notes? }   never the phone, never an owner or a rider
//   PATCH /:userId/cod-block      { blocked: false }  allow Cash on delivery again (his strikes go back to 0)
const express = require('express');
const mongoose = require('mongoose');
const apiErrors = require('../middlewares/apiErrors');
const User = require('../models/User');
const CustomerRisk = require('../models/CustomerRisk');
const edit = require('../services/userEditService');
const { hashPhone } = require('../utils/phoneHash');

const { wrap, httpError } = apiErrors;
const router = express.Router();
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// the owner works only with customers of his own shop
async function findCustomer(req) {
    const u = isId(req.params.userId) ? await User.findOne({ _id: req.params.userId, tenantId: req.tenant._id }).lean() : null;
    if (!u) throw httpError(404, 'Customer not found');
    if (u.role === 'admin') throw httpError(403, 'Owner accounts cannot be edited here');
    if (u.role === 'rider') throw httpError(409, 'This is a rider. Use the riders screen.');
    return u;
}

router.get('/', wrap(async (req, res) => {
    const page = clamp(parseInt(req.query.page, 10) || 1, 1, 1000);
    const limit = clamp(parseInt(req.query.limit, 10) || 20, 1, 50);
    const filter = { tenantId: req.tenant._id, role: 'customer' };
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (/^\d{3,10}$/.test(q)) filter.phone = new RegExp(q);
    else if (q) filter.name = new RegExp(esc(q.slice(0, 40)), 'i');

    const items = await User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit + 1).lean();
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    res.json({ items: items.map(edit.profileView), page, hasMore });
}));

router.get('/:userId', wrap(async (req, res) => {
    const user = await findCustomer(req);
    res.json({ ...edit.profileView(user), isBlocked: !!user.isBlocked, ...(await edit.detail(req.tenant._id, user)) });
}));

router.patch('/:userId', wrap(async (req, res) => {
    const user = await findCustomer(req);
    const r = await edit.applyProfile({
        tenantId: req.tenant._id, user, body: req.body, phoneHash: undefined,
        phoneHint: 'Only the platform can change a phone number',
    });
    req.auditBefore = r.before;
    res.json(edit.profileView(r.user));
}));

router.patch('/:userId/cod-block', wrap(async (req, res) => {
    if (!isId(req.params.userId)) throw httpError(404, 'Customer not found');
    if (req.body?.blocked !== false) throw httpError(400, 'Send blocked: false to allow Cash on delivery again');

    const tenantId = req.tenant._id;
    const user = await User.findOne({ _id: req.params.userId, tenantId }).select('phone phoneHash').lean();
    if (!user) throw httpError(404, 'Customer not found');

    const phoneHash = user.phoneHash || hashPhone(tenantId, user.phone);
    req.auditBefore = (await CustomerRisk.findOne({ tenantId, phoneHash }).lean()) || undefined;
    await CustomerRisk.updateOne(
        { tenantId, phoneHash },
        { $set: { codBlocked: false, strikes: 0 }, $unset: { codBlockedAt: 1 } },
    );
    res.json({ ok: true, codBlocked: false, strikes: 0 });
}));

router.use(apiErrors);
module.exports = router;