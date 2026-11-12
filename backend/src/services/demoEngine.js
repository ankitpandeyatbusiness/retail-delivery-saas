// The demo shop plays the other people by itself. A visitor who orders as a customer sees the order move: accepted, cooked, picked up by
// the demo rider, the rider's pin travels to the address, delivered. A visitor playing the Owner, Cook or Rider can do those steps
// by hand: the engine only moves an order that has waited long enough in its step, and every move goes through the real order flow
// (services/orderStatusService.js), so nothing here is special-cased for the screens.
// It looks ONLY at orders of demo shops (Tenant.isDemo). Real shops are never touched. Restart safe: it works from the order's own time stamps.
const Order = require('../models/Order');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Rider = require('../models/Rider');
const liveTracking = require('./liveTracking');
const demoTenant = require('./demoTenant');

const TERMINAL = ['delivered', 'cancelled', 'undelivered'];
const DWELL_MS = { placed: 20000, accepted: 10000, preparing: 15000, ready: 25000 };   // how long a step waits for a human before the engine moves it
const WALK_MS = 50000;      // the rider's journey from the shop to the door
const EVERY_MS = 4000;
let timer = null;

const lastChange = (o) => {
    const h = (o.statusHistory || [])[o.statusHistory.length - 1];
    return h && h.at ? +new Date(h.at) : +new Date(o.updatedAt || o.createdAt);
};

async function demoRider(tenantId) {
    const u = await demoTenant.personFor({ _id: tenantId }, 'rider');   // the demo rider (made on first use, with his rider profile)
    return u ? u._id : null;
}

async function change(order, status, label) {
    try {
        await require('./orderStatusService').change({ order, status, actor: { type: 'owner', label: label || 'demo shop' } });
        return true;
    } catch (e) { if (process.env.DEMO_DEBUG) console.error('demo engine:', status, e.message); return false; }   // somebody moved it a moment ago, or it may not move yet: try again at the next tick
}

// put the demo rider on this delivery (as if he had accepted the offer)
async function giveToRider(order) {
    const riderId = await demoRider(order.tenantId);
    if (!riderId) return false;
    const now = new Date();
    const r = await Order.updateOne({ _id: order._id, 'delivery.riderId': { $exists: false } },
        { $set: { 'delivery.riderId': riderId, 'delivery.status': 'accepted', 'delivery.assignedAt': now, 'delivery.acceptedAt': now, 'delivery.pinRequired': false } });
    if (r.modifiedCount) await Rider.updateOne({ tenantId: order.tenantId, userId: riderId }, { $set: { isOnline: true }, $inc: { activeOrderCount: 1 } });
    return true;
}

const lerp = (a, b, f) => a + (b - a) * f;

async function stepOne(tenant, order, now) {
    if (order.bulkId || order.tableSessionId || !['delivery', 'pickup'].includes(order.orderType)) return;   // table and bulk orders are worked by the waiter and the owner
    const waited = +now - lastChange(order);
    const st = order.status;

    if (st === 'placed' && waited >= DWELL_MS.placed) return void (await change(order, 'accepted'));
    if (st === 'accepted' && waited >= DWELL_MS.accepted) return void (await change(order, 'preparing'));
    if (st === 'preparing' && waited >= DWELL_MS.preparing) {
        if (order.orderType === 'pickup') return void (await change(order, 'ready'));
        if (!(await giveToRider(order))) return;
        await Order.updateOne({ _id: order._id, 'kitchen.readyAt': { $exists: false } }, { $set: { 'kitchen.readyAt': new Date() } });   // the cook marks the food ready
        const fresh = await Order.findById(order._id);
        return void (await change(fresh, 'out_for_delivery', 'demo rider'));
    }
    if (st === 'ready' && waited >= DWELL_MS.ready) return void (await change(order, 'delivered'));

    if (st === 'out_for_delivery' && order.delivery && order.delivery.riderId) {
        const t0 = order.delivery.pickedUpAt ? +new Date(order.delivery.pickedUpAt) : lastChange(order);
        const f = Math.min(1, (+now - t0) / WALK_MS);
        const from = { lat: tenant.delivery && tenant.delivery.latitude, lng: tenant.delivery && tenant.delivery.longitude };
        const to = { lat: order.address && order.address.latitude, lng: order.address && order.address.longitude };
        if ([from.lat, from.lng, to.lat, to.lng].every((x) => typeof x === 'number')) {
            await liveTracking.ingest({ tenantId: order.tenantId, riderId: order.delivery.riderId, body: { lat: lerp(from.lat, to.lat, f), lng: lerp(from.lng, to.lng, f), speed: 6 }, via: 'demo', now: +now })
                .then((r) => { if (process.env.DEMO_DEBUG) console.error('ingest', JSON.stringify(r)); }).catch((e) => { if (process.env.DEMO_DEBUG) console.error('ingest err', e.message); });
        }
        if (f >= 1) {
            if (await change(order, 'delivered', 'demo rider')) {
                await Rider.updateOne({ tenantId: order.tenantId, userId: order.delivery.riderId, activeOrderCount: { $gt: 0 } }, { $inc: { activeOrderCount: -1 } });
            }
        }
    }
}

// one round over every open order of every demo shop
async function tick(now = new Date()) {
    const shops = await Tenant.find({ isDemo: true }).select('_id delivery settings').lean();
    let moved = 0;
    for (const t of shops) {
        const open = await Order.find({ tenantId: t._id, status: { $nin: TERMINAL } }).limit(40);
        for (const o of open) {
            const before = o.status;
            await stepOne(t, o, now);
            if (before !== o.status) moved += 1;
        }
    }
    return { shops: shops.length, open: moved };
}

function start() {
    if (timer || process.env.DEMO_ENGINE === 'off') return;
    timer = setInterval(() => { tick().catch((e) => console.error('Demo engine error:', e.message)); }, EVERY_MS);
    if (timer.unref) timer.unref();
}
function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { tick, start, stop, DWELL_MS, WALK_MS };
