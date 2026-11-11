require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const db = require('./helpers/db');
const app = require('../src/server/app');
const realtime = require('../src/services/realtime');
const chat = require('../src/services/chat');
const Notification = require('../src/models/Notification');
const ChatMessage = require('../src/models/ChatMessage');
const { makeWorld } = require('./helpers/factory');

// what the server said to the live connections: [audience, event, payload]
let live;
beforeEach(() => {
    live = [];
    mock.method(realtime, 'toOwner', (t, ev, p) => live.push(['owner', ev, p]));
    mock.method(realtime, 'toUser', (t, u, ev, p) => live.push(['user:' + u, ev, p]));
});
afterEach(() => mock.restoreAll());
const said = (aud, ev) => live.filter((x) => x[0] === aud && x[1] === ev).map((x) => x[2]);

const note = (w, userId, extra = {}) => Notification.create({ tenantId: w.tenant._id, userId, ...(userId ? {} : { role: 'owner' }), type: 'test', title: 'T', ...extra });

describe('devices stay in step: notifications read on one device reach the others', () => {
    before(() => db.connect());
    after(() => db.disconnect());

    test('reading one message tells the same person\'s other devices, with the new unread number, and nobody else', async () => {
        const w = await makeWorld('sync-read-one');
        const uid = w.customer.user._id;
        const [a, b] = [await note(w, uid), await note(w, uid)];
        await note(w, w.rider.user._id);   // someone else's message

        const r = await request(app).post(`/api/notifications/${a._id}/read`).set(w.customer.headers);
        assert.equal(r.status, 200);
        const ev = said('user:' + uid, 'notification:read');
        assert.equal(ev.length, 1);
        assert.deepEqual(ev[0].ids, [String(a._id)]);
        assert.equal(ev[0].unread, 1);
        assert.equal(live.filter((x) => x[0] === 'user:' + w.rider.user._id).length, 0, 'nobody else hears it');
        assert.equal(said('owner', 'notification:read').length, 0);
        void b;
    });

    test('a message that does not exist or is not mine says nothing', async () => {
        const w = await makeWorld('sync-read-none');
        const theirs = await note(w, w.rider.user._id);
        const r = await request(app).post(`/api/notifications/${theirs._id}/read`).set(w.customer.headers);
        assert.equal(r.status, 404);
        assert.equal(live.length, 0);
    });

    test('read all and clear all say so, with unread 0', async () => {
        const w = await makeWorld('sync-read-all');
        const uid = w.customer.user._id;
        await note(w, uid); await note(w, uid);

        assert.equal((await request(app).post('/api/notifications/read-all').set(w.customer.headers)).status, 200);
        assert.deepEqual(said('user:' + uid, 'notification:read'), [{ all: true, unread: 0 }]);

        live.length = 0;
        await note(w, uid);
        assert.equal((await request(app).delete('/api/notifications').set(w.customer.headers)).status, 200);
        assert.deepEqual(said('user:' + uid, 'notification:read'), [{ all: true, unread: 0, cleared: true }]);
    });

    test('the owner inbox is shared by the shop: reading it tells every owner device', async () => {
        const w = await makeWorld('sync-owner');
        const n = await note(w, undefined);
        await note(w, undefined);

        assert.equal((await request(app).post(`/api/shop/notifications/${n._id}/read`).set(w.owner.headers)).status, 200);
        const one = said('owner', 'notification:read');
        assert.equal(one.length, 1);
        assert.equal(one[0].unread, 1);

        live.length = 0;
        assert.equal((await request(app).post('/api/shop/notifications/read-all').set(w.owner.headers)).status, 200);
        assert.deepEqual(said('owner', 'notification:read'), [{ all: true, unread: 0 }]);
        // the "read" message goes to the owner side only (the generic sync:changed of phase 12 may still reach the person's own devices)
        assert.equal(live.filter((x) => x[0].startsWith('user:') && x[1] === 'notification:read').length, 0, 'it goes to the owner side, not to one person');
    });

    test('reading a bulk order or booking chat tells my other devices (not only inquiries)', async () => {
        const w = await makeWorld('sync-chat');
        const cid = w.customer.user._id;
        for (const kind of ['bulk', 'booking', 'inquiry']) {
            live.length = 0;
            const refId = new mongoose.Types.ObjectId();
            await ChatMessage.create({ tenantId: w.tenant._id, kind, refId, customerId: cid, from: 'owner', senderId: w.owner.user._id, text: 'hello' });

            await chat.markRead({ tenant: w.tenant, kind, refId, side: 'customer', customerId: cid });

            const mineEcho = said('user:' + cid, 'chat:status').filter((p) => p.echo && p.status === 'read');
            assert.equal(mineEcho.length, 1, `${kind}: the reader's other device is told`);
            assert.equal(mineEcho[0].kind, kind);
            assert.equal(mineEcho[0].refId, String(refId));
            assert.deepEqual(mineEcho[0].ids, []);
            const senderTick = said('owner', 'chat:status').filter((p) => !p.echo && p.ids.length === 1);
            assert.equal(senderTick.length, 1, `${kind}: the sender still gets the read tick`);
        }
    });

    test('nothing unread: no echo is made up', async () => {
        const w = await makeWorld('sync-chat-none');
        const refId = new mongoose.Types.ObjectId();
        await chat.markRead({ tenant: w.tenant, kind: 'bulk', refId, side: 'customer', customerId: w.customer.user._id });
        // the other device may still be showing a stale badge, so an echo is allowed when nothing was unread, but it must carry no ticks
        for (const [, , p] of live) assert.deepEqual(p.ids, []);
    });
});
