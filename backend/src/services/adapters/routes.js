// Road routes and travel times for live tracking.
//
//   const r = await routes.getRoute({ from: { lat, lng }, to: { lat, lng } })
//   -> { source: 'google' | 'estimate', points: [{ lat, lng }, ...], distanceM, durationSec, reason? }
//
// ROUTES_PROVIDER=google (and a key in GOOGLE_ROUTES_API_KEY, or GOOGLE_MAPS_API_KEY) uses Google's Routes API.
// Anything else, or any problem, gives an ESTIMATE (a straight line, a road factor and an average speed): free, always works.
// Three stages, so the best answer comes first and the bill stays at zero (caps in PlatformSettings.tracking, see googleBudget.js):
//   1. a route WITH live traffic (Routes "Pro"): the first routeProCap calls of the month
//   2. a route without traffic (Routes "Essentials"): the next routeCap calls of the month
//   3. the free estimate
// Safety so the bill can never surprise you:
//   - a monthly cap (and a daily pace) on every stage. When both are used up the estimate is used.
//   - a circuit breaker: after 3 failures in a row Google is not called for 5 minutes.
//   - a time limit on every call.
// NOTE: the key in the phone app is usually restricted to the app. The server needs its OWN key (no app restriction) with the
// Routes API enabled in Google Cloud.
const budget = require('../googleBudget');
const polyline = require('../../utils/polyline');

const AVG_KMH = parseFloat(process.env.RIDER_AVG_SPEED_KMH) || 20;
const ROAD_FACTOR = 1.3;
const MAX_POINTS = 1500;   // enough to follow every bend (fewer points cut the corners across blocks)
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
async function googleCall({ from, to, traffic }) {
    const key = process.env.GOOGLE_ROUTES_SERVER_KEY || process.env.GOOGLE_ROUTES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
    if (!key) throw new Error('No Google key for the server');
    const body = {
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: 'TWO_WHEELER',
        routingPreference: traffic ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE',
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

async function usedThisMonth() {
    const u = await budget.usage();
    return (u.route_pro?.used || 0) + (u.route_ess?.used || 0);
}

const googleOn = () => process.env.ROUTES_PROVIDER === 'google';

// the stages in order: [counter name in googleBudget, does it use live traffic]
const STAGES = [['route_pro', true], ['route_ess', false]];

async function getRoute({ from, to }) {
    const fb = (reason) => estimate(from, to, reason);
    if (!googleOn()) return fb('estimate_only');
    if (Date.now() < state.openUntil) return fb('breaker');
    let failed = false;
    for (const [sku, traffic] of STAGES) {
        let allowed = false;
        try { allowed = await budget.take(sku); } catch (e) { return fb('error'); }
        if (!allowed) continue;   // this stage is used up this month (or today): try the economical one
        try {
            state.calls += 1;
            const r = await transport({ from, to, traffic });
            state.failures = 0;
            const points = thin(r.points?.length ? r.points : [from, to]);
            return { source: 'google', traffic, points, distanceM: Math.round(r.distanceM), durationSec: Math.max(60, Math.round(r.durationSec)) };
        } catch (e) {
            failed = true;   // the next stage is still tried once (for example when "with traffic" is refused for a travel mode)
            state.lastError = String(e.message || e).slice(0, 120);
        }
    }
    if (failed) {
        state.failures += 1;   // one failure per request, however many stages were tried
        if (state.failures >= BREAKER_AFTER) { state.openUntil = Date.now() + BREAKER_MS; state.failures = 0; console.warn('Routes: Google failed 3 times, using estimates for 5 minutes'); }
    }
    return fb(failed ? 'error' : 'monthly_cap');
}

async function stats() {
    return { provider: googleOn() ? 'google' : 'estimate', usedThisMonth: await usedThisMonth().catch(() => 0), ...state, breakerOpen: Date.now() < state.openUntil };
}
const resetForTests = () => { Object.assign(state, { failures: 0, openUntil: 0, calls: 0, estimates: 0, lastError: '' }); };

module.exports = { getRoute, estimate, thin, haversineM, setTransport, stats, resetForTests, ROAD_FACTOR, AVG_KMH };
