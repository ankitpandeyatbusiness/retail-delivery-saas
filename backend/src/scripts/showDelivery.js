require('dotenv').config();
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');

(async () => {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    const t = await Tenant.findOne({ slug: 'savera' }).lean();
    console.log('delivery:', JSON.stringify(t.delivery));
    await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });