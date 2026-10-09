require('dotenv').config();
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Session = require('../models/Session');

(async () => {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    const t = await Tenant.findOne({ slug: 'savera' });
    if (!t) throw new Error('savera not found');

    // 1. remove the wrongly created rider-test user
    const bad = await User.findOne({ tenantId: t._id, phone: '9450863962' });
    if (bad) {
        await Session.deleteMany({ userId: bad._id });
        await User.deleteOne({ _id: bad._id });
        console.log('Removed user 9450863962');
    }

    // 2. make 9454326498 an owner of savera
    const r = await User.updateOne({ tenantId: t._id, phone: '9454326498' }, { $set: { role: 'admin' } });
    console.log('Owner update matched:', r.matchedCount);

    await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });