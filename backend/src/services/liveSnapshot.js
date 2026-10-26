// The "live" picture of one shop, used by the superadmin panel and the owner panel.
const mongoose = require('mongoose');
const { statusExpr, boardStatusOf } = require('../utils/boardStatus');
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

// What is waiting for the OWNER (the pipeline cards blink for these):
//   accepted      orders he has accepted but not started: he must mark them preparing
//   cookingNoRider  delivery orders being prepared with no rider (nobody accepted): he must assign one by hand
//   ready         ready orders with no rider yet, or waiting 5+ minutes to be handed over
//   roadDue       when each order on the road is due (the app turns the late ones red and counts the minutes)
const READY_WAIT_MS = 5 * 60 * 1000;
async function attention(tenantId, now) {
    const rows = await Order.find({ tenantId, status: { $in: ['accepted', 'preparing', 'ready', 'out_for_delivery'] }, ...HIDE_UNPAID })
        .select('status orderType kitchen.readyAt delivery.riderId delivery.status delivery.dueAt updatedAt').limit(300).lean();
    const out = { accepted: 0, cookingNoRider: 0, ready: 0, roadDue: [], kitchenProblems: 0 };
    for (const raw of rows) {
        const o = { ...raw, status: boardStatusOf(raw) };   // a packed delivery order counts as ready
        const noRider = o.orderType === 'delivery' && (!o.delivery?.riderId || o.delivery?.status === 'rejected');
        if (o.status === 'accepted') out.accepted += 1;
        else if (o.status === 'preparing' && noRider) out.cookingNoRider += 1;
        else if (o.status === 'ready' && (noRider || now.getTime() - new Date(o.updatedAt).getTime() >= READY_WAIT_MS)) out.ready += 1;
        else if (o.status === 'out_for_delivery' && o.delivery?.dueAt) out.roadDue.push(new Date(o.delivery.dueAt).toISOString());
    }
    out.roadDue = out.roadDue.slice(0, 30);
    // a cook told him about a problem and he has not decided yet (the Cooking card blinks)
    out.kitchenProblems = await Order.countDocuments({ tenantId, status: { $in: ['accepted', 'preparing', 'ready'] }, 'kitchen.problem.at': { $exists: true }, 'kitchen.problem.handledAt': { $exists: false } }).catch(() => 0);
    out.look = await require('./orderLook').summary(tenantId);   // orders that need a look once: { count, urgent, top }
    return out;
}

async function build(tenantId, { owner = false } = {}) {
    const now = new Date();
    const day = startOf(now, 'day');
    const month = startOf(now, 'month');

    const [counts, riders, billableToday, billableMonth, revenue, customers, wallet, tenant, feed] = await Promise.all([
        Order.aggregate([
            { $match: { tenantId, status: { $in: ACTIVE_STATUSES }, ...HIDE_UNPAID } },
            { $group: { _id: statusExpr, n: { $sum: 1 } } },
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
        orders: { active, activeTotal: Object.values(active).reduce((a, b) => a + b, 0), attention: await attention(tenantId, now) },
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