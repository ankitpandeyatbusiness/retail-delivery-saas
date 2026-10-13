// The shop rating = the average of ALL dish ratings of the shop. Saved on the shop (Tenant.stats.rating)
// every time a customer rates. The app shows it only from 20 ratings (see MIN_SHOP_RATINGS).
const mongoose = require('mongoose');
const Review = require('../models/Review');
const Tenant = require('../models/Tenant');

async function refresh(tenantId) {
    const id = new mongoose.Types.ObjectId(String(tenantId));
    const [r] = await Review.aggregate([
        { $match: { tenantId: id } },
        { $group: { _id: null, avg: { $avg: '$rating' }, n: { $sum: 1 } } },
    ]);
    const rating = { avg: r ? Math.round(r.avg * 10) / 10 : 0, count: r ? r.n : 0 };
    await Tenant.updateOne({ _id: id }, { $set: { 'stats.rating': rating } });
    return rating;
}

module.exports = { refresh };