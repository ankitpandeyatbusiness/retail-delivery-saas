// Platform coupons for plan payments: who can see/use one, checking a typed code, recording the use, and the push to eligible shops.
//   A shop is ELIGIBLE when the coupon is live (active, in its dates, uses left), the shop is on its list (or the list is empty), it has not used it,
//   and it can actually pay inside the window: no paid plan running (none, free, ended, Partner), or its paid plan ends before the coupon does.
const PlatformCoupon = require('../models/PlatformCoupon');
const Tenant = require('../models/Tenant');
const planService = require('./planService');
const { httpError } = require('../middlewares/apiErrors');

const RANK = { partner: 0, growth: 1, pro: 2 };
const NAME = { growth: 'Growth', pro: 'Pro' };
const IST = 5.5 * 3600000;

const cleanCode = (c) => String(c || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
// "2026-11-30" -> the last millisecond of that day in India; and the first moment of a day
const endOfDay = (ymd) => { const [y, m, d] = String(ymd).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - IST); };
const startOfDay = (ymd) => { const [y, m, d] = String(ymd).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - IST); };

const live = (c, now) => c.active && c.startsAt <= now && c.endsAt >= now && (c.maxUses == null || c.usedCount < c.maxUses);

function eligible(c, tenant, now = new Date()) {
    if (!live(c, now)) return false;
    if (c.shops.length && !c.shops.some((id) => String(id) === String(tenant._id))) return false;
    if (c.usedBy.some((u) => String(u.tenantId) === String(tenant._id))) return false;
    const v = planService.viewOf(tenant, now);
    if (v.id && v.id !== 'partner' && v.status === 'active' && v.endsAt) {
        if (v.endsAt > c.endsAt) return false;                                    // its paid time runs past the coupon: nothing to offer now
        if (!c.plans.some((p) => RANK[p] >= RANK[v.id])) return false;            // the coupon is only for a lower plan than the one it holds
    }
    return true;
}

// the coupons this shop can use now, as the cards on the Plan screen
async function cardsFor(tenant, now = new Date()) {
    const list = await PlatformCoupon.find({ active: true, endsAt: { $gte: now }, startsAt: { $lte: now } }).sort({ pct: -1 }).lean();
    return list.filter((c) => eligible(c, tenant, now)).map((c) => ({ id: String(c._id), code: c.code, pct: c.pct, plans: c.plans, months: c.months, endsAt: c.endsAt }));
}

// a typed or tapped code, for this purchase. Throws a plain message when it cannot be used.
async function check(code, tenant, { to, months }, now = new Date()) {
    const c = await PlatformCoupon.findOne({ code: cleanCode(code) }).lean();
    if (!c) throw httpError(400, 'That coupon code is not valid');
    if (!eligible(c, tenant, now)) throw httpError(400, 'This coupon is not available for your shop');
    if (!c.plans.includes(to)) throw httpError(400, 'This coupon does not apply to this plan');
    if (c.months.length && !c.months.includes(Number(months))) throw httpError(400, 'This coupon does not apply to this number of months');
    return c;
}

// a paid payment used the coupon: counted once per payment (the payment row id), inside the payment's transaction
async function redeem(couponId, tenantId, paymentId, pct, session) {
    await PlatformCoupon.updateOne({ _id: couponId, 'usedBy.paymentId': { $ne: String(paymentId) } }, { $inc: { usedCount: 1 }, $push: { usedBy: { tenantId, paymentId: String(paymentId), pct } } }, session ? { session } : {});
}

// every shop that can use this coupon now (brand shops: only the main shop pays, so only it is counted)
async function eligibleShops(c, now = new Date()) {
    const q = { 'closure.on': { $ne: true } };
    if (c.shops.length) q._id = { $in: c.shops };
    const shops = await Tenant.find(q).select('name slug plan brandId').lean();
    const brandPlan = require('./brandPlan');
    const Brand = require('../models/Brand');
    const mains = new Map();
    const out = [];
    for (const t of shops) {
        if (!eligible(c, t, now)) continue;
        if (t.brandId) {
            const key = String(t.brandId);
            if (!mains.has(key)) { const b = await Brand.findById(key); mains.set(key, b ? String(await brandPlan.mainOf(b)) : null); }
            if (mains.get(key) !== String(t._id)) continue;
        }
        out.push(t);
    }
    return out;
}

const dayText = (d) => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });

// the push: one message per eligible shop. title/body are what the supreme admin picked or edited.
async function notify(c, { title, body }, now = new Date()) {
    const center = require('../notifications/center');
    const shops = await eligibleShops(c, now);
    let sent = 0;
    for (const t of shops) {
        try { await center.notify('plan_offer', { tenantId: t._id, title, body, data: { prompt: 'plan', coupon: c.code } }); sent += 1; } catch (e) { /* one shop failing must not stop the rest */ }
    }
    await PlatformCoupon.updateOne({ _id: c._id }, { $set: { notifiedAt: now } });
    return { sent, eligible: shops.length };
}

// ready-made push texts, filled from the coupon (the admin picks one and may edit it)
function textsFor(c) {
    const plan = c.plans.length === 2 ? 'Growth or Pro' : NAME[c.plans[0]] || 'a plan';
    const term = c.months.length === 1 ? `${c.months[0]} months` : c.months.length ? `${c.months.join(' or ')} months` : 'any term';
    const till = dayText(c.endsAt);
    return [
        { title: `${c.pct}% off your plan`, body: `Pay for ${plan} for ${term} and get ${c.pct}% off with code ${c.code}. Valid till ${till}.` },
        { title: 'A special offer for your shop', body: `Use code ${c.code} on the Plan screen and save ${c.pct}% on ${plan} (${term}). Offer ends ${till}.` },
        { title: `Last days: ${c.pct}% off`, body: `Your offer, ${c.pct}% off ${plan} with code ${c.code}, ends on ${till}. Renew now and save.` },
    ];
}

module.exports = { cleanCode, endOfDay, startOfDay, live, eligible, cardsFor, check, redeem, eligibleShops, notify, textsFor };
