// The brand owner's "All branches" panel: totals and lists that read every branch of the brand, one row per branch.
// Read only. Changes are made inside one branch (the owner switches to it), never from here.
const Order = require('../models/Order');
const Tenant = require('../models/Tenant');
const { ACTIVE_STATUSES } = require('./orderflow');
const { HIDE_UNPAID } = require('./onlineOrder');
const { httpError } = require('../middlewares/apiErrors');

const IST_MS = 5.5 * 3600000;
const DAY = 86400000;

// today (India) | 7 | 30 | 90 | 2026-10  ->  { from, to, label }
function rangeOf(range, now = new Date()) {
    const r = String(range || 'today');
    const istMidnight = (d) => new Date(Math.floor((d.getTime() + IST_MS) / DAY) * DAY - IST_MS);
    const today = istMidnight(now);
    if (r === 'today') return { from: today, to: new Date(today.getTime() + DAY), label: 'Today' };
    if (/^(7|30|90)$/.test(r)) return { from: new Date(today.getTime() - (Number(r) - 1) * DAY), to: new Date(today.getTime() + DAY), label: `Last ${r} days` };
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(r);
    if (m) {
        const from = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1) - IST_MS);
        const to = new Date(Date.UTC(Number(m[1]), Number(m[2]), 1) - IST_MS);
        return { from, to, label: r };
    }
    throw httpError(400, 'range must be today, 7, 30, 90 or a month like 2026-10');
}

const rupees = (n) => Math.round((Number(n) || 0) * 100) / 100;

// one row per branch + the brand totals
async function overview(brand, range) {
    const { from, to, label } = rangeOf(range);
    const branches = await Tenant.find({ brandId: brand._id }).sort({ createdAt: 1 }).select('slug name branchCity address.city status billing.isLive').lean();
    const ids = branches.map((b) => b._id);
    const [rows, active] = await Promise.all([
        Order.aggregate([
            { $match: { tenantId: { $in: ids }, createdAt: { $gte: from, $lt: to }, ...HIDE_UNPAID } },
            {
                $group: {
                    _id: '$tenantId',
                    orders: { $sum: 1 },
                    delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
                    cancelled: { $sum: { $cond: [{ $in: ['$status', ['cancelled', 'undelivered']] }, 1, 0] } },
                    sales: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, '$pricing.total', 0] } },
                },
            },
        ]),
        Order.aggregate([
            { $match: { tenantId: { $in: ids }, status: { $in: ACTIVE_STATUSES }, ...HIDE_UNPAID } },
            { $group: { _id: '$tenantId', n: { $sum: 1 } } },
        ]),
    ]);
    const by = new Map(rows.map((r) => [String(r._id), r]));
    const act = new Map(active.map((r) => [String(r._id), r.n]));
    const items = branches.map((b) => {
        const r = by.get(String(b._id)) || {};
        const delivered = r.delivered || 0;
        return {
            slug: b.slug, name: b.name, city: b.branchCity || (b.address && b.address.city) || null,
            status: b.status, live: !!(b.billing && b.billing.isLive),
            orders: r.orders || 0, delivered, cancelled: r.cancelled || 0, activeNow: act.get(String(b._id)) || 0,
            sales: rupees(r.sales), avgOrder: delivered ? rupees((r.sales || 0) / delivered) : 0,
        };
    });
    const sum = (k) => items.reduce((s, i) => s + i[k], 0);
    const totals = { orders: sum('orders'), delivered: sum('delivered'), cancelled: sum('cancelled'), activeNow: sum('activeNow'), sales: rupees(sum('sales')) };
    totals.avgOrder = totals.delivered ? rupees(totals.sales / totals.delivered) : 0;
    return { range: label, from, to, branches: items, totals };
}

// orders of every branch (or one) newest first, each labelled with its branch
async function orders(brand, { branch, status, page, limit }) {
    const branches = await Tenant.find({ brandId: brand._id }).select('slug name').lean();
    let scope = branches;
    if (branch) {
        scope = branches.filter((b) => b.slug === String(branch).toLowerCase());
        if (!scope.length) throw httpError(404, 'That branch is not part of your brand');
    }
    const pg = Math.min(Math.max(parseInt(page, 10) || 1, 1), 10000);
    const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
    const filter = { tenantId: { $in: scope.map((b) => b._id) }, ...HIDE_UNPAID };
    if (status === 'active') filter.status = { $in: ACTIVE_STATUSES };
    else if (status) {
        const list = String(status).split(',').filter((s) => ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled', 'undelivered'].includes(s));
        if (!list.length) throw httpError(400, 'Unknown status');
        filter.status = { $in: list };
    }
    const rows = await Order.find(filter).sort({ createdAt: -1 }).skip((pg - 1) * lim).limit(lim + 1)
        .select('tenantId orderNo status orderType pricing.total payment.method payment.status createdAt customer.name bulkCode').lean();
    const hasMore = rows.length > lim;
    if (hasMore) rows.pop();
    const nameOf = new Map(branches.map((b) => [String(b._id), { slug: b.slug, name: b.name }]));
    return {
        page: pg, hasMore,
        items: rows.map((o) => ({
            id: o._id, branch: nameOf.get(String(o.tenantId)), orderNo: o.orderNo, bulkCode: o.bulkCode || null, status: o.status, orderType: o.orderType,
            total: o.pricing && o.pricing.total, payment: o.payment && o.payment.method, paid: !!(o.payment && o.payment.status === 'paid'),
            customer: (o.customer && o.customer.name) || null, createdAt: o.createdAt,
        })),
    };
}

module.exports = { overview, orders, rangeOf };
