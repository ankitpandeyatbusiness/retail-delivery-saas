// Run ONCE, with the server stopped:  node src/scripts/migrateBilling.js
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../database/database');
const Order = require('../models/Order');
const Tenant = require('../models/Tenant');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');

(async () => {
    await connectDB();

    // 1. old invoices are monthly ones
    const k = await SubscriptionInvoice.updateMany({ kind: { $exists: false } }, { $set: { kind: 'monthly' } });
    console.log('Invoices marked monthly:', k.modifiedCount);

    // 2. remove the old one-invoice-per-month index, then build the new one
    try {
        await SubscriptionInvoice.collection.dropIndex('tenantId_1_period_1');
        console.log('Old index dropped');
    } catch (e) {
        console.log('Old index not dropped (fine if it was already gone):', e.message);
    }
    await SubscriptionInvoice.createIndexes();
    console.log('New index ready');

    // 3. delivered order counter for every shop, from real orders
    const rows = await Order.aggregate([
        { $match: { status: 'delivered' } },
        { $group: { _id: '$tenantId', n: { $sum: 1 } } },
    ]);
    if (rows.length) {
        await Tenant.bulkWrite(rows.map((r) => ({
            updateOne: { filter: { _id: r._id }, update: { $set: { 'billing.deliveredCount': r.n } } },
        })));
    }
    console.log('Delivered counters set for', rows.length, 'shop(s)');

    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });