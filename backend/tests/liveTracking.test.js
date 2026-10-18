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
const guard = require('../src/services/trackingGuard');
const Rider = require('../src/models/Rider');
const Tenant = require('../src/models/Tenant');
const PlatformSettings = require('../src/models/PlatformSettings');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');

// Live tracking over sockets: the rider pings, people watching the order see it at once, the database is written in batches,
// and when the server is struggling or full the apps are told to poll instead (nothing crashes).
let w; let server; let port; let order; let boss;
const clients = [];
before(async () => {
    await db.connect();
    server = http.createServer(app);
    realtime.init(server);
    await new Promise((r) => server.listen(0, r));
    port = server.address().port;
});
after(async () => {
    guard.stop();
    liveTracking.stopFlusher();
    await new Promise((r) => server.close(r));
    await db.disconnect();
});
beforeEach(async () => {
    await db.clear();
    liveTracking.reset();
    await guard.clearAuto();
    w = await f.makeWorld('live-shop');
    tenantRecognizer.invalidateTenant('live-shop');
    boss = await f.makeSuperAdmin('boss@example.com');
    await Rider.updateOne({ tenantId: w.tenant._id, userId: w.rider.user._id }, { $set: { name: 'Raju', isActive: true, activeOrderCount: 1 } }, { upsert: true });
    order = await f.makeOrder(w.tenant, w.customer.user, {
        status: 'out_for_delivery', delivery: { riderId: w.rider.user._id, status: 'picked_up' },
    });
});
afterEach(async () => {
    while (clients.length) clients.pop().close();
    await PlatformSettings.updateOne({ _id: 'main' }, { $unset: { tracking: 1 } });
    await guard.refresh();
});

const connectAs = (who, extra = {}) => new Promise((resolve, reject) => {
    const c = connect(`http://localhost:${port}`, { auth: { token: who.accessToken, tenant: w.tenant.slug }, transports: ['websocket'], reconnection: false, ...extra });
    clients.push(c);
    c.on('connect', () => resolve(c));
    c.on('connect_error', (e) => reject(e));
});
const emitAck = (c, ev, body) => new Promise((resolve) => c.emit(ev, body, resolve));
const next = (c, ev, ms = 3000) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error(`no ${ev}`)), ms); c.once(ev, (p) => { clearTimeout(t); resolve(p); }); });
const watch = async () => {
    const cust = await connectAs(w.customer);
    assert.equal((await emitAck(cust, 'order:join', { orderId: String(order._id) })).ok, true);
    return cust;
};
const admin = (m, url, body) => request(app)[m](`/api/admin${url}`).set({ Authorization: `Bearer ${boss.token}` }).send(body);

describe('the rider sends his position over the socket', () => {
    test('the customer watching the order gets it at once, with the direction; the rider is told it was saved', async () => {
        const cust = await watch();
        const rider = await connectAs(w.rider);
        const got = next(cust, 'rider:location');
        const ack = await emitAck(rider, 'rider:ping', { lat: 26.84, lng: 80.94, speed: 5.2 });
        assert.deepEqual([ack.ok, ack.saved], [true, true]);
        const p = await got;
        assert.deepEqual([p.orderId, p.lat, p.lng, p.speed, p.seq], [String(order._id), 26.84, 80.94, 5.2, 1]);
        assert.equal(liveTracking.latestFor(w.rider.user._id).lat, 26.84);

        await f.sleep(liveTracking.MIN_GAP_MS + 50);
        const second = next(cust, 'rider:location');
        await emitAck(rider, 'rider:ping', { lat: 26.8405, lng: 80.94 });   // moved north
        const q = await second;
        assert.equal(q.seq, 2);
        assert.ok(q.heading === 0 || q.heading > 350 || q.heading < 10, `heading ${q.heading}`);   // about north
    });

    test('bad input, too fast, no order on the way and a customer pinging are all refused politely', async () => {
        const rider = await connectAs(w.rider);
        assert.equal((await emitAck(rider, 'rider:ping', { lat: 'x', lng: 1 })).ok, false);
        assert.equal((await emitAck(rider, 'rider:ping', { lat: 200, lng: 1 })).ok, false);
        assert.equal((await emitAck(rider, 'rider:ping', undefined)).ok, false);
        assert.equal((await emitAck(rider, 'rider:ping', { lat: 26.8, lng: 80.9 })).saved, true);
        const fast = await emitAck(rider, 'rider:ping', { lat: 26.8001, lng: 80.9 });
        assert.deepEqual([fast.ok, fast.saved, fast.reason], [true, false, 'too_fast']);

    });

    test('a rider with no order on the way, or a shop with tracking off, is not saved', async () => {
        const rider = await connectAs(w.rider);
        await f.makeOrder(w.tenant, w.customer.user, { status: 'placed' });
        await require('../src/models/Order').updateOne({ _id: order._id }, { $set: { status: 'delivered' } });
        liveTracking.orderChanged(w.rider.user._id);
        const none = await emitAck(rider, 'rider:ping', { lat: 26.8, lng: 80.9 });
        assert.deepEqual([none.ok, none.saved, none.reason], [true, false, 'no_order_on_the_way']);

        await require('../src/models/Order').updateOne({ _id: order._id }, { $set: { status: 'out_for_delivery' } });
        liveTracking.orderChanged(w.rider.user._id);
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.riders.liveTracking': false } });
        liveTracking.reset();
        const off = await emitAck(rider, 'rider:ping', { lat: 26.8, lng: 80.9 });
        assert.deepEqual([off.saved, off.reason], [false, 'tracking_off']);
    });

    test('only a rider can ping; the web request does the same thing (the fallback)', async () => {
        const owner = await connectAs(w.owner);
        const noReply = await new Promise((resolve) => { owner.emit('rider:ping', { lat: 26.8, lng: 80.9 }, resolve); setTimeout(() => resolve('ignored'), 400); });
        assert.equal(noReply, 'ignored');
        assert.equal(liveTracking.latestFor(w.rider.user._id), null);

        const cust = await watch();
        const got = next(cust, 'rider:location');
        const r = await request(app).post('/api/rider/location').set(w.rider.headers).send({ lat: 26.81, lng: 80.91 });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.saved, true);
        assert.equal((await got).lat, 26.81);
        assert.equal((await request(app).post('/api/rider/location').set(w.rider.headers).send({ lat: 'no' })).status, 400);
        assert.ok(guard.stats().httpFallbacks >= 1);
    });
});

describe('opening the map', () => {
    test('someone who joins later gets the last known position straight away', async () => {
        const rider = await connectAs(w.rider);
        await emitAck(rider, 'rider:ping', { lat: 26.84, lng: 80.94 });
        const cust = await connectAs(w.customer);
        const got = next(cust, 'rider:location');
        await emitAck(cust, 'order:join', { orderId: String(order._id) });
        const p = await got;
        assert.deepEqual([p.lat, p.lng], [26.84, 80.94]);
    });

    test('the order tracking and the owner map show the live position, which is never behind the saved one', async () => {
        const rider = await connectAs(w.rider);
        await emitAck(rider, 'rider:ping', { lat: 26.84, lng: 80.94 });
        const t = await request(app).get(`/api/orders/${order._id}/tracking`).set(w.customer.headers);
        assert.equal(t.status, 200, JSON.stringify(t.body));
        assert.equal(t.body.riderLocation.lat, 26.84);
        const m = await request(app).get('/api/shop/riders/locations').set(w.owner.headers);
        assert.equal(m.status, 200);
        assert.equal(m.body.items[0].lat, 26.84);   // the owner map has it at once: it reads the live position, not the database
    });
});

describe('the database is never written for a position', () => {
    test('many pings write nothing to the database, and the memory is cleared when the last order is done', async () => {
        const t0 = Date.now();
        for (let i = 0; i < 3; i += 1) {   // three pings 3 seconds apart (the clock is passed in, so the test is fast)
            const r = await liveTracking.ingest({ tenantId: w.tenant._id, riderId: w.rider.user._id, body: { lat: 26.84 + i / 10000, lng: 80.94 }, via: 'socket', now: t0 + i * 3000 });
            assert.equal(r.saved, true);
        }
        assert.ok(liveTracking.latestFor(w.rider.user._id));
        assert.equal((await Rider.findOne({ userId: w.rider.user._id }).lean()).lastLocation, undefined);   // nothing was written, now or later
        await liveTracking.flush(Date.now() + 20000);
        assert.equal((await Rider.findOne({ userId: w.rider.user._id }).lean()).lastLocation, undefined);

        const orderStatus = require('../src/services/orderStatusService');
        const Order = require('../src/models/Order');
        await orderStatus.change({ order: await Order.findById(order._id), status: 'delivered', actor: { type: 'superadmin', label: 'test' } });
        assert.equal(liveTracking.latestFor(w.rider.user._id), null);
    });
});

describe('a crowd', () => {
    test('150 phones watching one order all get every ping, and the database takes no write', async () => {
        const crowd = [];
        for (let i = 0; i < 150; i += 1) crowd.push(connectAs(w.customer));
        const phones = await Promise.all(crowd);
        await Promise.all(phones.map((c) => emitAck(c, 'order:join', { orderId: String(order._id) })));
        assert.ok(realtime.connectionCount() >= 150);

        const got = new Array(phones.length).fill(0);
        phones.forEach((c, i) => c.on('rider:location', () => { got[i] += 1; }));
        const t0 = Date.now();
        for (let i = 0; i < 10; i += 1) {
            await liveTracking.ingest({ tenantId: w.tenant._id, riderId: w.rider.user._id, body: { lat: 26.84 + i / 10000, lng: 80.94 }, via: 'socket', now: t0 + i * 3000 });
        }
        await f.waitFor(async () => got.every((n) => n === 10), 5000);
        assert.ok(got.every((n) => n === 10), `some phones missed pings: ${got.filter((n) => n !== 10).length}`);
        assert.equal((await Rider.findOne({ userId: w.rider.user._id }).lean()).lastLocation, undefined);   // ten pings, no database write
    });
});

describe('when the server is struggling or full, nothing crashes', () => {
    test('polling mode: new sockets are refused with a clear answer and the public mode says poll; existing apps are told', async () => {
        const rider = await connectAs(w.rider);
        const told = next(rider, 'tracking:mode');
        const set = await admin('put', '/platform/tracking', { mode: 'polling', pollSec: 12 });
        assert.equal(set.status, 200, JSON.stringify(set.body));
        const notice = await told;
        assert.deepEqual([notice.mode, notice.pollSec], ['polling', 12]);
        assert.ok(notice.retryAfterSec >= 60);

        const err = await connectAs(w.customer).then(() => null, (e) => e);
        assert.equal(err.message, 'SERVER_BUSY');
        assert.equal(err.data.mode, 'polling');
        assert.equal(err.data.pollSec, 12);
        assert.ok(err.data.retryAfterSec >= 60);
        const mode = await request(app).get('/api/tracking/mode');
        assert.equal(mode.status, 200);
        assert.deepEqual([mode.body.mode, mode.body.pollSec], ['polling', 12]);

        // the web request keeps working in every mode: it is the polling path
        const r = await request(app).post('/api/rider/location').set(w.rider.headers).send({ lat: 26.8, lng: 80.9 });
        assert.equal(r.status, 200);

        await admin('put', '/platform/tracking', { mode: 'socket' });
        await connectAs(w.customer);   // back to normal
    });

    test('polling mode also closes the open sockets after a moment (superadmins stay), and the apps are told when to come back', async () => {
        guard.config.shedDelayMs = 50;
        try {
            const cust = await connectAs(w.customer);
            const adm = connect(`http://localhost:${port}`, { auth: { adminToken: boss.token }, transports: ['websocket'], reconnection: false });
            clients.push(adm);
            await new Promise((resolve) => adm.on('connect', resolve));
            const told = next(cust, 'tracking:mode');
            const closed = new Promise((resolve) => cust.on('disconnect', resolve));
            await admin('put', '/platform/tracking', { mode: 'polling' });
            const notice = await told;
            assert.equal(notice.mode, 'polling');
            assert.ok(notice.retryAfterSec >= 60);
            assert.equal(await closed, 'io server disconnect');
            await f.sleep(100);
            assert.equal(adm.connected, true);
            assert.ok(guard.stats().shed >= 1);
        } finally { guard.config.shedDelayMs = 3000; }
    });

    test('the cap: when this many sockets are open the next one is refused', async () => {
        await admin('put', '/platform/tracking', { maxSockets: 10 });
        const base = realtime.connectionCount();
        const made = [];
        let refused = null;
        for (let i = 0; i < 12 && !refused; i += 1) {
            try { made.push(await connectAs(w.customer)); } catch (e) { refused = e; }
        }
        assert.ok(refused, 'the cap was not applied');
        assert.equal(refused.message, 'SERVER_BUSY');
        assert.ok(made.length + base <= 10);
        const adm = connect(`http://localhost:${port}`, { auth: { adminToken: boss.token }, transports: ['websocket'], reconnection: false });
        clients.push(adm);
        assert.equal(await new Promise((resolve) => { adm.on('connect', () => resolve(true)); adm.on('connect_error', () => resolve(false)); }), true);   // a superadmin is never refused
    });

    test('the watchdog: a struggling server switches to polling by itself, then comes back', async () => {
        await guard.forceAuto(60000, 'The server is busy');
        const st = await guard.status();
        assert.deepEqual([st.mode, st.reason], ['polling', 'The server is busy']);
        const err = await connectAs(w.customer).then(() => null, (e) => e);
        assert.equal(err.message, 'SERVER_BUSY');
        await guard.clearAuto();
        assert.equal((await guard.status()).mode, 'socket');
        await connectAs(w.customer);
    });

    test('the switch is for the supreme admin; everybody can look at the health; bad input is refused', async () => {
        const other = await f.makeSuperAdmin('vivek@example.com', { phones: ['9876543210'] });
        const read = await request(app).get('/api/admin/platform/tracking').set({ Authorization: `Bearer ${other.token}` });
        assert.equal(read.status, 200);
        assert.ok('sockets' in read.body && 'counters' in read.body);
        const no = await request(app).put('/api/admin/platform/tracking').set({ Authorization: `Bearer ${other.token}` }).send({ mode: 'off' });
        assert.equal(no.status, 403);
        for (const bad of [{ mode: 'fast' }, { maxSockets: 3 }, { pollSec: 1 }, {}]) assert.equal((await admin('put', '/platform/tracking', bad)).status, 400, JSON.stringify(bad));
        const off = await admin('put', '/platform/tracking', { mode: 'off' });
        assert.equal(off.body.status.mode, 'off');
        const e = await connectAs(w.customer).then(() => null, (x) => x);
        assert.equal(e.message, 'TRACKING_OFF');
        const reset = await admin('put', '/platform/tracking', { reset: true });
        assert.equal(reset.body.status.mode, 'socket');
    });
});
