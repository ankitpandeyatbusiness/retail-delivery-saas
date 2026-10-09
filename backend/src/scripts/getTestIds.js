require('dotenv').config();
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const Product = require('../models/Product');
const User = require('../models/User');
const Address = require('../models/Address');

(async () => {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    const t = await Tenant.findOne({ slug: 'savera' });
    if (!t) throw new Error('savera not found');

    const p = await Product.findOne({ tenantId: t._id, name: 'Butter Naan' }).lean();
    console.log('Product id (Butter Naan, price ' + (p && p.price) + '):', p && String(p._id));

    const u = await User.findOne({ tenantId: t._id, phone: '8318538918' }).lean();
    const a = u && await Address.findOne({ tenantId: t._id, userId: u._id }).lean();
    console.log('Address id:', a ? String(a._id) : 'NOT FOUND for this customer');

    await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });