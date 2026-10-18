// A load test for live tracking: many riders sending their position, many customer phones watching, all over real sockets.
//
//   cd backend
//   node tests/load/trackingLoad.js                       (20 riders, 10 watchers each, 20 seconds)
//   node tests/load/trackingLoad.js --riders 50 --watchers 20 --seconds 40 --cap 5000
//
// It starts its OWN server and an in-memory database (the same as the tests), so it never touches the real shop or the real
// database. Numbers are better than on a small free server, because the phones and the server share this computer: read
// them as "does the design hold" (no missed positions, the cap and the polling answer work, memory stays flat), and run the
// same riders/watchers against a staging copy of the real server for the real answer.
//
// What it reports: how many positions every watcher received (all of them?), how long a position took from the rider to a
// watcher (p50, p95, worst), the server's delay and memory, how many connections were refused at the cap (they would poll),
// and how many database writes the positions turned into.
require('../helpers/env');
const http = require('http');
const { monitorEventLoopDelay } = require('perf_hooks');
const { io: connect } = require('socket.io-client');
const db = require('../helpers/db');
const f = require('../helpers/factory');
const appModule = require('../../src/server/app');
const app = appModule.app || appModule;
const realtime = require('../../src/services/realtime');
const liveTracking = require('../../src/services/liveTracking');
const guard = require('../../src/services/trackingGuard');
const PlatformSettings = require('../../src/models/PlatformSettings');
const Rider = require('../../src/models/Rider');
const tenantRecognizer = require('../../src/middlewares/tenantRecognizer');

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : def; };
const RIDERS = arg('riders', 20);
const WATCHERS = arg('watchers', 10);
const SECONDS = arg('seconds', 20);
const CAP = arg('cap', 5000);
const GAP_MS = 2200;   // the server drops pings closer than 2 seconds

const pct = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : 0);

async function main() {
    await db.connect();
    const server = http.createServer(app);
    realtime.init(server);
    await new Promise((r) => server.listen(0, r));
    const url = `http://localhost:${server.address().port}`;
    const tenant = await f.makeTenant('load-shop');
    tenantRecognizer.invalidateTenant('load-shop');
    await PlatformSettings.updateOne({ _id: 'main' }, { $set: { 'tracking.maxSockets': CAP } }, { upsert: true });
    await guard.refresh();

    console.log(`Setting up ${RIDERS} riders, ${RIDERS} orders and ${RIDERS * WATCHERS} watching phones (cap ${CAP})...`);
    const trips = [];
    for (let i = 0; i < RIDERS; i += 1) {
        const rider = await f.makeUser(tenant, 'rider', `91${String(10000000 + i).slice(-8)}`);
        const customer = await f.makeUser(tenant, 'customer', `92${String(10000000 + i).slice(-8)}`);
        await Rider.updateOne({ tenantId: tenant._id, userId: rider.user._id }, { $set: { isActive: true, activeOrderCount: 1 } });
        const order = await f.makeOrder(tenant, customer.user, {
            status: 'out_for_delivery', delivery: { riderId: rider.user._id, status: 'picked_up' },
            address: { line1: '9 Test Lane', city: 'Lucknow', latitude: 26.85, longitude: 80.95 },
        });
        trips.push({ rider, customer, orderId: String(order._id), sentAt: new Map(), got: [], watchers: [] });
    }

    const open = (who) => new Promise((resolve) => {
        const c = connect(url, { auth: { token: who.accessToken, tenant: 'load-shop' }, transports: ['websocket'], reconnection: false });
        c.on('connect', () => resolve({ c }));
        c.on('connect_error', (e) => resolve({ error: e.message, c }));
    });

    const latencies = [];
    let refused = 0;
    let connected = 0;
    for (const trip of trips) {
        const batch = await Promise.all(Array.from({ length: WATCHERS }, () => open(trip.customer)));
        for (const w of batch) {
            if (w.error) { refused += 1; w.c.close(); continue; }
            connected += 1;
            const mine = { n: 0 };
            trip.watchers.push({ c: w.c, mine });
            w.c.on('rider:location', (p) => {
                const t = trip.sentAt.get(Math.round((p.lat - 26.80) * 1e5));
                if (t) { latencies.push(Date.now() - t); mine.n += 1; }
            });
            await new Promise((r) => w.c.emit('order:join', { orderId: trip.orderId }, r));
        }
        trip.rider.socket = (await open(trip.rider)).c;
    }
    console.log(`Connected ${connected} watching phones; ${refused} were refused (they would poll instead). Riding for ${SECONDS} s...`);

    const lag = monitorEventLoopDelay({ resolution: 10 });
    lag.enable();
    const heap0 = process.memoryUsage().heapUsed;
    const end = Date.now() + SECONDS * 1000;
    let sent = 0;
    let saved = 0;
    let i = 0;
    while (Date.now() < end) {
        i += 1;
        await Promise.all(trips.map((trip) => new Promise((resolve) => {
            const key = i;
            trip.sentAt.set(key, Date.now());
            trip.rider.socket.emit('rider:ping', { lat: 26.80 + key * 1e-5, lng: 80.90 + key * 1e-5 }, (ack) => { sent += 1; if (ack?.saved) saved += 1; resolve(); });
        })));
        await new Promise((r) => setTimeout(r, GAP_MS));
    }
    await new Promise((r) => setTimeout(r, 1500));   // let the last positions arrive
    lag.disable();

    const expected = trips.reduce((a, t) => a + t.watchers.length * saved / trips.length, 0);
    const received = trips.reduce((a, t) => a + t.watchers.reduce((b, w) => b + w.mine.n, 0), 0);
    const stats = guard.stats();
    await liveTracking.flush(Date.now() + 60000);   // memory housekeeping only: no position is ever written to the database
    console.log('\n=========== RESULT ===========');
    console.log(`Positions sent by riders:     ${sent} (${saved} accepted)`);
    console.log(`Watchers got them:            ${received} of about ${Math.round(expected)} expected (${expected ? Math.round((received / expected) * 100) : 100}%)`);
    console.log(`Time rider -> phone:          p50 ${pct(latencies, 50)} ms, p95 ${pct(latencies, 95)} ms, worst ${pct(latencies, 100)} ms`);
    console.log(`Server delay (event loop):    mean ${(lag.mean / 1e6).toFixed(1)} ms, worst ${(lag.max / 1e6).toFixed(0)} ms`);
    console.log(`Memory growth:                ${Math.round((process.memoryUsage().heapUsed - heap0) / 1048576)} MB`);
    console.log(`Refused at the cap:           ${refused} (would fall back to polling)`);
    console.log('Database writes for positions: 0 (positions live in memory and on the socket only)');
    console.log(`Server switched to polling:   ${stats.autoUntil ? 'YES (watchdog)' : 'no'}`);
    const bad = received < expected * 0.99 || pct(latencies, 95) > 1000;
    console.log(bad ? '\nVERDICT: PROBLEM. Positions were missed or slow. Lower the cap or add a paid server.' : '\nVERDICT: OK for this load.');

    trips.forEach((t) => { t.watchers.forEach((w) => w.c.close()); t.rider.socket.close(); });
    guard.stop(); liveTracking.reset();
    await new Promise((r) => server.close(r));
    await db.disconnect();
    process.exit(bad ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
