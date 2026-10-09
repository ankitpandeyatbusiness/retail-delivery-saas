// COD cash ledger tools for the owner. All money is integer paise.
//   balance = sum of amountPaise (collect +, handover -, adjust +/-)
const mongoose = require('mongoose');
const CodSettlement = require('../models/CodSettlement');
const Rider = require('../models/Rider');
const Order = require('../models/Order');
const { httpError } = require('../middlewares/apiErrors');

const MAX_PAISE = 10000000;   // Rs 1,00,000 in one entry
const oid = (v) => new mongoose.Types.ObjectId(String(v));

// every rider of the shop (also removed ones that still have cash on the books)
async function balances(tenantId) {
    const [rows, riders] = await Promise.all([
        CodSettlement.aggregate([
            { $match: { tenantId } },
            {
                $group: {
                    _id: '$riderId',
                    collectedPaise: { $sum: { $cond: [{ $eq: ['$type', 'collect'] }, '$amountPaise', 0] } },
                    handedPaise: { $sum: { $cond: [{ $eq: ['$type', 'handover'] }, { $multiply: ['$amountPaise', -1] }, 0] } },
                    adjustedPaise: { $sum: { $cond: [{ $eq: ['$type', 'adjust'] }, '$amountPaise', 0] } },
                    balancePaise: { $sum: '$amountPaise' },
                    lastAt: { $max: '$createdAt' },
                },
            },
        ]),
        Rider.find({ tenantId }).select('userId name isActive').lean(),
    ]);
    const byId = new Map(rows.map((r) => [String(r._id), r]));
    const items = riders.map((r) => {
        const b = byId.get(String(r.userId)) || {};
        byId.delete(String(r.userId));
        return {
            riderId: r.userId, name: r.name || null, isActive: r.isActive, removed: false,
            collectedPaise: b.collectedPaise || 0, handedPaise: b.handedPaise || 0,
            adjustedPaise: b.adjustedPaise || 0, balancePaise: b.balancePaise || 0, lastAt: b.lastAt || null,
        };
    });
    for (const [id, b] of byId) {
        items.push({
            riderId: id, name: 'Removed rider', isActive: false, removed: true,
            collectedPaise: b.collectedPaise, handedPaise: b.handedPaise,
            adjustedPaise: b.adjustedPaise, balancePaise: b.balancePaise, lastAt: b.lastAt,
        });
    }
    items.sort((a, b) => b.balancePaise - a.balancePaise);
    return { items, totalOwedPaise: items.reduce((s, i) => s + i.balancePaise, 0) };
}

async function balanceOf(tenantId, riderId) {
    const [r] = await CodSettlement.aggregate([
        { $match: { tenantId, riderId: oid(riderId) } },
        { $group: { _id: null, balancePaise: { $sum: '$amountPaise' }, rows: { $sum: 1 } } },
    ]);
    return { balancePaise: r?.balancePaise || 0, rows: r?.rows || 0 };
}

// type: handover (amountPaise > 0, rider gave cash to the shop) or adjust (any non-zero amount, note needed)
async function record({ tenantId, riderId, type, amountPaise, note, actor }) {
    if (!['handover', 'adjust'].includes(type)) throw httpError(400, 'Invalid type');
    if (!Number.isInteger(amountPaise) || amountPaise === 0 || Math.abs(amountPaise) > MAX_PAISE) {
        throw httpError(400, 'amountPaise must be a whole number of paise (not 0, at most 10000000)');
    }
    const clean = typeof note === 'string' ? note.trim().slice(0, 200) : '';
    if (type === 'adjust' && clean.length < 3) throw httpError(400, 'Please write a reason for the adjustment');
    if (type === 'handover' && amountPaise < 0) throw httpError(400, 'A handover amount must be more than 0');

    const bal = await balanceOf(tenantId, riderId);
    if (!bal.rows && !(await Rider.exists({ tenantId, userId: riderId }))) throw httpError(404, 'Rider not found');
    if (type === 'handover' && amountPaise > bal.balancePaise) {
        throw httpError(409, `The rider only owes ${bal.balancePaise} paise right now`);
    }

    const row = await CodSettlement.create({
        tenantId, riderId, type,
        amountPaise: type === 'handover' ? -amountPaise : amountPaise,
        note: clean || undefined,
        actor: actor ? { type: actor.type, id: String(actor.id), label: actor.label } : undefined,
    });
    return { ok: true, entryId: row._id, balancePaise: bal.balancePaise + row.amountPaise };
}

async function ledger({ tenantId, riderId, page, limit }) {
    const items = await CodSettlement.find({ tenantId, riderId })
        .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit + 1)
        .populate('orderId', 'orderNo').lean();
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    return {
        items: items.map((r) => ({
            id: r._id, type: r.type, amountPaise: r.amountPaise, note: r.note || null,
            orderNo: r.orderId?.orderNo || null, actor: r.actor || null, createdAt: r.createdAt,
        })),
        page, hasMore,
    };
}

// deliveries, average pickup-to-door time, rating, for a date range
async function performance({ tenantId, from, to }) {
    const rows = await Order.aggregate([
        {
            $match: {
                tenantId, status: 'delivered', 'delivery.riderId': { $exists: true },
                'delivery.deliveredAt': { $gte: from, $lte: to },
            },
        },
        {
            $group: {
                _id: '$delivery.riderId',
                deliveries: { $sum: 1 },
                avgMs: { $avg: { $subtract: ['$delivery.deliveredAt', '$delivery.pickedUpAt'] } },
                cashPaise: { $sum: '$delivery.cashCollectedPaise' },
                ratedCount: { $sum: { $cond: [{ $gt: ['$deliveryRating.rating', 0] }, 1, 0] } },
                ratingAvg: { $avg: '$deliveryRating.rating' },
            },
        },
    ]);
    const riders = await Rider.find({ tenantId }).select('userId name ratingAvg ratingCount').lean();
    const byId = new Map(riders.map((r) => [String(r.userId), r]));
    const items = rows.map((r) => {
        const p = byId.get(String(r._id));
        return {
            riderId: r._id, name: p?.name || 'Removed rider',
            deliveries: r.deliveries,
            avgDeliveryMin: r.avgMs == null ? null : Math.round((r.avgMs / 60000) * 10) / 10,
            cashCollectedPaise: r.cashPaise,
            periodRatingAvg: r.ratingAvg == null ? null : Math.round(r.ratingAvg * 100) / 100,
            periodRatedCount: r.ratedCount,
            overallRatingAvg: p?.ratingAvg ?? null,
            overallRatingCount: p?.ratingCount ?? 0,
        };
    }).sort((a, b) => b.deliveries - a.deliveries);
    return { from, to, items };
}

module.exports = { balances, record, ledger, performance };