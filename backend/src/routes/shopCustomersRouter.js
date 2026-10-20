// Owner (and superadmin) customer tools. Mounted at /api/shop/customers (also through the superadmin shop mount).
//   GET   /                       ?q=&page=&limit=    the customers of this shop (full phones: they are his own customers)
//   GET   /:userId                one customer with order numbers and Cash on delivery strikes
//   PATCH /:userId                { name?, email?, notes? }   never the phone, never an owner or a rider
//   PATCH /:userId/block          { blocked: true|false, reason?, orderId?, sessionId? }  stop (or allow again) this customer in this shop; logs them out at once
//   GET   /blocked                the blocked customers: when, by whom, why, and the order or table bill it was about
//   PATCH /:userId/cod-block      { blocked: false }  allow Cash on delivery again (his strikes go back to 0)
const express = require('express');
const mongoose = require('mongoose');
const apiErrors = require('../middlewares/apiErrors');
const User = require('../models/User');
const Order = require('../models/Order');
const TableSession = require('../models/TableSession');
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

// why a customer is blocked, with the order (or table bill) it was about
async function blockViews(tenantId, users) {
    const orderIds = users.map((u) => u.blockInfo?.orderId).filter(Boolean);
    const sessionIds = users.map((u) => u.blockInfo?.sessionId).filter(Boolean);
    const [orders, sessions] = await Promise.all([
        orderIds.length ? Order.find({ tenantId, _id: { $in: orderIds } }).select('orderNo orderType status pricing.total payment.method payment.status createdAt cancelReason items.name items.quantity tableNo').lean() : [],
        sessionIds.length ? TableSession.find({ tenantId, _id: { $in: sessionIds } }).select('table owedPaise walkoutAt closedAt owedClearedAt').lean() : [],
    ]);
    const o = new Map(orders.map((x) => [String(x._id), x]));
    const t = new Map(sessions.map((x) => [String(x._id), x]));
    return users.map((u) => {
        const b = u.blockInfo || {};
        const od = b.orderId ? o.get(String(b.orderId)) : null;
        const ts = b.sessionId ? t.get(String(b.sessionId)) : null;
        return {
            id: String(u._id), name: u.name || null, phone: u.phone || null,
            at: b.at || null, byType: b.byType || null, byLabel: b.byLabel || null, reason: b.reason || null,
            order: od ? {
                id: String(od._id), orderNo: od.orderNo, orderType: od.orderType, status: od.status, total: od.pricing?.total || 0,
                pay: { method: od.payment?.method, status: od.payment?.status }, at: od.createdAt, cancelReason: od.cancelReason || null,
                items: (od.items || []).map((l) => ({ name: l.name, quantity: l.quantity })),
            } : null,
            table: ts ? { table: ts.table, amount: (ts.owedPaise || 0) / 100, at: ts.walkoutAt || ts.closedAt || null, cleared: !!ts.owedClearedAt } : null,
        };
    });
}

// the owner works only with customers of his own shop
async function findCustomer(req) {
    const u = isId(req.params.userId) ? await User.findOne({ _id: req.params.userId, tenantId: req.tenant._id }).lean() : null;
    if (!u) throw httpError(404, 'Customer not found');
    if (u.role === 'admin') throw httpError(403, 'Owner accounts cannot be edited here');
    if (u.role === 'rider') throw httpError(409, 'This is a rider. Use the riders screen.');
    if (u.role === 'kitchen' || u.role === 'waiter') throw httpError(409, 'This is shop staff. Use the Staff screen.');
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

router.get('/blocked', wrap(async (req, res) => {
    const users = await User.find({ tenantId: req.tenant._id, role: 'customer', isBlocked: true }).sort({ 'blockInfo.at': -1, updatedAt: -1 }).limit(100).lean();
    res.json({ items: await blockViews(req.tenant._id, users) });
}));

router.get('/:userId', wrap(async (req, res) => {
    const user = await findCustomer(req);
    const block = user.isBlocked ? (await blockViews(req.tenant._id, [user]))[0] : null;
    res.json({ ...edit.profileView(user), isBlocked: !!user.isBlocked, block, ...(await edit.detail(req.tenant._id, user)) });
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
    if (req.body.blocked) {
        // why: the owner's words, and the order (or table bill) of this customer it was about
        const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
        let orderId; let sessionId;
        if (isId(req.body.orderId) && await Order.exists({ _id: req.body.orderId, tenantId: req.tenant._id, userId: user._id })) orderId = req.body.orderId;
        if (isId(req.body.sessionId) && await TableSession.exists({ _id: req.body.sessionId, tenantId: req.tenant._id, customers: user._id })) sessionId = req.body.sessionId;
        const by = req.actor || {};
        await User.updateOne({ _id: user._id, tenantId: req.tenant._id }, { $set: { isBlocked: true, blockInfo: { at: new Date(), byType: by.type || 'owner', byLabel: by.label || undefined, reason: reason || undefined, orderId, sessionId } } });
        await Session.deleteMany({ userId: user._id });
    } else {
        await User.updateOne({ _id: user._id, tenantId: req.tenant._id }, { $set: { isBlocked: false }, $unset: { blockInfo: 1 } });
    }
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