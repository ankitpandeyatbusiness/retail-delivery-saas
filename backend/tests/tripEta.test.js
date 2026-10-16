require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: connect } = require('socket.io-client');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const realtime = require('../src/services/realtime');
const liveTracking = require('../src/services/liveTracking');
const tripEta = require('../src/services/tripEta');
const guard = require('../src/services/trackingGuard');
const routes = require('../src/services/adapters/routes');
const polyline = require('../src/utils/polyline');
const Order = require('../src/models/Order');
const Notification = require('../src/models/Notification');
const PlatformSettings = require('../src/models/PlatformSettings');
const Counter = require('../src/models/Counter');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');

// The road route and the arrival time of an order on its way, the "arriving" alerts, the quiet rider, and the Google guard rails
// (monthly cap, circuit breaker, estimate fallback).
const A = { lat: 26.80, lng: 80.90 };       // the shop
const B = { lat: 26.80, lng: 80.95 };       // a corner
const DEST = { lat: 26.85, lng: 80.95 };    // the customer
const ROAD = [A, B, DEST];                  // the road: east, then north (about 10.5 km)

let w; let server; let port; let order; let boss; let calls;
const clients = [];
before(async () => {
    await db.connect();
    server = http.createServer(app);
    realtime.init(server);
    await new Promise((r) => server.listen(0, r));
    port = server.address().port;
});
after(async () => {
    guard.stop(); liveTracking.reset();
    await new Promise((r) => server.close(r));
    await db.disconnect();
});
beforeEach(async () => {
    await db.clear();
    liveTracking.reset();
    routes.resetForTests();
    calls = [];
    routes.setTransport(async (args) => { calls.push(args); return { points: ROAD, distanceM: 10000, durationSec: 1500 }; });
    w = await f.makeWorld('eta-shop');
    tenantRecognizer.invalidateTenant('eta-shop');
    boss = await f.makeSuperAdmin('boss@example.com');
    await require('../src/models/Rider').updateOne({ tenantId: w.tenant._id, userId: w.rider.user._id }, { $set: { name: 'Raju', isActive: true, activeOrderCount: 1 } }, { upsert: true });
    order = await f.makeOrder(w.tenant, w.customer.user, {
        status: 'out_for_delivery', delivery: { riderId: w.rider.user._id, status: 'picked_up' },
        address: { line1: '9 Test Lane', city: 'Lucknow', latitude: DEST.lat, longitude: DEST.lng },
    });
});
afterEach(async () => {
    while (clients.length) clients.pop().close();
    delete process.env.ROUTES_PROVIDER;
    routes.setTransport(null);
    await PlatformSettings.updateOne({ _id: 'main' }, { $unset: { tracking: 1 } });
    await guard.refresh();
});

const ord = () => ({ id: String(order._id), tenantId: String(w.tenant._id), userId: String(w.customer.user._id), orderNo: order.orderNo, dest: DEST });
const ping = (pos, now) => tripEta.update({ order: ord(), riderId: w.rider.user._id, riderName: 'Raju', pos, now });
const google = () => { process.env.ROUTES_PROVIDER = 'google'; };
const watcher = async () => {
    const c = connect(`http://localhost:${port}`, { auth: { token: w.customer.accessToken, tenant: w.tenant.slug }, transports: ['websocket'], reconnection: false });
    clients.push(c);
    await new Promise((r) => c.on('connect', r));
    const seen = { route: [], eta: [], quiet: [], location: [] };
    c.on('rider:route', (p) => seen.route.push(p));
    c.on('order:eta', (p) => seen.eta.push(p));
    c.on('rider:quiet', (p) => seen.quiet.push(p));
    c.on('rider:location', (p) => seen.location.push(p));
    await new Promise((r) => c.emit('order:join', { orderId: String(order._id) }, r));
    return { c, seen };
};
const count = (type) => Notification.countDocuments({ type, userId: w.customer.user._id });

describe('the polyline text', () => {
    test('a route survives being written as text and read back', () => {
        const back = polyline.decode(polyline.encode(ROAD));
        assert.equal(back.length, 3);
        back.forEach((p, i) => { assert.ok(Math.abs(p.lat - ROAD[i].lat) < 1e-5 && Math.abs(p.lng - ROAD[i].lng) < 1e-5); });
        assert.equal(polyline.encode([{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }]), '_p~iF~ps|U_ulLnnqC_mqNvxq`@');   // Google's own example
    });
});

describe('without Google (the free estimate)', () => {
    test('a route and an arrival time come from the first ping, and the time falls as the rider gets closer', async () => {
        const { seen } = await watcher();
        const t0 = Date.now();
        const e1 = await ping(A, t0);
        assert.equal(e1.source, 'estimate');
        assert.ok(e1.remainingM > 9000 && e1.remainingM < 17000, `remaining ${e1.remainingM}`);
        assert.equal(calls.length, 0);   // no Google call at all
        const e2 = await ping(B, t0 + 3000);
        const e3 = await ping({ lat: 26.84, lng: 80.95 }, t0 + 6000);
        assert.ok(e2.remainingM < e1.remainingM && e3.remainingM < e2.remainingM);
        assert.ok(e3.remainingSec < e2.remainingSec && e2.remainingSec < e1.remainingSec);
        await f.waitFor(async () => seen.route.length >= 1);
        assert.equal(seen.route.length, 1);                 // the route is announced once
        assert.equal(seen.route[0].source, 'estimate');
        assert.equal(seen.route[0].orderId, String(order._id));
        assert.ok(seen.eta.length >= 1);
    });
});

describe('with Google', () => {
    test('one call for the whole trip; the time comes from how far along the road he is', async () => {
        google();
        const { seen } = await watcher();
        const t0 = Date.now();
        const e1 = await ping(A, t0);
        assert.equal(calls.length, 1);
        assert.deepEqual([e1.source, e1.remainingM, e1.remainingSec], ['google', 10000, 1500]);
        const mid = await ping(B, t0 + 5000);   // about half way
        assert.equal(calls.length, 1);
        assert.ok(mid.remainingM > 4000 && mid.remainingM < 6000, `mid ${mid.remainingM}`);
        assert.ok(mid.remainingSec > 600 && mid.remainingSec < 900);
        await ping({ lat: 26.8499, lng: 80.95 }, t0 + 10000);
        assert.equal(calls.length, 1);
        await f.waitFor(async () => seen.route.length >= 1);
        assert.equal(seen.route.length, 1);
        assert.equal(seen.route[0].source, 'google');
        assert.equal(polyline.decode(seen.route[0].polyline).length, 3);
    });

    test('leaving the road on two pings asks for a new route (not sooner than a minute); an old route is renewed', async () => {
        google();
        const t0 = Date.now();
        await ping(A, t0);
        const off = { lat: 26.78, lng: 80.93 };   // far from the road
        await ping(off, t0 + 5000);
        await ping(off, t0 + 8000);
        assert.equal(calls.length, 1, 'too soon after the last route');
        await ping(off, t0 + 70000);
        await ping(off, t0 + 73000);
        assert.equal(calls.length, 2);
        assert.deepEqual(calls[1].from, off);
        await ping(off, t0 + 73000 + 11 * 60000);   // an old route
        assert.equal(calls.length, 3);
    });

    test('the monthly cap: beyond it the estimate is used and Google is not called; the count never passes the cap', async () => {
        google();
        await PlatformSettings.findByIdAndUpdate('main', { $set: { 'tracking.routeCap': 2 } }, { upsert: true });
        await guard.refresh();
        const r1 = await routes.getRoute({ from: A, to: DEST });
        const r2 = await routes.getRoute({ from: A, to: DEST });
        const r3 = await routes.getRoute({ from: A, to: DEST });
        assert.deepEqual([r1.source, r2.source, r3.source, r3.reason], ['google', 'google', 'estimate', 'monthly_cap']);
        assert.equal(calls.length, 2);
        assert.equal(await Counter.findById(`routes:${new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7)}`).then((c) => c.seq), 2);
        assert.ok(r3.distanceM > 0 && r3.durationSec >= 120);
    });

    test('three failures in a row: Google is left alone for five minutes and the estimate is used meanwhile', async () => {
        google();
        routes.setTransport(async () => { calls.push(1); throw new Error('Google is down'); });
        const rs = [];
        for (let i = 0; i < 5; i += 1) rs.push(await routes.getRoute({ from: A, to: DEST }));
        assert.deepEqual(rs.map((r) => r.source), ['estimate', 'estimate', 'estimate', 'estimate', 'estimate']);
        assert.deepEqual(rs.map((r) => r.reason), ['error', 'error', 'error', 'breaker', 'breaker']);
        assert.equal(calls.length, 3);
        const s = await routes.stats();
        assert.equal(s.breakerOpen, true);
        assert.match(s.lastError, /Google is down/);
    });
});

describe('the alerts', () => {
    test('"arriving soon" and "reached" go to the customer once each, even if the pings keep coming', async () => {
        const t0 = Date.now();
        await ping(A, t0);
        assert.equal(await count('rider_arriving'), 0);
        await ping({ lat: 26.8470, lng: 80.95 }, t0 + 3000);   // about 330 m away
        await f.waitFor(async () => (await count('rider_arriving')) === 1);
        await ping({ lat: 26.8480, lng: 80.95 }, t0 + 6000);
        assert.equal(await count('rider_reached'), 0);
        await ping({ lat: 26.8496, lng: 80.95 }, t0 + 9000);    // about 45 m away
        await f.waitFor(async () => (await count('rider_reached')) === 1);
        await ping({ lat: 26.8497, lng: 80.95 }, t0 + 12000);
        await f.sleep(150);
        assert.equal(await count('rider_arriving'), 1);
        assert.equal(await count('rider_reached'), 1);
        const arriving = await Notification.findOne({ type: 'rider_arriving' }).lean();
        assert.match(arriving.title, /Arriving|almost there/);
        assert.equal(arriving.data.orderId, String(order._id));
        const saved = await Order.findById(order._id).lean();
        assert.ok(saved.delivery.arrivingNotifiedAt && saved.delivery.reachedNotifiedAt);
    });

    test('a quiet rider: the customer sees "reconnecting" after a minute, the owner is told after three, and a new ping clears it', async () => {
        const { seen } = await watcher();
        const t0 = Date.now();
        await ping(A, t0);
        await tripEta.sweep(t0 + 30000);
        await f.sleep(100);
        assert.equal(seen.quiet.length, 0);
        await tripEta.sweep(t0 + 65000);
        await f.waitFor(async () => seen.quiet.length === 1);
        await tripEta.sweep(t0 + 80000);
        assert.equal(seen.quiet.length, 1, 'told once');
        assert.equal(tripEta.view(order._id).quiet, true);
        assert.equal(await Notification.countDocuments({ type: 'rider_quiet', role: 'owner' }), 0);
        await tripEta.sweep(t0 + 190000);
        await f.waitFor(async () => (await Notification.countDocuments({ type: 'rider_quiet', role: 'owner' })) === 1);
        await tripEta.sweep(t0 + 250000);
        await f.sleep(100);
        assert.equal(await Notification.countDocuments({ type: 'rider_quiet', role: 'owner' }), 1);
        await ping(B, t0 + 260000);
        assert.equal(tripEta.view(order._id).quiet, false);
    });
});

describe('seeing it', () => {
    test('a phone that opens the map gets the position, the route and the arrival time at once; the tracking page has them too', async () => {
        google();
        const rider = connect(`http://localhost:${port}`, { auth: { token: w.rider.accessToken, tenant: w.tenant.slug }, transports: ['websocket'], reconnection: false });
        clients.push(rider);
        await new Promise((r) => rider.on('connect', r));
        const ack = await new Promise((r) => rider.emit('rider:ping', { lat: B.lat, lng: B.lng }, r));
        assert.equal(ack.saved, true);
        await f.waitFor(async () => !!tripEta.view(order._id));

        const { seen } = await watcher();
        await f.waitFor(async () => seen.location.length && seen.route.length && seen.eta.length);
        assert.equal(seen.location[0].lat, B.lat);
        assert.equal(seen.route[0].source, 'google');
        assert.ok(seen.eta[0].remainingM > 4000);

        const t = await request(app).get(`/api/orders/${order._id}/tracking`).set(w.customer.headers);
        assert.equal(t.status, 200, JSON.stringify(t.body));
        assert.equal(t.body.etaSource, 'route');
        assert.equal(t.body.route.source, 'google');
        assert.equal(polyline.decode(t.body.route.polyline).length, 3);
        assert.ok(t.body.remaining.meters > 4000 && t.body.remaining.seconds > 0);
        assert.equal(t.body.riderQuiet, false);
        assert.equal(typeof t.body.destination?.latitude, 'number');   // the address pin for the live map
    });

    test('the superadmin sees the road-route use, and sets the monthly cap (supreme admin only)', async () => {
        const read = await request(app).get('/api/admin/platform/tracking').set({ Authorization: `Bearer ${boss.token}` });
        assert.equal(read.status, 200);
        assert.deepEqual(['provider', 'usedThisMonth', 'calls', 'estimates', 'breakerOpen'].filter((k) => !(k in read.body.routes)), []);
        assert.equal(read.body.settings.routeCap, 8000);
        const put = await request(app).put('/api/admin/platform/tracking').set({ Authorization: `Bearer ${boss.token}` }).send({ routeCap: 500 });
        assert.equal(put.body.settings.routeCap, 500);
        assert.equal((await request(app).put('/api/admin/platform/tracking').set({ Authorization: `Bearer ${boss.token}` }).send({ routeCap: -1 })).status, 400);
        const other = await f.makeSuperAdmin('vivek@example.com', { phones: ['9876543210'] });
        assert.equal((await request(app).put('/api/admin/platform/tracking').set({ Authorization: `Bearer ${other.token}` }).send({ routeCap: 1 })).status, 403);
    });
});

describe('the lock-screen notification', () => {
    const pushChannel = require('../src/notifications/channels/push');
    const realSend = pushChannel.send;
    let sent;
    beforeEach(() => { sent = []; pushChannel.send = async (a) => { sent.push(a); return { sent: 1, tokens: 1 }; }; });
    afterEach(() => { pushChannel.send = realSend; });

    test('one silent, replaceable update: not at once, then only when the time moved 2 minutes and 90 seconds passed', async () => {
        const t0 = Date.now();
        await ping(A, t0);
        await ping(A, t0 + 30000);
        assert.equal(sent.length, 0);                              // too soon after pickup
        await ping(A, t0 + 61000);
        assert.equal(sent.length, 1);
        assert.equal(sent[0].tag, `trip-${order._id}`);
        assert.equal(sent[0].quietChannel, 'live_trip');
        assert.equal(String(sent[0].userId), String(w.customer.user._id));
        assert.match(sent[0].title, /Arriving in about \d+ min/);
        await ping({ lat: 26.8, lng: 80.9005 }, t0 + 100000);      // 90 seconds not over yet
        assert.equal(sent.length, 1);
        await ping(A, t0 + 160000);                                // 90 seconds over, but the time has not moved
        assert.equal(sent.length, 1);
        await ping(B, t0 + 170000);                                // about half way: many minutes less
        assert.equal(sent.length, 2);
        assert.equal(sent[1].tag, sent[0].tag);                    // same tag: it replaces the first one
    });

    test('the arriving push carries the same tag, so it replaces the update', async () => {
        const center = require('../src/notifications/center');
        const real = center.notify;
        const seen = [];
        center.notify = async (k, ctx) => { seen.push({ k, tag: ctx.tag }); return null; };
        try {
            const t0 = Date.now();
            await ping(A, t0);
            await ping({ lat: 26.8470, lng: 80.95 }, t0 + 3000);
            await f.waitFor(async () => seen.length >= 1);
            assert.equal(seen[0].k, 'rider_arriving');
            assert.equal(seen[0].tag, `trip-${order._id}`);
        } finally { center.notify = real; }
    });
});
