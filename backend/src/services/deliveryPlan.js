// The time a delivery should take, and the record of how long it really took.
//
//   estimateSec(order, tenant)  the time allowed BEFORE pickup: the straight-line distance shop -> customer, a road factor, 20 km/h on
//                               average, plus a 5 minute buffer. Worked out here, locally: NO Google call is paid for this.
//   recordStart(order)          the rider collected the food: the time allowed and the due time are saved on the order (the estimate).
//   refineWithRoute({...})      the first REAL Google route after pickup (the one the tracking already asks for) replaces the estimate:
//                               the time allowed becomes Google's driving time + the buffer. Once per order, no extra call.
//   recordDone(order)           the order was delivered: the journey time (collected -> delivered) is added to the rider's profile.
//                               Only a record for the shop and the customer. The rider is never warned or penalised for a late one.
const Order = require('../models/Order');
const Rider = require('../models/Rider');
const Tenant = require('../models/Tenant');
const routes = require('./adapters/routes');
const polyline = require('../utils/polyline');

const BUFFER_SEC = 5 * 60;
const KEEP_MS = 30 * 60000;
const kept = new Map();   // orderId -> { at, plan }

const spot = (lat, lng) => (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null);
const wholeMinutes = (sec) => Math.ceil(sec / 60) * 60;

// The fixed road shown on the rider's map: from the shop to the customer. One road per order (kept for 30 minutes), so Google is
// called once per order and counted in the same monthly caps as every route; when the caps are used up or Google fails the answer is the
// free estimate (source "estimate"). { source, polyline, distanceM, durationSec, allowedSec } or null when a pin is missing.
// "from" is the fallback start when the shop has no pin of its own (the rider's position).
async function plan(order, tenant, from) {
    const key = String(order._id);
    const hit = kept.get(key);
    if (hit && Date.now() - hit.at < KEEP_MS) return hit.plan;
    const a = spot(tenant?.delivery?.latitude, tenant?.delivery?.longitude) || from || null;
    const b = spot(order.address?.latitude, order.address?.longitude);
    if (!a || !b) return null;
    const r = await routes.getRoute({ from: a, to: b });
    const result = {
        source: r.source, polyline: polyline.encode(r.points), distanceM: r.distanceM, durationSec: r.durationSec,
        allowedSec: wholeMinutes(r.durationSec + BUFFER_SEC),
    };
    kept.set(key, { at: Date.now(), plan: result });
    if (kept.size > 500) kept.delete(kept.keys().next().value);
    return result;
}

// seconds allowed, or null when the shop or the customer has no pin on the map
function estimateSec(order, tenant) {
    const a = spot(tenant?.delivery?.latitude, tenant?.delivery?.longitude);
    const b = spot(order?.address?.latitude, order?.address?.longitude);
    if (!a || !b) return null;
    const metres = routes.haversineM(a, b) * routes.ROAD_FACTOR;
    const driving = Math.max(120, metres / ((routes.AVG_KMH * 1000) / 3600));
    return wholeMinutes(driving + BUFFER_SEC);
}

// at pickup. Never throws: a missing estimate only means no due time is saved.
async function recordStart(order, tenant) {
    try {
        // the rider's pickup call passes no shop with it: read the shop's pin
        const shop = tenant?.delivery ? tenant : await Tenant.findById(order.tenantId).select('delivery').lean();
        const sec = estimateSec(order, shop);
        const startedAt = order.delivery?.pickedUpAt;
        if (!sec || !startedAt) return null;
        const dueAt = new Date(new Date(startedAt).getTime() + sec * 1000);
        await Order.updateOne({ _id: order._id, tenantId: order.tenantId, 'delivery.dueAt': { $exists: false } }, { $set: { 'delivery.plannedSec': sec, 'delivery.dueAt': dueAt } });
        return dueAt;
    } catch (e) {
        console.error('Delivery plan error:', e.message);
        return null;
    }
}

// The first real route after pickup: its driving time (+ the buffer) becomes the time allowed. Only once per order.
async function refineWithRoute({ orderId, tenantId, durationSec }) {
    try {
        if (!(durationSec > 0)) return null;
        const o = await Order.findOne({ _id: orderId, tenantId, 'delivery.dueRefined': { $ne: true }, 'delivery.pickedUpAt': { $exists: true } }).select('delivery.pickedUpAt').lean();
        if (!o) return null;
        const sec = wholeMinutes(durationSec + BUFFER_SEC);
        const dueAt = new Date(new Date(o.delivery.pickedUpAt).getTime() + sec * 1000);
        const r = await Order.updateOne({ _id: orderId, tenantId, 'delivery.dueRefined': { $ne: true } }, { $set: { 'delivery.plannedSec': sec, 'delivery.dueAt': dueAt, 'delivery.dueRefined': true } });
        return r.modifiedCount ? dueAt : null;
    } catch (e) {
        console.error('Delivery plan refine error:', e.message);
        return null;
    }
}

// at delivery (once per order, because the status change runs its follow-up work once)
async function recordDone(order) {
    try {
        const d = order.delivery || {};
        if (!d.riderId || !d.pickedUpAt || !d.deliveredAt) return;
        const sec = Math.round((new Date(d.deliveredAt).getTime() - new Date(d.pickedUpAt).getTime()) / 1000);
        if (!(sec > 0) || sec > 6 * 3600) return;   // a forgotten order (marked delivered hours later) would spoil the average
        const late = d.dueAt && new Date(d.deliveredAt) > new Date(d.dueAt) ? 1 : 0;
        await Rider.updateOne({ tenantId: order.tenantId, userId: d.riderId }, { $inc: { deliveryCount: 1, deliverySecTotal: sec, lateCount: late } });
    } catch (e) {
        console.error('Delivery record error:', e.message);
    }
}

// the average for the screens: minutes, or null until there is a delivery on record
const avgMin = (r) => (r?.deliveryCount > 0 ? Math.max(1, Math.round(r.deliverySecTotal / r.deliveryCount / 60)) : null);

module.exports = { plan, estimateSec, recordStart, refineWithRoute, recordDone, avgMin, BUFFER_SEC };
