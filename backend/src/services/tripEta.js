// The road route and the arrival time of every order that is on its way, kept up to date as the rider's pings come in.
//
//   - the route is asked for ONCE when the order is picked up, and again only when the rider leaves it (150 m away on two pings
//     in a row) or a route with traffic is 10 minutes old (a route without traffic stays good for an hour). Between those the arrival time is worked out from how far along the route he is,
//     so there is no call per ping.
//   - events to the people watching the order (room order:<id>):
//       rider:route { orderId, polyline, distanceM, durationSec, source }          when a route is made
//       order:eta   { orderId, etaAt, remainingM, remainingSec, source, at }       at most every 5 seconds
//       rider:quiet { orderId, since }                                              the rider's phone went quiet
//   - two pushes to the customer, each sent only once per order: "arriving soon" (3 minutes or 600 m away) and "reached" (80 m).
//     The owner is told once if the rider has been quiet for 3 minutes.
const Order = require('../models/Order');
const realtime = require('./realtime');
const routes = require('./adapters/routes');
const polyline = require('../utils/polyline');

const OFF_ROUTE_M = 150;
const REROUTE_GAP_MS = 60000;
const ROUTE_MAX_AGE_MS = 10 * 60000;       // a route WITH traffic is asked again after this (jams change)
const ROUTE_NOTRAFFIC_AGE_MS = 60 * 60000; // a route without traffic never changes: only a wrong turn needs a new one
const ESTIMATE_RETRY_MS = 2 * 60000;
const ETA_EMIT_MS = 5000;
const ARRIVING_SEC = 180;
const ARRIVING_M = 600;
const REACHED_M = 80;
const QUIET_MS = 60000;
const OWNER_QUIET_MS = 3 * 60000;
const SWEEP_MS = 15000;

const trips = new Map();   // orderId -> trip
let sweepTimer = null;

/* ------------------------------ where is he on the route ------------------------------ */
const M_LAT = 110540;
const mLng = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

function prepare(points) {
    const cum = [0];
    for (let i = 1; i < points.length; i += 1) {
        const dx = (points[i].lng - points[i - 1].lng) * mLng(points[i - 1].lat);
        const dy = (points[i].lat - points[i - 1].lat) * M_LAT;
        cum.push(cum[i - 1] + Math.hypot(dx, dy));
    }
    return cum;
}

// the nearest point of the route to `p`: how far off it (distM) and how far along (fraction 0..1)
function project(route, p) {
    const pts = route.points;
    let best = { distM: Infinity, along: 0 };
    for (let i = 0; i < pts.length - 1; i += 1) {
        const a = pts[i];
        const k = mLng(a.lat);
        const bx = (pts[i + 1].lng - a.lng) * k;
        const by = (pts[i + 1].lat - a.lat) * M_LAT;
        const px = (p.lng - a.lng) * k;
        const py = (p.lat - a.lat) * M_LAT;
        const len2 = bx * bx + by * by;
        const t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
        const d = Math.hypot(px - t * bx, py - t * by);
        if (d < best.distM) best = { distM: d, along: route.cum[i] + t * Math.sqrt(len2) };
    }
    const total = route.cum[route.cum.length - 1] || 1;
    return { distM: best.distM, fraction: Math.max(0, Math.min(1, best.along / total)) };
}

/* ------------------------------ one ping for one order ------------------------------ */
// order: { id, tenantId, userId, orderNo, dest: { lat, lng } }   pos: { lat, lng }
async function update({ order, riderId, riderName, pos, now = Date.now() }) {
    const dest = order?.dest;
    if (!dest || !Number.isFinite(dest.lat) || !Number.isFinite(dest.lng)) return null;
    const here = { lat: pos.lat, lng: pos.lng };
    let trip = trips.get(order.id);
    if (trip?.busy) return trip.eta || null;   // a route request is already on its way

    if (!trip) trip = { startedAt: now, lock: { at: 0, mins: null, count: 0 }, orderId: order.id, tenantId: String(order.tenantId), userId: String(order.userId), orderNo: order.orderNo, riderId: String(riderId), riderName, dest, route: null, eta: null, lastEtaEmit: 0, offRoute: 0, routedAt: 0, flags: {}, quiet: false, quietOwner: false };
    trip.riderId = String(riderId);
    trip.lastPingAt = now;
    if (trip.quiet) trip.quiet = false;
    trips.set(order.id, trip);

    let need = !trip.route;
    if (trip.route?.source === 'google') {
        const pr = project(trip.route, here);
        trip.offRoute = pr.distM > OFF_ROUTE_M ? trip.offRoute + 1 : 0;
        if (now - trip.routedAt > (trip.route.traffic ? ROUTE_MAX_AGE_MS : ROUTE_NOTRAFFIC_AGE_MS) || (trip.offRoute >= 2 && now - trip.routedAt > REROUTE_GAP_MS)) need = true;
    } else if (trip.route) {
        // an estimate costs nothing: redo it from where he is. Ask Google again now and then.
        const est = routes.estimate(here, dest, trip.route.reason);
        trip.route = { ...est, cum: prepare(est.points) };
        if (now - trip.routedAt > ESTIMATE_RETRY_MS) need = true;
    }
    if (need) {
        trip.busy = true;
        try {
            const r = await routes.getRoute({ from: here, to: dest });
            const first = !trip.route;
            const changed = !trip.route || trip.route.source !== r.source || r.source === 'google';
            trip.route = { ...r, cum: prepare(r.points) };
            trip.routedAt = now;
            trip.offRoute = 0;
            if (first || changed) emitRoute(trip);
        } finally { trip.busy = false; }
    }

    // progress along the route -> what is left and when he arrives
    const pr = project(trip.route, here);
    const remainingM = Math.max(0, Math.round(trip.route.distanceM * (1 - pr.fraction)));
    const remainingSec = remainingM <= REACHED_M ? 0 : Math.max(30, Math.round(trip.route.durationSec * (1 - pr.fraction)));
    trip.eta = { orderId: order.id, etaAt: new Date(now + remainingSec * 1000), remainingM, remainingSec, source: trip.route.source, at: new Date(now) };

    const arriving = remainingSec <= ARRIVING_SEC || remainingM <= ARRIVING_M;
    const reached = remainingM <= REACHED_M;
    if (now - trip.lastEtaEmit >= ETA_EMIT_MS || (arriving && !trip.flags.arrivingSeen) || (reached && !trip.flags.reachedSeen)) {
        trip.lastEtaEmit = now;
        realtime.toOrder(order.id, 'order:eta', serialEta(trip));
    }
    if (arriving) { trip.flags.arrivingSeen = true; claimAndNotify(trip, 'arriving').catch((e) => console.error('Arriving alert error:', e.message)); }
    if (reached) { trip.flags.reachedSeen = true; claimAndNotify(trip, 'reached').catch((e) => console.error('Reached alert error:', e.message)); }
    if (!arriving) lockScreenUpdate(trip, now);
    startSweeper();
    return trip.eta;
}

/* ------------------------------ the lock-screen notification ------------------------------ */
// One notification per trip ("Arriving in about 12 min") that is REPLACED, not stacked, as the time changes: every push carries
// the same tag, so Android swaps the old one for the new one. Silent (its own quiet channel), sent only when the time has moved
// by 2 minutes and at least 90 seconds have passed, at most 10 times a trip. The first one waits a minute after pickup
// (the normal "out for delivery" message has just been shown). The "arriving" and "reached" pushes use the same tag.
const LOCK_FIRST_MS = 60000;
const LOCK_GAP_MS = 90000;
const LOCK_DELTA_MIN = 2;
const LOCK_MAX = 10;
const tagOf = (orderId) => `trip-${orderId}`;

function lockScreenUpdate(trip, now) {
    const l = trip.lock;
    if (!trip.eta || l.count >= LOCK_MAX) return;
    const mins = Math.max(1, Math.ceil(trip.eta.remainingSec / 60));
    if (l.count === 0 ? now - trip.startedAt < LOCK_FIRST_MS : (now - l.at < LOCK_GAP_MS || Math.abs(mins - l.mins) < LOCK_DELTA_MIN)) return;
    l.at = now; l.mins = mins; l.count += 1;   // claimed before the send, so a slow push never doubles up
    const who = trip.riderName || 'Your delivery partner';
    require('../notifications/channels/push').send({
        tenantId: trip.tenantId, userId: trip.userId, title: `Arriving in about ${mins} min`,
        body: `${who} is bringing order #${trip.orderNo}`, data: { orderId: trip.orderId, orderNo: trip.orderNo, kind: 'tracking' },
        tag: tagOf(trip.orderId), quietChannel: 'live_trip',
    }).catch((e) => console.error('Lock-screen update error:', e.message));
}

const serialEta = (trip) => ({ ...trip.eta, etaAt: trip.eta.etaAt.toISOString?.() || trip.eta.etaAt });

function emitRoute(trip, socket) {
    try {
        const body = { orderId: trip.orderId, polyline: polyline.encode(trip.route.points), distanceM: trip.route.distanceM, durationSec: trip.route.durationSec, source: trip.route.source };
        if (socket) socket.emit('rider:route', body); else realtime.toOrder(trip.orderId, 'rider:route', body);
    } catch (e) { /* the map just draws without the line */ }
}

/* ------------------------------ the two pushes ------------------------------ */
// "the first one to claim it sends it": the flag is saved on the order, so a restart or a second server never repeats it
async function claimAndNotify(trip, which) {
    const field = which === 'arriving' ? 'delivery.arrivingNotifiedAt' : 'delivery.reachedNotifiedAt';
    const r = await Order.updateOne({ _id: trip.orderId, [field]: { $exists: false }, status: 'out_for_delivery' }, { $set: { [field]: new Date() } });
    if (!r.modifiedCount) return;
    const center = require('../notifications/center');   // required here: the notification code uses the realtime file too
    const who = trip.riderName || 'Your delivery partner';
    const mins = Math.max(1, Math.round(trip.eta.remainingSec / 60));
    const text = which === 'arriving'
        ? { title: mins <= 1 ? `${who} is almost there` : `Arriving in about ${mins} min`, body: `${who} is close to your address. Please keep your delivery PIN ready.` }
        : { title: `${who} has reached`, body: `Order #${trip.orderNo}: your delivery partner is at your address now.` };
    await center.notify(which === 'arriving' ? 'rider_arriving' : 'rider_reached', {
        tenantId: trip.tenantId, userId: trip.userId, title: text.title, body: text.body, data: { orderId: trip.orderId, orderNo: trip.orderNo, kind: 'tracking' },
        tag: tagOf(trip.orderId),   // replaces the lock-screen "Arriving in about N min" instead of stacking under it
    });
}

/* ------------------------------ a quiet rider ------------------------------ */
async function sweep(now = Date.now()) {
    for (const [id, trip] of trips) {
        if (now - trip.lastPingAt > 6 * 3600 * 1000) { trips.delete(id); continue; }
        const quiet = now - trip.lastPingAt;
        if (quiet > QUIET_MS && !trip.quiet) {
            trip.quiet = true;
            realtime.toOrder(id, 'rider:quiet', { orderId: id, since: new Date(trip.lastPingAt).toISOString() });
        }
        if (quiet > OWNER_QUIET_MS && !trip.quietOwner) {
            trip.quietOwner = true;
            try {
                require('../notifications/center').notify('rider_quiet', {
                    tenantId: trip.tenantId, title: `Rider not reporting: order #${trip.orderNo}`,
                    body: `${trip.riderName || 'The rider'} has not sent a location for ${Math.round(quiet / 60000)} minutes. You may want to call him.`, data: { orderId: id, orderNo: trip.orderNo },
                });
            } catch (e) { /* ignore */ }
        }
    }
}
function startSweeper() {
    if (sweepTimer) return;
    sweepTimer = setInterval(() => { sweep().catch(() => { }); }, SWEEP_MS);
    sweepTimer.unref?.();
}
function stopSweeper() { if (sweepTimer) clearInterval(sweepTimer); sweepTimer = null; }

/* ------------------------------ reading ------------------------------ */
// for the order tracking page (the polling path) and for someone who opens the map
function view(orderId) {
    const t = trips.get(String(orderId));
    if (!t?.route || !t.eta) return null;
    return {
        route: { polyline: polyline.encode(t.route.points), distanceM: t.route.distanceM, durationSec: t.route.durationSec, source: t.route.source },
        eta: serialEta(t), quiet: !!t.quiet,
    };
}
function sendSnapshot(socket, orderId) {
    const t = trips.get(String(orderId));
    if (!t?.route) return;
    emitRoute(t, socket);
    if (t.eta) socket.emit('order:eta', serialEta(t));
    if (t.quiet) socket.emit('rider:quiet', { orderId: String(orderId), since: new Date(t.lastPingAt).toISOString() });
}
// the order is no longer on its way
function drop(orderId) { trips.delete(String(orderId)); }
// keep only the trips of this rider whose orders are still on the way
function keepOnly(riderId, ids) { for (const [id, t] of trips) if (t.riderId === String(riderId) && !ids.includes(id)) trips.delete(id); }
function dropForRider(riderId) { for (const [id, t] of trips) if (t.riderId === String(riderId)) trips.delete(id); }
const reset = () => { trips.clear(); stopSweeper(); };

module.exports = { update, view, sendSnapshot, sweep, drop, keepOnly, dropForRider, reset, stopSweeper, project, prepare, QUIET_MS, OWNER_QUIET_MS };
