// Offers for people eating at the shop. They come by themselves (no code to type), the owner switches each on in Dine in settings:
//   welcome   a customer's first table order            e.g. 10% off, up to Rs 100
//   regular   a customer who has paid for enough visits  e.g. 5% off, up to Rs 50, on every table order
//   happy     a time of day (India time)                 e.g. 15% off from 15:00 to 18:00
// One offer per order: the one that saves the customer the most. A coupon, if he uses one, replaces it.
const Order = require('../models/Order');
const TableSession = require('../models/TableSession');
const User = require('../models/User');
const { hashPhone } = require('../utils/phoneHash');
const { brief } = require('../utils/orderBrief');

const round2 = (n) => Math.round(n * 100) / 100;
const toMin = (t) => { const [h, m] = String(t).split(':'); return Number(h) * 60 + Number(m); };
const istMins = (now) => { const d = new Date(now.getTime() + 330 * 60000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const cut = (subtotal, pct, max) => { let a = (subtotal * pct) / 100; if (max > 0) a = Math.min(a, max); return round2(Math.min(a, subtotal)); };

function happyNow(d, now) {
    if (!d.happyOn || !d.happyFrom || !d.happyTo) return false;
    const f = toMin(d.happyFrom);
    const t = toMin(d.happyTo);
    const m = istMins(now);
    if (f === t) return false;
    return t > f ? m >= f && m < t : m >= f || m < t;
}

// what we know about this customer at this shop
async function facts({ tenant, userId }) {
    const user = await User.findById(userId).select('phone').lean();
    const who = user?.phone ? { 'customer.phoneHash': hashPhone(tenant._id, user.phone) } : { userId };   // by phone: a new account does not bring a second welcome offer
    const [prior, visits] = await Promise.all([
        Order.countDocuments({ tenantId: tenant._id, orderType: 'dine_in', status: { $ne: 'cancelled' }, ...who }),
        TableSession.countDocuments({ tenantId: tenant._id, customers: userId, status: 'closed', walkout: { $ne: true }, paidPaise: { $gt: 0 } }),
    ]);
    const friend = await require('./referral').hasFriendCode(tenant._id, userId).catch(() => false);   // a friend's code is waiting for his first order
    return { prior, visits, friend: !!friend };
}

// the offer this order gets (null if none)
async function best({ tenant, config, userId, subtotal, now = new Date() }) {
    const d = config.orders?.dineIn || {};
    if (!d.enabled || !(d.welcomeOn || d.regularOn || d.happyOn || d.referOn)) return null;
    const f = (d.welcomeOn || d.regularOn || d.referOn) ? await facts({ tenant, userId }) : { prior: 1, visits: 0 };
    const all = [];
    if (d.welcomeOn && f.prior === 0) all.push({ kind: 'welcome', label: 'Welcome offer', amount: cut(subtotal, d.welcomePercent, d.welcomeMax) });
    if (d.referOn && f.friend && f.prior === 0) all.push({ kind: 'friend', label: "Friend's offer", amount: cut(subtotal, d.referFriendPercent, d.referFriendMax) });
    if (d.regularOn && f.visits >= d.regularAfter) all.push({ kind: 'regular', label: 'Regular customer offer', amount: cut(subtotal, d.regularPercent, d.regularMax) });
    if (happyNow(d, now)) all.push({ kind: 'happy', label: 'Happy hour', amount: cut(subtotal, d.happyPercent, d.happyMax) });
    return all.filter((x) => x.amount > 0).sort((a, b) => b.amount - a.amount)[0] || null;
}

// the offers a customer can see before he orders (banners on Home and in the cart)
async function describe({ tenant, config, userId, now = new Date() }) {
    const d = config.orders?.dineIn || {};
    const out = [];
    if (!d.enabled) return out;
    const f = (d.welcomeOn || d.regularOn || d.referOn) ? await facts({ tenant, userId }) : { prior: 1, visits: 0 };
    if (d.referOn && f.friend && f.prior === 0) out.push({ kind: 'friend', text: `${d.referFriendPercent}% off your first table order, a friend's gift${d.referFriendMax > 0 ? ` (up to ₹${d.referFriendMax})` : ''}` });
    if (d.welcomeOn && f.prior === 0) out.push({ kind: 'welcome', text: `${d.welcomePercent}% off your first table order${d.welcomeMax > 0 ? ` (up to ₹${d.welcomeMax})` : ''}` });
    if (d.regularOn && f.visits >= d.regularAfter) out.push({ kind: 'regular', text: `${d.regularPercent}% off every table order, because you are a regular${d.regularMax > 0 ? ` (up to ₹${d.regularMax})` : ''}` });
    if (d.happyOn && d.happyFrom && d.happyTo) {
        const on = happyNow(d, now);
        out.push({ kind: 'happy', on, text: on ? `Happy hour until ${d.happyTo}: ${d.happyPercent}% off${d.happyMax > 0 ? ` (up to ₹${d.happyMax})` : ''}` : `Happy hour ${d.happyFrom} to ${d.happyTo}: ${d.happyPercent}% off` });
    }
    return out;
}

// his usual: what he had at his last meal here (the app puts it in the cart)
async function usual({ tenant, userId }) {
    const o = await Order.findOne({ tenantId: tenant._id, userId, orderType: 'dine_in', status: 'delivered' }).sort({ createdAt: -1 }).lean();
    if (!o) return null;
    return { id: String(o._id), orderNo: o.orderNo, brief: brief(o, 3), count: (o.items || []).length, total: o.pricing?.total || 0 };
}

module.exports = { best, describe, usual, happyNow };
