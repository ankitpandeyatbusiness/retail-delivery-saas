const mongoose = require('mongoose');
const Complaint = require('../models/Complaint');
const Order = require('../models/Order');
const Tenant = require('../models/Tenant');
const center = require('../notifications/center');
const liveFeed = require('./liveFeed');
const refundService = require('./refundService');
const { httpError } = require('../middlewares/apiErrors');

const { TYPES } = Complaint;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const STATUSES = ['open', 'in_progress', 'resolved'];
const TYPE_TEXT = {
    missing_item: 'an item is missing', wrong_item: 'a wrong item came', quality: 'food quality',
    late: 'the order was late', packaging: 'packaging problem', other: 'other problem',
};
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const rs = (paise) => (paise / 100).toFixed(2).replace(/\.00$/, '');
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const view = (c, { forOwner = false } = {}) => ({
    id: c._id, orderId: c.orderId, orderNo: c.orderNo, type: c.type, text: c.text, photos: c.photos || [],
    status: c.status, ownerReply: c.ownerReply || null, resolution: c.resolution, refundPaise: c.refundPaise || 0,
    refundStatus: c.refundStatus, createdAt: c.createdAt, decidedAt: c.decidedAt || null,
    ...(forOwner ? { customerName: c.customerName || null } : {}),
});

// For these the customer must send at least one photo of the food (a wrong or bad dish needs proof)
const PHOTO_REQUIRED = ['wrong_item', 'quality'];

function parseNew(body) {
    const b = body || {};
    if (!TYPES.includes(b.type)) throw httpError(400, 'Choose what went wrong');
    const t = text(b.text, 501);
    if (t.length < 3 || t.length > 500) throw httpError(400, 'Write 3 to 500 characters');
    let photos = [];
    if (b.photos !== undefined) {
        const bad = !Array.isArray(b.photos) || b.photos.length > 3
            || b.photos.some((p) => typeof p !== 'string' || !/^https:\/\//.test(p) || p.length > 500);
        if (bad) throw httpError(400, 'Send up to 3 photo links');
        photos = b.photos;
    }
    if (PHOTO_REQUIRED.includes(b.type) && photos.length < 1) throw httpError(400, 'Please add a photo of the food for this complaint');
    return { type: b.type, text: t, photos };
}

/* ------------------------------ customer ------------------------------ */
async function create({ tenant, userId, orderId, body }) {
    if (!isId(orderId)) throw httpError(404, 'Order not found');
    const order = await Order.findOne({ _id: orderId, tenantId: tenant._id, userId })
        .select('orderNo status deliveredAt customer.name').lean();
    if (!order) throw httpError(404, 'Order not found');
    if (order.status !== 'delivered') throw httpError(409, 'You can complain after the order is delivered');
    if (!order.deliveredAt) throw httpError(409, 'The delivery time is missing for this order');
    if (Date.now() - new Date(order.deliveredAt).getTime() > WINDOW_MS) {
        throw httpError(409, 'You can complain within 24 hours of delivery');
    }
    const clean = parseNew(body);
    let doc;
    try {
        doc = await Complaint.create({
            tenantId: tenant._id, orderId: order._id, orderNo: order.orderNo, userId,
            customerName: order.customer?.name, ...clean,
        });
    } catch (e) {
        if (e && e.code === 11000) throw httpError(409, 'You already sent a complaint for this order');
        throw e;
    }
    try {
        center.notify('complaint_new', {
            tenantId: tenant._id,
            title: 'New complaint',
            body: `Order #${doc.orderNo}: ${TYPE_TEXT[doc.type]}. Please reply within 24 hours.`,
            data: { complaintId: String(doc._id), orderId: String(doc.orderId), orderNo: doc.orderNo },
        });
    } catch (e) { console.error('Complaint notify error:', e.message); }
    return view(doc);
}

async function forOrder({ tenant, userId, orderId }) {
    if (!isId(orderId)) throw httpError(404, 'Order not found');
    const order = await Order.findOne({ _id: orderId, tenantId: tenant._id, userId }).select('status deliveredAt').lean();
    if (!order) throw httpError(404, 'Order not found');
    const c = await Complaint.findOne({ tenantId: tenant._id, orderId }).lean();
    const until = order.deliveredAt ? new Date(new Date(order.deliveredAt).getTime() + WINDOW_MS) : null;
    const canComplain = !c && order.status === 'delivered' && !!until && until.getTime() > Date.now();
    return { items: c ? [view(c)] : [], canComplain, until: canComplain ? until : null };
}

/* ------------------------------ owner ------------------------------ */
async function listFor({ tenantId, status, page = 1, limit = 30 }) {
    if (status !== undefined && !STATUSES.includes(status)) throw httpError(400, 'Unknown status');
    const filter = { ...(tenantId ? { tenantId } : {}), ...(status ? { status } : {}) };
    const rows = await Complaint.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit + 1).lean();
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    return { rows, hasMore };
}

async function ownerList({ tenantId, query }) {
    const page = Math.min(Math.max(parseInt(query.page, 10) || 1, 1), 1000);
    const { rows, hasMore } = await listFor({ tenantId, status: query.status, page });
    return { items: rows.map((c) => view(c, { forOwner: true })), page, hasMore };
}

async function adminList({ query }) {
    if (query.tenantId !== undefined && !isId(query.tenantId)) throw httpError(400, 'Bad shop id');
    const page = Math.min(Math.max(parseInt(query.page, 10) || 1, 1), 1000);
    const { rows, hasMore } = await listFor({ tenantId: query.tenantId, status: query.status, page, limit: 50 });
    const shops = await Tenant.find({ _id: { $in: [...new Set(rows.map((r) => String(r.tenantId)))] } }).select('slug name').lean();
    const slug = Object.fromEntries(shops.map((s) => [String(s._id), s.slug]));
    return { items: rows.map((c) => ({ ...view(c, { forOwner: true }), tenantId: c.tenantId, shop: slug[String(c.tenantId)] || null })), page, hasMore };
}

const DECISION_TEXT = {
    refund_full: (c) => `The shop will refund Rs ${rs(c.refundPaise)} for order #${c.orderNo}.`,
    refund_partial: (c) => `The shop will refund Rs ${rs(c.refundPaise)} for order #${c.orderNo}.`,
    no_refund: (c) => `The shop looked at your complaint for order #${c.orderNo}. No refund this time.`,
    none: (c) => `The shop replied to your complaint for order #${c.orderNo}.`,
};

async function decide({ tenant, id, actor, body }) {
    if (!isId(id)) throw httpError(404, 'Complaint not found');
    const b = body || {};
    const c = await Complaint.findOne({ _id: id, tenantId: tenant._id }).lean();
    if (!c) throw httpError(404, 'Complaint not found');
    if (c.status === 'resolved') throw httpError(409, 'This complaint is already decided');

    const reply = text(b.ownerReply, 501);
    if (reply.length > 500) throw httpError(400, 'Reply is too long (500 characters)');
    const resolution = b.resolution === undefined ? 'none' : b.resolution;
    if (!Complaint.RESOLUTIONS.includes(resolution)) throw httpError(400, 'Unknown decision');

    let refundPaise = 0;
    let refundStatus = 'none';
    if (resolution === 'none') {
        if (!reply) throw httpError(400, 'Write a reply or choose a decision');
    } else if (resolution === 'no_refund') {
        if (!reply) throw httpError(400, 'Tell the customer why there is no refund');
    } else {
        const order = await Order.findOne({ _id: c.orderId, tenantId: tenant._id }).select('pricing payment').lean();
        const total = Math.round((Number(order?.pricing?.total) || 0) * 100);
        const tip = Math.min(Math.round((Number(order?.pricing?.tip) || 0) * 100), total);
        const cap = total - tip;                       // the tip is not refunded on a delivered order
        if (cap <= 0) throw httpError(409, 'There is nothing to refund on this order');
        if (resolution === 'refund_full') refundPaise = cap;
        else {
            if (!Number.isInteger(b.refundPaise) || b.refundPaise < 1 || b.refundPaise > cap) {
                throw httpError(400, `Refund must be 1 to ${cap} paise`);
            }
            refundPaise = b.refundPaise;
        }
        const online = order.payment?.method && order.payment.method !== 'cod' && order.payment.status === 'paid';
        refundStatus = online ? 'pending' : 'noted';
    }

    const now = new Date();
    const done = await Complaint.findOneAndUpdate(
        { _id: id, tenantId: tenant._id, status: { $ne: 'resolved' } },
        {
            $set: {
                status: resolution === 'none' ? 'in_progress' : 'resolved', resolution, refundPaise, refundStatus,
                ...(reply ? { ownerReply: reply } : {}),
                ...(resolution === 'none' ? {} : { decidedAt: now, decidedBy: actor?.label || actor?.type || 'owner' }),
            },
        },
        { returnDocument: 'after' },
    );
    if (!done) throw httpError(409, 'This complaint is already decided');

    // after the save: the money (Phase 4 provides issueRefund), then the messages
    let final = done;
    if (refundStatus === 'pending' && typeof refundService.issueRefund === 'function') {
        let st = 'failed';
        try {
            const r = await refundService.issueRefund({
                tenantId: tenant._id, orderId: done.orderId, amountPaise: refundPaise, reason: 'complaint', complaintId: done._id,
            });
            if (r && r.ok !== false) st = 'done';
        } catch (e) { console.error('Complaint refund error:', e.message); }
        final = await Complaint.findOneAndUpdate({ _id: id }, { $set: { refundStatus: st } }, { returnDocument: 'after' });
    }
    try {
        center.notify('complaint_decision', {
            tenantId: tenant._id, userId: final.userId,
            title: 'Update on your complaint',
            body: `${DECISION_TEXT[resolution](final)}${final.ownerReply ? ` "${final.ownerReply.slice(0, 120)}"` : ''}`,
            vars: { orderNo: final.orderNo, resolution, ownerReply: final.ownerReply || '', refundPaise: final.refundPaise },
            data: { complaintId: String(final._id), orderId: String(final.orderId), orderNo: final.orderNo },
        });
        liveFeed.emit(tenant._id, 'complaints', { type: 'complaint.decided', orderNo: final.orderNo, resolution, refundPaise: final.refundPaise });
    } catch (e) { console.error('Complaint notify error:', e.message); }
    return view(final, { forOwner: true });
}

module.exports = { create, forOrder, ownerList, adminList, decide, view, WINDOW_MS };