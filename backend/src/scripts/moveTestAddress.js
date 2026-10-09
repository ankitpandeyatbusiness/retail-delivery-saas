require('dotenv').config();
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Address = require('../models/Address');

(async () => {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    const t = await Tenant.findOne({ slug: 'savera' }).lean();
    const u = await User.findOne({ tenantId: t._id, phone: '8318538918' }).lean();
    const r = await Address.updateOne(
        { tenantId: t._id, userId: u._id },
        { $set: { latitude: 26.4540, longitude: 80.3319, city: 'Kanpur', pincode: '208001' } }
    );
    console.log('Matched:', r.matchedCount, 'Modified:', r.modifiedCount);
    await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });