// The free start of a brand with branches.
//   - A branch made by the supreme admin gets NO free start of its own (its go-live month is never billed; it is billed from the first full month after go-live),
//     unless the brand's switch "New branches get a free start" is on. Then the free start belongs to the whole BRAND: one shared pool.
//   - The pool starts when the first pooled branch goes live, and ends when the pooled branches TOGETHER reach the free orders (platform default 100),
//     or when the free months (default 2) have passed, whichever is first. Both numbers can be set for one brand.
//   - When it ends, every pooled branch ends its free time at the same moment (billing.freeForceEndedAt), so they all start billing in the same month
//     (the first full month after it), on the usual bill day.
//   - A branch that joins while the pool runs shares what is left; one that joins or goes live after it ended gets no free time.
// Branches made before this switch existed, and existing shops added to a brand, keep their own free period.
const Tenant = require('../models/Tenant');
const Brand = require('../models/Brand');
const PlatformSettings = require('../models/PlatformSettings');
const { httpError } = require('../middlewares/apiErrors');

const NEVER = { orders: 1000000, months: 1200 };   // a pooled branch never ends by itself: the pool ends it

const limitsOf = (brand, platform) => ({
    orders: (brand.freeStart && brand.freeStart.freeOrders) ?? (platform && platform.billing && platform.billing.freeOrders) ?? 100,
    months: (brand.freeStart && brand.freeStart.freeMonths) ?? (platform && platform.billing && platform.billing.freeMonths) ?? 2,
});

const joinPool = (tenantId) => Tenant.updateOne({ _id: tenantId }, { $set: { 'billing.pooled': true, 'billing.freeOrdersOverride': NEVER.orders, 'billing.freeMonthsOverride': NEVER.months } });
const noFreeStart = (tenantId) => Tenant.updateOne({ _id: tenantId }, { $set: { 'billing.pooled': false, 'billing.freeOrdersOverride': 0, 'billing.freeMonthsOverride': 0 } });

// a branch the supreme admin just made
async function applyToNewBranch(brand, tenantId) {
    const fs = brand.freeStart || {};
    if (fs.on && !fs.endedAt) { await joinPool(tenantId); return 'pooled'; }
    await noFreeStart(tenantId);
    return 'none';
}

// the supreme admin switches it on: branches that are still in their free time join the pool; the pool starts at the first go-live
async function enable(brand, { freeOrders, freeMonths } = {}) {
    if (brand.freeStart && brand.freeStart.endedAt) throw httpError(409, 'The free start of this brand has already ended. It cannot be started again.');
    const branches = await Tenant.find({ brandId: brand._id }).select('billing').lean();
    // still in their free time: state free (the default), and the free time not ended
    const joining = branches.filter((t) => ((t.billing && t.billing.state) || 'free') === 'free' && !(t.billing && (t.billing.freeEndedAt || t.billing.freeForceEndedAt)));
    for (const t of joining) await joinPool(t._id);
    const goLives = joining.filter((t) => t.billing && t.billing.isLive && t.billing.goLiveAt).map((t) => new Date(t.billing.goLiveAt).getTime());
    brand.freeStart = {
        ...(brand.freeStart && brand.freeStart.toObject ? brand.freeStart.toObject() : brand.freeStart),
        on: true,
        freeOrders: freeOrders === undefined ? (brand.freeStart && brand.freeStart.freeOrders) : freeOrders,
        freeMonths: freeMonths === undefined ? (brand.freeStart && brand.freeStart.freeMonths) : freeMonths,
        startedAt: goLives.length ? new Date(Math.min(...goLives)) : (brand.freeStart && brand.freeStart.startedAt),
    };
    await brand.save();
    return { joined: joining.length };
}

// the pool of a brand: { orders so far, limits, start, end moment if it should end now }
async function state(brand, platform, now = new Date()) {
    const pooled = await Tenant.find({ brandId: brand._id, 'billing.pooled': true }).select('billing').lean();
    const live = pooled.filter((t) => t.billing && t.billing.isLive && !(t.billing.freeForceEndedAt));
    const limit = limitsOf(brand, platform);
    const orders = live.reduce((s, t) => s + ((t.billing && t.billing.billableCount) || 0), 0);
    const startedAt = brand.freeStart && brand.freeStart.startedAt;
    let endAt = null;
    if (startedAt) {
        const byTime = new Date(startedAt);
        byTime.setUTCMonth(byTime.getUTCMonth() + limit.months);
        if (now >= byTime) endAt = byTime;
    }
    if (!endAt && live.length && orders >= limit.orders) endAt = now;
    return { pooled, live, orders, limit, startedAt, endAt };
}

// End the pool at this moment for every pooled branch. Safe to repeat.
async function end(brand, at) {
    const fresh = await Brand.findOneAndUpdate({ _id: brand._id, 'freeStart.endedAt': { $exists: false } }, { $set: { 'freeStart.endedAt': at } }, { returnDocument: 'after' });
    if (!fresh) return false;   // someone ended it a moment ago
    const pooled = await Tenant.find({ brandId: brand._id, 'billing.pooled': true }).select('billing slug').lean();
    for (const t of pooled) {
        if (t.billing && t.billing.isLive) {
            await Tenant.updateOne({ _id: t._id, 'billing.freeForceEndedAt': { $exists: false } }, { $set: { 'billing.freeForceEndedAt': at } });
        } else {
            await noFreeStart(t._id);   // not live yet: it gets no free time when it goes live
        }
        require('../middlewares/tenantRecognizer').invalidateTenant(t.slug);
    }
    return true;
}

// called from the billing check of a pooled branch: ends the pool when it is time. Returns true when it ended just now.
async function checkFor(tenant, platform, now = new Date()) {
    const id = tenant.brandId || (await Tenant.findById(tenant._id).select('brandId').lean() || {}).brandId;
    if (!id) return false;
    const brand = await Brand.findById(id);
    if (!brand || !brand.freeStart || !brand.freeStart.on || brand.freeStart.endedAt) return false;
    const st = await state(brand, platform, now);
    if (!st.endAt) return false;
    return end(brand, st.endAt);
}

// the supreme admin switches it off: a running pool ends now
async function disable(brand, now = new Date()) {
    if (!brand.freeStart || !brand.freeStart.on) return { ended: false };
    const ended = brand.freeStart.endedAt ? false : await end(brand, now);
    await Brand.updateOne({ _id: brand._id }, { $set: { 'freeStart.on': false } });
    return { ended };
}

// "Go live" of a pooled branch: the first one starts the pool; one that comes after the pool ended gets no free time
async function onGoLive(tenantId, now = new Date()) {
    const t = await Tenant.findById(tenantId).select('brandId billing').lean();
    if (!t || !t.brandId || !(t.billing && t.billing.pooled)) return;
    const brand = await Brand.findById(t.brandId);
    if (!brand || !brand.freeStart) return;
    if (brand.freeStart.endedAt) { await noFreeStart(tenantId); return; }
    if (!brand.freeStart.startedAt) await Brand.updateOne({ _id: brand._id }, { $set: { 'freeStart.startedAt': (t.billing && t.billing.goLiveAt) || now } });
}

// for the Brand page
async function view(brand, now = new Date()) {
    const platform = await PlatformSettings.findById('main').select('billing').lean();
    const fs = brand.freeStart || {};
    const st = await state(brand, platform, now);
    return {
        on: !!fs.on, ended: !!fs.endedAt, endedAt: fs.endedAt || null, startedAt: fs.startedAt || null,
        freeOrders: st.limit.orders, freeMonths: st.limit.months, ordersSoFar: st.orders,
        ordersLeft: Math.max(st.limit.orders - st.orders, 0), branchesInPool: st.pooled.length,
    };
}

module.exports = { applyToNewBranch, enable, disable, checkFor, onGoLive, view, state, joinPool, noFreeStart, NEVER };
