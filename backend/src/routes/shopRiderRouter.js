// Owner (and superadmin) rider tools. Reads req.tenant, so it is mounted twice like the other shop routes.
//   manage  -> /riders      GET list, POST add, PATCH /:userId, DELETE /:userId
//   orders  -> /orders      GET /:id/delivery, POST /:id/assign, POST /:id/unassign

const express = require('express');
const mongoose = require('mongoose');
const apiErrors = require('../middlewares/apiErrors');
const riders = require('../services/riderService');
const riderPay = require('../services/riderPay');
const Rider = require('../models/Rider');
const RiderPayout = require('../models/RiderPayout');
const assignment = require('../services/assignmentService');
const Order = require('../models/Order');
const { UNPAID_QUERY } = require('../services/onlineOrder');
const schedule = require('../services/riderSchedule');
const RiderLeave = require('../models/RiderLeave');

const { wrap, httpError } = apiErrors;
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const actorOf = (req) => req.actor || { type: 'owner', id: req.auth.userId, label: req.shopUser?.phone || 'shop owner' };

/* ------------------------------ /riders ------------------------------ */
const manage = express.Router();

manage.get('/', wrap(async (req, res) => {
    const items = await riders.list(req.tenant._id);
    const sums = await schedule.summaries(req.tenant._id, items.map((r) => r.userId));
    // leave: requests waiting, days of approved leave this month, and whether he is on leave today
    res.json({ items: items.map((r) => ({ ...r, leave: sums.get(String(r.userId)) || { pending: 0, monthDays: 0, monthRequests: 0, onLeaveToday: false } })) });
}));

// Leave requests. GET /leaves?status=pending (default) | all   ·   PUT /leaves/:id { approve: true | false, note? }
manage.get('/leaves', wrap(async (req, res) => {
    const all = req.query.status === 'all';
    const rows = await RiderLeave.find({ tenantId: req.tenant._id, ...(all ? {} : { status: 'pending' }) }).sort({ createdAt: -1 }).limit(60).lean();
    res.json({ items: rows.map((l) => ({ id: String(l._id), riderId: String(l.riderUserId), riderName: l.riderName || null, from: l.from, to: l.to, days: l.days, reason: l.reason, status: l.status, note: l.decidedNote || '', createdAt: l.createdAt })) });
}));
manage.put('/leaves/:id', wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Leave not found');
    if (typeof req.body?.approve !== 'boolean') throw httpError(400, 'Send approve: true or false');
    try { await schedule.decide({ tenantId: req.tenant._id, id: req.params.id, approve: req.body.approve, note: req.body.note }); } catch (e) { throw httpError(e.status || 400, e.message); }
    res.json({ ok: true });
}));

// { "phone": "9876543210", "name": "Ravi" }
manage.post('/', wrap(async (req, res) => {
    const r = await riders.addByPhone({ tenantId: req.tenant._id, phone: req.body?.phone, name: req.body?.name });
    res.status(201).json(r);
}));

// { "isActive": false } and/or { "name": "Ravi K" } and/or { "email": "ravi@mail.com" } (empty text clears it)
manage.patch('/:userId', wrap(async (req, res) => {
    if (!isId(req.params.userId)) throw httpError(404, 'Rider not found');
    res.json(await riders.update({
        tenantId: req.tenant._id, userId: req.params.userId, isActive: req.body?.isActive, name: req.body?.name, email: req.body?.email,
    }));
}));

// One rider's pay: the plan that applies, what he earned, and (when the owner records payments) what was paid.
manage.get('/:userId/pay', wrap(async (req, res) => {
    if (!isId(req.params.userId)) throw httpError(404, 'Rider not found');
    const rider = await Rider.findOne({ tenantId: req.tenant._id, userId: req.params.userId }).select('pay').lean();
    if (!rider) throw httpError(404, 'Rider not found');
    const shop = req.tenant.settings?.riders || {};
    const plan = riderPay.effectivePlan(shop, rider);
    res.json({
        own: rider.pay?.type ? rider.pay : null,                         // his own plan, or null when he follows the shop's
        shop: riderPay.effectivePlan(shop, null),                          // the shop's plan
        label: riderPay.describe(plan),
        trackPayouts: !!shop.trackPayouts,
        money: await riderPay.moneyFor({ tenantId: req.tenant._id, riderId: rider.userId || req.params.userId, plan, riders: shop, limit: 30 }),
    });
}));

// { "pay": { type: "per_delivery", perDelivery: 30 } }  or  { "pay": null } to follow the shop's plan again
manage.put('/:userId/pay', wrap(async (req, res) => {
    if (!isId(req.params.userId)) throw httpError(404, 'Rider not found');
    const v = riderPay.validatePlan(req.body?.pay, { allowSame: true });
    if (!v.ok) return res.status(400).json({ error: v.errors[0], errors: v.errors });
    const r = await Rider.updateOne(
        { tenantId: req.tenant._id, userId: req.params.userId },
        v.clean ? { $set: { pay: v.clean } } : { $unset: { pay: 1 } },
    );
    if (!r.matchedCount) throw httpError(404, 'Rider not found');
    res.json({ ok: true, own: v.clean });
}));

// the owner records a payment he made to the rider (money moves outside the app). { amountPaise, kind?, note?, paidAt? }
manage.post('/:userId/payments', wrap(async (req, res) => {
    if (!isId(req.params.userId)) throw httpError(404, 'Rider not found');
    if (!req.tenant.settings?.riders?.trackPayouts) throw httpError(409, 'Switch on "Record payments to riders" in the delivery rules first');
    if (!(await Rider.exists({ tenantId: req.tenant._id, userId: req.params.userId }))) throw httpError(404, 'Rider not found');
    const b = req.body || {};
    if (!Number.isInteger(b.amountPaise) || b.amountPaise < 100 || b.amountPaise > 100000000) throw httpError(400, 'Amount must be from ₹1 to ₹10,00,000');
    const kind = b.kind === undefined ? 'earnings' : b.kind;
    if (!RiderPayout.KINDS.includes(kind)) throw httpError(400, `kind must be one of: ${RiderPayout.KINDS.join(', ')}`);
    let paidAt = new Date();
    if (b.paidAt !== undefined) {
        paidAt = new Date(b.paidAt);
        if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 60000 || paidAt.getTime() < Date.now() - 400 * 86400000) throw httpError(400, 'The date is not valid');
    }
    const row = await RiderPayout.create({
        tenantId: req.tenant._id, riderId: req.params.userId, amountPaise: b.amountPaise, kind, paidAt,
        note: typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 200) : undefined, by: actorOf(req),
    });
    req.auditAfter = { amountPaise: row.amountPaise, kind };
    res.status(201).json(riderPay.payoutView(row));
}));

// a wrong entry is cancelled (kept in the history, not counted)
manage.delete('/:userId/payments/:payId', wrap(async (req, res) => {
    if (!isId(req.params.userId) || !isId(req.params.payId)) throw httpError(404, 'Payment not found');
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 200) : '';
    if (!reason) throw httpError(400, 'Write a reason');
    const r = await RiderPayout.updateOne(
        { _id: req.params.payId, tenantId: req.tenant._id, riderId: req.params.userId, voidedAt: { $exists: false } },
        { $set: { voidedAt: new Date(), voidReason: reason } },
    );
    if (!r.matchedCount) throw httpError(404, 'Payment not found');
    res.json({ ok: true });
}));

manage.delete('/:userId', wrap(async (req, res) => {
    if (!isId(req.params.userId)) throw httpError(404, 'Rider not found');
    res.json(await riders.remove({ tenantId: req.tenant._id, userId: req.params.userId }));
}));

manage.use(apiErrors);

/* ------------------------------ /orders (stays open while the shop is paused) ------------------------------ */
const orders = express.Router();

// an online order that is not paid yet does not exist for the shop
orders.param('id', async (req, res, next, id) => {
    try {
        if (isId(id) && await Order.exists({ _id: id, tenantId: req.tenant._id, ...UNPAID_QUERY })) return next(httpError(404, 'Order not found'));
        return next();
    } catch (e) {
        return next(e);
    }
});

// the full delivery block, including offers and rider history
orders.get('/:id/delivery', wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Order not found');
    const o = await Order.findOne({ _id: req.params.id, tenantId: req.tenant._id }).select('orderNo orderType status delivery deliveryRating').lean();
    if (!o) throw httpError(404, 'Order not found');
    res.json({ orderNo: o.orderNo, orderType: o.orderType, status: o.status, delivery: o.delivery || null, deliveryRating: o.deliveryRating?.rating ? o.deliveryRating : null });
}));

// { "riderId": "<user id>" }   or   { "auto": true }
// If the order already has a rider this changes him, and "reason" is needed.
orders.post('/:id/assign', wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Order not found');
    const { riderId, auto, reason } = req.body || {};
    if (auto !== true && !isId(riderId)) throw httpError(400, 'Send riderId, or auto: true');
    const order = await assignment.assign({
        orderId: req.params.id, tenantId: req.tenant._id,
        riderUserId: auto === true ? undefined : riderId, auto: auto === true, reason, actor: actorOf(req),
    });
    res.status(201).json({ ok: true, delivery: order.toJSON().delivery });
}));

// { "reason": "Rider is not answering" }
orders.post('/:id/unassign', wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, 'Order not found');
    res.json(await assignment.unassign({
        orderId: req.params.id, tenantId: req.tenant._id, reason: req.body?.reason, actor: actorOf(req),
    }));
}));

orders.use(apiErrors);

module.exports = { manage, orders };