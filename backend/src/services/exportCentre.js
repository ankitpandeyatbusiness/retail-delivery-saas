// The Export centre: every export of the platform works the same way.
//   pick WHAT (customers, orders, rent invoices, payments ...), the SHOPS (all, some, a brand), the PERIOD, the DETAIL LEVEL and the filters of that export.
// Detail levels: quick (the few columns you need every day) -> standard (the working detail) -> everything (all of it, plus a sheet of lines where it helps).
// A dataset is a small description: where the rows come from, which filters it has, and its columns with the level each one first appears at.
// Read-only. Phone numbers are masked unless the supreme admin asked for full ones (the route writes that down).
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Order = require('../models/Order');
const BulkOrder = require('../models/BulkOrder');
const BulkPayment = require('../models/BulkPayment');
const TableBooking = require('../models/TableBooking');
const Brand = require('../models/Brand');
const PlanPayment = require('../models/PlanPayment');
const planWord = (t) => { const v = require('./planService').viewOf(t); return t.plan?.paused ? 'paused' : v.status === 'none' ? 'no plan' : v.status === 'free' ? 'free' : v.id; };
const OnlinePayment = require('../models/OnlinePayment');
const OnlineRefund = require('../models/OnlineRefund');
const SmsTopup = require('../models/SmsTopup');
const SmsLog = require('../models/SmsLog');
const Complaint = require('../models/Complaint');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Expense = require('../models/Expense');
const AuditLog = require('../models/AuditLog');
const { maskPhone } = require('../utils/phoneHash');
const { buildWorkbook } = require('./xlsxExport');
const { httpError } = require('../middlewares/apiErrors');

const MAX_ROWS = 20000;          // an Excel file holds the first 20,000 rows (it is built in memory)
const CSV_MAX = 100000;          // a CSV is plain text, so it can hold five times as many
const IST = 330 * 60000;
const DAY = 86400000;
const LEVELS = { quick: 1, standard: 2, everything: 3 };
const LEVEL_NAME = { quick: 'Quick', standard: 'Standard', everything: 'Everything' };
const rs = (p) => Math.round((Number(p) || 0)) / 100;          // paise -> rupees
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const isId = (v) => mongoose.isValidObjectId(v);
const ref = (o) => (o ? (o.ref || (o.orderNo ? `#${o.orderNo}` : '')) : '');
const nice = (v) => String(v ?? '').replace(/_/g, ' ');
const fmtDay = (d) => (d ? new Date(new Date(d).getTime() + IST).toISOString().slice(0, 10) : '');
const clock = (min) => { const m = Math.round(min) % 1440; const h = Math.floor(m / 60); return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ----- filters from the request -----
const dayStart = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? new Date(`${s}T00:00:00+05:30`) : null);
function periodOf(q) {
    const from = dayStart(q.from);
    const to = dayStart(q.to);
    if (q.from && !from) throw httpError(400, 'The "from" date must look like 2026-11-01');
    if (q.to && !to) throw httpError(400, 'The "to" date must look like 2026-11-30');
    if (from && to && from > to) throw httpError(400, 'The "from" date must not be after the "to" date');
    return { from, to: to ? new Date(to.getTime() + DAY) : null };
}
// the shops asked for: a list of ids, or a brand's branches, or null = every shop
async function scopeOf(q) {
    const ids = [];
    if (q.shops) for (const x of String(q.shops).split(',').filter(Boolean)) { if (!isId(x)) throw httpError(400, 'A shop id is not valid'); ids.push(oid(x)); }
    if (q.brandId) {
        if (!isId(q.brandId)) throw httpError(400, 'The brand id is not valid');
        const t = await Tenant.find({ brandId: q.brandId }).select('_id').lean();
        ids.push(...t.map((x) => x._id));
        if (!t.length && !ids.length) return [];
    }
    return ids.length ? ids : null;
}
const inRange = (field, p) => (p.from || p.to ? { [field]: { ...(p.from ? { $gte: p.from } : {}), ...(p.to ? { $lt: p.to } : {}) } } : {});
const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);

// ----- the datasets -----
// columns: { h: header, k: key, kind, lv: first level it shows at (1 quick, 2 standard, 3 everything), get(doc, ctx) }
const ShopExpense = require('../models/ShopExpense');
const D = {};

// ----- a customer in plain words (the Everything level of the customers export) -----
const MEAL = (min) => (min < 11 * 60 ? 'breakfast time' : min < 16 * 60 ? 'lunch time' : min < 19 * 60 ? 'evening snack time' : min < 23 * 60 ? 'dinner time' : 'late at night');
// new / loyal / regular / occasional / slipping / lapsed / never ordered, from how often and how recently
function customerType(r, now) {
    if (!r.orders) return 'Never ordered';
    const quiet = r.lastAt ? Math.floor((now - new Date(r.lastAt).getTime()) / DAY) : null;
    const age = r.firstAt ? Math.floor((now - new Date(r.firstAt).getTime()) / DAY) : null;
    if (r.isBlocked) return 'Blocked';
    if (quiet !== null && quiet > 60) return 'Lapsed';
    if (quiet !== null && quiet > 30) return 'Slipping away';
    if (age !== null && age <= 30 && r.delivered <= 2) return 'New';
    if (r.delivered >= 8) return 'Loyal';
    if (r.delivered >= 3) return 'Regular';
    return 'Occasional';
}
// how often he orders, in words (days between orders)
function rhythm(every) {
    if (every === null) return '';
    if (every <= 1.5) return 'almost every day';
    if (every <= 4) return 'a few times a week';
    if (every <= 9) return 'about once a week';
    if (every <= 20) return 'every two or three weeks';
    return 'now and then';
}
function behaviour(r, e, c, type, every) {
    if (!r.orders) return 'Joined but has not placed an order yet. A welcome offer may bring the first one.';
    const parts = [];
    const quiet = r.lastAt ? Math.floor((c.now - new Date(r.lastAt).getTime()) / DAY) : null;
    parts.push(`${type} customer: ${r.delivered} order${r.delivered === 1 ? '' : 's'} delivered, ₹${Math.round(r.spent)} spent in all.`);
    if (every !== null) parts.push(`Orders ${rhythm(every)}${r.delivered >= 3 ? ` (about every ${Math.max(1, Math.round(every))} days)` : ''}.`);
    if (e.min != null || e.dow) {
        const when = [];
        if (e.min != null) when.push(`around ${clock(e.min)} (${MEAL(e.min)})`);
        if (e.dow) when.push(`most often on ${WEEKDAY[e.dow - 1]}s`);
        parts.push(`Usually orders ${when.join(', ')}.`);
    }
    if (e.dishes && e.dishes.length) parts.push(`Likes ${e.dishes.map((d, i) => (i === 0 ? `${d[0]} (${d[1]} times)` : d[0])).join(', ')}.`);
    if (r.delivered) {
        const avg = r.spent / r.delivered;
        const rel = r.shopAvg ? avg / r.shopAvg : null;
        parts.push(`Spends about ₹${Math.round(avg)} an order${rel ? (rel >= 1.2 ? ', more than most customers of this shop' : rel <= 0.8 ? ', less than most customers of this shop' : ', like most customers of this shop') : ''}.`);
    }
    const TYPE = { delivery: 'home delivery', pickup: 'pickup', dine_in: 'dining in' };
    const PAY = { cod: 'cash', upi: 'UPI', card: 'card', wallet: 'the wallet', online: 'online' };
    if (e.type || e.pay) parts.push(`Prefers ${[e.type ? TYPE[e.type] || e.type : '', e.pay ? `paying by ${PAY[e.pay] || e.pay}` : ''].filter(Boolean).join(' and ')}.`);
    const bad = r.cancelled + r.noShow;
    if (bad) parts.push(`Cancelled ${r.cancelled} and was not at home ${r.noShow} time${r.noShow === 1 ? '' : 's'} out of ${r.orders} orders${bad / r.orders >= 0.3 ? ': often unreliable' : ''}.`);
    if (e.complaints) parts.push(`Complained ${e.complaints} time${e.complaints === 1 ? '' : 's'}.`);
    if (e.rating) parts.push(`Gives delivery ratings of ${r2(e.rating)} on average.`);
    if (quiet !== null) {
        if (r.prior30 > 0 || r.last30 > 0) parts.push(r.last30 > r.prior30 ? 'More active than last month.' : r.last30 < r.prior30 ? 'Ordering less than last month.' : 'About as active as last month.');
        parts.push(quiet === 0 ? 'Ordered today.' : `Last order ${quiet} day${quiet === 1 ? '' : 's'} ago.`);
    }
    const hint = { Loyal: 'A thank-you offer would keep them.', Regular: 'Keep them happy: they can become loyal.', New: 'Encourage a second order soon.', Occasional: 'A small nudge may bring them back.', 'Slipping away': 'Send a comeback offer now.', Lapsed: 'Probably lost: try one win-back message.', Blocked: 'This customer is blocked.' }[type];
    if (hint) parts.push(hint);
    return parts.join(' ');
}

D.customers = {
    title: 'Customers', group: 'People', hint: 'Who ordered from which shop, how much, how often, and what they like. Everything adds a plain-words summary of each customer.',
    shopField: 'tenantId', periodLabel: 'Joined between', periodOn: true,
    filters: [
        { key: 'status', label: 'Who', options: [['', 'Everyone'], ['ordered', 'Has ordered'], ['never', 'Never ordered'], ['lapsed', 'Quiet for 30+ days'], ['blocked', 'Blocked']] },
        { key: 'minOrders', label: 'At least', options: [['', 'Any orders'], ['2', '2 orders'], ['5', '5 orders'], ['10', '10 orders']] },
    ],
    columns: [
        { h: 'Shop', k: 'shop', lv: 1 }, { h: 'Name', k: 'name', lv: 1 }, { h: 'Phone', k: 'phone', kind: 'center', lv: 1 },
        { h: 'Orders', k: 'orders', kind: 'int', lv: 1 }, { h: 'Total spent (₹)', k: 'spent', kind: 'money', lv: 1 }, { h: 'Last order', k: 'last', kind: 'date', lv: 1 },
        { h: 'Joined', k: 'joined', kind: 'date', lv: 2 }, { h: 'First order', k: 'first', kind: 'date', lv: 2 }, { h: 'Delivered', k: 'delivered', kind: 'int', lv: 2 },
        { h: 'Average order (₹)', k: 'avg', kind: 'money', lv: 2 }, { h: 'Cancelled by him', k: 'cancelled', kind: 'int', lv: 2 }, { h: 'Not at home', k: 'noShow', kind: 'int', lv: 2 },
        { h: 'Days since last order', k: 'quiet', kind: 'int', lv: 2 }, { h: 'Orders in last 30 days', k: 'last30', kind: 'int', lv: 2 }, { h: 'Status', k: 'status', kind: 'status', lv: 2 }, { h: 'Customer type', k: 'ctype', kind: 'center', lv: 2 },
        { h: 'Behaviour in words', k: 'words', kind: 'wide', lv: 3 }, { h: 'Orders every (days)', k: 'every', kind: 'center', lv: 3 }, { h: 'Spend compared to shop', k: 'vsAvg', kind: 'center', lv: 3 }, { h: 'Compared to last month', k: 'trend', kind: 'center', lv: 3 },
        { h: 'Favourite food (times)', k: 'dish1', kind: 'wide', lv: 3 }, { h: '2nd favourite', k: 'dish2', kind: 'wide', lv: 3 }, { h: '3rd favourite', k: 'dish3', kind: 'wide', lv: 3 },
        { h: 'Usual order time', k: 'usualTime', lv: 3 }, { h: 'Favourite day', k: 'day', kind: 'center', lv: 3 }, { h: 'Usual order type', k: 'type', kind: 'center', lv: 3 },
        { h: 'Usually pays by', k: 'pay', kind: 'center', lv: 3 }, { h: 'Avg delivery rating given', k: 'rating', kind: 'center', lv: 3 }, { h: 'Complaints made', k: 'complaints', kind: 'int', lv: 3 },
        { h: 'Blocked', k: 'blocked', kind: 'center', lv: 3 },
    ],
    async fetch(f, ctx) {
        const match = { role: 'customer', ...(ctx.scope ? { tenantId: { $in: ctx.scope } } : {}), ...inRange('createdAt', ctx.period) };
        const after = {};
        if (f.status === 'ordered') after.orders = { $gt: 0 };
        if (f.status === 'never') after.orders = 0;
        if (f.status === 'blocked') after.isBlocked = true;
        if (f.status === 'lapsed') { after.orders = { $gt: 0 }; after.lastAt = { $lt: new Date(ctx.now - 30 * DAY) }; }
        if (Number(f.minOrders) > 0) after.orders = { ...(typeof after.orders === 'object' ? after.orders : {}), $gte: Number(f.minOrders) };
        const base = [
            { $match: match },
            { $lookup: {
                from: Order.collection.name, let: { uid: '$_id' },
                pipeline: [
                    { $match: { $expr: { $eq: ['$userId', '$$uid'] } } },
                    { $group: {
                        _id: null, orders: { $sum: 1 },
                        delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
                        spent: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, { $ifNull: ['$bulkTotal', { $ifNull: ['$pricing.total', 0] }] }, 0] } },
                        cancelled: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'cancelled'] }, { $eq: ['$cancelledBy', 'customer'] }] }, 1, 0] } },
                        noShow: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'undelivered'] }, { $eq: ['$undelivered.reasonCode', 'customer'] }] }, 1, 0] } },
                        last30: { $sum: { $cond: [{ $gte: ['$createdAt', new Date(ctx.now - 30 * DAY)] }, 1, 0] } },
                        prior30: { $sum: { $cond: [{ $and: [{ $gte: ['$createdAt', new Date(ctx.now - 60 * DAY)] }, { $lt: ['$createdAt', new Date(ctx.now - 30 * DAY)] }] }, 1, 0] } },
                        firstAt: { $min: '$createdAt' }, lastAt: { $max: '$createdAt' },
                    } },
                ],
                as: 'st',
            } },
            { $addFields: { st: { $first: '$st' } } },
            { $project: {
                tenantId: 1, name: 1, phone: 1, isBlocked: { $ifNull: ['$isBlocked', false] }, joinedAt: '$createdAt',
                orders: { $ifNull: ['$st.orders', 0] }, delivered: { $ifNull: ['$st.delivered', 0] }, spent: { $ifNull: ['$st.spent', 0] },
                cancelled: { $ifNull: ['$st.cancelled', 0] }, noShow: { $ifNull: ['$st.noShow', 0] }, last30: { $ifNull: ['$st.last30', 0] }, prior30: { $ifNull: ['$st.prior30', 0] },
                firstAt: '$st.firstAt', lastAt: '$st.lastAt',
            } },
            ...(Object.keys(after).length ? [{ $match: after }] : []),
        ];
        const [cnt] = await User.aggregate([...base, { $count: 'n' }]);
        const count = cnt ? cnt.n : 0;
        if (ctx.countOnly) return { count };
        const rows = await User.aggregate([...base, { $sort: { spent: -1, _id: 1 } }, { $limit: ctx.max }]);
        // the heavy part: favourites, usual time, day, how he pays (only when asked for)
        const extra = new Map();
        if (ctx.lv >= 3 && rows.length) {
            const ids = rows.map((r) => r._id);
            const m = { userId: { $in: ids }, status: 'delivered' };
            const tz = '+05:30';
            const [dishes, dayRows, typeRows, payRows, avgRows, comp] = await Promise.all([
                Order.aggregate([{ $match: m }, { $unwind: '$items' }, { $group: { _id: { u: '$userId', d: '$items.name' }, q: { $sum: { $ifNull: ['$items.quantity', 1] } } } }, { $sort: { q: -1 } }]),
                Order.aggregate([{ $match: m }, { $group: { _id: { u: '$userId', v: { $dayOfWeek: { date: '$createdAt', timezone: tz } } }, n: { $sum: 1 } } }]),
                Order.aggregate([{ $match: m }, { $group: { _id: { u: '$userId', v: '$orderType' }, n: { $sum: 1 } } }]),
                Order.aggregate([{ $match: m }, { $group: { _id: { u: '$userId', v: '$payment.method' }, n: { $sum: 1 } } }]),
                Order.aggregate([{ $match: m }, { $group: { _id: '$userId', min: { $avg: { $add: [{ $multiply: [{ $hour: { date: '$createdAt', timezone: tz } }, 60] }, { $minute: { date: '$createdAt', timezone: tz } }] } }, rating: { $avg: '$deliveryRating.rating' } } }]),
                Complaint.aggregate([{ $match: { userId: { $in: ids } } }, { $group: { _id: '$userId', n: { $sum: 1 } } }]),
            ]);
            const get = (id) => { const k = String(id); if (!extra.has(k)) extra.set(k, { dishes: [] }); return extra.get(k); };
            for (const d of dishes) { const e = get(d._id.u); if (e.dishes.length < 3) e.dishes.push([d._id.d, d.q]); }
            const mode = (arr, key) => { const best = new Map(); for (const x of arr) { const k = String(x._id.u); if (x._id.v != null && (!best.has(k) || x.n > best.get(k).n)) best.set(k, { v: x._id.v, n: x.n }); } for (const [k, b] of best) get(k)[key] = b.v; };
            mode(dayRows, 'dow'); mode(typeRows, 'type'); mode(payRows, 'pay');
            for (const a of avgRows) { const e = get(a._id); e.min = a.min; e.rating = a.rating; }
            for (const c of comp) get(c._id).complaints = c.n;
        }
        const tot = new Map();
        for (const r of rows) { const k = String(r.tenantId); const t = tot.get(k) || { spent: 0, n: 0 }; t.spent += r.spent; t.n += r.delivered; tot.set(k, t); }
        return { count, rows: rows.map((r) => { const t = tot.get(String(r.tenantId)); return { ...r, shopAvg: t && t.n ? t.spent / t.n : 0, extra: extra.get(String(r._id)) || {} }; }) };
    },
    map(r, c) {
        const e = r.extra || {};
        const d = (i) => (e.dishes && e.dishes[i] ? `${e.dishes[i][0]} (${e.dishes[i][1]})` : '');
        const TYPE = { delivery: 'Delivery', pickup: 'Pickup', dine_in: 'Dine in' };
        const PAY = { cod: 'Cash', upi: 'UPI', card: 'Card', wallet: 'Wallet', online: 'Online' };
        const quiet = r.lastAt ? Math.floor((c.now - new Date(r.lastAt).getTime()) / DAY) : null;
        const ctype = customerType(r, c.now);
        const every = r.delivered >= 2 && r.firstAt && r.lastAt ? Math.max(0.5, (new Date(r.lastAt).getTime() - new Date(r.firstAt).getTime()) / DAY / (r.delivered - 1)) : null;
        const behaviourText = c.lv >= 3 ? behaviour(r, e, c, ctype, every) : '';
        return {
            shop: c.shop(r.tenantId), name: r.name || '', phone: c.phone(r.phone), orders: r.orders, spent: r2(r.spent), last: r.lastAt || '',
            joined: r.joinedAt, first: r.firstAt || '', delivered: r.delivered, avg: r.delivered ? r2(r.spent / r.delivered) : 0, cancelled: r.cancelled, noShow: r.noShow,
            quiet: quiet === null ? '' : quiet, last30: r.last30, status: r.isBlocked ? 'blocked' : r.orders === 0 ? 'never ordered' : quiet >= 30 ? 'lapsed' : 'active',
            dish1: d(0), dish2: d(1), dish3: d(2), usualTime: e.min != null ? clock(e.min) : '', day: e.dow ? WEEKDAY[e.dow - 1] : '',
            type: e.type ? TYPE[e.type] || e.type : '', pay: e.pay ? PAY[e.pay] || e.pay : '', rating: e.rating ? r2(e.rating) : '', complaints: e.complaints || 0,
            blocked: r.isBlocked ? 'Yes' : 'No',
            ctype, words: behaviourText, every: every === null ? '' : Math.round(every * 10) / 10,
            vsAvg: r.shopAvg && r.delivered ? `${Math.round((r.spent / r.delivered / r.shopAvg - 1) * 100) > 0 ? '+' : ''}${Math.round((r.spent / r.delivered / r.shopAvg - 1) * 100)}%` : '',
            trend: !r.orders ? '' : r.last30 > r.prior30 ? 'More active' : r.last30 < r.prior30 ? 'Less active' : 'Same',
        };
    },
};

D.orders = {
    title: 'Orders', group: 'Orders and money', hint: 'Every order with its money, from a few columns to the whole story and a sheet of dishes.',
    model: Order, shopField: 'tenantId', dateField: 'createdAt', periodLabel: 'Ordered between', sort: { createdAt: -1 },
    filters: [
        { key: 'status', label: 'Status', multi: true, options: [['placed', 'New'], ['accepted', 'Accepted'], ['preparing', 'Preparing'], ['ready', 'Ready'], ['out_for_delivery', 'On the way'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['undelivered', 'Not delivered']] },
        { key: 'type', label: 'Order type', options: [['', 'Every type'], ['delivery', 'Delivery'], ['pickup', 'Pickup'], ['dine_in', 'Dine-in']] },
        { key: 'method', label: 'Paid by', options: [['', 'Any'], ['cod', 'Cash'], ['upi', 'UPI'], ['card', 'Card'], ['wallet', 'Wallet']] },
        { key: 'pay', label: 'Payment', options: [['', 'Any'], ['paid', 'Paid'], ['pending', 'Pending'], ['failed', 'Failed'], ['refunded', 'Refunded']] },
    ],
    where(f) {
        const w = {};
        const st = list(f.status);
        if (st.length) w.status = { $in: st };
        if (['delivery', 'pickup', 'dine_in'].includes(f.type)) w.orderType = f.type;
        if (['cod', 'upi', 'card', 'wallet'].includes(f.method)) w['payment.method'] = f.method;
        if (['paid', 'pending', 'failed', 'refunded'].includes(f.pay)) w['payment.status'] = f.pay;
        return w;
    },
    columns: [
        { h: 'Date', k: 'at', kind: 'date', lv: 1 }, { h: 'Shop', k: 'shop', lv: 1 }, { h: 'Order', k: 'ref', lv: 1 }, { h: 'Bulk order', k: 'bulk', kind: 'center', lv: 1 }, { h: 'Customer', k: 'customer', lv: 1 },
        { h: 'Status', k: 'status', kind: 'status', lv: 1 }, { h: 'Type', k: 'type', kind: 'center', lv: 1 }, { h: 'Paid by', k: 'method', kind: 'center', lv: 1 }, { h: 'Total (₹)', k: 'total', kind: 'money', lv: 1 },
        { h: 'Whole bulk order (₹)', k: 'bulkTotal', kind: 'money', lv: 2 },
        { h: 'Phone', k: 'phone', kind: 'center', lv: 2 }, { h: 'Items', k: 'items', kind: 'wide', lv: 2 }, { h: 'Subtotal (₹)', k: 'subtotal', kind: 'money', lv: 2 }, { h: 'Discount (₹)', k: 'discount', kind: 'money', lv: 2 },
        { h: 'Delivery fee (₹)', k: 'delivery', kind: 'money', lv: 2 }, { h: 'Packaging (₹)', k: 'packaging', kind: 'money', lv: 2 }, { h: 'GST (₹)', k: 'tax', kind: 'money', lv: 2 }, { h: 'Tip (₹)', k: 'tip', kind: 'money', lv: 2 },
        { h: 'Payment status', k: 'pay', kind: 'status', lv: 2 }, { h: 'Coupon', k: 'coupon', kind: 'center', lv: 2 }, { h: 'Rider', k: 'rider', lv: 2 }, { h: 'Delivered at', k: 'deliveredAt', kind: 'date', lv: 2 }, { h: 'Minutes to deliver', k: 'mins', kind: 'int', lv: 2 },
        { h: 'Address', k: 'address', kind: 'wide', lv: 3 }, { h: 'Accepted at', k: 'tAccepted', kind: 'date', lv: 3 }, { h: 'Ready at', k: 'tReady', kind: 'date', lv: 3 }, { h: 'Out for delivery at', k: 'tOut', kind: 'date', lv: 3 },
        { h: 'Cancelled by', k: 'cancelBy', kind: 'center', lv: 3 }, { h: 'Cancel reason', k: 'cancelReason', lv: 3 }, { h: 'Refund (₹)', k: 'refund', kind: 'money', lv: 3 }, { h: 'Kept by shop (₹)', k: 'kept', kind: 'money', lv: 3 },
        { h: 'Not delivered because', k: 'undelivered', lv: 3 }, { h: 'Note to rider', k: 'note', kind: 'wide', lv: 3 }, { h: 'Note to kitchen', k: 'foodNote', kind: 'wide', lv: 3 }, { h: 'Rating given', k: 'rating', kind: 'center', lv: 3 },
        { h: 'Table', k: 'table', kind: 'center', lv: 3 }, { h: 'Booked for', k: 'scheduled', kind: 'date', lv: 3 }, { h: 'Razorpay payment', k: 'paymentId', lv: 3 }, { h: 'Paid at', k: 'paidAt', kind: 'date', lv: 3 },
    ],
    async prepare(docs, ctx) {
        const ids = [...new Set(docs.map((o) => o.delivery?.riderId).filter(Boolean).map(String))];
        ctx.riders = new Map((await User.find({ _id: { $in: ids } }).select('name phone').lean()).map((u) => [String(u._id), u]));
    },
    map(o, c) {
        const at = (s) => { const h = (o.statusHistory || []).filter((x) => x.status === s); return h.length ? h[h.length - 1].at : ''; };
        const a = o.address || {};
        const rider = o.delivery?.riderId ? c.riders.get(String(o.delivery.riderId)) : null;
        const placed = new Date(o.createdAt).getTime();
        return {
            at: o.createdAt, shop: c.shop(o.tenantId), ref: ref(o), bulk: o.bulkId ? (o.bulkCode || 'Bulk') : '', bulkTotal: o.bulkId ? r2(o.bulkTotal) : '',
            customer: o.customer?.name || '', status: o.status, type: nice(o.orderType), method: String(o.payment?.method || '').toUpperCase(), total: r2(o.pricing?.total),
            phone: c.phone(o.customer?.phone), items: (o.items || []).map((l) => `${l.quantity}× ${l.name}`).join(', '), subtotal: r2(o.pricing?.subtotal), discount: r2(o.pricing?.discount),
            delivery: r2(o.pricing?.deliveryFee), packaging: r2(o.pricing?.packagingCharge), tax: r2(o.pricing?.tax), tip: r2(o.pricing?.tip), pay: o.payment?.status, coupon: o.pricing?.couponCode || '',
            rider: rider ? `${rider.name || ''} ${c.phone(rider.phone)}`.trim() : '', deliveredAt: o.deliveredAt || '', mins: o.deliveredAt ? Math.round((new Date(o.deliveredAt).getTime() - placed) / 60000) : '',
            address: [a.line1, a.line2, a.landmark, a.city, a.pincode].filter(Boolean).join(', '), tAccepted: at('accepted'), tReady: at('ready'), tOut: at('out_for_delivery'),
            cancelBy: o.cancel?.by || '', cancelReason: nice(o.cancel?.reasonCode), refund: rs(o.cancel?.refundPaise || o.undelivered?.refundPaise), kept: rs(o.cancel?.keptPaise || o.undelivered?.keptPaise),
            undelivered: o.undelivered ? `${nice(o.undelivered.reasonCode)}${o.undelivered.note ? `: ${o.undelivered.note}` : ''}` : '', note: o.note || '', foodNote: o.foodNote || '',
            rating: o.deliveryRating?.rating || '', table: o.tableNo || '', scheduled: o.scheduledFor || '', paymentId: o.payment?.paymentId || '', paidAt: o.payment?.paidAt || '',
        };
    },
    extraSheets(docs, c, lv) {
        if (lv < 3) return [];
        const rows = [];
        for (const o of docs) for (const l of o.items || []) rows.push({ at: o.createdAt, shop: c.shop(o.tenantId), ref: ref(o), dish: l.name, qty: l.quantity, unit: r2(l.unitPrice), line: r2(l.lineTotal), gst: r2(l.tax), note: l.note || '' });
        return [{ title: 'Dishes', columns: [{ header: 'Date', key: 'at', kind: 'date' }, { header: 'Shop', key: 'shop' }, { header: 'Order', key: 'ref' }, { header: 'Dish', key: 'dish', kind: 'wide' }, { header: 'Qty', key: 'qty', kind: 'int' }, { header: 'Price each (₹)', key: 'unit', kind: 'money' }, { header: 'Line total (₹)', key: 'line', kind: 'money' }, { header: 'GST (₹)', key: 'gst', kind: 'money' }, { header: 'Note', key: 'note' }], rows, total: true }];
    },
};

D.bulk_orders = {
    title: 'Bulk orders', group: 'Orders and money', hint: 'Every bulk order from the request to the end: the quote, the advance, the balance, and any refund.',
    model: BulkOrder, shopField: 'tenantId', dateField: 'createdAt', periodLabel: 'Asked between', sort: { createdAt: -1 },
    filters: [
        { key: 'status', label: 'Status', multi: true, options: [['requested', 'Waiting for quote'], ['quoted', 'Quote sent'], ['confirmed', 'Advance paid'], ['preparing', 'Being made'], ['ready', 'Ready'], ['out_for_delivery', 'On the way'], ['delivered', 'Delivered'], ['completed', 'Completed'], ['declined', 'Declined'], ['cancelled', 'Cancelled'], ['expired', 'Quote expired']] },
        { key: 'type', label: 'Type', options: [['', 'Every type'], ['delivery', 'Delivery'], ['pickup', 'Pickup']] },
    ],
    where(f) {
        const w = {};
        const st = list(f.status);
        if (st.length) w.status = { $in: st };
        if (['delivery', 'pickup'].includes(f.type)) w.fulfilment = f.type;
        return w;
    },
    columns: [
        { h: 'Date', k: 'at', kind: 'date', lv: 1 }, { h: 'Shop', k: 'shop', lv: 1 }, { h: 'Bulk order', k: 'code', kind: 'center', lv: 1 }, { h: 'Customer', k: 'customer', lv: 1 },
        { h: 'Status', k: 'status', kind: 'status', lv: 1 }, { h: 'Type', k: 'type', kind: 'center', lv: 1 }, { h: 'Total (₹)', k: 'total', kind: 'money', lv: 1 },
        { h: 'Phone', k: 'phone', kind: 'center', lv: 2 }, { h: 'Wanted for', k: 'when', kind: 'date', lv: 2 }, { h: 'Items', k: 'items', kind: 'wide', lv: 2 }, { h: 'Sales after discount (₹)', k: 'sales', kind: 'money', lv: 2 },
        { h: 'Advance paid (₹)', k: 'advance', kind: 'money', lv: 2 }, { h: 'Balance (₹)', k: 'balance', kind: 'money', lv: 2 }, { h: 'Balance paid', k: 'balPaid', kind: 'center', lv: 2 }, { h: 'Balance paid by', k: 'via', kind: 'center', lv: 2 },
        { h: 'Delivered at', k: 'deliveredAt', kind: 'date', lv: 2 },
        { h: 'Refund (₹)', k: 'refund', kind: 'money', lv: 3 }, { h: 'Advance kept by shop', k: 'kept', kind: 'center', lv: 3 }, { h: 'Cancelled by', k: 'cancelBy', kind: 'center', lv: 3 }, { h: 'Cancel reason', k: 'cancelReason', kind: 'wide', lv: 3 },
        { h: 'Company', k: 'company', lv: 3 }, { h: 'GSTIN', k: 'gstin', kind: 'center', lv: 3 }, { h: 'Address', k: 'address', kind: 'wide', lv: 3 }, { h: 'Note', k: 'note', kind: 'wide', lv: 3 },
        { h: 'Advance Razorpay payment', k: 'paymentId', lv: 3 }, { h: 'Advance paid at', k: 'paidAt', kind: 'date', lv: 3 },
    ],
    // the advance's Razorpay payment id (the bulk order only keeps the id of its own payment record)
    async prepare(docs, ctx) {
        const ids = docs.map((b) => b.payment?.advancePaymentId).filter(Boolean);
        ctx.bulkPays = new Map((ids.length ? await BulkPayment.find({ _id: { $in: ids } }).select('rzpPaymentId').lean() : []).map((x) => [String(x._id), x.rzpPaymentId]));
    },
    map(b, c) {
        const q = b.quote?.pricing || b.pricing || {};
        const net = r2((b.quote?.pricing?.subtotal || 0) + (b.quote?.pricing?.packagingCharge || 0) - (b.quote?.pricing?.discount || 0));
        const a = b.address || {};
        const pay = b.payment || {};
        return {
            at: b.createdAt, shop: c.shop(b.tenantId), code: b.code, customer: b.contact?.name || '', status: b.status, type: nice(b.fulfilment), total: r2(q.total),
            phone: c.phone(b.contact?.phone), when: b.when || '', items: (b.lines || []).map((l) => `${l.quantity}× ${l.name}`).join(', '),
            sales: ['delivered', 'completed'].includes(b.status) ? net : '', advance: pay.advancePaise ? rs(pay.advancePaise) : '', balance: b.quote?.balancePaise ? rs(b.quote.balancePaise) : '',
            balPaid: pay.balancePaid ? 'Yes' : (pay.advancePaise ? 'No' : ''), via: pay.balanceVia || '', deliveredAt: b.stageAt?.delivered || '',
            refund: pay.refundPaise ? rs(pay.refundPaise) : '', kept: pay.advanceKept ? 'Yes' : '', cancelBy: b.cancelledBy || '', cancelReason: b.cancelReason || '',
            company: b.contact?.company || '', gstin: b.contact?.gstin || '', address: [a.line1, a.line2, a.landmark, a.city, a.pincode].filter(Boolean).join(', '), note: b.note || '',
            paymentId: (pay.advancePaymentId && c.bulkPays.get(String(pay.advancePaymentId))) || '', paidAt: pay.paidAt || '',
        };
    },
};

D.invoices = {
    title: 'Plan payments', group: 'Orders and money', hint: 'What shops paid you for plans and extra shops, with GST and payment details.',
    model: PlanPayment, shopField: 'tenantId', dateField: 'paidAt', periodLabel: 'Paid between', sort: { paidAt: -1 },
    filters: [
        { key: 'status', label: 'Status', options: [['', 'Paid'], ['held', 'Held for you']] },
        { key: 'kind', label: 'Kind', options: [['', 'Any'], ['new', 'New plan'], ['renew', 'Renewal'], ['upgrade', 'Upgrade'], ['branch', 'Extra shop']] },
    ],
    where(f) {
        const w = { status: f.status === 'held' ? 'held' : 'paid' };
        if (['new', 'renew', 'upgrade', 'branch'].includes(f.kind)) w.kind = f.kind;
        return w;
    },
    columns: [
        { h: 'Invoice no', k: 'no', lv: 1 }, { h: 'Shop', k: 'shop', lv: 1 }, { h: 'Plan', k: 'plan', kind: 'center', lv: 1 }, { h: 'Months', k: 'months', kind: 'int', lv: 1 }, { h: 'Total (₹)', k: 'total', kind: 'money', lv: 1 },
        { h: 'Status', k: 'status', kind: 'status', lv: 1 }, { h: 'Paid on', k: 'paidAt', kind: 'date', lv: 1 },
        { h: 'Kind', k: 'kind', kind: 'center', lv: 2 }, { h: 'Base amount (₹)', k: 'base', kind: 'money', lv: 2 }, { h: 'GST %', k: 'gstPct', kind: 'int', lv: 2 }, { h: 'GST (₹)', k: 'gst', kind: 'money', lv: 2 },
        { h: 'Payment id', k: 'payId', lv: 3 }, { h: 'Held because', k: 'heldWhy', kind: 'wide', lv: 3 },
    ],
    map(i, c) {
        const q = i.quote || {};
        return {
            no: i.invoice?.invoiceNo || '', shop: c.shop(i.tenantId), plan: i.to, months: i.months || 1, total: r2((i.payablePaise || 0) / 100), status: i.status, paidAt: i.paidAt || '',
            kind: i.kind, base: r2((q.taxablePaise ?? i.payablePaise ?? 0) / 100), gstPct: q.gstPercent || 0, gst: r2((q.gstPaise || 0) / 100), payId: i.paymentId || '', heldWhy: i.heldWhy || '',
        };
    },
};

D.payments = {
    title: 'Customer payments', group: 'Orders and money', hint: 'Online payments customers made, with the Razorpay ids.',
    model: OnlinePayment, shopField: 'tenantId', dateField: 'createdAt', periodLabel: 'Paid between', sort: { createdAt: -1 },
    filters: [{ key: 'status', label: 'Status', options: [['', 'Any'], ['created', 'Started'], ['captured', 'Received'], ['mismatch', 'Mismatch']] }],
    where: (f) => (['created', 'captured', 'mismatch'].includes(f.status) ? { status: f.status } : {}),
    columns: [
        { h: 'Date', k: 'at', kind: 'date', lv: 1 }, { h: 'Shop', k: 'shop', lv: 1 }, { h: 'Order', k: 'order', lv: 1 }, { h: 'Amount (₹)', k: 'amount', kind: 'money', lv: 1 }, { h: 'Status', k: 'status', kind: 'status', lv: 1 }, { h: 'Razorpay payment', k: 'pid', lv: 1 },
        { h: 'Razorpay order', k: 'oid', lv: 2 }, { h: 'Method', k: 'method', kind: 'center', lv: 2 }, { h: 'Received (₹)', k: 'captured', kind: 'money', lv: 2 }, { h: 'Refunded (₹)', k: 'refunded', kind: 'money', lv: 2 }, { h: 'Received at', k: 'capturedAt', kind: 'date', lv: 2 },
        { h: 'Test or live', k: 'mode', kind: 'center', lv: 3 }, { h: 'Confirmed by', k: 'source', kind: 'center', lv: 3 }, { h: 'Last failure', k: 'fail', kind: 'wide', lv: 3 },
    ],
    // Three places keep a customer's online money: the order payments, the payments of bulk orders (the advance, and the balance when paid online), and the deposits of
    // table bookings. They are one sheet here, newest first, so the file agrees with the Transactions tab. The Order column says which a row is.
    async fetch(f, ctx) {
        const m = matchFor(D.payments, f, ctx);
        const scope = ctx.scope ? { tenantId: { $in: ctx.scope } } : {};
        const bulkWhere = { ...scope, ...inRange('createdAt', ctx.period), ...(f.status ? { status: f.status === 'mismatch' ? '__none__' : f.status } : {}) };   // (a bulk payment is never a "mismatch")
        const depWhere = !f.status || f.status === 'captured' ? { ...scope, 'payment.amountPaise': { $gt: 0 }, ...inRange('payment.paidAt', ctx.period) } : null;   // (a deposit is recorded when it is paid)
        const [n1, n2, n3] = await Promise.all([OnlinePayment.countDocuments(m), BulkPayment.countDocuments(bulkWhere), depWhere ? TableBooking.countDocuments(depWhere) : 0]);
        if (ctx.countOnly) return { count: n1 + n2 + n3 };
        const [a1, a2, a3] = await Promise.all([
            OnlinePayment.find(m).sort({ createdAt: -1 }).limit(ctx.max).lean(),
            BulkPayment.find(bulkWhere).sort({ createdAt: -1 }).limit(ctx.max).lean(),
            depWhere ? TableBooking.find(depWhere).sort({ 'payment.paidAt': -1 }).limit(ctx.max).lean() : [],
        ]);
        const when = (x) => new Date(x._src === 'deposit' ? x.payment.paidAt : x.createdAt).getTime();
        const rows = [...a1.map((x) => ({ ...x, _src: 'online' })), ...a2.map((x) => ({ ...x, _src: 'bulk' })), ...a3.map((x) => ({ ...x, _src: 'deposit' }))].sort((x, y) => when(y) - when(x)).slice(0, ctx.max);
        return { count: n1 + n2 + n3, rows };
    },
    async prepare(docs, ctx) {
        const online = docs.filter((d) => d._src === 'online');
        const bulk = docs.filter((d) => d._src === 'bulk');
        ctx.orders = new Map((await Order.find({ _id: { $in: online.map((d) => d.orderId) } }).select('orderNo ref').lean()).map((o) => [String(o._id), o]));
        ctx.bulks = new Map((bulk.length ? await BulkOrder.find({ _id: { $in: bulk.map((d) => d.bulkId) } }).select('code').lean() : []).map((o) => [String(o._id), o.code]));
    },
    map(p, c) {
        if (p._src === 'bulk') {
            return { at: p.createdAt, shop: c.shop(p.tenantId), order: `Bulk ${c.bulks.get(String(p.bulkId)) || ''}`.trim(), amount: rs(p.amountPaise), status: p.status, pid: p.rzpPaymentId || '', oid: p.rzpOrderId, method: `Bulk ${p.kind}`, captured: p.status === 'captured' ? rs(p.amountPaise) : 0, refunded: p.refund?.status === 'refunded' ? rs(p.refund.amountPaise) : 0, capturedAt: p.capturedAt || '', mode: p.mode, source: '', fail: '' };
        }
        if (p._src === 'deposit') {
            return { at: p.payment.paidAt, shop: c.shop(p.tenantId), order: `Table booking ${p.code || ''}`.trim(), amount: rs(p.payment.amountPaise), status: 'captured', pid: p.payment.rzpPaymentId || '', oid: p.payment.rzpOrderId || '', method: 'Booking deposit', captured: rs(p.payment.amountPaise), refunded: p.deposit?.status === 'refunded' ? rs(p.payment.amountPaise) : 0, capturedAt: p.payment.paidAt, mode: '', source: '', fail: '' };
        }
        return { at: p.createdAt, shop: c.shop(p.tenantId), order: ref(c.orders.get(String(p.orderId))), amount: rs(p.amountPaise), status: p.status, pid: p.rzpPaymentId || '', oid: p.rzpOrderId, method: p.method || '', captured: rs(p.capturedPaise), refunded: rs(p.refundedPaise), capturedAt: p.capturedAt || '', mode: p.mode, source: p.source || '', fail: p.lastFailure ? `${p.lastFailure.reason || ''}` : '' };
    },
};
D.refunds = {
    title: 'Refunds', group: 'Orders and money', hint: 'Money sent back to customers, and the ones that failed.',
    model: OnlineRefund, shopField: 'tenantId', dateField: 'createdAt', periodLabel: 'Asked between', sort: { createdAt: -1 },
    filters: [{ key: 'status', label: 'Status', options: [['', 'Any'], ['pending', 'Waiting'], ['processing', 'Sending'], ['processed', 'Done'], ['failed', 'Failed']] }],
    where: (f) => (['pending', 'processing', 'processed', 'failed'].includes(f.status) ? { status: f.status } : {}),
    columns: [
        { h: 'Date', k: 'at', kind: 'date', lv: 1 }, { h: 'Shop', k: 'shop', lv: 1 }, { h: 'Order', k: 'order', lv: 1 }, { h: 'Amount (₹)', k: 'amount', kind: 'money', lv: 1 }, { h: 'Status', k: 'status', kind: 'status', lv: 1 }, { h: 'Reason', k: 'reason', lv: 1 },
        { h: 'Razorpay payment', k: 'pid', lv: 2 }, { h: 'Razorpay refund', k: 'rid', lv: 2 }, { h: 'Tries', k: 'tries', kind: 'int', lv: 2 }, { h: 'Done at', k: 'doneAt', kind: 'date', lv: 2 },
        { h: 'Why it failed', k: 'err', kind: 'wide', lv: 3 }, { h: 'Made in Razorpay dashboard', k: 'external', kind: 'center', lv: 3 }, { h: 'Customer told at', k: 'told', kind: 'date', lv: 3 },
    ],
    // The money sent back: order refunds, the refunds of bulk orders (kept on the payment), and the table booking deposits that went back. One sheet.
    async fetch(f, ctx) {
        const m = matchFor(D.refunds, f, ctx);
        const scope = ctx.scope ? { tenantId: { $in: ctx.scope } } : {};
        const BULK = { processing: 'sending', processed: 'refunded', failed: 'failed' };   // (a bulk refund is never "waiting": it is sending, done or failed)
        const bulkWhere = { ...scope, ...inRange('refund.at', ctx.period), 'refund.status': f.status ? (BULK[f.status] || '__none__') : { $exists: true } };
        const depWhere = !f.status || f.status === 'processed' ? { ...scope, 'deposit.status': 'refunded', 'payment.amountPaise': { $gt: 0 }, ...inRange('deposit.refundedAt', ctx.period) } : null;
        const [n1, n2, n3] = await Promise.all([OnlineRefund.countDocuments(m), BulkPayment.countDocuments(bulkWhere), depWhere ? TableBooking.countDocuments(depWhere) : 0]);
        if (ctx.countOnly) return { count: n1 + n2 + n3 };
        const [a1, a2, a3] = await Promise.all([
            OnlineRefund.find(m).sort({ createdAt: -1 }).limit(ctx.max).lean(),
            BulkPayment.find(bulkWhere).sort({ 'refund.at': -1 }).limit(ctx.max).lean(),
            depWhere ? TableBooking.find(depWhere).sort({ 'deposit.refundedAt': -1 }).limit(ctx.max).lean() : [],
        ]);
        const when = (x) => new Date(x._src === 'deposit' ? x.deposit.refundedAt : x._src === 'bulk' ? (x.refund.at || x.updatedAt) : x.createdAt).getTime();
        const rows = [...a1.map((x) => ({ ...x, _src: 'online' })), ...a2.map((x) => ({ ...x, _src: 'bulk' })), ...a3.map((x) => ({ ...x, _src: 'deposit' }))].sort((x, y) => when(y) - when(x)).slice(0, ctx.max);
        return { count: n1 + n2 + n3, rows };
    },
    async prepare(docs, ctx) {
        const online = docs.filter((d) => d._src === 'online');
        const bulk = docs.filter((d) => d._src === 'bulk');
        ctx.orders = new Map((await Order.find({ _id: { $in: online.map((d) => d.orderId) } }).select('orderNo ref').lean()).map((o) => [String(o._id), o]));
        ctx.bulks = new Map((bulk.length ? await BulkOrder.find({ _id: { $in: bulk.map((d) => d.bulkId) } }).select('code').lean() : []).map((o) => [String(o._id), o.code]));
    },
    map(r, c) {
        if (r._src === 'bulk') {
            const NAME = { sending: 'processing', refunded: 'processed', failed: 'failed' };
            return { at: r.refund.at || r.updatedAt, shop: c.shop(r.tenantId), order: `Bulk ${c.bulks.get(String(r.bulkId)) || ''}`.trim(), amount: rs(r.refund.amountPaise), status: NAME[r.refund.status] || r.refund.status, reason: nice(r.refund.reason), pid: r.rzpPaymentId, rid: r.refund.refundId || '', tries: r.refund.attempts || 0, doneAt: r.refund.status === 'refunded' ? r.refund.at : '', err: r.refund.lastError || '', external: 'No', told: '' };
        }
        if (r._src === 'deposit') {
            return { at: r.deposit.refundedAt, shop: c.shop(r.tenantId), order: `Table booking ${r.code || ''}`.trim(), amount: rs(r.payment.amountPaise), status: 'processed', reason: 'Booking deposit returned', pid: r.payment.rzpPaymentId || '', rid: r.deposit.refundId || '', tries: '', doneAt: r.deposit.refundedAt, err: r.deposit.refundError || '', external: 'No', told: '' };
        }
        return { at: r.createdAt, shop: c.shop(r.tenantId), order: ref(c.orders.get(String(r.orderId))), amount: rs(r.amountPaise), status: r.status, reason: nice(r.reason), pid: r.rzpPaymentId, rid: r.rzpRefundId || '', tries: r.attempts || 0, doneAt: r.processedAt || '', err: r.lastError || '', external: r.external ? 'Yes' : 'No', told: r.customerNotifiedAt || '' };
    },
};
D.sms_topups = {
    title: 'SMS top-ups', group: 'SMS', hint: 'What shops paid to add SMS balance.',
    model: SmsTopup, shopField: 'tenantId', dateField: 'createdAt', periodLabel: 'Asked between', sort: { createdAt: -1 },
    filters: [{ key: 'status', label: 'Status', options: [['', 'Any'], ['pending', 'Pending'], ['paid', 'Paid'], ['expired', 'Expired']] }],
    where: (f) => (['pending', 'paid', 'expired'].includes(f.status) ? { status: f.status } : {}),
    columns: [
        { h: 'Date', k: 'at', kind: 'date', lv: 1 }, { h: 'Shop', k: 'shop', lv: 1 }, { h: 'Reference', k: 'ref', lv: 1 }, { h: 'Wallet gets (₹)', k: 'amount', kind: 'money', lv: 1 }, { h: 'Status', k: 'status', kind: 'status', lv: 1 }, { h: 'Paid at', k: 'paidAt', kind: 'date', lv: 1 },
        { h: 'GST (₹)', k: 'gst', kind: 'money', lv: 2 }, { h: 'Paid in all (₹)', k: 'payable', kind: 'money', lv: 2 }, { h: 'Razorpay payment', k: 'pid', lv: 2 },
        { h: 'Razorpay order', k: 'oid', lv: 3 }, { h: 'Paid by', k: 'paidBy', lv: 3 }, { h: 'Tax invoice', k: 'inv', lv: 3 },
    ],
    map: (t, c) => ({ at: t.createdAt, shop: c.shop(t.tenantId), ref: t.ref || '', amount: rs(t.amountPaise), status: t.status, paidAt: t.paidAt || '', gst: rs(t.gstPaise), payable: rs(t.payablePaise || t.amountPaise), pid: t.paymentId || '', oid: t.rzpOrderId || '', paidBy: t.paidBy?.label || '', inv: t.invoice?.invoiceNo || '' }),
};

D.sms_sent = {
    title: 'SMS sent', group: 'SMS', hint: 'Every SMS the platform sent for the shops, with what it cost.',
    model: SmsLog, shopField: 'tenantId', dateField: 'createdAt', periodLabel: 'Sent between', sort: { createdAt: -1 },
    filters: [
        { key: 'purpose', label: 'Kind', options: [['', 'Any'], ['otp', 'Login OTP'], ['order', 'Order'], ['bill', 'Bill'], ['alert', 'Alert'], ['platform_alert', 'Your alerts']] },
        { key: 'status', label: 'Result', options: [['', 'Any'], ['sent', 'Sent'], ['failed', 'Failed'], ['mock', 'Test only']] },
    ],
    where(f) { const w = {}; if (['otp', 'order', 'bill', 'alert', 'platform_alert'].includes(f.purpose)) w.purpose = f.purpose; if (['sent', 'failed', 'mock'].includes(f.status)) w.status = f.status; return w; },
    columns: [
        { h: 'Date', k: 'at', kind: 'date', lv: 1 }, { h: 'Shop', k: 'shop', lv: 1 }, { h: 'Kind', k: 'purpose', kind: 'center', lv: 1 }, { h: 'Result', k: 'status', kind: 'status', lv: 1 }, { h: 'To', k: 'to', kind: 'center', lv: 1 },
        { h: 'Shop paid (₹)', k: 'charged', kind: 'money', lv: 2 }, { h: 'Cost to you (₹)', k: 'cost', kind: 'money', lv: 2 }, { h: 'Own provider', k: 'own', kind: 'center', lv: 2 }, { h: 'Provider message id', k: 'pid', lv: 3 },
    ],
    map: (l, c) => ({ at: l.createdAt, shop: c.shop(l.tenantId), purpose: nice(l.purpose), status: l.status, to: l.phoneMasked || '', charged: rs(l.chargedPaise), cost: rs(l.costPaise), own: l.own ? 'Yes' : 'No', pid: l.providerMessageId || '' }),
};

D.complaints = {
    title: 'Complaints', group: 'Orders and money', hint: 'What customers complained about and how it ended.',
    model: Complaint, shopField: 'tenantId', dateField: 'createdAt', periodLabel: 'Raised between', sort: { createdAt: -1 },
    filters: [{ key: 'status', label: 'Status', options: [['', 'Any'], ['open', 'Open'], ['in_progress', 'In progress'], ['resolved', 'Resolved']] }],
    where: (f) => (['open', 'in_progress', 'resolved'].includes(f.status) ? { status: f.status } : {}),
    columns: [
        { h: 'Date', k: 'at', kind: 'date', lv: 1 }, { h: 'Shop', k: 'shop', lv: 1 }, { h: 'Order no', k: 'no', lv: 1 }, { h: 'Customer', k: 'customer', lv: 1 }, { h: 'About', k: 'type', kind: 'center', lv: 1 }, { h: 'Status', k: 'status', kind: 'status', lv: 1 }, { h: 'What he wrote', k: 'text', kind: 'wide', lv: 1 },
        { h: 'Owner reply', k: 'reply', kind: 'wide', lv: 2 }, { h: 'Outcome', k: 'resolution', kind: 'center', lv: 2 }, { h: 'Refund (₹)', k: 'refund', kind: 'money', lv: 2 }, { h: 'Refund status', k: 'refundStatus', kind: 'status', lv: 2 },
        { h: 'Decided at', k: 'decidedAt', kind: 'date', lv: 3 }, { h: 'Decided by', k: 'decidedBy', lv: 3 }, { h: 'Rider at fault', k: 'rider', kind: 'center', lv: 3 }, { h: 'Closed by itself because', k: 'auto', kind: 'wide', lv: 3 }, { h: 'Photos', k: 'photos', kind: 'int', lv: 3 },
    ],
    map: (x, c) => ({ at: x.createdAt, shop: c.shop(x.tenantId), no: x.orderNo || '', customer: x.customerName || '', type: nice(x.type), status: x.status, text: x.text, reply: x.ownerReply || '', resolution: nice(x.resolution), refund: rs(x.refundPaise), refundStatus: x.refundStatus, decidedAt: x.decidedAt || '', decidedBy: x.decidedBy || '', rider: x.riderFault === undefined ? '' : x.riderFault ? 'Yes' : 'No', auto: x.autoReason || '', photos: (x.photos || []).length }),
};

D.riders = {
    title: 'Riders', group: 'People', hint: 'The riders of each shop and how many deliveries they did.',
    model: User, shopField: 'tenantId', dateField: 'createdAt', periodLabel: 'Joined between', sort: { createdAt: -1 }, baseWhere: { role: 'rider' },
    filters: [{ key: 'blocked', label: 'Status', options: [['', 'Any'], ['no', 'Active'], ['yes', 'Blocked']] }],
    where: (f) => (f.blocked === 'yes' ? { isBlocked: true } : f.blocked === 'no' ? { isBlocked: { $ne: true } } : {}),
    columns: [
        { h: 'Shop', k: 'shop', lv: 1 }, { h: 'Name', k: 'name', lv: 1 }, { h: 'Phone', k: 'phone', kind: 'center', lv: 1 }, { h: 'Status', k: 'status', kind: 'status', lv: 1 },
        { h: 'Joined', k: 'joined', kind: 'date', lv: 2 }, { h: 'Deliveries', k: 'done', kind: 'int', lv: 2 }, { h: 'Last delivery', k: 'last', kind: 'date', lv: 3 }, { h: 'Cash orders delivered', k: 'cash', kind: 'int', lv: 3 },
    ],
    async prepare(docs, ctx) {
        const g = await Order.aggregate([{ $match: { 'delivery.riderId': { $in: docs.map((d) => d._id) }, status: 'delivered' } }, { $group: { _id: '$delivery.riderId', n: { $sum: 1 }, last: { $max: '$deliveredAt' }, cash: { $sum: { $cond: [{ $eq: ['$payment.method', 'cod'] }, 1, 0] } } } }]);
        ctx.stats = new Map(g.map((x) => [String(x._id), x]));
    },
    map(u, c) { const s = c.stats.get(String(u._id)) || {}; return { shop: c.shop(u.tenantId), name: u.name || '', phone: c.phone(u.phone), status: u.isBlocked ? 'blocked' : 'active', joined: u.createdAt, done: s.n || 0, last: s.last || '', cash: s.cash || 0 }; },
};

D.menu = {
    title: 'Menu items', group: 'Shop data', hint: 'Every dish of the chosen shops with price and how well it sells.',
    model: Product, shopField: 'tenantId', dateField: 'createdAt', periodLabel: 'Added between', sort: { tenantId: 1, name: 1 },
    filters: [{ key: 'active', label: 'Shown to customers', options: [['', 'Any'], ['yes', 'Yes'], ['no', 'Hidden']] }, { key: 'veg', label: 'Food', options: [['', 'Any'], ['veg', 'Veg'], ['non', 'Non-veg']] }],
    where(f) { const w = {}; if (f.active === 'yes') w.isActive = { $ne: false }; if (f.active === 'no') w.isActive = false; if (f.veg === 'veg') w.isVeg = true; if (f.veg === 'non') w.isVeg = false; return w; },
    columns: [
        { h: 'Shop', k: 'shop', lv: 1 }, { h: 'Item', k: 'name', lv: 1 }, { h: 'Price (₹)', k: 'price', kind: 'money', lv: 1 }, { h: 'Veg', k: 'veg', kind: 'center', lv: 1 }, { h: 'Shown', k: 'active', kind: 'center', lv: 1 },
        { h: 'Category', k: 'cat', lv: 2 }, { h: 'Description', k: 'desc', kind: 'wide', lv: 2 }, { h: 'Times ordered', k: 'orders', kind: 'int', lv: 2 }, { h: 'Bestseller', k: 'best', kind: 'center', lv: 2 },
        { h: 'Price before discount (₹)', k: 'mrp', kind: 'money', lv: 3 }, { h: 'Sold by', k: 'sellBy', kind: 'center', lv: 3 }, { h: 'Kind', k: 'kind', kind: 'center', lv: 3 }, { h: 'Pictures', k: 'pics', kind: 'int', lv: 3 }, { h: 'Added', k: 'added', kind: 'date', lv: 3 },
    ],
    async prepare(docs, ctx) { ctx.cats = new Map((await Category.find({ _id: { $in: [...new Set(docs.map((d) => String(d.categoryId)))] } }).select('name').lean()).map((x) => [String(x._id), x.name])); },
    map: (p, c) => ({ shop: c.shop(p.tenantId), name: p.name, price: r2(p.price), veg: p.isVeg ? 'Veg' : 'Non-veg', active: p.isActive === false ? 'Hidden' : 'Yes', cat: c.cats.get(String(p.categoryId)) || '', desc: p.description || '', orders: p.orderCount || 0, best: p.isBestseller ? 'Yes' : '', mrp: r2(p.mrp), sellBy: p.sellBy || '', kind: p.itemKind || '', pics: (p.images || []).length + (p.image ? 1 : 0), added: p.createdAt }),
};

D.shops = {
    title: 'Shops', group: 'Shop data', hint: 'All shops with their status, place and bill state.',
    model: Tenant, shopField: '_id', dateField: 'createdAt', periodLabel: 'Joined between', sort: { name: 1 },
    filters: [{ key: 'status', label: 'Status', options: [['', 'Any'], ['active', 'Active'], ['suspended', 'Suspended']] }, { key: 'billing', label: 'Bill', options: [['', 'Any'], ['ok', 'Fine'], ['paused', 'Paused']] }],
    where(f) { const w = {}; if (['active', 'suspended'].includes(f.status)) w.status = f.status; if (f.billing === 'paused') w['plan.paused'] = true; if (f.billing === 'ok') w['plan.paused'] = { $ne: true }; return w; },
    columns: [
        { h: 'Shop', k: 'name', lv: 1 }, { h: 'Code', k: 'code', kind: 'center', lv: 1 }, { h: 'Status', k: 'status', kind: 'status', lv: 1 }, { h: 'City', k: 'city', lv: 1 }, { h: 'Phone', k: 'phone', kind: 'center', lv: 1 }, { h: 'Bill', k: 'bill', kind: 'status', lv: 1 },
        { h: 'Brand', k: 'brand', lv: 2 }, { h: 'Joined', k: 'joined', kind: 'date', lv: 2 }, { h: 'Address', k: 'address', kind: 'wide', lv: 2 }, { h: 'GSTIN', k: 'gstin', kind: 'center', lv: 2 },
        { h: 'Orders (all time)', k: 'orders', kind: 'int', lv: 3 }, { h: 'Delivered sales (₹)', k: 'sales', kind: 'money', lv: 3 }, { h: 'Last order', k: 'last', kind: 'date', lv: 3 },
    ],
    async prepare(docs, ctx) {
        const [b, g] = await Promise.all([
            Brand.find({ _id: { $in: docs.map((d) => d.brandId).filter(Boolean) } }).select('name').lean(),
            ctx.lv >= 3 ? Order.aggregate([{ $match: { tenantId: { $in: docs.map((d) => d._id) } } }, { $group: { _id: '$tenantId', n: { $sum: 1 }, sales: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, { $ifNull: ['$bulkTotal', { $ifNull: ['$pricing.total', 0] }] }, 0] } }, last: { $max: '$createdAt' } } }]) : [],
        ]);
        ctx.brands = new Map(b.map((x) => [String(x._id), x.name]));
        ctx.stats = new Map(g.map((x) => [String(x._id), x]));
    },
    map(t, c) { const s = c.stats.get(String(t._id)) || {}; return { name: t.name, code: t.refCode || t.slug, status: t.status, city: t.address?.city || '', phone: c.phone(t.phone), bill: t.plan?.paused ? 'paused' : 'ok', brand: t.brandId ? c.brands.get(String(t.brandId)) || '' : '', joined: t.createdAt, address: [t.address?.line, t.address?.city, t.address?.pincode].filter(Boolean).join(', '), gstin: t.business?.gstin || '', orders: s.n || 0, sales: r2(s.sales), last: s.last || '' }; },
};

D.expenses = {
    title: 'Your expenses', group: 'Platform', hint: 'What you spend to run the platform (not per shop).',
    model: Expense, shopField: null, dateField: 'date', periodLabel: 'Spent between', sort: { date: -1 },
    filters: [{ key: 'category', label: 'Kind', options: [['', 'Any'], ...Expense.CATEGORIES.map((x) => [x, nice(x)])] }],
    where: (f) => (Expense.CATEGORIES.includes(f.category) ? { category: f.category } : {}),
    columns: [
        { h: 'Date', k: 'date', kind: 'date', lv: 1 }, { h: 'Kind', k: 'cat', lv: 1 }, { h: 'Amount (₹)', k: 'amount', kind: 'money', lv: 1 }, { h: 'Paid to', k: 'vendor', lv: 1 },
        { h: 'Note', k: 'note', kind: 'wide', lv: 2 }, { h: 'Repeats monthly', k: 'repeat', kind: 'center', lv: 2 }, { h: 'Stops after', k: 'ends', kind: 'date', lv: 3 }, { h: 'Added by', k: 'by', lv: 3 },
    ],
    map: (e) => ({ date: e.date, cat: e.category === 'other' && e.otherName ? `other: ${e.otherName}` : nice(e.category), amount: rs(e.amountPaise), vendor: e.vendor || '', note: e.note || '', repeat: e.repeatMonthly ? 'Yes' : '', ends: e.endsOn || '', by: e.createdBy || '' }),
};

D.audit = {
    title: 'Audit log', group: 'Platform', hint: 'Who changed what, and when.',
    model: AuditLog, shopField: 'tenantId', dateField: 'at', periodLabel: 'Between', sort: { at: -1 },
    filters: [{ key: 'actor', label: 'Who', options: [['', 'Everyone'], ['superadmin', 'Superadmins'], ['owner', 'Owners'], ['rider', 'Riders'], ['staff', 'Staff'], ['system', 'Automatic']] }, { key: 'failed', label: 'Result', options: [['', 'All'], ['yes', 'Failed only']] }],
    where(f) { const w = {}; if (['superadmin', 'owner', 'rider', 'staff', 'system'].includes(f.actor)) w.actorType = f.actor; if (f.failed === 'yes') w.status = { $gte: 400 }; return w; },
    columns: [
        { h: 'Time', k: 'at', kind: 'date', lv: 1 }, { h: 'Who', k: 'who', lv: 1 }, { h: 'Action', k: 'action', kind: 'wide', lv: 1 }, { h: 'Shop', k: 'shop', lv: 1 }, { h: 'Result', k: 'status', kind: 'center', lv: 1 },
        { h: 'Method', k: 'method', kind: 'center', lv: 2 }, { h: 'Address', k: 'path', kind: 'wide', lv: 2 }, { h: 'From', k: 'ip', lv: 3 }, { h: 'Details', k: 'params', kind: 'wide', lv: 3 },
    ],
    map: (a, c) => ({ at: a.at, who: a.actorLabel || a.actorType, action: a.action, shop: a.tenantId ? c.shop(a.tenantId) : '', status: a.status || '', method: a.method || '', path: a.path || '', ip: a.ip || '', params: a.params ? JSON.stringify(a.params).slice(0, 300) : '' }),
};

// ----- people who run the shops: owners, brand owners and branch managers, cooks and waiters -----
const days = (from, now) => (from ? Math.max(0, Math.floor((now - new Date(from).getTime()) / DAY)) : null);
const hourText = (h) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
const inDays = (n) => (n === null ? 'never' : n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`);

// last 30 days per shop: orders, sales, cancels, how fast the shop accepts, its busiest hour
async function shopRecent(ids, now) {
    const since = new Date(now - 30 * DAY);
    const tz = '+05:30';
    const m = { tenantId: { $in: ids }, createdAt: { $gte: since } };
    const [life, rec, hours] = await Promise.all([
        Order.aggregate([{ $match: { tenantId: { $in: ids } } }, { $group: { _id: '$tenantId', orders: { $sum: 1 }, delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } }, sales: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, { $ifNull: ['$bulkTotal', { $ifNull: ['$pricing.total', 0] }] }, 0] } }, last: { $max: '$createdAt' } } }]),
        Order.aggregate([{ $match: m }, { $addFields: { acc: { $arrayElemAt: [{ $filter: { input: { $ifNull: ['$statusHistory', []] }, cond: { $eq: ['$$this.status', 'accepted'] } } }, 0] } } },
            { $group: { _id: '$tenantId', orders: { $sum: 1 }, delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } }, cancelled: { $sum: { $cond: [{ $in: ['$status', ['cancelled', 'undelivered']] }, 1, 0] } }, sales: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, { $ifNull: ['$bulkTotal', { $ifNull: ['$pricing.total', 0] }] }, 0] } }, acceptMin: { $avg: { $cond: [{ $ifNull: ['$acc.at', false] }, { $divide: [{ $subtract: ['$acc.at', '$createdAt'] }, 60000] }, null] } } } }]),
        Order.aggregate([{ $match: m }, { $group: { _id: { t: '$tenantId', h: { $hour: { date: '$createdAt', timezone: tz } } }, n: { $sum: 1 } } }]),
    ]);
    const out = new Map();
    const get = (id) => { const k = String(id); if (!out.has(k)) out.set(k, {}); return out.get(k); };
    for (const x of life) Object.assign(get(x._id), { allOrders: x.orders, allDelivered: x.delivered, allSales: x.sales, lastOrder: x.last });
    for (const x of rec) Object.assign(get(x._id), { orders30: x.orders, delivered30: x.delivered, cancelled30: x.cancelled, sales30: x.sales, acceptMin: x.acceptMin });
    const best = new Map();
    for (const h of hours) { const k = String(h._id.t); if (!best.has(k) || h.n > best.get(k).n) best.set(k, { h: h._id.h, n: h.n }); }
    for (const [k, b] of best) get(k).peak = b.h;
    return out;
}

D.owners = {
    title: 'Shop owners', group: 'People', hint: 'Every shop owner: how the shop is doing, rent, SMS balance and how active the owner is.',
    shopField: 'tenantId', periodLabel: 'Owner joined between', periodOn: true,
    filters: [
        { key: 'rent', label: 'Plan', options: [['', 'Any'], ['free', 'Free period'], ['paused', 'Paused (plan not renewed)']] },
        { key: 'status', label: 'Shop', options: [['', 'Any'], ['active', 'Open'], ['suspended', 'Suspended']] },
        { key: 'activity', label: 'Orders in 30 days', options: [['', 'Any'], ['busy', '10 or more'], ['quiet', 'Fewer than 10'], ['none', 'None']] },
        { key: 'login', label: 'Owner last seen', options: [['', 'Any'], ['week', 'Within 7 days'], ['old', 'Over 14 days ago or never']] },
    ],
    columns: [
        { h: 'Shop', k: 'shop', lv: 1 }, { h: 'Owner', k: 'name', lv: 1 }, { h: 'Phone', k: 'phone', kind: 'center', lv: 1 }, { h: 'Shop status', k: 'status', kind: 'status', lv: 1 },
        { h: 'Plan', k: 'rent', kind: 'status', lv: 1 }, { h: 'Orders (30 days)', k: 'orders30', kind: 'int', lv: 1 }, { h: 'Sales (30 days) (₹)', k: 'sales30', kind: 'money', lv: 1 }, { h: 'Last order', k: 'lastOrder', kind: 'date', lv: 1 },
        { h: 'Joined', k: 'joined', kind: 'date', lv: 2 }, { h: 'Owner last logged in', k: 'login', kind: 'date', lv: 2 }, { h: 'Unpaid bills (₹)', k: 'owed', kind: 'money', lv: 2 }, { h: 'Overdue bills', k: 'overdue', kind: 'int', lv: 2 },
        { h: 'SMS balance (₹)', k: 'sms', kind: 'money', lv: 2 }, { h: 'Rating', k: 'rating', kind: 'center', lv: 2 }, { h: 'Cancelled (30 days) %', k: 'cancelPct', kind: 'int', lv: 2 }, { h: 'Accepts an order in (min)', k: 'accept', kind: 'center', lv: 2 }, { h: 'Brand', k: 'brand', lv: 2 },
        { h: 'Behaviour in words', k: 'words', kind: 'wide', lv: 3 }, { h: 'Orders (all time)', k: 'allOrders', kind: 'int', lv: 3 }, { h: 'Sales (all time) (₹)', k: 'allSales', kind: 'money', lv: 3 }, { h: 'Busiest hour', k: 'peak', kind: 'center', lv: 3 },
        { h: 'Ratings given to the shop', k: 'ratingN', kind: 'int', lv: 3 }, { h: 'Complaints (90 days)', k: 'complaints', kind: 'int', lv: 3 }, { h: 'Support requests open', k: 'tickets', kind: 'int', lv: 3 }, { h: 'App version', k: 'version', kind: 'center', lv: 3 }, { h: 'Blocked', k: 'blocked', kind: 'center', lv: 3 },
    ],
    async fetch(f, ctx) {
        const um = { role: 'admin', ...(ctx.scope ? { tenantId: { $in: ctx.scope } } : {}), ...inRange('createdAt', ctx.period) };
        const users = await User.find(um).sort({ createdAt: -1 }).limit(ctx.max * 2).select('tenantId name phone isBlocked createdAt lastLoginAt').lean();
        const ids = [...new Set(users.map((u) => String(u.tenantId)))].map(oid);
        const [tenants, st, inv, wallets, comp, tix, vers] = await Promise.all([
            Tenant.find({ _id: { $in: ids } }).select('name status billing plan brandId stats').lean(),
            shopRecent(ids, ctx.now),
            Promise.resolve([]),   // everything is prepaid: nobody owes anything
            require('../models/SmsWallet').find({ tenantId: { $in: ids } }).select('tenantId balancePaise').lean(),
            Complaint.aggregate([{ $match: { tenantId: { $in: ids }, createdAt: { $gte: new Date(ctx.now - 90 * DAY) } } }, { $group: { _id: '$tenantId', n: { $sum: 1 } } }]),
            require('../models/SupportTicket').aggregate([{ $match: { tenantId: { $in: ids }, status: 'open' } }, { $group: { _id: '$tenantId', n: { $sum: 1 } } }]),
            require('../models/AppVersionSeen').aggregate([{ $match: { tenantId: { $in: ids } } }, { $sort: { lastSeenAt: -1 } }, { $group: { _id: '$tenantId', version: { $first: '$version' } } }]),
        ]);
        const T = new Map(tenants.map((t) => [String(t._id), t]));
        const by = (arr, key = '_id') => new Map(arr.map((x) => [String(x[key]), x]));
        const I = by(inv); const W = by(wallets, 'tenantId'); const C = by(comp); const X = by(tix); const V = by(vers);
        const brands = new Map((await Brand.find({ _id: { $in: tenants.map((t) => t.brandId).filter(Boolean) } }).select('name').lean()).map((b) => [String(b._id), b.name]));
        let rows = users.map((u) => {
            const k = String(u.tenantId); const t = T.get(k) || {};
            return { u, t, s: st.get(k) || {}, inv: I.get(k), wallet: W.get(k), complaints: (C.get(k) || {}).n || 0, tickets: (X.get(k) || {}).n || 0, version: (V.get(k) || {}).version || '', brand: t.brandId ? brands.get(String(t.brandId)) || '' : '' };
        });
        rows = rows.filter((r) => {
            if (f.status && r.t.status !== f.status) return false;
            if (f.rent && planWord(r.t) !== f.rent) return false;
            const o = r.s.orders30 || 0;
            if (f.activity === 'busy' && o < 10) return false;
            if (f.activity === 'quiet' && !(o > 0 && o < 10)) return false;
            if (f.activity === 'none' && o !== 0) return false;
            const seen = r.u.lastLoginAt ? ctx.now - new Date(r.u.lastLoginAt).getTime() : null;
            if (f.login === 'week' && !(seen !== null && seen <= 7 * DAY)) return false;
            if (f.login === 'old' && !(seen === null || seen > 14 * DAY)) return false;
            return true;
        });
        return { count: rows.length, rows: ctx.countOnly ? [] : rows.slice(0, ctx.max) };
    },
    map(r, c) {
        const { u, t, s } = r;
        const o30 = s.orders30 || 0;
        const cancelPct = o30 ? Math.round(((s.cancelled30 || 0) / o30) * 100) : 0;
        const rating = t.stats && t.stats.rating && t.stats.rating.count ? t.stats.rating : null;
        const owed = r.inv ? r.inv.owed : 0;
        const seen = days(u.lastLoginAt, c.now);
        const lastOrder = days(s.lastOrder, c.now);
        const bits = [];
        if (!s.allOrders) bits.push('No order has ever come in.');
        else {
            bits.push(`${o30 ? `Gets about ${Math.max(1, Math.round(o30 / 30))} order${Math.round(o30 / 30) > 1 ? 's' : ''} a day (${o30} in 30 days)${s.peak !== undefined ? `, busiest around ${hourText(s.peak)}` : ''}.` : `No orders in the last 30 days; the last one was ${inDays(lastOrder)}.`}`);
            if (s.acceptMin != null) bits.push(`Accepts an order in about ${Math.max(1, Math.round(s.acceptMin))} min (${s.acceptMin <= 3 ? 'fast' : s.acceptMin <= 8 ? 'ordinary' : 'slow'}).`);
            if (o30 >= 5) bits.push(`${cancelPct}% of orders were cancelled${cancelPct >= 20 ? ' (high)' : ''}.`);
        }
        if (rating) bits.push(`Rated ${r2(rating.avg)} from ${rating.count} rating${rating.count === 1 ? '' : 's'}.`);
        const pw = planWord(t);
        bits.push(pw === 'paused' ? 'Paused: the plan was not renewed.' : pw === 'free' ? 'Still in the free period.' : pw === 'no plan' ? 'No plan yet.' : `On the ${pw} plan.`);
        bits.push(`Owner last logged in ${inDays(seen)}.`);
        bits.push(!s.allOrders ? 'Needs help to get the first order.' : o30 === 0 ? 'Quiet shop: worth a call.' : seen !== null && seen > 14 ? 'Shop runs but the owner is rarely in the app: worth a check.' : cancelPct >= 20 ? 'Many cancels: talk about why.' : 'Looks healthy.');
        return {
            shop: c.shop(u.tenantId), name: u.name || '', phone: c.phone(u.phone), status: t.status || '', rent: planWord(t), orders30: o30, sales30: r2(s.sales30), lastOrder: s.lastOrder || '',
            joined: u.createdAt, login: u.lastLoginAt || '', owed: r2(owed), overdue: r.inv ? r.inv.overdue : 0, sms: rs(r.wallet && r.wallet.balancePaise), rating: rating ? r2(rating.avg) : '', cancelPct,
            accept: s.acceptMin != null ? Math.round(s.acceptMin * 10) / 10 : '', brand: r.brand, words: bits.join(' '), allOrders: s.allOrders || 0, allSales: r2(s.allSales), peak: s.peak !== undefined ? hourText(s.peak) : '',
            ratingN: rating ? rating.count : 0, complaints: r.complaints, tickets: r.tickets, version: r.version, blocked: u.isBlocked ? 'Yes' : 'No',
        };
    },
};

D.brand_people = {
    title: 'Brand owners and branch managers', group: 'People', hint: 'Who runs each brand and each branch, with how their branches are doing.',
    shopField: 'tenantId', noPeriod: true,
    filters: [
        { key: 'role', label: 'Role', options: [['', 'Both'], ['brand', 'Brand owners'], ['branch', 'Branch managers']] },
        
    ],
    columns: [
        { h: 'Brand', k: 'brand', lv: 1 }, { h: 'Person', k: 'name', lv: 1 }, { h: 'Phone', k: 'phone', kind: 'center', lv: 1 }, { h: 'Role', k: 'role', kind: 'center', lv: 1 }, { h: 'Runs', k: 'runs', lv: 1 }, { h: 'Branches', k: 'branches', kind: 'int', lv: 1 },
        { h: 'Orders (30 days)', k: 'orders30', kind: 'int', lv: 2 }, { h: 'Sales (30 days) (₹)', k: 'sales30', kind: 'money', lv: 2 }, { h: 'Unpaid bills (₹)', k: 'owed', kind: 'money', lv: 2 }, { h: 'Last logged in', k: 'login', kind: 'date', lv: 2 }, { h: 'Joined', k: 'joined', kind: 'date', lv: 2 },
        { h: 'Behaviour in words', k: 'words', kind: 'wide', lv: 3 }, { h: 'Branch names', k: 'names', kind: 'wide', lv: 3 }, { h: 'City', k: 'city', lv: 3 }, { h: 'Gets brand alerts for', k: 'alerts', lv: 3 }, { h: 'Blocked', k: 'blocked', kind: 'center', lv: 3 },
    ],
    async fetch(f, ctx) {
        const tm = { brandId: { $ne: null }, ...(ctx.scope ? { _id: { $in: ctx.scope } } : {}) };
        const tenants = await Tenant.find(tm).select('name brandId address.city status').lean();
        const brandIds = [...new Set(tenants.map((t) => String(t.brandId)))];
        const brands = await Brand.find({ _id: { $in: brandIds } }).select('name ownerPhones ownerNotify').lean();
        const tids = tenants.map((t) => t._id);
        const [st, inv, owners] = await Promise.all([
            shopRecent(tids, ctx.now),
            Promise.resolve([]),   // everything is prepaid: nobody owes anything
            User.find({ role: 'admin', tenantId: { $in: tids } }).select('tenantId name phone isBlocked createdAt lastLoginAt').lean(),
        ]);
        const I = new Map(inv.map((x) => [String(x._id), x]));
        const byBrand = new Map();
        for (const t of tenants) { const k = String(t.brandId); if (!byBrand.has(k)) byBrand.set(k, []); byBrand.get(k).push(t); }
        const sum = (shops) => shops.reduce((a, t) => { const s = st.get(String(t._id)) || {}; const i = I.get(String(t._id)); return { orders: a.orders + (s.orders30 || 0), sales: a.sales + (s.sales30 || 0), owed: a.owed + (i ? i.owed : 0), unpaid: a.unpaid + (i ? i.n : 0) }; }, { orders: 0, sales: 0, owed: 0, unpaid: 0 });
        const rows = [];
        const known = new Map();   // phone -> user (an owner login), for the name of a brand owner
        for (const u of owners) known.set(String(u.phone), u);
        for (const b of brands) {
            const shops = byBrand.get(String(b._id)) || [];
            const phones = new Set((b.ownerPhones || []).map(String));
            for (const p of phones) {
                const u = known.get(p) || (await User.findOne({ role: 'admin', phone: p }).select('name phone isBlocked createdAt lastLoginAt').lean()) || { phone: p };
                const notify = (b.ownerNotify || []).find((n) => String(n.phone) === p);
                rows.push({ role: 'Brand owner', brand: b, person: u, shops, tot: sum(shops), runs: 'All branches', notify: notify ? (notify.all ? 'Every branch' : 'Own branch only') : 'Not set' });
            }
            for (const u of owners) {
                const t = shops.find((x) => String(x._id) === String(u.tenantId));
                if (!t || phones.has(String(u.phone))) continue;
                rows.push({ role: 'Branch manager', brand: b, person: u, shops: [t], tot: sum([t]), runs: t.name, notify: 'Own branch only' });
            }
        }
        const out = rows.filter((r) => (!f.role || (f.role === 'brand') === (r.role === 'Brand owner')) && (f.rent !== 'owing' || r.tot.unpaid > 0));
        return { count: out.length, rows: ctx.countOnly ? [] : out.slice(0, ctx.max) };
    },
    map(r, c) {
        const u = r.person || {};
        const seen = days(u.lastLoginAt, c.now);
        const best = [...r.shops].sort((a, b) => 0).length ? r.shops : [];
        const bits = [r.role === 'Brand owner' ? `Owns ${r.brand.name} with ${r.shops.length} branch${r.shops.length === 1 ? '' : 'es'}.` : `Manages the ${r.runs} branch of ${r.brand.name}.`];
        bits.push(r.tot.orders ? `${r.tot.orders} orders and ₹${Math.round(r.tot.sales)} sales in 30 days.` : 'No orders in 30 days.');
        bits.push(r.tot.unpaid ? `${r.tot.unpaid} unpaid bill${r.tot.unpaid === 1 ? '' : 's'} worth ₹${Math.round(r.tot.owed)}.` : 'Rent is paid up.');
        bits.push(`Last logged in ${inDays(seen)}.`);
        bits.push(r.tot.orders === 0 ? 'Quiet: worth a call.' : seen !== null && seen > 14 ? 'Rarely in the app: worth a check.' : 'Looks active.');
        return {
            brand: r.brand.name, name: u.name || '', phone: c.phone(u.phone), role: r.role, runs: r.runs, branches: r.shops.length, orders30: r.tot.orders, sales30: r2(r.tot.sales), owed: r2(r.tot.owed),
            login: u.lastLoginAt || '', joined: u.createdAt || '', words: bits.join(' '), names: best.map((t) => t.name).join(', '), city: [...new Set(r.shops.map((t) => t.address && t.address.city).filter(Boolean))].join(', '),
            alerts: r.notify, blocked: u.isBlocked ? 'Yes' : 'No',
        };
    },
};

D.staff = {
    title: 'Cooks and waiters', group: 'People', hint: 'The kitchen and floor staff of each shop, and what the cooks have handled.',
    shopField: 'tenantId', periodLabel: 'Joined between', periodOn: true,
    filters: [
        { key: 'role', label: 'Role', options: [['', 'Both'], ['kitchen', 'Cooks'], ['waiter', 'Waiters']] },
        { key: 'active', label: 'Status', options: [['', 'Any'], ['yes', 'Active'], ['no', 'Paused by the owner']] },
        { key: 'duty', label: 'Duty', options: [['', 'Any'], ['on', 'On duty now'], ['off', 'Off duty']] },
    ],
    columns: [
        { h: 'Shop', k: 'shop', lv: 1 }, { h: 'Name', k: 'name', lv: 1 }, { h: 'Role', k: 'role', kind: 'center', lv: 1 }, { h: 'Phone', k: 'phone', kind: 'center', lv: 1 }, { h: 'Status', k: 'status', kind: 'status', lv: 1 }, { h: 'On duty now', k: 'onDuty', kind: 'center', lv: 1 }, { h: 'Last active', k: 'seen', kind: 'date', lv: 1 },
        { h: 'Joined', k: 'joined', kind: 'date', lv: 2 }, { h: 'Duty set by', k: 'mode', kind: 'center', lv: 2 }, { h: 'Holidays planned', k: 'holidays', kind: 'int', lv: 2 }, { h: 'Orders cooked (30 days)', k: 'cooked30', kind: 'int', lv: 2 }, { h: 'Cooking time (min, avg)', k: 'cookMin', kind: 'center', lv: 2 },
        { h: 'Behaviour in words', k: 'words', kind: 'wide', lv: 3 }, { h: 'Orders cooked (all time)', k: 'cookedAll', kind: 'int', lv: 3 }, { h: 'Problems told to the owner (30 days)', k: 'problems', kind: 'int', lv: 3 }, { h: 'Off until', k: 'offUntil', kind: 'date', lv: 3 }, { h: 'Blocked', k: 'blocked', kind: 'center', lv: 3 },
    ],
    async fetch(f, ctx) {
        const Staff = require('../models/Staff');
        const m = { ...(ctx.scope ? { tenantId: { $in: ctx.scope } } : {}), ...inRange('createdAt', ctx.period) };
        if (['kitchen', 'waiter'].includes(f.role)) m.role = f.role;
        if (f.active === 'yes') m.isActive = { $ne: false };
        if (f.active === 'no') m.isActive = false;
        const staff = await Staff.find(m).sort({ createdAt: -1 }).limit(ctx.max).lean();
        const uids = staff.map((s) => s.userId);
        const users = new Map((await User.find({ _id: { $in: uids } }).select('phone name isBlocked lastLoginAt').lean()).map((u) => [String(u._id), u]));
        const since = new Date(ctx.now - 30 * DAY);
        const [all, rec] = await Promise.all([
            Order.aggregate([{ $match: { 'kitchen.readyBy': { $in: uids } } }, { $group: { _id: '$kitchen.readyBy', n: { $sum: 1 } } }]),
            Order.aggregate([{ $match: { createdAt: { $gte: since }, $or: [{ 'kitchen.readyBy': { $in: uids } }, { 'kitchen.startedBy': { $in: uids } }] } },
                { $group: { _id: '$kitchen.readyBy', n: { $sum: 1 }, cookMin: { $avg: { $cond: [{ $and: [{ $ifNull: ['$kitchen.startedAt', false] }, { $ifNull: ['$kitchen.readyAt', false] }] }, { $divide: [{ $subtract: ['$kitchen.readyAt', '$kitchen.startedAt'] }, 60000] }, null] } }, problems: { $sum: { $cond: [{ $ifNull: ['$kitchen.problem.at', false] }, 1, 0] } } } }]),
        ]);
        const A = new Map(all.map((x) => [String(x._id), x.n])); const R = new Map(rec.map((x) => [String(x._id), x]));
        const nowOn = (s) => s.isActive !== false && !(s.duty && s.duty.offUntil && new Date(s.duty.offUntil).getTime() > ctx.now) && !(s.duty && s.duty.online === false);
        let rows = staff.map((s) => ({ s, u: users.get(String(s.userId)) || {}, cookedAll: A.get(String(s.userId)) || 0, r: R.get(String(s.userId)) || {} }));
        if (f.duty === 'on') rows = rows.filter((x) => nowOn(x.s));
        if (f.duty === 'off') rows = rows.filter((x) => !nowOn(x.s));
        // the average cooking time of all cooks, to say "faster / slower than the others"
        const times = rows.map((x) => x.r.cookMin).filter((v) => v != null);
        const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
        for (const x of rows) { x.avgAll = avg; x.on = nowOn(x.s); }
        return { count: rows.length, rows: ctx.countOnly ? [] : rows };
    },
    map(x, c) {
        const { s, u, r } = x;
        const cook = s.role === 'kitchen';
        const seen = days(s.lastSeenAt || u.lastLoginAt, c.now);
        const bits = [cook ? 'Cook.' : 'Waiter.'];
        if (cook) {
            if (r.n) {
                const m = Math.max(1, Math.round(r.cookMin || 0));
                bits.push(`Handled ${r.n} order${r.n === 1 ? '' : 's'} in 30 days${r.cookMin != null ? `, about ${m} min each${x.avgAll ? (r.cookMin < x.avgAll * 0.8 ? ' (faster than the other cooks)' : r.cookMin > x.avgAll * 1.25 ? ' (slower than the other cooks)' : ' (like the other cooks)') : ''}` : ''}.`);
                if (r.problems) bits.push(`Told the owner about ${r.problems} problem${r.problems === 1 ? '' : 's'}.`);
            } else bits.push('Did not handle an order in the last 30 days.');
        }
        bits.push(s.isActive === false ? 'Paused by the owner.' : x.on ? 'On duty now.' : 'Off duty now.');
        bits.push(`Last active ${inDays(seen)}.`);
        bits.push(s.isActive === false ? 'Not working at the moment.' : seen !== null && seen > 14 ? 'Not seen for two weeks: check if still working.' : cook && !r.n ? 'Check if the kitchen screen is being used.' : 'Looks active.');
        return {
            shop: c.shop(s.tenantId), name: s.name || u.name || '', role: cook ? 'Cook' : 'Waiter', phone: c.phone(u.phone), status: s.isActive === false ? 'paused' : 'active', onDuty: x.on ? 'Yes' : 'No', seen: s.lastSeenAt || u.lastLoginAt || '',
            joined: s.createdAt, mode: (s.duty && s.duty.mode) || 'manual', holidays: (s.holidays || []).length, cooked30: cook ? r.n || 0 : '', cookMin: cook && r.cookMin != null ? Math.round(r.cookMin * 10) / 10 : '',
            words: bits.join(' '), cookedAll: cook ? x.cookedAll : '', problems: cook ? r.problems || 0 : '', offUntil: (s.duty && s.duty.offUntil) || '', blocked: u.isBlocked ? 'Yes' : 'No',
        };
    },
};

D.shop_costs = {
    title: 'My costs', group: 'My business', hint: 'What you wrote down as costs of the shop (ingredients, salaries, rent...).',
    model: ShopExpense, shopField: 'tenantId', dateField: 'date', periodLabel: 'Spent between', sort: { date: -1 },
    filters: [{ key: 'category', label: 'Kind', options: [['', 'Any'], ...ShopExpense.CATEGORIES.map((x) => [x, nice(x)])] }],
    where: (f) => (ShopExpense.CATEGORIES.includes(f.category) ? { category: f.category } : {}),
    columns: [
        { h: 'Date', k: 'date', kind: 'date', lv: 1 }, { h: 'Shop', k: 'shop', lv: 1 }, { h: 'Kind', k: 'cat', lv: 1 }, { h: 'Amount (₹)', k: 'amount', kind: 'money', lv: 1 },
        { h: 'Paid to', k: 'vendor', lv: 2 }, { h: 'Note', k: 'note', kind: 'wide', lv: 2 }, { h: 'Repeats monthly', k: 'repeat', kind: 'center', lv: 2 }, { h: 'Stops after', k: 'ends', kind: 'date', lv: 3 }, { h: 'Added by', k: 'by', lv: 3 },
    ],
    map: (e, c) => ({ date: e.date, shop: c.shop(e.tenantId), cat: e.category === 'other' && e.otherName ? 'other: ' + e.otherName : nice(e.category), amount: rs(e.amountPaise), vendor: e.vendor || '', note: e.note || '', repeat: e.repeatMonthly ? 'Yes' : '', ends: e.endsOn || '', by: e.createdBy || '' }),
};

D.branches = {
    title: 'My shops and branches', group: 'My business', hint: 'Each shop or branch of yours: sales, orders, rent, team size and how it is doing.',
    shopField: '_id', noPeriod: true,
    filters: [{ key: 'status', label: 'Shop', options: [['', 'Any'], ['active', 'Open'], ['suspended', 'Suspended']] }],
    columns: [
        { h: 'Shop', k: 'name', lv: 1 }, { h: 'City', k: 'city', lv: 1 }, { h: 'Status', k: 'status', kind: 'status', lv: 1 }, { h: 'Manager', k: 'manager', lv: 1 },
        { h: 'Orders (30 days)', k: 'orders30', kind: 'int', lv: 1 }, { h: 'Sales (30 days) (₹)', k: 'sales30', kind: 'money', lv: 1 }, { h: 'Plan', k: 'rent', kind: 'status', lv: 1 },
        { h: 'Delivered (30 days)', k: 'delivered30', kind: 'int', lv: 2 }, { h: 'Cancelled (30 days) %', k: 'cancelPct', kind: 'int', lv: 2 }, { h: 'Rating', k: 'rating', kind: 'center', lv: 2 }, { h: 'Accepts an order in (min)', k: 'accept', kind: 'center', lv: 2 },
        { h: 'Unpaid bills (₹)', k: 'owed', kind: 'money', lv: 2 }, { h: 'SMS balance (₹)', k: 'sms', kind: 'money', lv: 2 }, { h: 'Customers', k: 'customers', kind: 'int', lv: 2 }, { h: 'Riders', k: 'riders', kind: 'int', lv: 2 }, { h: 'Cooks', k: 'cooks', kind: 'int', lv: 2 }, { h: 'Waiters', k: 'waiters', kind: 'int', lv: 2 },
        { h: 'Behaviour in words', k: 'words', kind: 'wide', lv: 3 }, { h: 'Orders (all time)', k: 'allOrders', kind: 'int', lv: 3 }, { h: 'Sales (all time) (₹)', k: 'allSales', kind: 'money', lv: 3 }, { h: 'Busiest hour', k: 'peak', kind: 'center', lv: 3 }, { h: 'Last order', k: 'lastOrder', kind: 'date', lv: 3 }, { h: 'Complaints (90 days)', k: 'complaints', kind: 'int', lv: 3 }, { h: 'Open since', k: 'joined', kind: 'date', lv: 3 },
    ],
    async fetch(f, ctx) {
        const SmsWallet = require('../models/SmsWallet');
        const m = { ...(ctx.scope ? { _id: { $in: ctx.scope } } : {}), ...(['active', 'suspended'].includes(f.status) ? { status: f.status } : {}) };
        const tenants = await Tenant.find(m).sort({ createdAt: 1 }).select('name status billing plan address.city branchCity stats createdAt').lean();
        if (ctx.countOnly) return { count: tenants.length };
        const ids = tenants.map((t) => t._id);
        const [st, inv, wallets, comp, people, admins] = await Promise.all([
            shopRecent(ids, ctx.now),
            Promise.resolve([]),   // everything is prepaid: nobody owes anything
            SmsWallet.find({ tenantId: { $in: ids } }).select('tenantId balancePaise').lean(),
            Complaint.aggregate([{ $match: { tenantId: { $in: ids }, createdAt: { $gte: new Date(ctx.now - 90 * DAY) } } }, { $group: { _id: '$tenantId', n: { $sum: 1 } } }]),
            User.aggregate([{ $match: { tenantId: { $in: ids }, role: { $in: ['customer', 'rider', 'kitchen', 'waiter'] } } }, { $group: { _id: { t: '$tenantId', r: '$role' }, n: { $sum: 1 } } }]),
            User.find({ tenantId: { $in: ids }, role: 'admin' }).select('tenantId name phone').lean(),
        ]);
        const I = new Map(inv.map((x) => [String(x._id), x])); const W = new Map(wallets.map((x) => [String(x.tenantId), x])); const C = new Map(comp.map((x) => [String(x._id), x.n]));
        const P = new Map(); for (const x of people) P.set(`${x._id.t}:${x._id.r}`, x.n);
        const A = new Map(); for (const u of admins) { const k = String(u.tenantId); if (!A.has(k)) A.set(k, []); A.get(k).push(u); }
        return { count: tenants.length, rows: tenants.map((t) => ({ t, s: st.get(String(t._id)) || {}, inv: I.get(String(t._id)), wallet: W.get(String(t._id)), complaints: C.get(String(t._id)) || 0, admins: A.get(String(t._id)) || [], n: (r) => P.get(`${t._id}:${r}`) || 0 })) };
    },
    map(r, c) {
        const { t, s } = r;
        const o30 = s.orders30 || 0;
        const cancelPct = o30 ? Math.round(((s.cancelled30 || 0) / o30) * 100) : 0;
        const rating = t.stats && t.stats.rating && t.stats.rating.count ? t.stats.rating : null;
        const owed = r.inv ? r.inv.owed : 0;
        const lastOrder = days(s.lastOrder, c.now);
        const bits = [];
        if (!s.allOrders) bits.push('No order has come in yet.');
        else {
            bits.push(o30 ? `Gets about ${Math.max(1, Math.round(o30 / 30))} order${Math.round(o30 / 30) > 1 ? 's' : ''} a day (${o30} in 30 days)${s.peak !== undefined ? `, busiest around ${hourText(s.peak)}` : ''}.` : `No orders in the last 30 days; the last one was ${inDays(lastOrder)}.`);
            if (s.acceptMin != null) bits.push(`Accepts an order in about ${Math.max(1, Math.round(s.acceptMin))} min (${s.acceptMin <= 3 ? 'fast' : s.acceptMin <= 8 ? 'ordinary' : 'slow'}).`);
            if (o30 >= 5) bits.push(`${cancelPct}% of orders were cancelled${cancelPct >= 20 ? ' (high)' : ''}.`);
        }
        if (rating) bits.push(`Rated ${r2(rating.avg)} from ${rating.count} rating${rating.count === 1 ? '' : 's'}.`);
        bits.push(`Team: ${r.n('kitchen')} cook${r.n('kitchen') === 1 ? '' : 's'}, ${r.n('waiter')} waiter${r.n('waiter') === 1 ? '' : 's'}, ${r.n('rider')} rider${r.n('rider') === 1 ? '' : 's'}; ${r.n('customer')} customers.`);
        const pw = planWord(t);
        bits.push(pw === 'paused' ? 'Paused: the plan was not renewed.' : pw === 'free' ? 'Still in the free period.' : pw === 'no plan' ? 'No plan yet.' : `On the ${pw} plan.`);
        bits.push(!s.allOrders ? 'Needs the first order.' : o30 === 0 ? 'Quiet: think of an offer or a message to customers.' : cancelPct >= 20 ? 'Many cancels: find out why.' : r.n('rider') === 0 && o30 > 0 ? 'No riders yet.' : 'Looks healthy.');
        return {
            name: t.name, city: t.branchCity || (t.address && t.address.city) || '', status: t.status, manager: r.admins.map((u) => `${u.name || ''} ${c.phone(u.phone)}`.trim()).join(', '),
            orders30: o30, sales30: r2(s.sales30), rent: planWord(t), delivered30: s.delivered30 || 0, cancelPct, rating: rating ? r2(rating.avg) : '', accept: s.acceptMin != null ? Math.round(s.acceptMin * 10) / 10 : '',
            owed: r2(owed), sms: rs(r.wallet && r.wallet.balancePaise), customers: r.n('customer'), riders: r.n('rider'), cooks: r.n('kitchen'), waiters: r.n('waiter'),
            words: bits.join(' '), allOrders: s.allOrders || 0, allSales: r2(s.allSales), peak: s.peak !== undefined ? hourText(s.peak) : '', lastOrder: s.lastOrder || '', complaints: r.complaints, joined: t.createdAt,
        };
    },
};

const ORDER = ['customers', 'owners', 'brand_people', 'staff', 'riders', 'orders', 'bulk_orders', 'invoices', 'payments', 'refunds', 'complaints', 'menu', 'shops', 'sms_topups', 'sms_sent', 'expenses', 'audit', 'branches', 'shop_costs'];

// ----- the engine -----
const hasPeriod = (d) => !d.noPeriod && (d.dateField !== undefined || !!d.periodOn);
// Plans without full exports (Partner, Growth): the money columns only, never a customer's name, phone or address (q.moneyOnly === '1', set by the owner's export route)
const PII_KEYS = new Set(['customer', 'phone', 'address', 'company', 'gstin', 'note', 'rider', 'name', 'email', 'landmark']);
const cols = (d, lv, moneyOnly) => d.columns.filter((c) => c.lv <= lv && !(moneyOnly && PII_KEYS.has(c.k)));

const SHOP_ONLY = ['branches', 'shop_costs'];   // exports that are the owner's own, not the platform's
function catalog({ keys, moneyOnly } = {}) {
    return ORDER.filter((k) => (keys ? keys.includes(k) : !SHOP_ONLY.includes(k))).map((key) => {
        const d = D[key];
        return {
            key, title: d.title, group: d.group, hint: d.hint, shops: d.shopField !== null, period: hasPeriod(d), periodLabel: d.periodLabel || 'Between',
            filters: (d.filters || []).map((f) => ({ key: f.key, label: f.label, multi: !!f.multi, options: f.options })),
            levels: Object.fromEntries(Object.keys(LEVELS).map((n) => [n, { label: LEVEL_NAME[n], columns: cols(d, LEVELS[n], moneyOnly).map((c) => c.h), extra: n === 'everything' && !!d.extraSheets }])),
        };
    });
}

async function context(d, q, full, forced) {
    const names = new Map((await Tenant.find({}).select('name').lean()).map((t) => [String(t._id), t.name]));
    const lv = LEVELS[q.level] || 2;
    return {
        now: Date.now(), lv, max: q.format === 'csv' ? CSV_MAX : MAX_ROWS, scope: forced || (await scopeOf(q)), period: periodOf(q),
        shop: (id) => names.get(String(id)) || '',
        phone: (p) => (full ? (p || '') : (maskPhone(p) || '')),
    };
}
function filtersOf(d, q) { return Object.fromEntries((d.filters || []).map((f) => [f.key, q[f.key] === undefined ? '' : String(q[f.key])])); }

function matchFor(d, f, ctx) {
    const m = { ...(d.baseWhere || {}), ...(d.where ? d.where(f) : {}) };
    if (d.shopField && ctx.scope) m[d.shopField] = { $in: ctx.scope };
    if (d.dateField) Object.assign(m, inRange(d.dateField, ctx.period));
    return m;
}

// { count, capped }
async function count(key, q, { full = false, forced } = {}) {
    const d = D[key];
    if (!d) throw httpError(404, 'Unknown export');
    const ctx = await context(d, q, full, forced);
    ctx.countOnly = true;
    const f = filtersOf(d, q);
    const n = d.fetch ? (await d.fetch(f, ctx)).count : await d.model.countDocuments(matchFor(d, f, ctx));
    return { count: n, max: ctx.max, capped: n > ctx.max };
}

async function rowsFor(key, q, full, forced) {
    const d = D[key];
    if (!d) throw httpError(404, 'Unknown export');
    const ctx = await context(d, q, full, forced);
    const f = filtersOf(d, q);
    let docs; let total;
    if (d.fetch) { const r = await d.fetch(f, ctx); docs = r.rows; total = r.count; } else {
        const m = matchFor(d, f, ctx);
        [docs, total] = await Promise.all([d.model.find(m).sort(d.sort || { _id: -1 }).limit(ctx.max).lean(), d.model.countDocuments(m)]);
    }
    if (d.prepare) await d.prepare(docs, ctx);
    const columns = cols(d, ctx.lv, q.moneyOnly === '1');
    const rows = docs.map((x) => d.map(x, ctx));
    return { d, ctx, docs, columns, rows, total, f };
}

const periodText = (ctx) => (ctx.period.from || ctx.period.to ? `${ctx.period.from ? fmtDay(ctx.period.from) : 'the beginning'} to ${ctx.period.to ? fmtDay(new Date(ctx.period.to.getTime() - DAY)) : 'today'}` : 'All time');

// the Excel file: a Summary sheet first (what you asked for, in words), then the data, then any extra sheet
async function workbook(key, q, { full = false, admin = '', forced } = {}) {
    const { d, ctx, docs, columns, rows, total, f } = await rowsFor(key, q, full, forced);
    const lvName = Object.keys(LEVELS).find((n) => LEVELS[n] === ctx.lv);
    const shopsText = ctx.scope ? `${ctx.scope.length} shop${ctx.scope.length === 1 ? '' : 's'} chosen` : 'All shops';
    const filterText = (d.filters || []).map((x) => { const v = list(f[x.key]); if (!v.length) return null; return `${x.label}: ${v.map((id) => (x.options.find((o) => o[0] === id) || [id, id])[1]).join(', ')}`; }).filter(Boolean).join(' · ') || 'None';
    const summary = [
        { a: 'Export', b: d.title }, { a: 'Detail', b: `${LEVEL_NAME[lvName]} (${columns.length} columns)` }, { a: 'Shops', b: d.shopField === null ? 'Not per shop' : shopsText },
        { a: d.periodLabel || 'Period', b: hasPeriod(d) ? periodText(ctx) : 'Not used' }, { a: 'Filters', b: filterText },
        { a: 'Rows', b: String(rows.length) }, { a: 'Phone numbers', b: full ? 'Full' : 'Hidden in the middle' },
        ...(total > rows.length ? [{ a: 'Note', b: `${total} rows match; the file holds the first ${rows.length}. Narrow the period or pick fewer shops, or choose CSV (up to ${CSV_MAX}), and download again.` }] : []),
        { a: 'Made by', b: admin || 'Superadmin' }, { a: 'Made on', b: new Date(ctx.now) },
    ].map((x) => ({ a: x.a, b: x.b }));
    const sheets = [
        { title: 'Summary', columns: [{ header: 'What', key: 'a', width: 22 }, { header: 'Value', key: 'b', kind: 'wide', width: 60 }], rows: summary.map((x) => ({ a: x.a, b: x.b instanceof Date ? x.b.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : x.b })) },
        { title: d.title, columns: columns.map((c) => ({ header: c.h, key: c.k, kind: c.kind })), rows, total: columns.some((c) => c.kind === 'money') && key !== 'customers' && key !== 'shops' },
        ...(d.extraSheets ? d.extraSheets(docs, ctx, ctx.lv) : []),
    ];
    return { buf: await buildWorkbook(sheets), rows: rows.length, total };
}

const csvCell = (v) => {
    if (typeof v === 'number') return String(v);
    let s = v instanceof Date ? new Date(v.getTime() + IST).toISOString().replace('T', ' ').slice(0, 16) : String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = `'${s}`;   // a text that starts like a formula stays text in Excel
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
async function csv(key, q, { full = false, forced } = {}) {
    const { columns, rows, total } = await rowsFor(key, q, full, forced);
    const head = columns.map((c) => csvCell(c.h)).join(',');
    const body = rows.map((r) => columns.map((c) => csvCell(r[c.k])).join(',')).join('\r\n');
    return { text: `﻿${head}\r\n${body}`, rows: rows.length, total };
}

const OWNER_KEYS = ['customers', 'orders', 'bulk_orders', 'riders', 'staff', 'branches', 'menu', 'complaints', 'invoices', 'shop_costs'];
module.exports = { OWNER_KEYS, catalog, count, workbook, csv, MAX_ROWS, CSV_MAX, DATASETS: D, ORDER };
