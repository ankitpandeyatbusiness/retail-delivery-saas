// How a rider is paid. The owner picks ONE plan for the shop and can give a single rider his own.
//
//   none          paid in hand, the app does not track pay (the rider sees no earnings at all)
//   salary        a fixed amount every day, week or month (information; no per-delivery amount)
//   per_delivery  a fixed amount for each delivery
//   percent       a percent of each order's total
//   distance      a base amount, plus an amount for every km beyond the first few (shop to customer, in a straight line)
//   salary_plus   a salary AND an amount for each delivery
//
// Amounts in a plan are in rupees (like every shop setting). What a delivery earned is copied onto the order at delivery
// (Order.delivery.earnPaise), so changing the plan later never changes old deliveries. Pay is information for the rider
// and the owner; money is only moved by the owner, outside the app (the optional payment records just remember it).
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const Rider = require('../models/Rider');
const Order = require('../models/Order');
const RiderPayout = require('../models/RiderPayout');
const { haversineKm } = require('../utils/geo');

const TYPES = ['none', 'salary', 'per_delivery', 'percent', 'distance', 'salary_plus'];
const EVERY = ['month', 'week', 'day'];
const IST = 330 * 60 * 1000;
const DAY = 86400000;

const oid = (v) => new mongoose.Types.ObjectId(String(v));   // aggregations do not turn text into ids by themselves
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const inRange = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const rs = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

// Checks a plan from the owner's screen. Returns { ok, clean } or { ok: false, errors }. `null` / { type: 'same' } means "use the shop's plan" (for one rider).
function validatePlan(input, { allowSame = false } = {}) {
    if (input === null || input === undefined || input?.type === 'same') {
        return allowSame ? { ok: true, clean: null } : { ok: false, errors: ['pay: choose how riders are paid'] };
    }
    const errors = [];
    const t = input.type;
    if (!TYPES.includes(t)) return { ok: false, errors: [`pay.type: must be one of: ${TYPES.join(', ')}`] };
    const clean = { type: t };
    const need = (key, min, max, label) => {
        if (!inRange(input[key], min, max)) errors.push(`pay.${key}: ${label} must be a number from ${min} to ${max}`);
        else clean[key] = round2(input[key]);
    };
    if (t === 'salary' || t === 'salary_plus') {
        need('salary', 1, 1000000, 'the salary');
        if (!EVERY.includes(input.salaryEvery)) errors.push('pay.salaryEvery: choose day, week or month');
        else clean.salaryEvery = input.salaryEvery;
    }
    if (t === 'per_delivery' || t === 'salary_plus') need('perDelivery', 1, 10000, 'the amount for each delivery');
    if (t === 'percent') need('percent', 0.5, 100, 'the percent');
    if (t === 'distance') {
        need('base', 0, 10000, 'the base amount');
        need('freeKm', 0, 50, 'the free distance');
        need('perKm', 0, 1000, 'the amount per km');
        if (!errors.length && !(clean.base > 0 || clean.perKm > 0)) errors.push('pay: give a base amount or an amount per km');
    }
    return errors.length ? { ok: false, errors } : { ok: true, clean };
}

// the plan that applies: the rider's own, else the shop's, else the old single "pay for each delivery" number, else none
function effectivePlan(shopRiders = {}, rider = null) {
    if (rider?.pay?.type) return rider.pay;
    if (shopRiders?.pay?.type) return shopRiders.pay;
    if (Number.isFinite(shopRiders?.payPerDelivery) && shopRiders.payPerDelivery > 0) return { type: 'per_delivery', perDelivery: shopRiders.payPerDelivery };
    return { type: 'none' };
}

// what ONE delivery pays under a plan (whole paise). totalRupees = the order total, distanceKm = shop to customer (or null)
function earnPaise(plan, { totalRupees = 0, distanceKm = null } = {}) {
    switch (plan?.type) {
        case 'per_delivery':
        case 'salary_plus':
            return Math.round((plan.perDelivery || 0) * 100);
        case 'percent':
            return Math.round(Number(totalRupees) * (plan.percent || 0));   // rupees * percent = paise
        case 'distance': {
            const extra = Number.isFinite(distanceKm) ? Math.max(0, distanceKm - (plan.freeKm || 0)) * (plan.perKm || 0) : 0;
            return Math.round(((plan.base || 0) + extra) * 100);
        }
        default:
            return 0;
    }
}

const describe = (plan) => {
    switch (plan?.type) {
        case 'salary': return `Salary ${rs(plan.salary)} every ${plan.salaryEvery}`;
        case 'per_delivery': return `${rs(plan.perDelivery)} for each delivery`;
        case 'percent': return `${plan.percent}% of each order`;
        case 'distance': return `${rs(plan.base)}${plan.perKm ? ` + ${rs(plan.perKm)} per km after ${plan.freeKm || 0} km` : ''} for each delivery`;
        case 'salary_plus': return `Salary ${rs(plan.salary)} every ${plan.salaryEvery} + ${rs(plan.perDelivery)} for each delivery`;
        default: return 'Paid outside the app';
    }
};

const perDeliveryTypes = ['per_delivery', 'percent', 'distance', 'salary_plus'];
const paysPerDelivery = (plan) => perDeliveryTypes.includes(plan?.type);

// What this delivery earned, worked out when the order ends. notDelivered: the food was collected but did not reach the customer.
async function earnForOrder(order, { notDelivered = false } = {}) {
    if (!order?.delivery?.riderId) return 0;
    const [tenant, rider] = await Promise.all([
        Tenant.findById(order.tenantId).select('settings.riders delivery').lean(),
        Rider.findOne({ tenantId: order.tenantId, userId: order.delivery.riderId }).select('pay').lean(),
    ]);
    if (notDelivered && !tenant?.settings?.riders?.payUndelivered) return 0;
    const plan = effectivePlan(tenant?.settings?.riders, rider);
    const a = order.address || {};
    const from = tenant?.delivery || {};
    const distanceKm = [from.latitude, from.longitude, a.latitude, a.longitude].every(Number.isFinite)
        ? haversineKm(from.latitude, from.longitude, a.latitude, a.longitude) : null;
    return earnPaise(plan, { totalRupees: order.pricing?.total, distanceKm });
}

const istDay = (now) => new Date(Math.floor((now.getTime() + IST) / DAY) * DAY - IST);
const istWeek = (now) => { const d = istDay(now); const dow = (new Date(d.getTime() + IST).getUTCDay() + 6) % 7; return new Date(d.getTime() - dow * DAY); };   // Monday
const istMonth = (now) => new Date(`${new Date(now.getTime() + IST).toISOString().slice(0, 7)}-01T00:00:00+05:30`);

// what he earned: today, this week, this month, and in all (deliveries with pay, from the copy on each order)
async function earned({ tenantId, riderId, since, now = new Date() }) {
    const today = istDay(now); const week = istWeek(now); const month = istMonth(now);
    const [r] = await Order.aggregate([
        { $match: { tenantId: oid(tenantId), 'delivery.riderId': oid(riderId), 'delivery.earnPaise': { $gt: 0 } } },
        { $addFields: { at: { $ifNull: ['$deliveredAt', '$updatedAt'] } } },
        {
            $group: {
                _id: null,
                total: { $sum: '$delivery.earnPaise' },
                sinceTotal: { $sum: since ? { $cond: [{ $gte: ['$at', since] }, '$delivery.earnPaise', 0] } : '$delivery.earnPaise' },
                month: { $sum: { $cond: [{ $gte: ['$at', month] }, '$delivery.earnPaise', 0] } },
                week: { $sum: { $cond: [{ $gte: ['$at', week] }, '$delivery.earnPaise', 0] } },
                today: { $sum: { $cond: [{ $gte: ['$at', today] }, '$delivery.earnPaise', 0] } },
            },
        },
    ]);
    return { todayPaise: r?.today || 0, weekPaise: r?.week || 0, monthPaise: r?.month || 0, totalPaise: r?.total || 0, sinceTrackingPaise: r?.sinceTotal || 0 };
}

const payoutView = (p) => ({ id: p._id, amountPaise: p.amountPaise, kind: p.kind, note: p.note || null, paidAt: p.paidAt, voided: !!p.voidedAt, by: p.by?.label || null });

// everything the rider (and the owner, for one rider) sees about pay
async function moneyFor({ tenantId, riderId, plan, riders = {}, now = new Date(), limit = 20 }) {
    if (plan.type === 'none') return { type: 'none', label: describe(plan), hidden: true };
    const tracked = !!riders.trackPayouts;
    const since = tracked && riders.trackFrom ? new Date(riders.trackFrom) : null;
    const [e, payments, paidRows] = await Promise.all([
        paysPerDelivery(plan) ? earned({ tenantId, riderId, since, now }) : Promise.resolve(null),
        tracked ? RiderPayout.find({ tenantId, riderId }).sort({ paidAt: -1, _id: -1 }).limit(limit).lean() : Promise.resolve([]),
        tracked
            ? RiderPayout.aggregate([
                { $match: { tenantId: oid(tenantId), riderId: oid(riderId), voidedAt: { $exists: false }, kind: { $in: ['earnings', 'advance'] }, ...(since ? { paidAt: { $gte: since } } : {}) } },
                { $group: { _id: null, paid: { $sum: '$amountPaise' } } },
            ])
            : Promise.resolve([]),
    ]);
    const paidPaise = paidRows[0]?.paid || 0;
    return {
        type: plan.type,
        label: describe(plan),
        hidden: false,
        salary: plan.salary ? { amountPaise: Math.round(plan.salary * 100), every: plan.salaryEvery } : null,
        earned: e ? { todayPaise: e.todayPaise, weekPaise: e.weekPaise, monthPaise: e.monthPaise, totalPaise: e.totalPaise } : null,
        tracked,
        paidPaise: tracked && e ? paidPaise : null,
        pendingPaise: tracked && e ? Math.max(0, e.sinceTrackingPaise - paidPaise) : null,
        payments: payments.map(payoutView),
    };
}

module.exports = { TYPES, EVERY, validatePlan, effectivePlan, earnPaise, earnForOrder, describe, paysPerDelivery, earned, moneyFor, payoutView };
