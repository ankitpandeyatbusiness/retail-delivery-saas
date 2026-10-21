// A one-line answer to "what will this shop pay next, and for which month?", for the super admin's shop list and the shop page.
// Everything comes from the same rules the real bills use (utils/billingRules.js): the shop's own free orders / free months / fixed fee / order tiers when
// the supreme admin gave it its own plan, else the platform's. Nothing here is saved or billed; it only reads.
//
//   rent = {
//     stage:   'not_live' | 'free' | 'paying' | 'grace' | 'paused'
//     custom:  true when this shop has its own plan (free orders, free months, a fixed fee or its own tiers)
//     plan:    'Fixed ₹2,000 a month' | '0 to 305 orders: ₹3,000' ...     (the way this shop is charged)
//     free:    { ordersLeft, freeOrders, freeMonths, endsAt }              while the free service lasts
//     first:   { period }                                                  free: the first month that will be billed (earlier if the free orders run out sooner)
//     next:    { period, orders, fee, gst, total, billedOn }               paying: the month being counted now, what it comes to so far, and when it is billed
//     text:    the short sentence the list shows
//   }
const PlatformSettings = require('../models/PlatformSettings');
const Order = require('../models/Order');
const { resolveFee, freeStatus, resolveTiers, tierTable } = require('../utils/billingRules');
const { periodOf, nextPeriod, firstBillablePeriod } = require('./subscriptionService');
const billable = require('./billableService');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthWord = (period) => { const [y, m] = period.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const dayWord = (d) => { const x = new Date(new Date(d).getTime() + 330 * 60000); return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`; };
const rs = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const isCustom = (t) => {
    const b = t?.billing || {};
    return b.freeOrdersOverride != null || b.freeMonthsOverride != null || b.fixedFeeOverride != null || (Array.isArray(b.tiersOverride) && b.tiersOverride.length > 0);
};

function planWords(tenant, platform) {
    const fixed = tenant?.billing?.fixedFeeOverride;
    if (fixed !== null && fixed !== undefined) return `Fixed ${rs(fixed)} a month`;
    const rows = tierTable(resolveTiers(tenant, platform));
    return rows.map((r) => `${r.label}: ${rs(r.fee)}`).join(' · ');
}

// the shops' orders this month that count for rent (one query for all of them)
async function countsFor(ids, period) {
  const { from, to } = billable.monthRange(period);
  const rows = await Order.aggregate([
      { $match: { tenantId: { $in: ids }, 'billing.billable': true, 'billing.at': { $gte: from, $lt: to } } },
      { $group: { _id: '$tenantId', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

// tenants must carry: _id createdAt billing subscription.gstPercent
async function forShops(tenants, now = new Date()) {
    const out = new Map();
    if (!tenants.length) return out;
    const platform = await PlatformSettings.findById('main').lean();
    const period = periodOf(now);
    const counts = await countsFor(tenants.map((t) => t._id), period);
    const gstOn = !!platform?.business?.gstin;
    for (const t of tenants) {
        const state = t.billing?.state || 'free';
        const free = freeStatus(t, platform, now);
        const custom = isCustom(t);
        const rent = { stage: 'free', custom, plan: planWords(t, platform), free: null, first: null, next: null, text: '' };
        if (!t.billing?.isLive) {
            rent.stage = 'not_live';
            rent.text = 'Not live yet: free, nothing is counted';
        } else if (state === 'paused' || state === 'grace') {
            rent.stage = state;
            rent.text = state === 'paused' ? 'Paused: a rent bill is unpaid' : 'A rent bill is unpaid (grace period)';
        } else if (free.free) {
            rent.stage = 'free';
            rent.free = { ordersLeft: free.ordersLeft, freeOrders: free.freeOrders, freeMonths: free.freeMonths, endsAt: free.endsAt };
            const first = firstBillablePeriod(free.endsAt);
            rent.first = { period: first };
            rent.text = `Free period: ${free.ordersLeft} free orders left, ends by ${dayWord(free.endsAt)}. First rent: ${monthWord(first)}`;
        } else {
            rent.stage = 'paying';
            const orders = counts.get(String(t._id)) || 0;
            const { fee } = resolveFee(t, platform, orders);
            const gstPercent = gstOn ? (t.subscription?.gstPercent ?? 18) : 0;
            const gst = round2((fee * gstPercent) / 100);
            const billedOn = new Date(`${nextPeriod(period)}-01T00:00:00+05:30`);
            rent.next = { period, orders, fee, gst, total: round2(fee + gst), billedOn };
            rent.text = `${monthWord(period)} rent so far: ${rs(fee + gst)} (${orders} orders). Billed on ${dayWord(billedOn)}`;
        }
        out.set(String(t._id), rent);
    }
    return out;
}

module.exports = { forShops, isCustom };
