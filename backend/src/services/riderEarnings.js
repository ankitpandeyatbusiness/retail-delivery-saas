// Rider earnings are INFORMATION ONLY (no payout happens here).
// The pay per delivery is a shop setting (settings.riders.payPerDelivery, in rupees). It is copied onto the
// order at delivery (Order.delivery.earnPaise), so a later change of the rate never changes old deliveries.
const Tenant = require('../models/Tenant');
const Order = require('../models/Order');

async function payPerDeliveryPaise(tenantId) {
    const t = await Tenant.findById(tenantId).select('settings.riders.payPerDelivery').lean();
    const v = t?.settings?.riders?.payPerDelivery;
    return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : 0;
}

// today and month are Date objects (start of the India day / month)
async function sums({ tenantId, riderId, today, month }) {
    const [r] = await Order.aggregate([
        { $match: { tenantId, 'delivery.riderId': riderId, status: 'delivered' } },
        {
            $group: {
                _id: null,
                total: { $sum: '$delivery.earnPaise' },
                month: { $sum: { $cond: [{ $gte: ['$deliveredAt', month] }, '$delivery.earnPaise', 0] } },
                today: { $sum: { $cond: [{ $gte: ['$deliveredAt', today] }, '$delivery.earnPaise', 0] } },
            },
        },
    ]);
    return { todayPaise: r?.today || 0, monthPaise: r?.month || 0, totalPaise: r?.total || 0 };
}

module.exports = { payPerDeliveryPaise, sums };