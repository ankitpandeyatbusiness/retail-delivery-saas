// The end-of-day summary for the owner (Tier-1 #6): what the shop did on one day (India time), in one call.
// Sales = DELIVERED orders counted on the day they were delivered, like the Home screen and the sales report.
// Amounts named ...Paise are paise; every other amount is rupees.
// One day (?date=) or a range of days (?from=&to=, up to a year): the same report, plus the busiest hours, the order types, new against returning customers,
// the sales lost to cancels, the team, and the same numbers for the period just before, for a comparison.
const User = require('../models/User');
const Order = require('../models/Order');
const BulkOrder = require('../models/BulkOrder');
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

const okDay = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

async function build({ tenantId, date, from: fromDay, to: toDay, now = new Date() }) {
    let day; let from; let to; let rangeMode = false;
    if (fromDay !== undefined || toDay !== undefined) {
        if (!okDay(fromDay) || !okDay(toDay)) throw httpError(400, 'from and to must look like 2026-10-31');
        if (fromDay > toDay) throw httpError(400, 'The from day must not be after the to day');
        from = new Date(Date.parse(`${fromDay}T00:00:00+05:30`));
        to = new Date(Date.parse(`${toDay}T00:00:00+05:30`) + DAY_MS);
        if ((to - from) / DAY_MS > 366) throw httpError(400, 'Choose at most one year');
        if (from.getTime() > now.getTime()) throw httpError(400, 'That day has not come yet');
        day = fromDay === toDay ? fromDay : `${fromDay} to ${toDay}`;
        rangeMode = fromDay !== toDay;
    } else {
        day = date === undefined ? todayIst(now) : date;
        if (!okDay(day)) throw httpError(400, 'date must look like 2026-10-31');
        from = new Date(Date.parse(`${day}T00:00:00+05:30`));
        to = new Date(from.getTime() + DAY_MS);
        if (from.getTime() > now.getTime()) throw httpError(400, 'That day has not come yet');
    }
    const prevFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));

    const delivered = { tenantId, status: 'delivered', bulkId: { $exists: false }, deliveredAt: { $gte: from, $lt: to } };
    const placed = { tenantId, createdAt: { $gte: from, $lt: to }, ...HIDE_UNPAID, ...require('./onlineOrder').HIDE_BULK_TICKET };

    const bulkRows = BulkOrder.aggregate([{ $match: { tenantId, status: { $in: ['delivered', 'completed'] }, 'stageAt.delivered': { $gte: from, $lt: to } } }, { $group: { _id: null, orders: { $sum: 1 }, sales: { $sum: { $subtract: [{ $add: [{ $ifNull: ['$quote.pricing.subtotal', 0] }, { $ifNull: ['$quote.pricing.packagingCharge', 0] }] }, { $ifNull: ['$quote.pricing.discount', 0] }] } } } }]);
    const tz = '+05:30';
    const extra = Promise.all([
        Order.aggregate([{ $match: delivered }, { $group: { _id: { $hour: { date: '$deliveredAt', timezone: tz } }, orders: { $sum: 1 }, sales: { $sum: NET } } }]),
        Order.aggregate([{ $match: delivered }, { $group: { _id: '$orderType', orders: { $sum: 1 }, sales: { $sum: NET } } }]),
        Order.aggregate([{ $match: delivered }, { $group: { _id: '$userId', n: { $sum: 1 } } }]),
        Order.aggregate([{ $match: { ...placed, status: { $in: ['cancelled', 'undelivered'] } } }, { $group: { _id: null, n: { $sum: 1 }, total: { $sum: { $ifNull: ['$pricing.total', 0] } } } }]),
        Order.aggregate([{ $match: { tenantId, status: 'delivered', bulkId: { $exists: false }, deliveredAt: { $gte: prevFrom, $lt: from } } }, { $group: { _id: null, orders: { $sum: 1 }, sales: { $sum: NET } } }]),
        Order.aggregate([{ $match: { ...delivered, 'kitchen.readyByName': { $exists: true, $ne: null } } }, { $group: { _id: '$kitchen.readyByName', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 5 }]),
        Order.aggregate([{ $match: { ...delivered, 'delivery.riderId': { $exists: true, $ne: null } } }, { $group: { _id: '$delivery.riderId', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 5 }]),
    ]);
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

    const [hoursRows, typeRows, userRows, lostRows, prevRows, cookRows, riderRows] = await extra;
    const hours = hoursRows.map((h) => ({ hour: h._id, orders: h.orders, sales: r2(h.sales) })).sort((a, b) => a.hour - b.hour);
    const peak = hours.reduce((best, h) => (!best || h.sales > best.sales ? h : best), null);
    // new = nobody of them had an order delivered before this period
    let returning = 0;
    if (userRows.length) {
        const ids = userRows.map((u) => u._id).filter(Boolean);
        returning = (await Order.aggregate([{ $match: { tenantId, userId: { $in: ids }, status: 'delivered', deliveredAt: { $lt: from } } }, { $group: { _id: '$userId' } }, { $count: 'n' }]))[0]?.n || 0;
    }
    const riderNames = new Map((await User.find({ _id: { $in: riderRows.map((r) => r._id) } }).select('name phone').lean()).map((u) => [String(u._id), u.name || u.phone || 'Rider']));
    const t = tot[0] || {};
    const bk = (await bulkRows)[0] || { orders: 0, sales: 0 };   // the bulk orders delivered today are part of today's sales
    const status = Object.fromEntries(byStatus.map((s) => [s._id, s.n]));
    return {
        date: day, isToday: day === todayIst(now), from, to,
        sales: {
            orders: (t.orders || 0) + bk.orders, revenue: r2((t.sales || 0) + bk.sales), averageOrder: (t.orders || 0) + bk.orders ? r2(((t.sales || 0) + bk.sales) / ((t.orders || 0) + bk.orders)) : 0,
            bulk: { orders: bk.orders, revenue: r2(bk.sales) },
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
        range: rangeMode, days: Math.round((to - from) / DAY_MS),
        hours, busiest: peak ? { hour: peak.hour, sales: peak.sales, orders: peak.orders } : null,
        types: typeRows.map((x) => ({ type: x._id || 'delivery', orders: x.orders, sales: r2(x.sales) })).sort((a, b) => b.sales - a.sales),
        customers: { total: userRows.length, returning, new: Math.max(0, userRows.length - returning) },
        lost: { orders: lostRows[0]?.n || 0, total: r2(lostRows[0]?.total || 0) },
        before: { orders: prevRows[0]?.orders || 0, revenue: r2(prevRows[0]?.sales || 0), from: prevFrom },
        team: { cooks: cookRows.map((c) => ({ name: c._id, orders: c.n })), riders: riderRows.map((r) => ({ name: riderNames.get(String(r._id)) || 'Rider', deliveries: r.n })) },
    };
}

module.exports = { build, todayIst };
