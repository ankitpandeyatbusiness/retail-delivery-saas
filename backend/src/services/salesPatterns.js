// When people order, how they order, new against returning customers, and cash still with riders. Delivered orders only (the same rule as the sales report).
const mongoose = require('mongoose');
const Order = require('../models/Order');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const CodSettlement = require('../models/CodSettlement');

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const net = { $subtract: [{ $add: ['$pricing.subtotal', '$pricing.packagingCharge'] }, '$pricing.discount'] };

async function report({ tenantId, from, to }) {
    const shop = tenantId ? { tenantId: oid(tenantId) } : {};
    const delivered = { ...shop, status: 'delivered', bulkId: { $exists: false }, deliveredAt: { $gte: from, $lte: to } };

    const [hours, days, types, buyers] = await Promise.all([
        Order.aggregate([{ $match: delivered }, { $group: { _id: { $hour: { date: '$deliveredAt', timezone: 'Asia/Kolkata' } }, orders: { $sum: 1 }, revenue: { $sum: net } } }]),
        Order.aggregate([{ $match: delivered }, { $group: { _id: { $isoDayOfWeek: { date: '$deliveredAt', timezone: 'Asia/Kolkata' } }, orders: { $sum: 1 }, revenue: { $sum: net } } }]),
        Order.aggregate([{ $match: delivered }, { $group: { _id: '$orderType', orders: { $sum: 1 }, revenue: { $sum: net } } }, { $sort: { revenue: -1 } }]),
        Order.aggregate([{ $match: delivered }, { $group: { _id: '$userId', orders: { $sum: 1 } } }]),
    ]);

    // hour 0..23 and weekday 1 (Monday) .. 7 (Sunday), every slot present so a chart has no gaps
    const hourRows = Array.from({ length: 24 }, (_, h) => { const x = hours.find((r) => r._id === h); return { hour: h, orders: x?.orders || 0, revenue: round2(x?.revenue) }; });
    const dayRows = Array.from({ length: 7 }, (_, i) => { const x = days.find((r) => r._id === i + 1); return { day: i + 1, orders: x?.orders || 0, revenue: round2(x?.revenue) }; });
    const peak = hourRows.reduce((a, r) => (r.orders > a.orders ? r : a), { hour: null, orders: 0 });
    const busiestDay = dayRows.reduce((a, r) => (r.orders > a.orders ? r : a), { day: null, orders: 0 });

    // new = his first delivered order ever (in these shops) falls inside the period; returning = he had one before
    const ids = buyers.map((b) => b._id);
    const firsts = ids.length ? await Order.aggregate([{ $match: { ...shop, status: 'delivered', bulkId: { $exists: false }, userId: { $in: ids } } }, { $group: { _id: '$userId', first: { $min: '$deliveredAt' } } }]) : [];
    const firstBy = new Map(firsts.map((x) => [String(x._id), x.first]));
    let fresh = 0;
    let again = 0;       // returning customers
    let repeatInside = 0;   // new customers who ordered more than once in the period
    for (const b of buyers) {
        const first = firstBy.get(String(b._id));
        if (first && first >= from) { fresh += 1; if (b.orders > 1) repeatInside += 1; } else again += 1;
    }
    const customers = { total: buyers.length, new: fresh, returning: again, returningPct: buyers.length ? Math.round((again / buyers.length) * 1000) / 10 : 0, newOrderedAgain: repeatInside };

    // cash the riders still hold: collected minus handed over (all time), only balances above zero
    const bal = await CodSettlement.aggregate([
        { $match: shop },
        { $group: { _id: { t: '$tenantId', r: '$riderId' }, paise: { $sum: '$amountPaise' } } },
        { $match: { paise: { $gt: 0 } } },
        { $sort: { paise: -1 } },
    ]);
    const top = bal.slice(0, 5);
    const riders = new Map((await User.find({ _id: { $in: top.map((b) => b._id.r) } }).select('name').lean()).map((u) => [String(u._id), u.name]));
    const shops = new Map((await Tenant.find({ _id: { $in: top.map((b) => b._id.t) } }).select('name').lean()).map((t) => [String(t._id), t.name]));
    const cash = {
        paise: bal.reduce((a, b) => a + b.paise, 0), riders: bal.length,
        top: top.map((b) => ({ riderId: String(b._id.r), rider: riders.get(String(b._id.r)) || 'Rider', tenantId: String(b._id.t), shopName: shops.get(String(b._id.t)) || 'Unknown shop', paise: b.paise })),
    };

    return {
        hours: hourRows, days: dayRows, peakHour: peak.hour, busiestDay: busiestDay.day,
        types: types.map((r) => ({ type: r._id, orders: r.orders, revenue: round2(r.revenue) })),
        customers, cash,
    };
}

module.exports = { report };
