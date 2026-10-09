// Owner (and superadmin) rider tools. Reads req.tenant, so it is mounted twice like the other shop routes.
//   manage  -> /riders      GET list, POST add, PATCH /:userId, DELETE /:userId
//   orders  -> /orders      GET /:id/delivery, POST /:id/assign, POST /:id/unassign

const express = require('express');
const mongoose = require('mongoose');
const apiErrors = require('../middlewares/apiErrors');
const riders = require('../services/riderService');
const assignment = require('../services/assignmentService');
const Order = require('../models/Order');

const { wrap, httpError } = apiErrors;
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const actorOf = (req) => req.actor || { type: 'owner', id: req.auth.userId, label: req.shopUser?.phone || 'shop owner' };

/* ------------------------------ /riders ------------------------------ */
const manage = express.Router();

manage.get('/', wrap(async (req, res) => {
    res.json({ items: await riders.list(req.tenant._id) });
}));

// { "phone": "9876543210", "name": "Ravi" }
manage.post('/', wrap(async (req, res) => {
    const r = await riders.addByPhone({ tenantId: req.tenant._id, phone: req.body?.phone, name: req.body?.name });
    res.status(201).json(r);
}));

// { "isActive": false } and/or { "name": "Ravi K" }
manage.patch('/:userId', wrap(async (req, res) => {
    if (!isId(req.params.userId)) throw httpError(404, 'Rider not found');
    res.json(await riders.update({
        tenantId: req.tenant._id, userId: req.params.userId, isActive: req.body?.isActive, name: req.body?.name,
    }));
}));

manage.delete('/:userId', wrap(async (req, res) => {
    if (!isId(req.params.userId)) throw httpError(404, 'Rider not found');
    res.json(await riders.remove({ tenantId: req.tenant._id, userId: req.params.userId }));
}));

manage.use(apiErrors);

/* ------------------------------ /orders (stays open while the shop is paused) ------------------------------ */
const orders = express.Router();

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