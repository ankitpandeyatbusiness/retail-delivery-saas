// Multi-branch, phase 1: the one-person-one-branch rule and the go-live checklist of a branch.
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Order = require('../models/Order');
const { httpError } = require('../middlewares/apiErrors');

const JOB_ROLES = ['admin', 'kitchen', 'waiter', 'rider'];

// A phone may work (owner, cook, waiter, rider) at ONE branch of a brand only. Customers are not limited.
// Does nothing for a shop that is not a branch. Call it before giving a phone a job in `tenant`.
// `tenant` is a shop document or just its id.
async function assertOneBranch(tenant, phone) {
    const tenantId = (tenant && tenant._id) || tenant;
    let brandId = tenant && tenant.brandId;
    if (brandId === undefined && !(tenant && tenant._id && tenant.isNew)) {
        const row = await Tenant.findById(tenantId).select('brandId').lean();
        brandId = row && row.brandId;
    }
    if (!brandId) return;
    const siblings = await Tenant.find({ brandId, _id: { $ne: tenantId } }).select('_id name').lean();
    if (!siblings.length) return;
    const other = await User.findOne({
        tenantId: { $in: siblings.map((t) => t._id) }, phone, role: { $in: JOB_ROLES }, isBlocked: { $ne: true },
    }).select('tenantId').lean();
    if (other) {
        const where = siblings.find((t) => String(t._id) === String(other.tenantId));
        throw httpError(409, `This number already works at ${(where && where.name) || 'another branch'}. One person can work at one branch only.`);
    }
}

// The things a branch needs before it goes live, with a plain yes/no for each.
async function checklist(t) {
    const d = t.delivery || {};
    const location = typeof d.latitude === 'number' && typeof d.longitude === 'number' && d.radiusKm > 0;
    const keys = !!(t.payments && t.payments.enabled && t.payments.keyId);
    const owner = !!(await User.exists({ tenantId: t._id, role: 'admin', isBlocked: { $ne: true } }));
    const live = !!(t.billing && t.billing.isLive);
    return { location, keys, owner, live, ready: location && keys && owner };   // ready = everything but the Go live button itself
}

async function ordersThisMonth(ids) {
    const from = new Date();
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
    const rows = await Order.aggregate([
        { $match: { tenantId: { $in: ids }, createdAt: { $gte: from } } },
        { $group: { _id: '$tenantId', n: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), r.n]));
}

module.exports = { assertOneBranch, checklist, ordersThisMonth, JOB_ROLES };
