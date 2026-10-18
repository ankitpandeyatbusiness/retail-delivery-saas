// The time a delivery should take, and the record of how long it really took.
//
//   plan(order, tenant)     the road from the shop to the customer and the time allowed: Google's driving time + a 5 minute buffer.
//                           One road per order (kept for 30 minutes), so the same answer is shown to the rider before and after
//                           pickup and the Google caps are charged once per order, not once per screen.
//   recordStart(order)      the rider collected the food: the time allowed and the due time are saved on the order.
//   recordDone(order)       the order was delivered: the journey time (collected -> delivered) is added to the rider's profile.
//                           Only a record for the shop and the customer. The rider is never warned or penalised for a late one.
const Order = require('../models/Order');
const Rider = require('../models/Rider');
const Tenant = require('../models/Tenant');
const routes = require('./adapters/routes');
const polyline = require('../utils/polyline');

const BUFFER_SEC = 5 * 60;
const KEEP_MS = 30 * 60000;
const kept = new Map();   // orderId -> { at, plan }

const spot = (lat, lng) => (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null);

// { source, polyline, distanceM, durationSec, allowedSec } or null when the shop or the customer has no pin on the map.
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
        allowedSec: Math.ceil((r.durationSec + BUFFER_SEC) / 60) * 60,   // whole minutes
    };
    kept.set(key, { at: Date.now(), plan: result });
    if (kept.size > 500) kept.delete(kept.keys().next().value);
    return result;
}

// at pickup. Never throws: a missing plan only means no due time is saved (the rider's screen then works it out itself).
async function recordStart(order, tenant) {
    try {
        // the rider's pickup call passes no shop with it: read the shop's pin
        const shop = tenant?.delivery ? tenant : await Tenant.findById(order.tenantId).select('delivery').lean();
        const p = await plan(order, shop);
        const startedAt = order.delivery?.pickedUpAt;
        if (!p || !startedAt) return null;
        const dueAt = new Date(new Date(startedAt).getTime() + p.allowedSec * 1000);
        await Order.updateOne({ _id: order._id, tenantId: order.tenantId, 'delivery.dueAt': { $exists: false } }, { $set: { 'delivery.plannedSec': p.allowedSec, 'delivery.dueAt': dueAt } });
        return dueAt;
    } catch (e) {
        console.error('Delivery plan error:', e.message);
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

module.exports = { plan, recordStart, recordDone, avgMin, BUFFER_SEC };
