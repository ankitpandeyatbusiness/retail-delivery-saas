// One-time fix: drops the old coupon index so Mongoose can create the new one.
//   node scripts/fixCouponIndex.js
// Safe to run twice.
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../database/database');
const Coupon = require('../models/Coupon');

(async () => {
    await connectDB();
    try {
        await Coupon.collection.dropIndex('tenantId_1_code_1');
        console.log('Old index dropped.');
    } catch (e) {
        console.log('Nothing to drop:', e.message);
    }
    await Coupon.syncIndexes();   // creates the new partial index
    console.log('New index created.');
    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });