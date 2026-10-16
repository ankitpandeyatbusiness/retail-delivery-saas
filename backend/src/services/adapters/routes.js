// Road routes and travel times for live tracking.
//
//   const r = await routes.getRoute({ from: { lat, lng }, to: { lat, lng } })
//   -> { source: 'google' | 'estimate', points: [{ lat, lng }, ...], distanceM, durationSec, reason? }
//
// ROUTES_PROVIDER=google (and a key in GOOGLE_ROUTES_API_KEY, or GOOGLE_MAPS_API_KEY) uses Google's Routes API.
// Anything else, or any problem, gives an ESTIMATE (a straight line, a road factor and an average speed): free, always works.
// Safety so the bill can never surprise you:
//   - a monthly cap on Google calls (PlatformSettings.tracking.routeCap, default 8000). When it is reached the estimate is used.
//   - a circuit breaker: after 3 failures in a row Google is not called for 5 minutes.
//   - a time limit on every call.
// NOTE: the key in the phone app is usually restricted to the app. The server needs its OWN key (no app restriction) with the
// Routes API enabled in Google Cloud.
const Counter = require('../../models/Counter');
const guard = require('../trackingGuard');
const polyline = require('../../utils/polyline');

const AVG_KMH = parseFloat(process.env.RIDER_AVG_SPEED_KMH) || 20;
const ROAD_FACTOR = 1.3;
const MAX_POINTS = 300;
const BREAKER_AFTER = 3;
const BREAKER_MS = 5 * 60000;
const TIMEOUT_MS = 4000;

const state = { failures: 0, openUntil: 0, calls: 0, estimates: 0, lastError: '' };

function haversineM(a, b) {
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

function estimate(from, to, reason) {
    state.estimates += 1;
    const distanceM = Math.round(haversineM(from, to) * ROAD_FACTOR);
    const durationSec = Math.max(120, Math.round(distanceM / ((AVG_KMH * 1000) / 3600)));
    return { source: 'estimate', points: [from, to], distanceM, durationSec, reason };
}

// keep the shape but not thousands of points: every nth point, always the first and the last
function thin(points, max = MAX_POINTS) {
    if (points.length <= max) return points;
    const step = Math.ceil(points.length / max);
    const out = points.filter((_, i) => i % step === 0);
    if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
    return out;
}

// the real call (tests replace it with setTransport)
async function googleCall({ from, to }) {
    const key = process.env.GOOGLE_ROUTES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
    if (!key) throw new Error('No Google key for the server');
    const body = {
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: 'TWO_WHEELER',
        routingPreference: 'TRAFFIC_UNAWARE',
    };
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Google routes ${res.status}`);
    const json = await res.json();
    const r = json?.routes?.[0];
    if (!r?.polyline?.encodedPolyline) throw new Error('Google returned no route');
    return { points: polyline.decode(r.polyline.encodedPolyline), distanceM: r.distanceMeters, durationSec: parseInt(String(r.duration || '0').replace('s', ''), 10) };
}
let transport = googleCall;
const setTransport = (fn) => { transport = fn || googleCall; };

const monthKey = (d = new Date()) => `routes:${new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 7)}`;

async function usedThisMonth() {
    const c = await Counter.findById(monthKey()).lean();
    return c?.seq || 0;
}

const googleOn = () => process.env.ROUTES_PROVIDER === 'google';

async function getRoute({ from, to }) {
    const fb = (reason) => estimate(from, to, reason);
    if (!googleOn()) return fb('estimate_only');
    if (Date.now() < state.openUntil) return fb('breaker');
    try {
        const cap = (await guard.loadedSettings()).routeCap;
        // take a call from the month's allowance first; give it back if the cap was passed
        const c = await Counter.findOneAndUpdate({ _id: monthKey() }, { $inc: { seq: 1 } }, { returnDocument: 'after', upsert: true });
        if (c.seq > cap) { await Counter.updateOne({ _id: monthKey() }, { $inc: { seq: -1 } }); return fb('monthly_cap'); }
        state.calls += 1;
        const r = await transport({ from, to });
        state.failures = 0;
        const points = thin(r.points?.length ? r.points : [from, to]);
        return { source: 'google', points, distanceM: Math.round(r.distanceM), durationSec: Math.max(60, Math.round(r.durationSec)) };
    } catch (e) {
        state.failures += 1;
        state.lastError = String(e.message || e).slice(0, 120);
        if (state.failures >= BREAKER_AFTER) { state.openUntil = Date.now() + BREAKER_MS; state.failures = 0; console.warn('Routes: Google failed 3 times, using estimates for 5 minutes'); }
        return fb('error');
    }
}

async function stats() {
    return { provider: googleOn() ? 'google' : 'estimate', usedThisMonth: await usedThisMonth().catch(() => 0), ...state, breakerOpen: Date.now() < state.openUntil };
}
const resetForTests = () => { Object.assign(state, { failures: 0, openUntil: 0, calls: 0, estimates: 0, lastError: '' }); };

module.exports = { getRoute, estimate, thin, haversineM, setTransport, stats, resetForTests, ROAD_FACTOR, AVG_KMH };
