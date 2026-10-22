require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const f = require('./helpers/factory');
const User = require('../src/models/User');
const DeviceToken = require('../src/models/DeviceToken');
const adapter = require('../src/services/adapters/push');
const pushChannel = require('../src/notifications/channels/push');
const groups = require('../src/notifications/alertGroups');
const { pickupIntentSpeech } = require('../src/utils/orderSpeech');

// Which alerts a person wants: the screen's data, the choices kept as the difference from the recommended settings, and the push that obeys them.
let w; let seq = 0;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => { await db.clear(); w = await f.makeWorld('alerts-shop-' + (++seq)); });
afterEach(() => mock.restoreAll());

const get = () => request(app).get('/api/me/alerts').set(w.owner.headers);
const put = (body) => request(app).put('/api/me/alerts').set(w.owner.headers).send(body);

describe('the alerts screen', () => {
    test('every group starts on, with the recommended settings and a sample to listen to', async () => {
        const r = await get();
        assert.equal(r.status, 200);
        assert.equal(r.body.role, 'admin');
        const g = Object.fromEntries(r.body.groups.map((x) => [x.id, x]));
        assert.deepEqual(g.new_orders.pref, { n: true, p: true, s: true });
        assert.ok(g.new_orders.sample.en && g.new_orders.sample.hi);
        assert.equal(g.offduty.can.p, true); assert.equal(g.offduty.pref.p, false, 'staff going off duty: a popup is possible but off by default');
        assert.ok(r.body.groups.every((x) => x.can.p), 'every alert of the owner can have a popup');
        assert.equal(g.holiday.can.s, true, 'every alert has a sound switch');
        assert.ok(r.body.groups.every((x) => x.can.s && x.sample), 'and an example to listen to');
        assert.ok(g.pickup.types.includes('pickup_intent'));
        assert.ok(g.pickup.can.p && g.pickup.can.s, 'pickup answers: notification, popup and sound');
    });

    test('a choice is kept, only the difference is stored, and the recommended settings bring everything back', async () => {
        const r = await put({ prefs: { kitchen: { s: false }, tables: { n: false } } });
        assert.equal(r.status, 200);
        const g = Object.fromEntries(r.body.groups.map((x) => [x.id, x]));
        assert.deepEqual(g.kitchen.pref, { n: true, p: true, s: false });
        assert.equal(g.tables.pref.n, false);
        const saved = (await User.findById(w.owner.user._id).lean()).alertPrefs;
        assert.deepEqual(saved, { kitchen: { s: false }, tables: { n: false } });
        // switching it back to the recommended value removes the entry
        await put({ prefs: { kitchen: { s: true } } });
        assert.deepEqual((await User.findById(w.owner.user._id).lean()).alertPrefs, { tables: { n: false } });
        // a switch that does not exist for a group is ignored
        assert.deepEqual(groups.cleanPrefs('rider', { offers: { p: true } }), {}, 'a switch a group does not have is ignored');

        assert.equal((await put({ reset: true })).status, 200);
        assert.ok(!Object.keys((await User.findById(w.owner.user._id).lean()).alertPrefs || {}).length, 'nothing is stored: everything is recommended again');
        assert.equal((await put({})).status, 400);
        assert.ok([401, 403].includes((await request(app).get('/api/me/alerts').set({ 'x-tenant-slug': w.tenant.slug })).status), 'a login is needed');
    });

    test('each job has its own groups; the waiter has nothing about cancelled orders', () => {
        assert.ok(groups.groupsFor('kitchen').some((x) => x.id === 'cancel' && x.types.includes('kitchen_cancelled')));
        assert.ok(!groups.groupsFor('waiter').some((x) => x.types.includes('waiter_cancelled') || x.id === 'cancel'));
        assert.ok(groups.groupsFor('rider').some((x) => x.types.includes('rider_offer')));
        assert.deepEqual(groups.groupsFor('customer'), []);
    });
});

describe('the push obeys the choices', () => {
    const ring = (type) => pushChannel.send({ tenantId: w.tenant._id, title: 't', body: 'b', data: { type, speech: 'hello' }, channelId: 'new_orders_v2', sound: 'new_order' });
    const setup = async () => {
        await DeviceToken.create({ tenantId: w.tenant._id, userId: w.owner.user._id, token: 'tok-owner' });
        return mock.method(adapter, 'send', async ({ tokens }) => ({ sent: tokens.length, invalidTokens: [] }));
    };

    test('notification off: nothing is sent; sound off: a silent channel and no voice; otherwise as before', async () => {
        const spy = await setup();
        process.env.SPEECH_DELAY_MS = '0';
        await ring('order_new');
        assert.equal(spy.mock.calls.length, 2, 'the loud push, then the voice message');
        assert.equal(spy.mock.calls[0].arguments[0].channelId, 'new_orders_v2');
        spy.mock.resetCalls();

        await put({ prefs: { new_orders: { s: false } } });
        await ring('order_new');
        assert.equal(spy.mock.calls.length, 1, 'silent: no voice message');
        assert.equal(spy.mock.calls[0].arguments[0].channelId, 'live_trip');
        spy.mock.resetCalls();

        await put({ prefs: { new_orders: { n: false } } });
        const r = await ring('order_new');
        assert.equal(r.sent, 0);
        assert.equal(spy.mock.calls.length, 0, 'nothing reaches the phone');

        await ring('order_cancelled');
        assert.ok(spy.mock.calls.length >= 1, 'another group is not touched');
    });
});

describe('what the owner hears of a pickup customer', () => {
    test('the name, what he said, the dishes and the pickup time; every answer, including on time', () => {
        const order = { orderNo: 1173, customer: { name: 'Ankit Sharma' }, scheduledFor: new Date('2026-10-21T15:00:00Z'), items: [{ name: 'Butter Naan', quantity: 2 }, { name: 'Paneer Butter Masala', quantity: 1 }] };
        const en = pickupIntentSpeech(order, 'coming');
        assert.match(en, /^Pickup order 1173\. Ankit is on the way\. 2 Butter Naan, 1 Paneer Butter Masala\. Pickup time 8:30 pm\.$/);
        assert.match(pickupIntentSpeech(order, 'on_time'), /on time/);
        assert.match(pickupIntentSpeech(order, 'late'), /running late/);
        assert.match(pickupIntentSpeech(order, 'coming', true), /पिकअप ऑर्डर 1173/);
        assert.doesNotMatch(en, /rupees|₹/);
    });
});
