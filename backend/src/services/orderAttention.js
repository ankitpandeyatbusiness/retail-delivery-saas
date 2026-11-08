// The Orders tab's "Needs attention" and "Live now": orders that are in trouble, and what every shop has running right now.
// Read-only. Every rule is plain (a status held too long, no rider, money not settled) so the superadmin knows why an order is listed.
const Order = require('../models/Order');
const Tenant = require('../models/Tenant');

const ACTIVE = ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery'];
const MIN = 60000;

const watch = require('./orderWatchSettings');
// minutes an order may stay in a state before it is called stuck (the superadmin sets them: orderWatchSettings.attention)
const limitsOf = (a) => ({ notAccepted: a.accept, cooking: a.cooking, noRider: a.noRider, onTheWay: a.onWay, payment: a.payment });
const LIMITS = limitsOf(watch.defaults().attention);

const LABEL = {
    not_accepted: 'Shop has not accepted',
    cooking_long: 'Taking too long to prepare',
    no_rider: 'No rider yet',
    on_way_long: 'On the way for too long',
    payment_pending: 'Online payment not completed',
    payment_failed: 'Payment failed',
    refund_due: 'Cancelled after payment, refund not done',
    cancel_asked: 'Customer asked to cancel',
};
// lower = more urgent
const RANK = { refund_due: 1, no_rider: 2, not_accepted: 3, cancel_asked: 4, on_way_long: 5, cooking_long: 6, payment_failed: 7, payment_pending: 8 };

const mins = (from, now) => Math.max(0, Math.round((now - new Date(from).getTime()) / MIN));
const lastAt = (o, status) => {
    const h = (o.statusHistory || []).filter((x) => x.status === status);
    return h.length ? h[h.length - 1].at : o.createdAt;
};

// the first (most urgent) problem of one order, or null
function problemOf(o, now, LIMITS = limitsOf(watch.defaults().attention)) {
    const online = o.payment?.method && o.payment.method !== 'cod';
    // (money the shop chose to KEEP, all of it, is not owed back: only a paid order with no refund and no kept money is flagged)
    if (o.status === 'cancelled' && online && o.payment?.status === 'paid' && !(o.cancel?.refundPaise > 0) && !((o.cancel?.keptPaise || 0) >= Math.round((o.pricing?.total || 0) * 100))) {
        return { code: 'refund_due', since: lastAt(o, 'cancelled') };
    }
    if (!ACTIVE.includes(o.status)) return null;
    if (o.scheduledFor && new Date(o.scheduledFor).getTime() > now) return null;   // booked for later: not late yet
    if (o.cancelRequest?.at) return { code: 'cancel_asked', since: o.cancelRequest.at };
    const riderless = o.orderType === 'delivery' && (!o.delivery?.riderId || o.delivery?.status === 'rejected');
    if (o.status === 'placed' && mins(o.createdAt, now) >= LIMITS.notAccepted && !(online && o.payment?.status === 'pending')) return { code: 'not_accepted', since: o.createdAt };
    if (o.status === 'ready' && riderless && mins(lastAt(o, 'ready'), now) >= LIMITS.noRider) return { code: 'no_rider', since: lastAt(o, 'ready') };
    if (o.status === 'out_for_delivery' && mins(lastAt(o, 'out_for_delivery'), now) >= LIMITS.onTheWay) return { code: 'on_way_long', since: lastAt(o, 'out_for_delivery') };
    if ((o.status === 'accepted' || o.status === 'preparing') && mins(lastAt(o, o.status), now) >= LIMITS.cooking) return { code: 'cooking_long', since: lastAt(o, o.status) };
    if (online && o.payment?.status === 'pending' && mins(o.createdAt, now) >= LIMITS.payment) return { code: 'payment_pending', since: o.createdAt };
    if (online && o.payment?.status === 'failed') return { code: 'payment_failed', since: o.createdAt };
    return null;
}

async function shopNames(ids) {
    const shops = await Tenant.find({ _id: { $in: ids } }).select('name slug').lean();
    return new Map(shops.map((s) => [String(s._id), s]));
}

// { counts: { code: n, total }, items: [{ code, label, minutes, order }] } for the last 3 days of orders (7 for refunds)
async function attention({ tenantId, now = Date.now() } = {}) {
    const since = new Date(now - 3 * 86400000);
    const filter = {
        ...(tenantId ? { tenantId } : {}),
        $or: [
            { status: { $in: ACTIVE }, createdAt: { $gte: new Date(now - 7 * 86400000) } },
            { status: 'cancelled', 'payment.status': 'paid', createdAt: { $gte: new Date(now - 7 * 86400000) } },
            { 'payment.status': { $in: ['failed', 'pending'] }, status: { $ne: 'cancelled' }, createdAt: { $gte: since } },
        ],
    };
    const limits = limitsOf((await watch.get()).attention);
    const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(400);
    const found = [];
    for (const o of orders) {
        const p = problemOf(o, now, limits);
        if (p) found.push({ code: p.code, label: LABEL[p.code], minutes: mins(p.since, now), order: o });
    }
    // an order the superadmin marked "handled by hand" for this very problem leaves the list (it comes back if a different problem appears)
    const marks = await require('./handledMarks').mapFor('order_problem', now);
    const mine = (f) => marks.get(`${f.order._id}:${f.code}`);
    const doneFound = found.filter(mine);
    found.splice(0, found.length, ...found.filter((f) => !mine(f)));
    found.sort((a, b) => (RANK[a.code] - RANK[b.code]) || (b.minutes - a.minutes));
    const top = found.slice(0, 100);
    const doneTop = doneFound.slice(0, 30);
    const names = await shopNames([...new Set([...top, ...doneTop].map((f) => String(f.order.tenantId)))]);
    const counts = { total: found.length };
    for (const f of found) counts[f.code] = (counts[f.code] || 0) + 1;
    const refundsOpen = await require('../models/OnlineRefund').countDocuments({ status: { $in: ['pending', 'processing', 'failed'] }, ...(tenantId ? { tenantId } : {}) });
    return {
        counts, refundsOpen,
        items: top.map((f) => ({
            code: f.code, label: f.label, minutes: f.minutes,
            order: { ...f.order.toJSON(), shopName: names.get(String(f.order.tenantId))?.name || 'Unknown shop' },
            refId: `${f.order._id}:${f.code}`,
        })),
        handled: doneTop.map((f) => ({
            code: f.code, label: f.label, minutes: f.minutes, refId: `${f.order._id}:${f.code}`, mark: mine(f),
            order: { ...f.order.toJSON(), shopName: names.get(String(f.order.tenantId))?.name || 'Unknown shop' },
        })),
    };
}

// every shop that has orders running, with how many in each stage and how long the oldest has waited, plus today's totals
async function live({ now = Date.now() } = {}) {
    const rows = await Order.find({ status: { $in: ACTIVE }, createdAt: { $gte: new Date(now - 2 * 86400000) } }).select('tenantId status createdAt scheduledFor orderType').lean();
    const by = new Map();
    for (const o of rows) {
        if (o.scheduledFor && new Date(o.scheduledFor).getTime() > now) continue;
        const k = String(o.tenantId);
        const r = by.get(k) || { tenantId: k, total: 0, placed: 0, kitchen: 0, ready: 0, onWay: 0, oldestMin: 0 };
        r.total += 1;
        if (o.status === 'placed') r.placed += 1;
        else if (o.status === 'accepted' || o.status === 'preparing') r.kitchen += 1;
        else if (o.status === 'ready') r.ready += 1;
        else r.onWay += 1;
        r.oldestMin = Math.max(r.oldestMin, mins(o.createdAt, now));
        by.set(k, r);
    }
    const names = await shopNames([...by.keys()]);
    const shops = [...by.values()].map((r) => ({ ...r, shopName: names.get(r.tenantId)?.name || 'Unknown shop' })).sort((a, b) => b.oldestMin - a.oldestMin);

    const ist = new Date(now + 330 * MIN); ist.setUTCHours(0, 0, 0, 0);
    const start = new Date(ist.getTime() - 330 * MIN);
    const today = await Order.aggregate([
        { $match: { createdAt: { $gte: start } } },
        { $group: { _id: '$status', n: { $sum: 1 }, sum: { $sum: '$pricing.total' } } },
    ]);
    const t = { orders: 0, delivered: 0, cancelled: 0, sales: 0 };
    for (const g of today) {
        t.orders += g.n;
        if (g._id === 'delivered') { t.delivered = g.n; t.sales = g.sum || 0; }
        if (g._id === 'cancelled' || g._id === 'undelivered') t.cancelled += g.n;
    }
    return { running: rows.length, shops, today: t };
}

module.exports = { attention, live, problemOf, LIMITS, LABEL };
