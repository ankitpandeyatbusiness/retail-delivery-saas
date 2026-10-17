// Owner (and superadmin) customer tools. Mounted at /api/shop/customers (also through the superadmin shop mount).
//   GET   /                       ?q=&page=&limit=    the customers of this shop (full phones: they are his own customers)
//   GET   /:userId                one customer with order numbers and Cash on delivery strikes
//   PATCH /:userId                { name?, email?, notes? }   never the phone, never an owner or a rider
//   PATCH /:userId/block          { blocked: true|false }  stop (or allow again) this customer in this shop; logs them out at once
//   PATCH /:userId/cod-block      { blocked: false }  allow Cash on delivery again (his strikes go back to 0)
const express = require('express');
const mongoose = require('mongoose');
const apiErrors = require('../middlewares/apiErrors');
const User = require('../models/User');
const CustomerRisk = require('../models/CustomerRisk');
const Session = require('../models/Session');
const edit = require('../services/userEditService');
const insights = require('../services/customerInsights');
const autopilot = require('../services/autopilot');
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

// who the customers are: tags (new, regular, loyal, vip, slipping, lost), usual time, favourite food
router.get('/insights', wrap(async (req, res) => {
    const page = clamp(parseInt(req.query.page, 10) || 1, 1, 1000);
    const limit = clamp(parseInt(req.query.limit, 10) || 20, 1, 50);
    res.json(await insights.list({ tenantId: req.tenant._id, tag: typeof req.query.tag === 'string' ? req.query.tag : 'all', q: req.query.q, page, limit }));
}));

router.get('/:userId/insight', wrap(async (req, res) => {
    const r = isId(req.params.userId) ? await insights.one({ tenantId: req.tenant._id, userId: req.params.userId }) : null;
    if (!r) throw httpError(404, 'Customer not found');
    res.json(r);
}));

// the one-tap Remind: GET shows the message (and whether it can go now), POST sends it. Push and the in-app inbox only.
router.get('/:userId/remind', wrap(async (req, res) => {
    res.json(await autopilot.previewRemind({ tenant: req.tenant, userId: req.params.userId, withOffer: req.query.offer === 'true' }));
}));
router.post('/:userId/remind', wrap(async (req, res) => {
    const b = req.body || {};
    res.json(await autopilot.remind({ tenant: req.tenant, userId: req.params.userId, title: b.title, body: b.body, withOffer: b.withOffer === true }));
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

router.patch('/:userId/block', wrap(async (req, res) => {
    if (typeof req.body?.blocked !== 'boolean') throw httpError(400, 'Send blocked: true or false');
    const user = await findCustomer(req);   // customers only: never an owner or a rider
    req.auditBefore = { isBlocked: !!user.isBlocked };
    await User.updateOne({ _id: user._id, tenantId: req.tenant._id }, { $set: { isBlocked: req.body.blocked } });
    if (req.body.blocked) await Session.deleteMany({ userId: user._id });
    res.json({ ok: true, isBlocked: req.body.blocked });
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