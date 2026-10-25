// Where an order is in the kitchen, for the guest: "2 orders ahead of yours", "being cooked now", and about how long it will take.
// The same list the cooks see (oldest start first). The time is an estimate: how long this shop really takes to cook (its last orders), and how
// many orders it cooks at the same time (staff.kitchenLanes). Shown only when the kitchen screen is on and the super admin allows it
// (staff.queueShown, staff.queueEta). Never throws: no queue information is better than a failed order page.
const Order = require('../models/Order');
const staffService = require('./staffService');
const kitchen = require('./kitchenService');

const WAITING = ['accepted', 'preparing'];
const FIELDS = 'orderNo orderType status scheduledFor createdAt statusHistory kitchen';
const LATER_MIN = 45;   // a pickup for much later is not "in the queue" yet

// how long the kitchen takes to cook one order: the average of the last orders (cached for a minute)
const cooked = new Map();   // tenantId -> { at, min }
async function cookMinutes(tenant) {
    const key = String(tenant._id);
    const hit = cooked.get(key);
    if (hit && Date.now() - hit.at < 60000) return hit.min;
    const rows = await Order.find({
        tenantId: tenant._id, 'kitchen.readyAt': { $gte: new Date(Date.now() - 14 * 86400000) }, 'kitchen.startedAt': { $exists: true },
    }).sort({ 'kitchen.readyAt': -1 }).limit(40).select('kitchen.startedAt kitchen.readyAt').lean();
    const mins = rows.map((o) => (new Date(o.kitchen.readyAt) - new Date(o.kitchen.startedAt)) / 60000).filter((m) => m >= 1 && m <= 120);
    const fallback = tenant.settings?.orders?.prepTimeMin ?? 20;
    const min = mins.length >= 5 ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : fallback;
    const out = Math.min(60, Math.max(3, min));
    cooked.set(key, { at: Date.now(), min: out });
    return out;
}

async function snapshot(tenant) {
    const rules = staffService.rulesOf(tenant);
    if (rules.kitchenOn !== true || rules.queueShown === false) return null;
    const types = rules.kitchenSees || ['delivery', 'pickup', 'dine_in'];
    const now = Date.now();
    const rows = await Order.find({ tenantId: tenant._id, orderType: { $in: types }, status: { $in: WAITING } }).select(FIELDS).limit(300).lean();
    const lateMin = rules.lateMin || 20;
    const make = rows.map((o) => kitchen.viewOf(o, { lateMin, now })).filter((o) => o.stage !== 'ready')
        .sort((a, b) => new Date(a.startAt) - new Date(b.startAt) || a.orderNo - b.orderNo);
    return { make, avg: await cookMinutes(tenant), lanes: Math.max(1, rules.kitchenLanes || 3), eta: rules.queueEta !== false, types, now };
}

// one order's place in the queue (or null when there is nothing to say)
function infoFor(snap, order) {
    if (!snap || order.orderType !== 'dine_in' || !snap.types.includes(order.orderType)) return null;   // only a table order shows its place in the kitchen queue
    if (order.kitchen?.readyAt || order.status === 'ready') return { stage: 'ready' };
    if (!WAITING.includes(order.status)) return null;
    const idx = snap.make.findIndex((o) => o.id === String(order._id));
    if (idx < 0) return null;
    const me = snap.make[idx];
    if (me.stage === 'cooking') {
        const gone = Math.floor((snap.now - new Date(order.kitchen?.startedAt || me.startAt).getTime()) / 60000);
        return { stage: 'cooking', position: idx + 1, ahead: idx, total: snap.make.length, etaMin: snap.eta ? Math.max(1, Math.ceil(snap.avg - gone)) : null };
    }
    if (order.scheduledFor && new Date(order.scheduledFor).getTime() - snap.now > LATER_MIN * 60000) return null;
    const waves = Math.floor(idx / snap.lanes);
    return { stage: 'waiting', position: idx + 1, ahead: idx, total: snap.make.length, etaMin: snap.eta ? Math.ceil(snap.avg * (1 + waves)) : null };
}

// orders: Order documents (or lean). Returns Map(id -> info) for the ones that have something to show.
async function forOrders(tenant, orders) {
    const out = new Map();
    try {
        const list = (orders || []).filter((o) => o && (WAITING.includes(o.status) || o.status === 'ready'));
        if (!list.length) return out;
        const snap = await snapshot(tenant);
        if (!snap) return out;
        for (const o of list) {
            const info = infoFor(snap, o);
            if (info) out.set(String(o._id), info);
        }
    } catch (e) {
        console.error('Queue info error:', e.message);
    }
    return out;
}

module.exports = { forOrders, snapshot, infoFor };
