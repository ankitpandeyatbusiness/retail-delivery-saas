// Money that did not become a sale: orders cancelled or not delivered, split by who caused it, and the money given back to customers.
// Orders are counted on the day they were placed. Values are rupees (the order total); refunds come from the refund records, in paise.
const Order = require('../models/Order');
const OnlineRefund = require('../models/OnlineRefund');
const Tenant = require('../models/Tenant');
const mongoose = require('mongoose');

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function report({ tenantId, from, to }) {
    const shop = tenantId ? { tenantId: oid(tenantId) } : {};
    const placed = { ...shop, createdAt: { $gte: from, $lte: to } };
    const bad = { status: { $in: ['cancelled', 'undelivered'] } };
    const who = { $cond: [{ $eq: ['$status', 'cancelled'] }, { $ifNull: ['$cancelledBy', 'unknown'] }, { $concat: ['nohome_', { $ifNull: ['$undelivered.reasonCode', 'unknown'] }] }] };

    const [byWho, byShop, total, refunds] = await Promise.all([
        Order.aggregate([{ $match: { ...placed, ...bad } }, { $group: { _id: who, count: { $sum: 1 }, value: { $sum: { $ifNull: ['$pricing.total', 0] } }, keptPaise: { $sum: { $ifNull: ['$cancel.keptPaise', { $ifNull: ['$undelivered.keptPaise', 0] }] } } } }]),
        tenantId ? Promise.resolve([]) : Order.aggregate([
            { $match: { ...placed, ...bad } },
            { $group: { _id: '$tenantId', count: { $sum: 1 }, value: { $sum: { $ifNull: ['$pricing.total', 0] } } } },
            { $sort: { value: -1 } }, { $limit: 5 },
        ]),
        Order.countDocuments(placed),
        OnlineRefund.aggregate([
            { $match: { ...shop, status: 'processed', processedAt: { $gte: from, $lte: to } } },
            { $group: { _id: { $ifNull: ['$reason', 'other'] }, count: { $sum: 1 }, paise: { $sum: '$amountPaise' } } },
            { $sort: { paise: -1 } },
        ]),
    ]);

    const rows = byWho.map((r) => ({ key: r._id, count: r.count, value: round2(r.value), keptPaise: r.keptPaise || 0 }));
    const sum = (f, pick = () => true) => rows.filter(pick).reduce((a, r) => a + r[f], 0);
    const names = new Map((await Tenant.find({ _id: { $in: byShop.map((s) => s._id) } }).select('name').lean()).map((t) => [String(t._id), t.name]));
    return {
        orders: total,
        lost: { count: sum('count'), value: round2(sum('value')), sharePct: total ? Math.round((sum('count') / total) * 1000) / 10 : 0 },
        // who caused it: customer / shop / rider / admin / system (cancelled) and nohome_customer / nohome_shop / nohome_rider (not delivered)
        byWho: rows.sort((a, b) => b.value - a.value),
        shopCaused: { count: sum('count', (r) => r.key === 'shop' || r.key === 'nohome_shop'), value: round2(sum('value', (r) => r.key === 'shop' || r.key === 'nohome_shop')) },
        customerCaused: { count: sum('count', (r) => r.key === 'customer' || r.key === 'nohome_customer'), value: round2(sum('value', (r) => r.key === 'customer' || r.key === 'nohome_customer')) },
        shops: byShop.map((s) => ({ tenantId: String(s._id), name: names.get(String(s._id)) || 'Unknown shop', count: s.count, value: round2(s.value) })),
        refunds: { count: refunds.reduce((a, r) => a + r.count, 0), paise: refunds.reduce((a, r) => a + r.paise, 0), byReason: refunds.map((r) => ({ reason: r._id, count: r.count, paise: r.paise })) },
    };
}

module.exports = { report };
