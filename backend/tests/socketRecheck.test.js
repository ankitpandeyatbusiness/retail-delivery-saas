// A person is removed or blocked AFTER the socket connected: the next sweep closes it.
require('./helpers/env');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: ioc } = require('socket.io-client');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const realtime = require('../src/services/realtime');
const User = require('../src/models/User');
const Session = require('../src/models/Session');
const Tenant = require('../src/models/Tenant');

let server; let port;
before(async () => {
    await db.connect();
    server = http.createServer(app.app || app);
    realtime.init(server);
    await new Promise((r) => server.listen(0, r));
    port = server.address().port;
});
after(async () => { await new Promise((r) => server.close(r)); await db.disconnect(); });

const connect = (w, who) => new Promise((resolve, reject) => {
    const c = ioc(`http://localhost:${port}`, { auth: { token: who.accessToken, tenant: w.tenant.slug }, transports: ['websocket'], reconnection: false });
    c.on('connect', () => resolve(c));
    c.on('connect_error', (e) => { c.close(); reject(e); });
});
const closedWithin = (c, ms = 1500) => new Promise((r) => { if (c.disconnected) return r(true); const t = setTimeout(() => r(false), ms); c.on('disconnect', () => { clearTimeout(t); r(true); }); });

test('a demoted owner, a blocked owner-panel and a blocked person are all disconnected; others stay', async () => {
    const w = await f.makeWorld('sock-recheck');
    const owner = await connect(w, w.owner);
    const cust = await connect(w, w.customer);
    assert.equal(await realtime.recheckSockets(), 0, 'nothing changed: nobody is closed');
    assert.equal(owner.connected && cust.connected, true);

    await User.updateOne({ _id: w.owner.user._id }, { $set: { role: 'customer' } });   // demoted
    assert.equal(await realtime.recheckSockets(), 1);
    assert.equal(await closedWithin(owner), true);
    assert.equal(cust.connected, true);

    await Session.deleteMany({ userId: w.customer.user._id });   // signed out / blocked
    await realtime.recheckSockets();
    assert.equal(await closedWithin(cust), true);
});

test('an owner is closed when the superadmin blocks the owner panel; a new connect of a blocked person is refused', async () => {
    const w = await f.makeWorld('sock-recheck-2');
    const owner = await connect(w, w.owner);
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { ownerBlocked: true } });
    await realtime.recheckSockets();
    assert.equal(await closedWithin(owner), true);
    await User.updateOne({ _id: w.customer.user._id }, { $set: { isBlocked: true } });
    await assert.rejects(connect(w, w.customer));
});
