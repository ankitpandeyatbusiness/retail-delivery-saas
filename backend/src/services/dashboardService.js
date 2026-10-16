// Everything the owner's Home screen shows, in ONE call (GET /api/shop/dashboard).
//
//   today       sales (delivered today), orders, average order value, orders placed, cancelled and the money lost,
//               how fast the shop accepts orders
//   yesterday   the same sales and orders up to this time yesterday, so "up 12 %" compares like with like
//   byHour      today's sales hour by hour (India time)
//   waiting     orders nobody has accepted yet, each with the moment the server will cancel it
//   stock       items that are out of stock, and items that are nearly out (only those with a stock count)
//   riders      online, free, and the cash they hold
//   complaints, sms, rent   the small things that need him
//
// "Sales" means DELIVERED orders counted on the day they were delivered, the same rule as the sales report.
const Order = require('../models/Order');
const Product = require('../models/Product');
const Rider = require('../models/Rider');
const Complaint = require('../models/Complaint');
const Tenant = require('../models/Tenant');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const smsWallet = require('./smsWalletService');
const cod = require('./codService');
const { startOf } = require('./liveSnapshot');
const { acceptDeadline } = require('./orderTimeout');
const { HIDE_UNPAID } = require('./onlineOrder');

const DAY_MS = 24 * 60 * 60 * 1000;
const LOW_STOCK_AT = 5;          // pieces (or grams / ml for items sold by weight or volume: counted as given)
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// food + packaging - discount: what the shop earned (delivery fee, tax and tips are not the shop's sales)
const NET = {
    $subtract: [
        { $add: [{ $ifNull: ['$pricing.subtotal', 0] }, { $ifNull: ['$pricing.packagingCharge', 0] }] },
        { $ifNull: ['$pricing.discount', 0] },
    ],
};

async function sales(tenantId, from, to) {
    const [row] = await Order.aggregate([
        { $match: { tenantId, status: 'delivered', deliveredAt: { $gte: from, $lt: to } } },
        { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: NET } } },
    ]);
    return { orders: row?.orders || 0, revenue: round2(row?.revenue || 0) };
}

// minutes from "the order reached the shop" to "the shop accepted it", average of today's orders
async function averageAcceptSeconds(tenantId, since) {
    const rows = await Order.find({ tenantId, createdAt: { $gte: since }, 'statusHistory.status': 'accepted', ...HIDE_UNPAID })
        .select('createdAt payment.paidAt scheduledFor statusHistory').limit(300).lean();
    const waits = [];
    for (const o of rows) {
        if (o.scheduledFor) continue;   // an order for later is accepted whenever the shop likes
        const acc = (o.statusHistory || []).find((h) => h.status === 'accepted');
        if (!acc?.at) continue;
        const reached = new Date(o.payment?.paidAt || o.createdAt).getTime();
        const wait = (new Date(acc.at).getTime() - reached) / 1000;
        if (wait >= 0 && wait < 3600) waits.push(wait);
    }
    return waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null;
}

async function build(tenantId) {
    const now = new Date();
    const day = startOf(now, 'day');
    const yesterday = new Date(day.getTime() - DAY_MS);
    const sameTimeYesterday = new Date(now.getTime() - DAY_MS);

    const [
        today, before, byHourRows, placed, cancelledRows, acceptSec, waitingRows, itemRows,
        riders, owed, complaints, wallet, tenant, invoiceRows,
    ] = await Promise.all([
        sales(tenantId, day, new Date(now.getTime() + 1000)),
        sales(tenantId, yesterday, sameTimeYesterday),
        Order.aggregate([
            { $match: { tenantId, status: 'delivered', deliveredAt: { $gte: day } } },
            { $group: { _id: { $hour: { date: '$deliveredAt', timezone: 'Asia/Kolkata' } }, orders: { $sum: 1 }, revenue: { $sum: NET } } },
        ]),
        Order.countDocuments({ tenantId, createdAt: { $gte: day }, ...HIDE_UNPAID }),
        Order.aggregate([
            { $match: { tenantId, createdAt: { $gte: day }, status: { $in: ['cancelled', 'undelivered'] }, ...HIDE_UNPAID } },
            { $group: { _id: null, count: { $sum: 1 }, lost: { $sum: { $ifNull: ['$pricing.total', 0] } } } },
        ]),
        averageAcceptSeconds(tenantId, day),
        Order.find({ tenantId, status: 'placed', ...HIDE_UNPAID })
            .select('orderNo createdAt payment scheduledFor pricing.total orderType items.name items.quantity')
            .sort({ createdAt: 1 }).limit(10).lean(),
        Product.find({
            tenantId, isActive: true,
            $or: [{ isAvailable: false }, { 'stock.enabled': true, 'stock.qty': { $lte: LOW_STOCK_AT } }],
        }).select('name isAvailable stock sellBy').sort({ name: 1 }).limit(60).lean(),
        Rider.find({ tenantId, isActive: true }).select('isOnline activeOrderCount').lean(),
        cod.balances(tenantId),
        Complaint.countDocuments({ tenantId, status: { $in: ['open', 'in_progress'] } }),
        smsWallet.status(tenantId),
        Tenant.findById(tenantId).select('billing.state').lean(),
        SubscriptionInvoice.aggregate([
            { $match: { tenantId, status: 'pending' } },
            { $group: { _id: null, amount: { $sum: '$total' }, count: { $sum: 1 }, graceEndsAt: { $min: '$graceEndsAt' } } },
        ]),
    ]);

    // all 24 hours, so the chart has no gaps
    const hourMap = new Map(byHourRows.map((r) => [r._id, r]));
    const byHour = Array.from({ length: 24 }, (_, h) => ({
        hour: h, orders: hourMap.get(h)?.orders || 0, revenue: round2(hourMap.get(h)?.revenue || 0),
    }));

    const out = itemRows.filter((p) => p.isAvailable === false);
    const low = itemRows.filter((p) => p.isAvailable !== false && p.stock?.enabled && p.stock.qty > 0 && p.stock.qty <= LOW_STOCK_AT);
    const brief = (p) => ({ id: p._id, name: p.name, qty: p.stock?.enabled ? p.stock.qty : null, sellBy: p.sellBy || null });

    const online = riders.filter((r) => r.isOnline);
    const invoice = invoiceRows[0];
    const cancelled = cancelledRows[0];

    return {
        at: now,
        today: {
            revenue: today.revenue,
            orders: today.orders,
            averageOrderValue: today.orders ? round2(today.revenue / today.orders) : 0,
            placed,
            cancelled: { count: cancelled?.count || 0, lost: round2(cancelled?.lost || 0) },
            averageAcceptSeconds: acceptSec,
        },
        yesterday: before,
        byHour,
        waiting: waitingRows.map((o) => ({
            id: o._id, orderNo: o.orderNo, createdAt: o.createdAt, orderType: o.orderType, total: o.pricing?.total || 0,
            paid: o.payment?.status === 'paid', scheduledFor: o.scheduledFor || null,
            items: (o.items || []).slice(0, 3).map((i) => `${i.quantity} ${i.name}`),
            acceptBy: acceptDeadline(o),
        })),
        stock: { out: out.slice(0, 8).map(brief), outCount: out.length, low: low.slice(0, 8).map(brief), lowCount: low.length },
        riders: {
            total: riders.length,
            online: online.length,
            free: online.filter((r) => !r.activeOrderCount).length,
            cashOwedPaise: owed.totalOwedPaise || 0,
        },
        complaints: { open: complaints },
        sms: { balancePaise: wallet.balancePaise, low: !!wallet.low, zero: !!wallet.zero },
        rent: {
            state: tenant?.billing?.state || null,
            dueAmount: invoice?.amount || 0,
            dueCount: invoice?.count || 0,
            graceEndsAt: invoice?.graceEndsAt || null,
        },
    };
}

module.exports = { build, LOW_STOCK_AT };
