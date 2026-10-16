// A rider's live position. It comes in over the rider's socket (`rider:ping`) or, as the fallback, over a normal web request
// (POST /api/rider/location); both go through ingest(), so the rules are the same.
//
//   - the NEWEST position of every rider lives in memory; the database is written at most every FLUSH_MS per rider (not on every
//     ping), which is what keeps a small server and a small database healthy
//   - every ping is pushed at once to the people watching the order (`rider:location` to the room order:<id>)
//   - a position is accepted only while the rider has an order on the way, and only if the shop has live tracking on
//   - someone who opens the map gets the last known position immediately (latestFor)
const Rider = require('../models/Rider');
const Order = require('../models/Order');
const Tenant = require('../models/Tenant');
const realtime = require('./realtime');
const guard = require('./trackingGuard');
const tripEta = require('./tripEta');

const MIN_GAP_MS = 2000;            // faster pings than this are dropped
const FLUSH_MS = 10000;             // the database is written at most this often per rider
const ORDERS_TTL_MS = 10000;        // a rider's orders on the way are looked up at most this often
const SHOP_TTL_MS = 60000;
const KEEP_MS = 6 * 3600 * 1000;    // positions older than this are forgotten
const FRESH_MS = 5 * 60000;

const latest = new Map();           // riderId -> { tenantId, lat, lng, heading, speed, accuracy, at, seq, flushedAt, dirty }
const ordersCache = new Map();      // riderId -> { at, ids: [orderId], orders: [{ id, tenantId, userId, orderNo, dest }], name }
const shopCache = new Map();        // tenantId -> { at, on }
let flushTimer = null;

const okNum = (v, lim) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const optNum = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v * 10) / 10 : null);

// direction of travel in degrees (0 = north) from two points, when the phone did not send one
function bearing(a, b) {
    const rad = Math.PI / 180;
    const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
    const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
    return Math.round((Math.atan2(y, x) / rad + 360) % 360);
}
const metres = (a, b) => {
    const R = 6371000;
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad;
    const dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
};

async function shopTrackingOn(tenantId) {
    const k = String(tenantId);
    const hit = shopCache.get(k);
    if (hit && Date.now() - hit.at < SHOP_TTL_MS) return hit.on;
    const t = await Tenant.findById(tenantId).select('settings.riders.liveTracking settings.riders.locationIntervalSec').lean();
    const on = t?.settings?.riders?.liveTracking !== false;
    const every = Number(t?.settings?.riders?.locationIntervalSec);
    shopCache.set(k, { at: Date.now(), on, every: every >= 5 && every <= 60 ? every : 10 });
    return on;
}

// the orders this rider is carrying to a customer right now
async function ordersOnTheWay(tenantId, riderId) {
    const k = String(riderId);
    const hit = ordersCache.get(k);
    if (hit && Date.now() - hit.at < ORDERS_TTL_MS) return hit.ids;
    const rows = await Order.find({
        tenantId, 'delivery.riderId': riderId, 'delivery.status': 'picked_up', status: 'out_for_delivery',
    }).select('_id userId orderNo address.latitude address.longitude').lean();
    const ids = rows.map((o) => String(o._id));
    const orders = rows.map((o) => ({
        id: String(o._id), tenantId: String(tenantId), userId: String(o.userId), orderNo: o.orderNo,
        dest: Number.isFinite(o.address?.latitude) && Number.isFinite(o.address?.longitude) ? { lat: o.address.latitude, lng: o.address.longitude } : null,
    }));
    const prev = ordersCache.get(k);
    let name = prev?.name;
    if (name === undefined) name = (await Rider.findOne({ tenantId, userId: riderId }).select('name').lean())?.name || null;
    ordersCache.set(k, { at: Date.now(), ids, orders, name });
    tripEta.keepOnly(riderId, ids);   // an order that is no longer on the way loses its route
    return ids;
}

/* ------------------------------ a position comes in ------------------------------ */
// body: { lat, lng, heading?, speed?, accuracy?, at? }.  via: 'socket' | 'http'
// Returns { ok, saved, reason? }. A bad position is { ok: false }. Tracking off / no order on the way is { ok: true, saved: false }.
async function ingest({ tenantId, riderId, body, via = 'http', now = Date.now() }) {
    const { lat, lng } = body || {};
    if (!okNum(lat, 90) || !okNum(lng, 180)) return { ok: false, reason: 'Send lat and lng as numbers' };
    if (!(await shopTrackingOn(tenantId))) return { ok: true, saved: false, reason: 'tracking_off' };

    const key = String(riderId);
    const prev = latest.get(key);
    if (prev && now - prev.t < MIN_GAP_MS) { guard.counters.droppedPings += 1; return { ok: true, saved: false, reason: 'too_fast' }; }

    const ids = await ordersOnTheWay(tenantId, riderId);
    if (!ids.length) return { ok: true, saved: false, reason: 'no_order_on_the_way' };

    const here = { lat, lng };
    let heading = optNum(body.heading, 0, 360);
    if (heading === null && prev && metres(prev, here) > 5) heading = bearing(prev, here);
    if (heading === null && prev) heading = prev.heading ?? null;
    const speed = optNum(body.speed, 0, 80);          // metres per second
    const accuracy = optNum(body.accuracy, 0, 5000);
    const at = new Date(now);
    const seq = (prev?.seq || 0) + 1;

    latest.set(key, {
        tenantId: String(tenantId), lat, lng, heading, speed, accuracy, at, t: now, seq,
        flushedAt: prev?.flushedAt || 0, dirty: true,
    });
    guard.counters.pings += 1;
    if (via === 'http') guard.counters.httpFallbacks += 1;

    for (const id of ids) {
        realtime.toOrder(id, 'rider:location', { orderId: id, lat, lng, heading, speed, accuracy, at, seq });
    }
    // the road route, the arrival time and the "arriving" alerts. Never waits for it and never fails the ping.
    const cached = ordersCache.get(key);
    for (const o of cached?.orders || []) {
        tripEta.update({ order: o, riderId, riderName: cached.name, pos: here, now }).catch((e) => console.error('Trip ETA error:', e.message));
    }
    startFlusher();
    return { ok: true, saved: true, orders: ids.length, everySec: shopCache.get(String(tenantId))?.every || 10 };
}

/* ------------------------------ reading ------------------------------ */
// the newest position of a rider (memory first, so it is never ~10 seconds behind), or null when it is old
function latestFor(riderId) {
    const p = latest.get(String(riderId));
    if (!p || Date.now() - p.t > FRESH_MS) return null;
    return { lat: p.lat, lng: p.lng, heading: p.heading ?? null, speed: p.speed ?? null, at: p.at, seq: p.seq };
}

// Replace a saved position (from the database) by the live one when the live one is newer
function newest(riderId, saved) {
    const live = latestFor(riderId);
    if (!live) return saved || null;
    if (saved?.at && new Date(saved.at).getTime() > new Date(live.at).getTime()) return saved;
    return { lat: live.lat, lng: live.lng, at: live.at, heading: live.heading, speed: live.speed };
}

// somebody joined an order's room: tell only that socket where the rider is now
function sendSnapshot(socket, orderId, riderId) {
    try {
        const p = latestFor(riderId);
        if (p) socket.emit('rider:location', { orderId: String(orderId), ...p });
    } catch (e) { /* the map just waits for the next ping */ }
}

/* ------------------------------ saving to the database, in batches ------------------------------ */
async function flush(now = Date.now()) {
    const ops = [];
    for (const [riderId, p] of latest) {
        if (now - p.t > KEEP_MS) { latest.delete(riderId); continue; }
        if (!p.dirty || now - p.flushedAt < FLUSH_MS) continue;
        ops.push({ updateOne: { filter: { tenantId: p.tenantId, userId: riderId }, update: { $set: { lastLocation: { lat: p.lat, lng: p.lng, at: p.at } } } } });
        p.dirty = false;
        p.flushedAt = now;
    }
    if (ops.length) {
        try { await Rider.bulkWrite(ops, { ordered: false }); } catch (e) { console.error('Live tracking save error:', e.message); }
    }
    for (const [k, v] of ordersCache) if (now - v.at > 5 * 60000) ordersCache.delete(k);
    return ops.length;
}

function startFlusher() {
    if (flushTimer) return;
    flushTimer = setInterval(() => { flush().catch(() => { }); }, 5000);
    flushTimer.unref?.();
}
function stopFlusher() { if (flushTimer) clearInterval(flushTimer); flushTimer = null; }

// the rider has no order on the way any more (or logged out): forget the memory and the cached order list
function forget(riderId) {
    latest.delete(String(riderId));
    ordersCache.delete(String(riderId));
    tripEta.dropForRider(riderId);
}
// an order changed status: the rider's list of orders on the way is looked up again next time
function orderChanged(riderId) { if (riderId) ordersCache.delete(String(riderId)); }
const reset = () => { latest.clear(); ordersCache.clear(); shopCache.clear(); stopFlusher(); tripEta.reset(); };
const size = () => latest.size;

module.exports = { ingest, latestFor, newest, sendSnapshot, flush, forget, orderChanged, reset, size, stopFlusher, bearing, metres, MIN_GAP_MS, FLUSH_MS };
