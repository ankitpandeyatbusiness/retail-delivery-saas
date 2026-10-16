// The "live" picture of one shop, used by the superadmin panel and the owner panel.
const mongoose = require('mongoose');
const liveTracking = require('./liveTracking');
const Order = require('../models/Order');
const Rider = require('../models/Rider');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const SmsWallet = require('../models/SmsWallet');
const { ACTIVE_STATUSES } = require('./orderflow');
const liveFeed = require('./liveFeed');
const { HIDE_UNPAID } = require('./onlineOrder');

const IST_MS = 330 * 60 * 1000;
// start of today / this month in Indian time
function startOf(now, unit) {
    const t = new Date(now.getTime() + IST_MS);
    if (unit === 'month') t.setUTCDate(1);
    t.setUTCHours(0, 0, 0, 0);
    return new Date(t.getTime() - IST_MS);
}

async function build(tenantId, { owner = false } = {}) {
    const now = new Date();
    const day = startOf(now, 'day');
    const month = startOf(now, 'month');

    const [counts, riders, billableToday, billableMonth, revenue, customers, wallet, tenant, feed] = await Promise.all([
        Order.aggregate([
            { $match: { tenantId, status: { $in: ACTIVE_STATUSES }, ...HIDE_UNPAID } },
            { $group: { _id: '$status', n: { $sum: 1 } } },
        ]),
        Rider.find({ tenantId, isActive: true, $or: [{ isOnline: true }, { activeOrderCount: { $gt: 0 } }] })
            .select('userId name isOnline activeOrderCount lastLocation').lean(),
        Order.countDocuments({ tenantId, 'billing.billable': true, 'billing.at': { $gte: day } }),
        Order.countDocuments({ tenantId, 'billing.billable': true, 'billing.at': { $gte: month } }),
        // revenue = food + packaging - discount, of orders delivered today
        Order.aggregate([
            { $match: { tenantId, status: 'delivered', deliveredAt: { $gte: day } } },
            {
                $group: {
                    _id: null,
                    total: {
                        $sum: {
                            $subtract: [
                                { $add: [{ $ifNull: ['$pricing.subtotal', 0] }, { $ifNull: ['$pricing.packagingCharge', 0] }] },
                                { $ifNull: ['$pricing.discount', 0] },
                            ]
                        }
                    },
                }
            },
        ]),
        User.countDocuments({ tenantId, role: 'customer' }),
        SmsWallet.findOne({ tenantId }).select('balancePaise').lean(),
        Tenant.findById(tenantId).select('billing.state').lean(),
        liveFeed.recent(tenantId, { owner, limit: 50 }),
    ]);

    // complaints arrive in a later batch; until then the number is 0
    const Complaint = mongoose.models.Complaint;
    const openComplaints = Complaint ? await Complaint.countDocuments({ tenantId, status: { $in: ['open', 'in_progress'] } }) : 0;

    const active = Object.fromEntries(counts.map((c) => [c._id, c.n]));
    return {
        at: now,
        orders: { active, activeTotal: Object.values(active).reduce((a, b) => a + b, 0) },
        riders: riders.map((r) => ({
            riderId: r.userId, name: r.name || null, isOnline: !!r.isOnline, activeOrderCount: r.activeOrderCount || 0,
            location: (() => { const p = liveTracking.newest(r.userId, r.lastLocation); return p?.at ? { lat: p.lat, lng: p.lng, at: p.at } : null; })(),
        })),
        billable: { today: billableToday, month: billableMonth },
        revenueToday: Math.round((revenue[0]?.total || 0) * 100) / 100,   // rupees
        customers,
        sms: { balancePaise: wallet?.balancePaise || 0 },
        billingState: tenant?.billing?.state || null,
        openComplaints,
        feed,
    };
}

module.exports = { build, startOf };