// Rider management for one shop: add by phone, list, switch on/off, remove.
const User = require('../models/User');
const Rider = require('../models/Rider');
const Order = require('../models/Order');
const Session = require('../models/Session');
const { ACTIVE_STATUSES } = require('./orderflow');
const { httpError } = require('../middlewares/apiErrors');

const PHONE_RE = /^[6-9]\d{9}$/;
const WITH_RIDER = ['assigned', 'accepted', 'picked_up'];

// Makes this phone a rider. An owner (admin) phone is never changed.
async function addByPhone({ tenantId, phone, name }) {
    phone = String(phone || '').trim();
    if (!PHONE_RE.test(phone)) throw httpError(400, 'Enter a valid 10-digit mobile number');

    const existing = await User.findOne({ tenantId, phone }).select('role isBlocked').lean();
    if (existing?.role === 'admin') throw httpError(409, 'This number belongs to the shop owner. Use another number.');
    if (existing?.isBlocked) throw httpError(409, 'This number is blocked');

    let user;
    try {
        user = await User.findOneAndUpdate(
            { tenantId, phone, role: { $ne: 'admin' } },     // the filter also protects against a race with an owner
            { $set: { role: 'rider' } },
            { upsert: true, new: true, setDefaultsOnInsert: true },
        );
    } catch (e) {
        if (e.code === 11000) throw httpError(409, 'This number belongs to the shop owner. Use another number.');
        throw e;
    }

    const set = { isActive: true };                          // adding again switches him back on
    const clean = typeof name === 'string' ? name.trim().slice(0, 80) : '';
    if (clean) set.name = clean;
    const rider = await Rider.findOneAndUpdate(
        { tenantId, userId: user._id },
        { $set: set },
        { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return { userId: user._id, phone, rider };
}

async function update({ tenantId, userId, isActive, name }) {
    const set = {};
    if (isActive !== undefined) {
        if (typeof isActive !== 'boolean') throw httpError(400, 'isActive must be true or false');
        set.isActive = isActive;
        if (!isActive) {
            set.isOnline = false;
            const busy = await Order.exists({
                tenantId, 'delivery.riderId': userId, status: { $in: ACTIVE_STATUSES }, 'delivery.status': { $in: WITH_RIDER },
            });
            if (busy) throw httpError(409, 'This rider has active orders. Reassign them first.');
        }
    }
    if (name !== undefined) set.name = String(name).trim().slice(0, 80);
    if (!Object.keys(set).length) throw httpError(400, 'Nothing to update');

    const rider = await Rider.findOneAndUpdate({ tenantId, userId }, { $set: set }, { new: true });
    if (!rider) throw httpError(404, 'Rider not found');
    return rider;
}

async function remove({ tenantId, userId }) {
    const rider = await Rider.findOne({ tenantId, userId });
    if (!rider) throw httpError(404, 'Rider not found');

    const busy = await Order.exists({
        tenantId, 'delivery.riderId': userId, status: { $in: ACTIVE_STATUSES }, 'delivery.status': { $in: WITH_RIDER },
    });
    if (busy) throw httpError(409, 'This rider has active orders. Reassign them first.');

    await Rider.deleteOne({ _id: rider._id });
    await User.updateOne({ _id: userId, tenantId, role: 'rider' }, { $set: { role: 'customer' } });
    await Session.deleteMany({ userId, tenantId });          // logs him out; he can sign in again as a customer
    return { ok: true };
}

// riders with live status and their active orders
async function list(tenantId) {
    const riders = await Rider.find({ tenantId }).sort({ createdAt: 1 }).lean();
    const ids = riders.map((r) => r.userId);
    const [users, orders] = await Promise.all([
        User.find({ _id: { $in: ids }, tenantId }).select('phone').lean(),
        Order.find({
            tenantId, 'delivery.riderId': { $in: ids }, status: { $in: ACTIVE_STATUSES }, 'delivery.status': { $in: WITH_RIDER },
        }).select('orderNo status delivery.riderId delivery.status').lean(),
    ]);
    const phoneOf = new Map(users.map((u) => [String(u._id), u.phone]));
    const byRider = new Map();
    for (const o of orders) {
        const k = String(o.delivery.riderId);
        if (!byRider.has(k)) byRider.set(k, []);
        byRider.get(k).push({ id: o._id, orderNo: o.orderNo, status: o.status, deliveryStatus: o.delivery.status });
    }
    return riders.map((r) => ({
        userId: r.userId, name: r.name || null, phone: phoneOf.get(String(r.userId)) || null,
        isActive: r.isActive, isOnline: r.isOnline, vehicle: r.vehicle || null, photo: r.photo || null,
        lastLocation: r.lastLocation || null, activeOrderCount: r.activeOrderCount,
        ratingAvg: r.ratingAvg, ratingCount: r.ratingCount,
        activeOrders: byRider.get(String(r.userId)) || [],
    }));
}

module.exports = { addByPhone, update, remove, list };