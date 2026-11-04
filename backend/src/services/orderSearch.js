// One search box for every order of every shop. Type several words and each one must fit, in any order:
//   "savera cancelled today"   "ramesh 450"   "paneer upi"   "SAV-1042"   "98765"   "rider suresh delivered"   "2026-11-04"
// A word can be a status, an order type, how it was paid, a day, an order number or reference, a phone (or part of one),
// an amount, or any text: shop, customer, dish, address, landmark, coupon, note, rider, Razorpay payment id.
// Returns a Mongo filter piece ({ $and: [...] }) to merge into the orders query, or null when there is nothing to search for.
const Tenant = require('../models/Tenant');
const User = require('../models/User');

const IST = 330 * 60000;
const DAY = 86400000;
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const startOfDay = (ms) => { const d = new Date(ms + IST); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - IST); };

const STATUS = {
    new: ['placed'], placed: ['placed'], accepted: ['accepted'], preparing: ['preparing'], cooking: ['preparing'], ready: ['ready'],
    delivered: ['delivered'], complete: ['delivered'], completed: ['delivered'], cancelled: ['cancelled'], canceled: ['cancelled'],
    undelivered: ['undelivered'], failed_delivery: ['undelivered'],
    active: ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery'], running: ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery'],
    ontheway: ['out_for_delivery'], 'on-the-way': ['out_for_delivery'], dispatched: ['out_for_delivery'],
};
const TYPE = { delivery: 'delivery', pickup: 'pickup', takeaway: 'pickup', dinein: 'dine_in', 'dine-in': 'dine_in', dine: 'dine_in', table: 'dine_in' };
const PAY = {
    cod: { 'payment.method': 'cod' }, cash: { 'payment.method': 'cod' }, upi: { 'payment.method': 'upi' }, card: { 'payment.method': 'card' }, wallet: { 'payment.method': 'wallet' },
    online: { 'payment.method': { $ne: 'cod' } }, paid: { 'payment.status': 'paid' }, unpaid: { 'payment.status': { $in: ['pending', 'failed'] } },
    refunded: { 'payment.status': 'refunded' },
};

// one word -> a Mongo condition (or null when it should be ignored)
async function wordCondition(w, now) {
    const lw = w.toLowerCase();
    if (STATUS[lw]) return { status: { $in: STATUS[lw] } };
    if (lw === 'on' || lw === 'the' || lw === 'way' || lw === 'of' || lw === 'in' || lw === 'at' || lw === 'rs' || lw === '₹') return null;
    if (TYPE[lw]) return { orderType: TYPE[lw] };
    if (lw === 'bulk') return { bulkId: { $exists: true, $ne: null } };
    if (PAY[lw]) return PAY[lw];
    if (lw === 'pending' || lw === 'failed') return { 'payment.status': lw };
    if (lw === 'today') return { createdAt: { $gte: startOfDay(now) } };
    if (lw === 'yesterday') return { createdAt: { $gte: startOfDay(now - DAY), $lt: startOfDay(now) } };
    if (lw === 'week') return { createdAt: { $gte: new Date(now - 7 * DAY) } };
    if (lw === 'month') return { createdAt: { $gte: new Date(now - 30 * DAY) } };
    if (/^\d{4}-\d{2}-\d{2}$/.test(w)) {
        const d = new Date(`${w}T00:00:00+05:30`);
        if (!Number.isNaN(d.getTime())) return { createdAt: { $gte: d, $lt: new Date(d.getTime() + DAY) } };
    }
    // a reference: SAV-1042, SAV-BK-AB12CD (a prefix is enough)
    if (/^[a-z]{2,6}-[a-z0-9-]+$/i.test(w)) return { $or: [{ ref: new RegExp(`^${esc(w)}${/^[a-z]{2,6}-\d+$/i.test(w) ? '$' : ''}`, 'i') }, { bulkCode: new RegExp(`^${esc(w.replace(/^[a-z]+-bk-/i, ''))}`, 'i') }] };

    const digits = w.replace(/\D/g, '');
    const rx = new RegExp(esc(w.replace(/^#/, '')), 'i');
    const or = [];
    if (/^#?\d{1,9}$/.test(w)) {
        const n = Number(w.replace('#', ''));
        or.push({ orderNo: n }, { 'pricing.total': n }, { 'address.pincode': String(n) }, { ref: new RegExp(`-${n}$`) });
    } else if (/^[₹]?\d+(\.\d{1,2})?$/.test(w)) {
        or.push({ 'pricing.total': Number(w.replace('₹', '')) });
    }
    if (digits.length >= 4 && /^[\d+\-\s()]+$/.test(w)) {
        const prx = new RegExp(digits.slice(-10));
        or.push({ 'customer.phone': prx }, { 'address.phone': prx });
    }
    if (/^[a-z0-9_]{6,}$/i.test(w) && /pay_/i.test(w)) or.push({ 'payment.paymentId': rx });

    if (!/^\d+$/.test(w) || w.length >= 3) {
        const [shops, people] = await Promise.all([
            Tenant.find({ $or: [{ name: rx }, { slug: rx }, { refCode: new RegExp(`^${esc(w)}$`, 'i') }] }).select('_id').limit(60).lean(),
            w.length >= 3 ? User.find({ $or: [{ name: rx }, ...(digits.length >= 4 ? [{ phone: new RegExp(digits) }] : [])] }).select('_id').limit(60).lean() : [],
        ]);
        if (shops.length) or.push({ tenantId: { $in: shops.map((s) => s._id) } });
        if (people.length) or.push({ 'delivery.riderId': { $in: people.map((p) => p._id) } }, { userId: { $in: people.map((p) => p._id) } });
        or.push(
            { 'customer.name': rx }, { 'items.name': rx }, { 'pricing.couponCode': rx }, { 'address.line1': rx }, { 'address.line2': rx },
            { 'address.landmark': rx }, { 'address.city': rx }, { 'address.name': rx }, { note: rx }, { foodNote: rx }, { tableNo: rx },
        );
    }
    return or.length ? { $or: or } : null;
}

async function filter(q, now = Date.now()) {
    const words = String(q || '').trim().slice(0, 100).split(/\s+/).filter(Boolean).slice(0, 8);
    if (!words.length) return null;
    const conds = [];
    for (const w of words) {
        const c = await wordCondition(w, now);
        if (c) conds.push(c);
    }
    return conds.length ? { $and: conds } : null;
}

module.exports = { filter };
