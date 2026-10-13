require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const request = require('supertest');
const { io: ioc } = require('socket.io-client');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const realtime = require('../src/services/realtime');
const liveFeed = require('../src/services/liveFeed');
const orderStatus = require('../src/services/orderStatusService');
const FeedEvent = require('../src/models/FeedEvent');
const AuditLog = require('../src/models/AuditLog');
const Rider = require('../src/models/Rider');
const { maskPhone } = require('../src/utils/phoneHash');

let server;
let port;
before(async () => {
    await db.connect();
    server = http.createServer(app);
    realtime.init(server);
    await new Promise((r) => server.listen(0, r));
    port = server.address().port;
});
after(async () => {
    await new Promise((r) => server.close(r));
    await db.disconnect();
});
beforeEach(async () => {
    await FeedEvent.deleteMany({});
    await AuditLog.deleteMany({});
});

const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const feedCount = (tenantId, extra = {}) => FeedEvent.countDocuments({ tenantId, ...extra });
const connect = (auth) => new Promise((resolve, reject) => {
    const c = ioc(`http://localhost:${port}`, { auth, transports: ['websocket'], reconnection: false });
    c.on('connect', () => resolve(c));
    c.on('connect_error', (e) => { c.close(); reject(e); });
});
const nextEvent = (c, ms = 1500) => new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    c.once('feed:event', (e) => { clearTimeout(t); resolve(e); });
});

describe('live feed: saving and cleaning', () => {
    test('emit saves a line and removes phone numbers and secrets', async () => {
        const w = await f.makeWorld('feed-scrub');
        liveFeed.emit(w.tenant._id, 'orders', {
            type: 'order.test', phone: '9876543210', customerPhone: '9876543210', token: 'abc',
            note: 'call 9876543210 now', nested: { mobile: '9123456780', ok: 5 },
        });
        await f.waitFor(async () => (await feedCount(w.tenant._id)) === 1);
        const row = await FeedEvent.findOne({ tenantId: w.tenant._id }).lean();
        assert.equal(row.type, 'order.test');
        const text = JSON.stringify(row);
        assert.ok(!text.includes('9876543210'));
        assert.ok(!text.includes('9123456780'));
        assert.ok(!text.includes('abc'));
        assert.equal(row.data.nested.ok, 5);
        assert.match(row.data.note, /\[phone\]/);
    });

    test('an unknown category or a missing shop saves nothing', async () => {
        const w = await f.makeWorld('feed-unknown');
        assert.equal(liveFeed.emit(w.tenant._id, 'gossip', { type: 'x' }), null);
        assert.equal(liveFeed.emit(null, 'orders', { type: 'x' }), null);
        await f.sleep(150);
        assert.equal(await FeedEvent.countDocuments({}), 0);
    });

    test('an order status change makes an "orders" line, without any phone number', async () => {
        const w = await f.makeWorld('feed-order');
        const order = await f.makeOrder(w.tenant, w.customer.user);
        await orderStatus.change({ order, status: 'accepted', actor: { type: 'owner', id: w.owner.user._id, label: '9000000010' } });
        await f.waitFor(async () => (await feedCount(w.tenant._id, { type: 'order.accepted' })) === 1);
        const row = await FeedEvent.findOne({ tenantId: w.tenant._id, type: 'order.accepted' }).lean();
        assert.equal(row.category, 'orders');
        assert.equal(row.data.orderNo, order.orderNo);
        assert.equal(row.data.by, 'owner');
        const text = JSON.stringify(row);
        assert.ok(!text.includes('9000000010'));
        assert.ok(!text.includes('9000000030'));
    });

    test('logins are in the feed: a good login and a wrong OTP, without the phone', async () => {
        const w = await f.makeWorld('feed-login');
        const phone = '9000000031';
        await f.plantOtp(w.tenant, phone, '123456');
        const bad = await request(app).post('/api/auth/verify-otp').set(w.customer.headers).send({ phone, otp: '654321' });
        assert.equal(bad.status, 400);
        const good = await request(app).post('/api/auth/verify-otp').set(w.customer.headers).send({ phone, otp: '123456' });
        assert.equal(good.status, 200);
        await f.waitFor(async () => (await feedCount(w.tenant._id, { category: 'logins' })) === 2);
        const types = (await FeedEvent.find({ tenantId: w.tenant._id, category: 'logins' }).lean()).map((r) => r.type).sort();
        assert.deepEqual(types, ['login.fail', 'login.ok']);
        assert.ok(!JSON.stringify(await FeedEvent.find({}).lean()).includes(phone));
    });
});

describe('live picture of a shop', () => {
    test('the superadmin sees counts, riders, billable orders, revenue, customers and the feed', async () => {
        const w = await f.makeWorld('snap-admin');
        const { token } = await f.makeSuperAdmin('snap-admin@test.com');
        await f.makeOrder(w.tenant, w.customer.user, { status: 'placed' });
        await f.makeOrder(w.tenant, w.customer.user, {
            status: 'delivered', deliveredAt: new Date(),
            pricing: { subtotal: 200, discount: 20, packagingCharge: 10, total: 190 },
            billing: { billable: true, at: new Date(), reason: 'delivered' },
        });
        await Rider.updateOne(
            { tenantId: w.tenant._id, userId: w.rider.user._id },
            { $set: { isOnline: true, lastLocation: { lat: 26.1, lng: 82.2, at: new Date() } } },
        );
        liveFeed.emit(w.tenant._id, 'orders', { type: 'order.test1' });
        liveFeed.emit(w.tenant._id, 'sms', { type: 'sms.test2' });
        await f.waitFor(async () => (await feedCount(w.tenant._id)) === 2);

        const res = await request(app).get(`/api/admin/tenants/${w.tenant._id}/live`).set(bearer(token));
        assert.equal(res.status, 200);
        assert.equal(res.body.orders.active.placed, 1);
        assert.equal(res.body.orders.activeTotal, 1);
        assert.equal(res.body.revenueToday, 190);
        assert.equal(res.body.billable.today, 1);
        assert.equal(res.body.billable.month, 1);
        assert.equal(res.body.customers, 1);
        assert.equal(typeof res.body.sms.balancePaise, 'number');
        assert.equal(res.body.openComplaints, 0);
        assert.equal(res.body.riders.length, 1);
        assert.equal(res.body.riders[0].location.lat, 26.1);
        assert.equal(res.body.feed.length, 2);
        assert.equal(res.body.feed[0].type, 'sms.test2');   // newest first
    });

    test('the owner sees his own feed without logins and settings lines', async () => {
        const w = await f.makeWorld('snap-owner');
        liveFeed.emit(w.tenant._id, 'orders', { type: 'order.visible' });
        liveFeed.emit(w.tenant._id, 'logins', { type: 'login.hidden' });
        liveFeed.emit(w.tenant._id, 'settings', { type: 'change' });
        await f.waitFor(async () => (await feedCount(w.tenant._id)) === 3);
        const res = await request(app).get('/api/shop/live').set(w.owner.headers);
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.feed.map((e) => e.type), ['order.visible']);
        assert.equal(typeof res.body.revenueToday, 'number');
    });

    test('a shop never sees the feed of another shop', async () => {
        const a = await f.makeWorld('snap-iso-a');
        const b = await f.makeWorld('snap-iso-b');
        liveFeed.emit(b.tenant._id, 'orders', { type: 'order.secret-b' });
        await f.waitFor(async () => (await feedCount(b.tenant._id)) === 1);
        const res = await request(app).get('/api/shop/live').set(a.owner.headers);
        assert.equal(res.status, 200);
        assert.equal(res.body.feed.length, 0);
    });

    test('only an owner (or the superadmin) can open the live picture', async () => {
        const w = await f.makeWorld('snap-perm');
        assert.equal((await request(app).get('/api/shop/live').set(w.customer.headers)).status, 403);
        assert.equal((await request(app).get('/api/shop/live').set(w.rider.headers)).status, 403);
        assert.equal((await request(app).get(`/api/admin/tenants/${w.tenant._id}/live`)).status, 401);
        assert.equal((await request(app).get(`/api/admin/tenants/${w.tenant._id}/live`).set(w.owner.headers)).status, 401);
    });
});

describe('phones in superadmin lists', () => {
    test('the user list hides the middle of every phone', async () => {
        const w = await f.makeWorld('mask-list');
        const { token } = await f.makeSuperAdmin('mask-list@test.com');
        const res = await request(app).get(`/api/admin/tenants/${w.tenant._id}/users`).set(bearer(token));
        assert.equal(res.status, 200);
        assert.ok(res.body.items.length >= 3);
        for (const u of res.body.items) {
            assert.notEqual(u.phone, '9000000030');
            assert.ok(!/^\d{10}$/.test(u.phone));
        }
        const customer = res.body.items.find((u) => u.role === 'customer');
        assert.equal(customer.phone, maskPhone('9000000030'));
    });

    test('revealing a phone shows the full number and writes an audit row', async () => {
        const w = await f.makeWorld('mask-reveal');
        const { token } = await f.makeSuperAdmin('mask-reveal@test.com');
        const res = await request(app).get(`/api/admin/tenants/${w.tenant._id}/users/${w.customer.user._id}/phone`).set(bearer(token));
        assert.equal(res.status, 200);
        assert.equal(res.body.phone, '9000000030');
        const rows = await AuditLog.find({ action: 'PHONE_REVEAL', tenantId: w.tenant._id }).lean();
        assert.equal(rows.length, 1);
        assert.equal(rows[0].actorType, 'superadmin');
        assert.ok(!JSON.stringify(rows[0]).includes('9000000030'));
    });

    test('revealing needs a superadmin, and an unknown user or a user of another shop gives 404', async () => {
        const a = await f.makeWorld('mask-a');
        const b = await f.makeWorld('mask-b');
        const { token } = await f.makeSuperAdmin('mask-ab@test.com');
        const url = (tid, uid) => `/api/admin/tenants/${tid}/users/${uid}/phone`;
        assert.equal((await request(app).get(url(a.tenant._id, a.customer.user._id)).set(a.owner.headers)).status, 401);
        assert.equal((await request(app).get(url(a.tenant._id, 'not-an-id')).set(bearer(token))).status, 404);
        assert.equal((await request(app).get(url(a.tenant._id, b.customer.user._id)).set(bearer(token))).status, 404);
        assert.equal(await AuditLog.countDocuments({ action: 'PHONE_REVEAL' }), 0);
    });
});

describe('live feed over Socket.IO', () => {
    test('a bad token and a shop token cannot connect as a superadmin', async () => {
        const w = await f.makeWorld('sock-bad');
        await assert.rejects(connect({ adminToken: 'rubbish' }));
        await assert.rejects(connect({ adminToken: w.owner.accessToken }));
    });

    test('a superadmin gets feed lines of every shop live', async () => {
        const a = await f.makeWorld('sock-all-a');
        const { token } = await f.makeSuperAdmin('sock-all@test.com');
        const c = await connect({ adminToken: token });
        try {
            const waiting = nextEvent(c);
            liveFeed.emit(a.tenant._id, 'orders', { type: 'order.live', orderNo: 7 });
            const ev = await waiting;
            assert.ok(ev);
            assert.equal(ev.type, 'order.live');
            assert.equal(ev.tenantId, String(a.tenant._id));
        } finally { c.close(); }
    });

    test('admin:watch limits the feed to one shop, admin:unwatch goes back to all shops', async () => {
        const a = await f.makeWorld('sock-watch-a');
        const b = await f.makeWorld('sock-watch-b');
        const { token } = await f.makeSuperAdmin('sock-watch@test.com');
        const c = await connect({ adminToken: token });
        try {
            const ack = await c.emitWithAck('admin:watch', { tenantId: String(a.tenant._id) });
            assert.equal(ack.ok, true);
            assert.equal((await c.emitWithAck('admin:watch', { tenantId: 'nope' })).ok, false);

            let waiting = nextEvent(c, 400);
            liveFeed.emit(b.tenant._id, 'orders', { type: 'order.other-shop' });
            assert.equal(await waiting, null);

            waiting = nextEvent(c);
            liveFeed.emit(a.tenant._id, 'orders', { type: 'order.watched-shop' });
            assert.equal((await waiting).type, 'order.watched-shop');

            await c.emitWithAck('admin:unwatch', {});
            waiting = nextEvent(c);
            liveFeed.emit(b.tenant._id, 'orders', { type: 'order.back-to-all' });
            assert.equal((await waiting).type, 'order.back-to-all');
        } finally { c.close(); }
    });
});