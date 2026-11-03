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
    const brand = await require('../models/Brand').findById(brandId).select('ownerPhones').lean();
    if (brand && (brand.ownerPhones || []).includes(String(phone))) return;   // a brand owner may own every branch
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

// Move one worker (manager, cook, waiter or rider) from one branch of a brand to another.
// Not while the person has live work. The history stays with the old branch; the old record becomes a plain customer.
async function movePerson({ brand, fromTenant, toTenant, userId }) {
    const Rider = require('../models/Rider');
    const Staff = require('../models/Staff');
    const Session = require('../models/Session');
    const riders = require('./riderService');
    const staff = require('./staffService');
    const owners = require('./ownerService');
    if (String(fromTenant._id) === String(toTenant._id)) throw httpError(400, 'Choose a different branch');
    if (String(fromTenant.brandId) !== String(brand._id) || String(toTenant.brandId) !== String(brand._id)) throw httpError(400, 'Both branches must belong to this brand');
    const user = await User.findOne({ _id: userId, tenantId: fromTenant._id }).select('role phone isBlocked name').lean();
    if (!user || !JOB_ROLES.includes(user.role)) throw httpError(404, 'Person not found in that branch');
    if (user.isBlocked) throw httpError(409, 'This person is blocked');
    if ((brand.ownerPhones || []).includes(user.phone)) throw httpError(409, 'A brand owner is not moved. Remove them as brand owner first.');
    const clash = await User.findOne({ tenantId: toTenant._id, phone: user.phone, role: { $in: JOB_ROLES } }).select('_id').lean();
    if (clash) throw httpError(409, 'This number already has a job in the other branch.');

    const back = async () => { /* put the old job back if the new one fails */
        if (user.role === 'rider') await riders.addByPhone({ tenantId: fromTenant._id, phone: user.phone, name: user.name });
        else if (user.role === 'admin') await owners.appoint(fromTenant, user.phone);
        else await staff.add({ tenant: fromTenant, phone: user.phone, name: user.name, role: user.role });
    };
    // leave the old branch (refused while the person has live work)
    if (user.role === 'rider') {
        const row = await Rider.findOne({ tenantId: fromTenant._id, userId }).select('name').lean();
        await riders.remove({ tenantId: fromTenant._id, userId });
        user.name = user.name || (row && row.name);
    } else if (user.role === 'admin') {
        const others = await User.countDocuments({ tenantId: fromTenant._id, role: 'admin', _id: { $ne: userId } });
        const brandOwners = (brand.ownerPhones || []).length;
        if (!others && !brandOwners) throw httpError(409, 'This is the only manager of the branch. Add another manager first.');
        await User.updateOne({ _id: userId }, { $set: { role: 'customer' } });
        await Session.deleteMany({ userId, tenantId: fromTenant._id });
    } else {
        await staff.remove({ tenant: fromTenant, userId });
    }
    // join the new one
    try {
        if (user.role === 'rider') await riders.addByPhone({ tenantId: toTenant._id, phone: user.phone, name: user.name });
        else if (user.role === 'admin') await owners.appoint(toTenant, user.phone);
        else await staff.add({ tenant: toTenant, phone: user.phone, name: user.name, role: user.role });
    } catch (e) {
        await back().catch(() => { });
        throw e;
    }
    return { ok: true, role: user.role, phone: user.phone };
}

// Make every brand owner an owner of this branch (a new or joining branch). Returns the problems instead of throwing.
async function giveOwnersAccess(brand, tenant) {
    const owners = require('./ownerService');
    const problems = [];
    for (const phone of brand.ownerPhones || []) {
        try { await owners.appoint(tenant, phone); } catch (e) { problems.push(`${phone}: ${e.message}`); }
    }
    return problems;
}

module.exports = { movePerson, giveOwnersAccess, assertOneBranch, checklist, ordersThisMonth, JOB_ROLES };
