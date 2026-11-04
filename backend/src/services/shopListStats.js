// What the superadmin's Shops list shows under each shop: orders today, when the last order came, what rent is owed, whether the shop has gone quiet, and its brand.
// One query each for orders, bills and brands, however many shops are listed.
const Order = require('../models/Order');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const Brand = require('../models/Brand');

const DAY = 86400000;
const QUIET_DAYS = 14;
const istStartOfDay = (d) => { const x = new Date(d.getTime() + 330 * 60000); x.setUTCHours(0, 0, 0, 0); return new Date(x.getTime() - 330 * 60000); };
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// items: tenants with _id, brandId, status, createdAt and billing { isLive, goLiveAt }. Returns Map(id -> stats)
async function forShops(items, now = new Date()) {
    const out = new Map();
    if (!items.length) return out;
    const ids = items.map((t) => t._id);
    const today = istStartOfDay(now);
    const since = new Date(now.getTime() - 90 * DAY);
    const [orders, owed, brands] = await Promise.all([
        Order.aggregate([
            { $match: { tenantId: { $in: ids }, createdAt: { $gte: since } } },
            { $group: { _id: '$tenantId', last: { $max: '$createdAt' }, today: { $sum: { $cond: [{ $gte: ['$createdAt', today] }, 1, 0] } } } },
        ]),
        SubscriptionInvoice.aggregate([
            { $match: { tenantId: { $in: ids }, status: 'pending' } },
            { $group: { _id: '$tenantId', total: { $sum: '$total' }, bills: { $sum: 1 }, overdue: { $sum: { $cond: [{ $lt: ['$dueDate', now] }, '$total', 0] } } } },
        ]),
        Brand.find({ _id: { $in: [...new Set(items.map((t) => t.brandId).filter(Boolean).map(String))] } }).select('name').lean(),
    ]);
    const o = new Map(orders.map((r) => [String(r._id), r]));
    const w = new Map(owed.map((r) => [String(r._id), r]));
    const b = new Map(brands.map((x) => [String(x._id), x.name]));
    for (const t of items) {
        const k = String(t._id);
        const ord = o.get(k); const due = w.get(k);
        const lastOrderAt = ord?.last || null;
        // quiet: live, open, and nothing ordered for 14 days (or never since going live 14+ days ago)
        const ref = lastOrderAt || t.billing?.goLiveAt || null;
        const quiet = !!t.billing?.isLive && t.status === 'active' && !!ref && now.getTime() - new Date(ref).getTime() > QUIET_DAYS * DAY;
        out.set(k, {
            ordersToday: ord?.today || 0, lastOrderAt, quiet,
            owed: round2(due?.total), overdue: round2(due?.overdue), bills: due?.bills || 0,
            brandName: t.brandId ? b.get(String(t.brandId)) || null : null,
        });
    }
    return out;
}

module.exports = { forShops };
