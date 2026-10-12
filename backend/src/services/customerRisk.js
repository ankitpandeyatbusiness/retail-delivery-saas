// Strikes on a customer's PHONE (by hash, so deleting the account does not remove them).
// 2 strikes block Cash on delivery for that phone in that shop. The owner or superadmin can clear it
// (PATCH /api/shop/customers/:userId/cod-block).
const User = require('../models/User');
const CustomerRisk = require('../models/CustomerRisk');
const { hashPhone } = require('../utils/phoneHash');

const MAX_STRIKES = 2;

// order = the saved order. Returns the new number of strikes, or null if no strike was given.
async function addStrike(order, now = new Date()) {
    const buyer = await User.findById(order.userId).select('role').lean();
    if (buyer?.role === 'admin') return null;   // a shop owner's own test order never gives a strike

    let phoneHash = order.customer?.phoneHash;
    if (!phoneHash && /^\d{10}$/.test(order.customer?.phone || '')) phoneHash = hashPhone(order.tenantId, order.customer.phone);
    if (!phoneHash) return null;

    const row = await CustomerRisk.findOneAndUpdate(
        { tenantId: order.tenantId, phoneHash },
        { $inc: { strikes: 1 } },
        { upsert: true, returnDocument: 'after' },
    );
    if (row.strikes >= MAX_STRIKES && !row.codBlocked) {
        await CustomerRisk.updateOne({ _id: row._id, codBlocked: { $ne: true } }, { $set: { codBlocked: true, codBlockedAt: now } });
    }
    return row.strikes;
}

module.exports = { addStrike, MAX_STRIKES };