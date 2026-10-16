// The end-of-day summary for the owner (Tier-1 #6): what the shop did on one day (India time), in one call.
// Sales = DELIVERED orders counted on the day they were delivered, like the Home screen and the sales report.
// Amounts named ...Paise are paise; every other amount is rupees.
const Order = require('../models/Order');
const Complaint = require('../models/Complaint');
const OnlinePayment = require('../models/OnlinePayment');
const OnlineRefund = require('../models/OnlineRefund');
const cod = require('./codService');
const { HIDE_UNPAID } = require('./onlineOrder');
const { httpError } = require('../middlewares/apiErrors');

const IST_MS = 330 * 60000;
const DAY_MS = 86400000;
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const NET = {
    $subtract: [
        { $add: [{ $ifNull: ['$pricing.subtotal', 0] }, { $ifNull: ['$pricing.packagingCharge', 0] }] },
        { $ifNull: ['$pricing.discount', 0] },
    ],
};

const todayIst = (now = new Date()) => new Date(now.getTime() + IST_MS).toISOString().slice(0, 10);

async function build({ tenantId, date, now = new Date() }) {
    const day = date === undefined ? todayIst(now) : date;
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) throw httpError(400, 'date must look like 2026-10-31');
    const from = new Date(Date.parse(`${day}T00:00:00+05:30`));
    const to = new Date(from.getTime() + DAY_MS);
    if (from.getTime() > now.getTime()) throw httpError(400, 'That day has not come yet');

    const delivered = { tenantId, status: 'delivered', deliveredAt: { $gte: from, $lt: to } };
    const placed = { tenantId, createdAt: { $gte: from, $lt: to }, ...HIDE_UNPAID };

    const [tot, byPay, top, byStatus, cancelledBy, cash, received, refunded, complaints, owed] = await Promise.all([
        Order.aggregate([{ $match: delivered }, {
            $group: {
                _id: null, orders: { $sum: 1 }, sales: { $sum: NET }, tips: { $sum: { $ifNull: ['$pricing.tip', 0] } },
                fees: { $sum: { $ifNull: ['$pricing.deliveryFee', 0] } }, tax: { $sum: { $ifNull: ['$pricing.tax', 0] } },
                discount: { $sum: { $ifNull: ['$pricing.discount', 0] } }, collected: { $sum: { $ifNull: ['$pricing.total', 0] } },
            },
        }]),
        Order.aggregate([{ $match: delivered }, { $group: { _id: '$payment.method', orders: { $sum: 1 }, total: { $sum: { $ifNull: ['$pricing.total', 0] } } } }, { $sort: { total: -1 } }]),
        Order.aggregate([{ $match: delivered }, { $unwind: '$items' }, { $group: { _id: '$items.productId', name: { $first: '$items.name' }, quantity: { $sum: '$items.quantity' }, revenue: { $sum: '$items.lineTotal' } } }, { $sort: { quantity: -1 } }, { $limit: 5 }]),
        Order.aggregate([{ $match: placed }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
        Order.aggregate([{ $match: { ...placed, status: 'cancelled' } }, { $group: { _id: '$cancelledBy', n: { $sum: 1 } } }]),
        Order.aggregate([{ $match: { ...delivered, 'payment.method': 'cod' } }, { $group: { _id: null, paise: { $sum: { $ifNull: ['$delivery.cashCollectedPaise', 0] } } } }]),
        OnlinePayment.aggregate([{ $match: { tenantId, status: 'captured', capturedAt: { $gte: from, $lt: to } } }, { $group: { _id: null, paise: { $sum: '$capturedPaise' }, n: { $sum: 1 } } }]),
        OnlineRefund.aggregate([{ $match: { tenantId, status: 'processed', processedAt: { $gte: from, $lt: to } } }, { $group: { _id: null, paise: { $sum: '$amountPaise' }, n: { $sum: 1 } } }]),
        Complaint.countDocuments({ tenantId, createdAt: { $gte: from, $lt: to } }),
        cod.balances(tenantId),
    ]);

    const t = tot[0] || {};
    const status = Object.fromEntries(byStatus.map((s) => [s._id, s.n]));
    return {
        date: day, isToday: day === todayIst(now), from, to,
        sales: {
            orders: t.orders || 0, revenue: r2(t.sales || 0), averageOrder: t.orders ? r2((t.sales || 0) / t.orders) : 0,
            tips: r2(t.tips || 0), deliveryFees: r2(t.fees || 0), tax: r2(t.tax || 0), discounts: r2(t.discount || 0), customersPaid: r2(t.collected || 0),
        },
        payments: byPay.map((p) => ({ method: p._id, orders: p.orders, total: r2(p.total) })),
        topItems: top.map((i) => ({ name: i.name, quantity: i.quantity, revenue: r2(i.revenue) })),
        orders: {
            placed: Object.values(status).reduce((a, b) => a + b, 0), delivered: status.delivered || 0,
            cancelled: status.cancelled || 0, undelivered: status.undelivered || 0,
            cancelledBy: Object.fromEntries(cancelledBy.filter((c) => c._id).map((c) => [c._id, c.n])),
        },
        cash: { collectedByRidersPaise: cash[0]?.paise || 0, withRidersNowPaise: owed.totalOwedPaise || 0 },
        online: { receivedPaise: received[0]?.paise || 0, receivedCount: received[0]?.n || 0, refundedPaise: refunded[0]?.paise || 0, refundedCount: refunded[0]?.n || 0 },
        complaints,
    };
}

module.exports = { build, todayIst };
