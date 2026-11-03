// The "All branches" panel, care side: customers, complaints and dish ratings of every branch of the brand (read only).
// Customers are only counted, never listed: the same phone at two branches is one person, and each branch keeps its own customer records.
const Tenant = require('../models/Tenant');
const Order = require('../models/Order');
const User = require('../models/User');
const Complaint = require('../models/Complaint');
const Review = require('../models/Review');
const Product = require('../models/Product');
const { HIDE_UNPAID } = require('./onlineOrder');
const { rangeOf } = require('./brandPanel');
const { httpError } = require('../middlewares/apiErrors');

const branchesOf = (brand) => Tenant.find({ brandId: brand._id }).sort({ createdAt: 1, _id: 1 }).select('slug name').lean();
const pick = (branches, slug) => {
    if (!slug) return branches;
    const one = branches.filter((b) => b.slug === String(slug).toLowerCase());
    if (!one.length) throw httpError(404, 'That branch is not part of your brand');
    return one;
};
const pageOf = (q) => ({
    page: Math.min(Math.max(parseInt(q.page, 10) || 1, 1), 1000),
    limit: Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 50),
});
const byTenant = (rows) => new Map(rows.map((r) => [String(r._id), r.n]));

// per branch: customers, new in the range, ordered in the range; and for the brand: real people (one phone = one person) and how many use 2+ branches
async function customers(brand, range) {
    const { from, to, label } = rangeOf(range);
    const branches = await branchesOf(brand);
    const ids = branches.map((b) => b._id);
    const [total, fresh, active, phones] = await Promise.all([
        User.aggregate([{ $match: { tenantId: { $in: ids }, role: 'customer' } }, { $group: { _id: '$tenantId', n: { $sum: 1 } } }]),
        User.aggregate([{ $match: { tenantId: { $in: ids }, role: 'customer', createdAt: { $gte: from, $lt: to } } }, { $group: { _id: '$tenantId', n: { $sum: 1 } } }]),
        Order.aggregate([
            { $match: { tenantId: { $in: ids }, createdAt: { $gte: from, $lt: to }, ...HIDE_UNPAID } },
            { $group: { _id: { t: '$tenantId', u: '$userId' } } },
            { $group: { _id: '$_id.t', n: { $sum: 1 } } },
        ]),
        User.aggregate([{ $match: { tenantId: { $in: ids }, role: 'customer' } }, { $group: { _id: '$phone', branches: { $addToSet: '$tenantId' } } }]),
    ]);
    const [t, f, a] = [byTenant(total), byTenant(fresh), byTenant(active)];
    const rows = branches.map((b) => ({
        slug: b.slug, name: b.name, customers: t.get(String(b._id)) || 0, newInRange: f.get(String(b._id)) || 0, orderedInRange: a.get(String(b._id)) || 0,
    }));
    const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
    return {
        range: label, branches: rows,
        totals: {
            customers: sum('customers'), newInRange: sum('newInRange'), orderedInRange: sum('orderedInRange'),
            people: phones.length, inMoreThanOneBranch: phones.filter((p) => p.branches.length > 1).length,
        },
    };
}

async function complaints(brand, q) {
    const branches = await branchesOf(brand);
    const scope = pick(branches, q.branch);
    const filter = { tenantId: { $in: scope.map((b) => b._id) } };
    if (q.status) {
        if (!['open', 'in_progress', 'resolved'].includes(q.status)) throw httpError(400, 'Unknown status');
        filter.status = q.status;
    }
    const { page, limit } = pageOf(q);
    const [rows, counts] = await Promise.all([
        Complaint.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit + 1)
            .select('tenantId orderNo bulkCode type text status resolution refundPaise customerName createdAt').lean(),
        Complaint.aggregate([
            { $match: { tenantId: { $in: branches.map((b) => b._id) }, status: { $in: ['open', 'in_progress'] } } },
            { $group: { _id: '$tenantId', n: { $sum: 1 } } },
        ]),
    ]);
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const nameOf = new Map(branches.map((b) => [String(b._id), { slug: b.slug, name: b.name }]));
    const open = byTenant(counts);
    return {
        page, hasMore,
        openByBranch: branches.map((b) => ({ slug: b.slug, name: b.name, open: open.get(String(b._id)) || 0 })),
        items: rows.map((c) => ({
            id: c._id, branch: nameOf.get(String(c.tenantId)), orderNo: c.orderNo, bulkCode: c.bulkCode || null, type: c.type, text: c.text,
            status: c.status, resolution: c.resolution, refundPaise: c.refundPaise || 0, customer: c.customerName || null, createdAt: c.createdAt,
        })),
    };
}

// dish ratings in the range: the average, count and number of low ratings (1 or 2 stars) per branch, and the newest ratings (low=1: only the low ones)
async function reviews(brand, q) {
    const branches = await branchesOf(brand);
    const scope = pick(branches, q.branch);
    const { from, to, label } = rangeOf(q.range || '30');
    const match = { tenantId: { $in: scope.map((b) => b._id) }, createdAt: { $gte: from, $lt: to } };
    if (q.low === '1' || q.low === 'true') match.rating = { $lte: 2 };
    const { page, limit } = pageOf(q);
    const [rows, stats] = await Promise.all([
        Review.find(match).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit + 1).select('tenantId productId rating comment createdAt').lean(),
        Review.aggregate([
            { $match: { tenantId: { $in: branches.map((b) => b._id) }, createdAt: { $gte: from, $lt: to } } },
            { $group: { _id: '$tenantId', avg: { $avg: '$rating' }, n: { $sum: 1 }, low: { $sum: { $cond: [{ $lte: ['$rating', 2] }, 1, 0] } } } },
        ]),
    ]);
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const dishes = new Map((await Product.find({ _id: { $in: rows.map((r) => r.productId) } }).select('name').lean()).map((p) => [String(p._id), p.name]));
    const nameOf = new Map(branches.map((b) => [String(b._id), { slug: b.slug, name: b.name }]));
    const st = new Map(stats.map((s) => [String(s._id), s]));
    const all = stats.reduce((a, s) => ({ n: a.n + s.n, w: a.w + s.avg * s.n }), { n: 0, w: 0 });
    const one = (n) => Math.round(n * 10) / 10;
    return {
        range: label, page, hasMore,
        branches: branches.map((b) => {
            const s = st.get(String(b._id));
            return { slug: b.slug, name: b.name, average: s ? one(s.avg) : null, count: s ? s.n : 0, low: s ? s.low : 0 };
        }),
        total: { average: all.n ? one(all.w / all.n) : null, count: all.n },
        items: rows.map((r) => ({
            id: r._id, branch: nameOf.get(String(r.tenantId)), dish: dishes.get(String(r.productId)) || null, rating: r.rating, comment: r.comment || null, createdAt: r.createdAt,
        })),
    };
}

module.exports = { customers, complaints, reviews };
