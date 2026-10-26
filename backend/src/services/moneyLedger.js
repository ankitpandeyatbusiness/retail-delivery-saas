// One list of every money movement, built live from the tables that already hold the money.
// There is no second copy, so the list can never disagree with the real records.
//   shop view      what the shop got from customers (+), and what went out: refunds, lost disputes, SMS top-ups, rent
//   platform view  what the platform received from all shops: SMS top-ups and rent (paid and still pending)
// All amounts are whole paise. Invoices keep rupees, so they are converted here.
const mongoose = require('mongoose');
const OnlinePayment = require('../models/OnlinePayment');
const OnlineRefund = require('../models/OnlineRefund');
const PaymentDispute = require('../models/PaymentDispute');
const SmsTransaction = require('../models/SmsTransaction');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const Tenant = require('../models/Tenant');
const Order = require('../models/Order');

const IST_MS = 330 * 60000;
const bad = (status, message) => Object.assign(new Error(message), { status });
const lit = (v) => ({ $literal: v });

const LABELS = {
    customer_payment: 'Payment from customer',
    customer_refund: 'Refund to customer',
    dispute_lost: 'Chargeback lost',
    sms_topup: 'SMS top-up',
    rent: 'Monthly bill',
};

// perspective: who is asking. dir = which way the money moves for him.
const BRANCHES = [
    {
        category: 'customer_payment', model: OnlinePayment, views: { shop: 'in' },
        match: { status: { $in: ['captured', 'mismatch'] }, capturedPaise: { $gt: 0 } },
        dateMatch: (r) => ({ capturedAt: r }),
        project: {
            at: '$capturedAt', amountPaise: '$capturedPaise', status: lit('done'), orderId: '$orderId', ref: '$rzpPaymentId',
            meta: { mode: '$mode', method: '$method', refundedPaise: '$refundedPaise' },
        },
    },
    {
        category: 'customer_refund', model: OnlineRefund, views: { shop: 'out' },
        match: { status: 'processed' },
        dateMatch: (r) => ({ processedAt: r }),
        project: {
            at: '$processedAt', amountPaise: '$amountPaise', status: lit('done'), orderId: '$orderId', ref: '$rzpRefundId',
            meta: { reason: '$reason', paymentRef: '$rzpPaymentId' },
        },
    },
    {
        category: 'dispute_lost', model: PaymentDispute, views: { shop: 'out' },
        match: { status: 'lost' },
        dateMatch: (r) => ({ updatedAt: r }),
        project: {
            at: '$updatedAt', amountPaise: '$amountPaise', status: lit('done'), orderId: '$orderId', ref: '$rzpDisputeId',
            meta: { reasonCode: '$reasonCode', paymentRef: '$rzpPaymentId' },
        },
    },
    {
        category: 'sms_topup', model: SmsTransaction, views: { shop: 'out', platform: 'in' },
        match: { type: 'topup', amountPaise: { $gt: 0 } },
        dateMatch: (r) => ({ createdAt: r }),
        project: {
            at: '$createdAt', amountPaise: '$amountPaise', status: lit('done'), orderId: lit(null), ref: '$paymentId',
            meta: { note: '$note', by: '$actor.label' },
        },
    },
    {
        category: 'rent', model: SubscriptionInvoice, views: { shop: 'out', platform: 'in' },
        match: { status: { $in: ['paid', 'pending'] } },
        dateMatch: (r) => ({ $or: [{ status: 'paid', paidAt: r }, { status: 'pending', issueDate: r }] }),
        project: {
            at: { $ifNull: ['$paidAt', '$issueDate'] },
            amountPaise: { $toLong: { $round: [{ $multiply: ['$total', 100] }, 0] } },
            status: { $cond: [{ $eq: ['$status', 'paid'] }, lit('done'), lit('pending')] },
            orderId: lit(null), ref: '$invoiceNo',
            meta: { period: '$period', kind: '$kind', paymentMode: '$paymentMode', paymentRef: '$paymentRef', dueDate: '$dueDate', description: '$description' },
        },
    },
];

const CATEGORIES = BRANCHES.map((b) => b.category);

const day = (v, endOfDay) => {
    const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
    if (!m) throw bad(400, 'Dates must look like 2026-10-31');
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) throw bad(400, 'Invalid date');
    return new Date(Date.UTC(y, mo - 1, d) - IST_MS + (endOfDay ? 86400000 - 1 : 0));
};

// turns a query string into a safe filter; throws 400 for anything strange
function parseQuery(q = {}, { view }) {
    const f = {};
    if (q.from !== undefined) f.from = day(q.from, false);
    if (q.to !== undefined) f.to = day(q.to, true);
    if (f.from && f.to && f.from > f.to) throw bad(400, 'The "from" date must not be after the "to" date');
    if (q.category !== undefined) {
        const allowed = BRANCHES.filter((b) => b.views[view]).map((b) => b.category);
        if (typeof q.category !== 'string' || !allowed.includes(q.category)) throw bad(400, `category must be one of: ${allowed.join(', ')}`);
        f.category = q.category;
    }
    if (q.status !== undefined) {
        if (!['done', 'pending'].includes(q.status)) throw bad(400, 'status must be done or pending');
        f.status = q.status;
    }
    if (q.tenantId !== undefined) {
        if (typeof q.tenantId !== 'string' || !mongoose.isValidObjectId(q.tenantId)) throw bad(400, 'tenantId is not valid');
        f.tenantId = new mongoose.Types.ObjectId(q.tenantId);
    }
    const page = Number.parseInt(q.page, 10);
    const limit = Number.parseInt(q.limit, 10);
    f.page = Number.isInteger(page) && page > 0 ? Math.min(page, 100000) : 1;
    f.limit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20;
    return f;
}

function branchPipeline(b, view, tenantId, f) {
    const range = {};
    if (f.from) range.$gte = f.from;
    if (f.to) range.$lte = f.to;
    const and = [b.match];
    if (tenantId) and.push({ tenantId });
    if (Object.keys(range).length) and.push(b.dateMatch(range));
    if (f.status === 'pending' && b.category !== 'rent') return null;   // only bills can be pending
    if (f.status === 'pending') and.push({ status: 'pending' });
    if (f.status === 'done' && b.category === 'rent') and.push({ status: 'paid' });
    return [
        { $match: { $and: and } },
        { $project: { tenantId: 1, ...b.project, category: lit(b.category), direction: lit(b.views[view]) } },
    ];
}

// view: 'shop' (needs tenantId) or 'platform' (all shops, or one with filter.tenantId)
async function list({ view, tenantId, filter, maxLimit }) {
    const f = filter;
    const limit = maxLimit ? Math.min(f.limit, maxLimit) : f.limit;
    const tid = view === 'shop' ? tenantId : f.tenantId;
    const parts = BRANCHES
        .filter((b) => b.views[view] && (!f.category || f.category === b.category))
        .map((b) => ({ b, pipe: branchPipeline(b, view, tid, f) }))
        .filter((x) => x.pipe);

    const empty = { items: [], page: f.page, limit, total: 0, totals: { inPaise: 0, outPaise: 0, pending: { count: 0, paise: 0 }, byCategory: [] } };
    if (!parts.length) return empty;

    const [first, ...rest] = parts;
    const rows = await first.b.model.aggregate([
        ...first.pipe,
        ...rest.map((x) => ({ $unionWith: { coll: x.b.model.collection.name, pipeline: x.pipe } })),
        {
            $facet: {
                items: [{ $sort: { at: -1, _id: -1 } }, { $skip: (f.page - 1) * limit }, { $limit: limit }],
                sums: [{ $group: { _id: { category: '$category', status: '$status', direction: '$direction' }, count: { $sum: 1 }, paise: { $sum: '$amountPaise' } } }],
            },
        },
    ]);
    const { items, sums } = rows[0];

    const totals = { inPaise: 0, outPaise: 0, pending: { count: 0, paise: 0 }, byCategory: [] };
    const cat = new Map();
    let total = 0;
    for (const s of sums) {
        total += s.count;
        if (s._id.status === 'pending') { totals.pending.count += s.count; totals.pending.paise += s.paise; continue; }
        if (s._id.direction === 'in') totals.inPaise += s.paise; else totals.outPaise += s.paise;
        cat.set(s._id.category, { category: s._id.category, label: LABELS[s._id.category], direction: s._id.direction, count: s.count, paise: s.paise });
    }
    totals.byCategory = [...cat.values()].sort((a, b) => b.paise - a.paise);
    totals.netPaise = view === 'shop' ? totals.inPaise - totals.outPaise : totals.inPaise;

    // names and order numbers, only for the rows on this page
    const tIds = [...new Set(items.map((i) => String(i.tenantId)))];
    const oIds = items.filter((i) => i.orderId).map((i) => i.orderId);
    const [tenants, orders] = await Promise.all([
        view === 'platform' ? Tenant.find({ _id: { $in: tIds } }).select('name slug').lean() : [],
        oIds.length ? Order.find({ _id: { $in: oIds } }).select('orderNo').lean() : [],
    ]);
    const tName = new Map(tenants.map((t) => [String(t._id), { name: t.name, slug: t.slug }]));
    const oNo = new Map(orders.map((o) => [String(o._id), o.orderNo]));

    return {
        items: items.map((i) => ({
            id: i._id, at: i.at, category: i.category, label: LABELS[i.category], direction: i.direction,
            amountPaise: i.amountPaise, status: i.status, ref: i.ref || null,
            orderId: i.orderId || null, orderNo: i.orderId ? oNo.get(String(i.orderId)) ?? null : null,
            ...(view === 'platform' ? { tenantId: i.tenantId, shop: tName.get(String(i.tenantId)) || null } : {}),
            meta: i.meta || {},
        })),
        page: f.page, limit, total, totals,
    };
}

module.exports = { list, parseQuery, CATEGORIES, LABELS };