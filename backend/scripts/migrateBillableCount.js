// Moves your EXISTING data to the new billing rules. Run it ONCE, BEFORE you start the server with batch E1.
//   node scripts/migrateBillableCount.js            -> dry run, only prints what it would change
//   node scripts/migrateBillableCount.js --apply    -> writes the changes
// 1. every shop: billableCount = the old deliveredCount
// 2. every delivered order: marked billable (at = the day it was delivered), so old months still count
// 3. shops that were already running (they have delivered orders or a go-live date) are marked LIVE.
//    The others stay "not live" and are free until you press Go live.
// Safe to run twice. Nothing is deleted. updatedAt dates are not touched.
if (require.main === module) require('dotenv').config();

const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');

const NEED_COUNTER = { 'billing.billableCount': { $exists: false } };
const NEED_ORDERS = { status: 'delivered', deliveredAt: { $exists: true }, 'billing.billable': { $ne: true } };
const NEED_LIVE = {
    'billing.isLive': { $exists: false },
    $or: [{ 'billing.deliveredCount': { $gt: 0 } }, { 'billing.goLiveAt': { $exists: true } }],
};

async function migrate({ apply = false } = {}) {
    const todo = {
        tenants: await Tenant.countDocuments(NEED_COUNTER),
        orders: await Order.countDocuments(NEED_ORDERS),
        live: await Tenant.countDocuments(NEED_LIVE),
    };
    if (!apply) return todo;

    const opts = { timestamps: false, updatePipeline: true };
    await Tenant.updateMany(NEED_COUNTER, [{ $set: { 'billing.billableCount': { $ifNull: ['$billing.deliveredCount', 0] } } }], opts);
    await Order.updateMany(NEED_ORDERS, [{ $set: { 'billing.billable': true, 'billing.at': '$deliveredAt', 'billing.reason': 'delivered' } }], opts);
    await Tenant.updateMany(NEED_LIVE, [{
        $set: { 'billing.isLive': true, 'billing.goLiveAt': { $ifNull: ['$billing.goLiveAt', '$createdAt'] } },
    }], opts);
    return todo;
}

module.exports = { migrate };

if (require.main === module) {
    const mongoose = require('mongoose');
    const connectDB = require('../src/database/database');
    const apply = process.argv.includes('--apply');
    (async () => {
        await connectDB();
        const r = await migrate({ apply });
        console.log(`${apply ? 'Updated' : 'Would update'}: ${r.tenants} shop counter(s), ${r.orders} delivered order(s), ${r.live} shop(s) marked live.`);
        if (!apply) console.log('Run again with --apply to save.');
        await mongoose.disconnect();
        process.exit(0);
    })().catch((e) => { console.error(e); process.exit(1); });
}