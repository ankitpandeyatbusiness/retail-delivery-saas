// Refer a friend (the owner switches it on in Dine in settings).
//   - every guest has a short code; a NEW guest types it once
//   - the friend gets an offer on his first table order (dineOffers: kind "friend", the best offer wins as usual)
//   - when that first meal is paid, the referrer is given points (the shop's points system: they arrive after its waiting time)
const User = require('../models/User');
const Order = require('../models/Order');
const Referral = require('../models/Referral');
const { hashPhone } = require('../utils/phoneHash');
const { DEFAULTS } = require('./tenantConfigService');

const fail = (status, message) => Object.assign(new Error(message), { status });
const tell = (event, ctx) => Promise.resolve().then(() => require('../notifications/center').notify(event, ctx)).catch((e) => console.error('Notification error:', e.message));
const cfgOf = (tenant) => ({ ...DEFAULTS.orders.dineIn, ...(tenant?.settings?.orders?.dineIn || {}) });
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O or 1/I
const makeCode = () => Array.from({ length: 6 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

async function codeFor(tenantId, userId) {
    const u = await User.findOne({ _id: userId, tenantId }).select('referralCode').lean();
    if (u?.referralCode) return u.referralCode;
    for (let i = 0; i < 8; i += 1) {
        const code = makeCode();
        try {
            const r = await User.updateOne({ _id: userId, tenantId, referralCode: { $exists: false } }, { $set: { referralCode: code } });
            if (r.modifiedCount) return code;
            return (await User.findOne({ _id: userId, tenantId }).select('referralCode').lean())?.referralCode || code;
        } catch (e) { if (e.code !== 11000) throw e; }   // that code is taken: try another
    }
    throw fail(503, 'Could not make your code. Please try again.');
}

// a guest who has ordered before is not "new"
async function hasOrdered(tenant, userId) {
    const u = await User.findById(userId).select('phone').lean();
    const who = u?.phone ? { 'customer.phoneHash': hashPhone(tenant._id, u.phone) } : { userId };
    return !!(await Order.exists({ tenantId: tenant._id, status: { $ne: 'cancelled' }, ...who }));
}

// what the Refer a friend screen shows
async function me({ tenant, userId }) {
    const d = cfgOf(tenant);
    if (!d.enabled || !d.referOn) return { on: false };
    const [code, mine, applied, ordered] = await Promise.all([
        codeFor(tenant._id, userId),
        Referral.find({ tenantId: tenant._id, referrerId: userId }).select('status points').lean(),
        Referral.findOne({ tenantId: tenant._id, friendId: userId }).lean(),
        hasOrdered(tenant, userId),
    ]);
    return {
        on: true, code, friendPercent: d.referFriendPercent, friendMax: d.referFriendMax, points: d.referPoints,
        joined: mine.length, rewarded: mine.filter((x) => x.status === 'rewarded').length, earned: mine.reduce((n, x) => n + (x.points || 0), 0),
        canApply: !applied && !ordered, applied: !!applied,
    };
}

// a new guest types a friend's code
async function apply({ tenant, userId, code }) {
    const d = cfgOf(tenant);
    if (!d.enabled || !d.referOn) throw fail(400, 'This shop is not running a refer a friend offer');
    const c = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(c)) throw fail(400, 'That code does not look right');
    if (await Referral.exists({ tenantId: tenant._id, friendId: userId })) throw fail(409, 'You have already used a code');
    if (await hasOrdered(tenant, userId)) throw fail(409, 'Codes are for guests who have not ordered here before');
    const ref = await User.findOne({ tenantId: tenant._id, referralCode: c }).select('_id name').lean();
    if (!ref) throw fail(404, 'We could not find that code');
    if (String(ref._id) === String(userId)) throw fail(400, 'You cannot use your own code');
    try { await Referral.create({ tenantId: tenant._id, referrerId: ref._id, friendId: userId, code: c }); } catch (e) {
        if (e.code === 11000) throw fail(409, 'You have already used a code');
        throw e;
    }
    return { ok: true, friendPercent: d.referFriendPercent, friendMax: d.referFriendMax };
}

// does this guest have a code waiting to be used on his first table order
const hasFriendCode = (tenantId, userId) => Referral.exists({ tenantId, friendId: userId, status: 'applied' });

// his first meal was paid: the referrer is given points, once
async function onVisitPaid({ tenantId, userId, orderId, orderNo }) {
    const r = await Referral.findOneAndUpdate({ tenantId, friendId: userId, status: 'applied' }, { $set: { status: 'rewarded', rewardedAt: new Date() } });
    if (!r) return null;
    const Tenant = require('../models/Tenant');
    const tenant = await Tenant.findById(tenantId).select('settings').lean();
    const d = cfgOf(tenant);
    const given = await Referral.countDocuments({ tenantId, referrerId: r.referrerId, status: 'rewarded', _id: { $ne: r._id } });
    if (!d.referOn || given >= d.referLimit) return null;   // the shop's limit per guest: the friend still got his offer
    const loyalty = require('./loyaltyService');
    const e = await loyalty.grant({ tenantId, userId: r.referrerId, orderId, orderNo, reason: 'referral', points: d.referPoints, note: 'A friend you referred' });
    if (!e) return null;
    await Referral.updateOne({ _id: r._id }, { $set: { points: d.referPoints } });
    const friend = await User.findById(userId).select('name').lean();
    tell('referral_reward', { tenantId, userId: r.referrerId, vars: { friend: friend?.name || 'Your friend', points: d.referPoints }, data: { kind: 'referral' } });
    return { points: d.referPoints };
}

module.exports = { codeFor, me, apply, hasFriendCode, onVisitPaid };
