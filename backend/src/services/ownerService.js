// Makes a phone the owner (role admin) of one shop or branch. Used by the superadmin "add owner" route and by the brand routes
// (brand owners, branch managers). The phone keeps its history; a customer becomes an owner, a rider or staff must be removed first.
const User = require('../models/User');
const Rider = require('../models/Rider');
const Order = require('../models/Order');
const { ACTIVE_STATUSES } = require('./orderflow');
const brands = require('./brandService');
const { httpError } = require('../middlewares/apiErrors');
const { hashPhone } = require('../utils/phoneHash');

// tenant: the shop document (needs _id and brandId). Returns { userId, alreadyOwner, before }.
async function appoint(tenant, phone) {
    if (!/^[6-9]\d{9}$/.test(String(phone || ''))) throw httpError(400, 'Enter a valid 10-digit mobile number');
    const tenantId = tenant._id;
    await brands.assertOneBranch(tenant, phone);   // one person, one branch (brand owners are the one exception)
    const existing = await User.findOne({ tenantId, phone }).select('role isBlocked').lean();
    if (existing) {
        if (existing.role === 'admin') return { userId: existing._id, alreadyOwner: true, before: { role: existing.role } };
        if (existing.isBlocked) throw httpError(409, 'This number is blocked. Unblock it first, then add it as owner.');
        if (existing.role === 'rider') {
            const [rider, riding] = await Promise.all([
                Rider.findOne({ tenantId, userId: existing._id }).select('isActive').lean(),
                Order.exists({ tenantId, 'delivery.riderId': existing._id, status: { $in: ACTIVE_STATUSES } }),
            ]);
            if (rider?.isActive || riding) {
                throw httpError(409, 'This number is an active rider. Remove the rider first, then add the number as owner.');
            }
        }
        if (existing.role === 'kitchen' || existing.role === 'waiter') throw httpError(409, 'This number is shop staff. Remove them from Staff first, then add the number as owner.');
        const busy = await Order.exists({ tenantId, userId: existing._id, status: { $in: ACTIVE_STATUSES } });
        if (busy) throw httpError(409, 'This person has an order in progress. Try again after it is delivered or cancelled.');
    }
    const u = await User.findOneAndUpdate(
        { tenantId, phone, isBlocked: { $ne: true } },
        { $set: { role: 'admin', phoneHash: hashPhone(tenantId, phone) } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    if (existing?.role === 'rider') await Rider.deleteMany({ tenantId, userId: u._id });   // an owner is not a rider
    return { userId: u._id, alreadyOwner: false, before: existing ? { role: existing.role } : undefined };
}

module.exports = { appoint };
