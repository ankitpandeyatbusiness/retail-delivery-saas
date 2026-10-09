require('dotenv').config();
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Address = require('../models/Address');

(async () => {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    const t = await Tenant.findOne({ slug: 'savera' }).lean();
    console.log('Tenant keys:', Object.keys(t));
    console.log('Shop location fields:', JSON.stringify({
        location: t.location, address: t.address, deliveryArea: t.deliveryArea, settings: t.settings && t.settings.deliveryArea
    }));
    const u = await User.findOne({ tenantId: t._id, phone: '8318538918' }).lean();
    const a = await Address.findOne({ tenantId: t._id, userId: u._id }).lean();
    console.log('Address:', JSON.stringify(a));
    await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });