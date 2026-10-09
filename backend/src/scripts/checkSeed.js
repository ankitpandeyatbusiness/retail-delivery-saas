require('dotenv').config();
const mongoose = require('mongoose');
const M = (n) => require(`../src/models/${n}`);
const Tenant = M('Tenant'), User = M('User'), Order = M('Order');

(async () => {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    for (const [slug, phone] of [['savera', '9876500001'], ['sweetcrumbs', '9876500002']]) {
        const t = await Tenant.findOne({ slug });
        if (!t) { console.log(slug, '→ TENANT NOT FOUND'); continue; }
        const u = await User.findOne({ tenantId: t._id, phone });
        const count = u ? await Order.countDocuments({ tenantId: t._id, userId: u._id }) : 0;
        console.log(slug, '→ user', u ? String(u._id) : 'MISSING', '| orders for that user:', count);
        const total = await Order.countDocuments({ tenantId: t._id });
        console.log('   all orders in tenant:', total);
    }
    await mongoose.disconnect();
})();