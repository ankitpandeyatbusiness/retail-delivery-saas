// Change what a person is inside ONE shop: customer, rider or owner ("admin").
// Used by the superadmin routes. A superadmin is not a shop role: see routes/adminTeamRouter.js.
//
// Rules, all checked here so every caller gets them:
//   - a blocked person must be unblocked first
//   - nobody with an order in progress (as customer or as rider) can be moved
//   - leaving "rider" removes the rider profile; entering "rider" creates one
//   - his logins end, so the app opens in the right mode when he signs in again
const User = require('../models/User');
const Rider = require('../models/Rider');
const Order = require('../models/Order');
const Session = require('../models/Session');
const { ACTIVE_STATUSES } = require('./orderflow');
const { hashPhone } = require('../utils/phoneHash');
const { httpError } = require('../middlewares/apiErrors');

const ROLES = ['customer', 'rider', 'admin'];
const PHONE_RE = /^[6-9]\d{9}$/;

async function busyWithOrders(tenantId, userId) {
    return !!(await Order.exists({
        tenantId,
        status: { $in: ACTIVE_STATUSES },
        $or: [{ userId }, { 'delivery.riderId': userId }],
    }));
}

// user: a plain User document of this shop (lean or toObject)
async function changeRole({ tenantId, user, role }) {
    if (!ROLES.includes(role)) throw httpError(400, `role must be one of: ${ROLES.join(', ')}`);
    if (user.role === role) return { user, unchanged: true };
    if (user.isBlocked) throw httpError(409, 'This person is blocked. Unblock them first.');
    if (await busyWithOrders(tenantId, user._id)) {
        throw httpError(409, 'This person has an order in progress. Try again after it is delivered or cancelled.');
    }

    let updated;
    try {
        updated = await User.findOneAndUpdate(
            { _id: user._id, tenantId },
            { $set: { role, phoneHash: user.phoneHash || hashPhone(tenantId, user.phone) } },
            { returnDocument: 'after' },
        ).lean();
    } catch (e) {
        if (e.code === 11000) throw httpError(409, 'This number already has another account in this shop');
        throw e;
    }
    if (!updated) throw httpError(404, 'User not found');

    if (user.role === 'rider') await Rider.deleteOne({ tenantId, userId: user._id });   // no longer a rider
    if (role === 'rider') {
        await Rider.findOneAndUpdate(
            { tenantId, userId: user._id },
            { $set: { isActive: true, ...(user.name ? { name: user.name } : {}) } },
            { upsert: true, setDefaultsOnInsert: true },
        );
    }
    await Session.deleteMany({ userId: user._id, tenantId });
    return { user: updated, unchanged: false };
}

// For a phone that may not exist in the shop yet (used when a superadmin steps down into a shop role)
async function setRoleByPhone({ tenantId, phone, role, name }) {
    if (!PHONE_RE.test(phone)) throw httpError(400, 'Invalid phone');
    if (!ROLES.includes(role)) throw httpError(400, `role must be one of: ${ROLES.join(', ')}`);
    let user = await User.findOne({ tenantId, phone }).lean();
    if (!user) {
        user = (await User.create({ tenantId, phone, role: 'customer', phoneHash: hashPhone(tenantId, phone), ...(name ? { name } : {}) })).toObject();
    }
    return changeRole({ tenantId, user, role });
}

module.exports = { changeRole, setRoleByPhone, ROLES };
