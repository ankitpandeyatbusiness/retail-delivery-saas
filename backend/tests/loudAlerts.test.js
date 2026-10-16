require('./helpers/env');
process.env.SPEECH_DELAY_MS = '0';   // the silent message is normally sent a few seconds after the notification; here at once
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const DeviceToken = require('../src/models/DeviceToken');
const pushChannel = require('../src/notifications/channels/push');
const pushAdapter = require('../src/services/adapters/push');
const { NEW_ORDER_CHANNEL } = require('../src/notifications/events');

// What the owner's "Soundbox off" must do on the server: that phone gets no loud new-order channel.
let world;
let calls;
const realSend = pushAdapter.send;

before(async () => {
    await db.connect();
});
after(async () => {
    pushAdapter.send = realSend;
    await db.disconnect();
});
beforeEach(async () => {
    await db.clear();
    world = await f.makeWorld('loud-shop');
    require('../src/middlewares/tenantRecognizer').invalidateTenant('loud-shop');   // the shop is looked up by slug and cached; each test makes a new one
    calls = [];
    pushAdapter.send = async (a) => { calls.push(a); return { sent: a.tokens.length, invalidTokens: [] }; };
});

const T_LOUD = 'L'.repeat(30);
const T_QUIET = 'Q'.repeat(30);
const T_OLD = 'O'.repeat(30);

describe('Soundbox off means no loud sound from that phone', () => {
    test('the app can register a phone as loud or quiet', async () => {
        const post = (body) => request(app).post('/api/notifications/devices').set(world.owner.headers).send(body);
        assert.equal((await post({ token: T_LOUD, platform: 'android', loudAlerts: true })).status, 201);
        assert.equal((await post({ token: T_QUIET, platform: 'android', loudAlerts: false })).status, 201);
        assert.equal((await post({ token: T_OLD, platform: 'android' })).status, 201);   // an older app does not say
        assert.equal((await post({ token: 'x'.repeat(30), loudAlerts: 'no' })).status, 400);

        assert.equal((await DeviceToken.findOne({ token: T_LOUD })).loudAlerts, true);
        assert.equal((await DeviceToken.findOne({ token: T_QUIET })).loudAlerts, false);
        assert.equal((await DeviceToken.findOne({ token: T_OLD })).loudAlerts, true);   // default: on

        // the same phone switching Soundbox off later
        assert.equal((await post({ token: T_LOUD, loudAlerts: false })).status, 201);
        assert.equal((await DeviceToken.findOne({ token: T_LOUD })).loudAlerts, false);
    });

    test('a new-order push: loud channel for loud phones, the normal channel for quiet ones', async () => {
        const base = { tenantId: world.tenant._id, userId: world.owner.user._id };
        await DeviceToken.create({ ...base, token: T_LOUD, loudAlerts: true });
        await DeviceToken.create({ ...base, token: T_QUIET, loudAlerts: false });
        await DeviceToken.create({ ...base, token: T_OLD });

        const r = await pushChannel.send({
            tenantId: world.tenant._id, title: 'New order', body: '#1', data: { orderId: 'x' }, channelId: NEW_ORDER_CHANNEL, sound: 'new_order',
        });
        assert.equal(r.sent, 3);

        const loud = calls.find((c) => c.channelId === NEW_ORDER_CHANNEL);
        const quiet = calls.find((c) => !c.channelId);
        assert.deepEqual([...loud.tokens].sort(), [T_LOUD, T_OLD].sort());
        assert.equal(loud.sound, 'new_order');
        assert.deepEqual(quiet.tokens, [T_QUIET]);
        assert.equal(quiet.sound, undefined);
    });

    test('a new order also sends loud phones a silent data message that carries the order, and nobody else', async () => {
        const base = { tenantId: world.tenant._id, userId: world.owner.user._id };
        await DeviceToken.create({ ...base, token: T_LOUD, loudAlerts: true });
        await DeviceToken.create({ ...base, token: T_QUIET, loudAlerts: false });

        await pushChannel.send({
            tenantId: world.tenant._id, title: 'New order', body: '#3',
            data: { orderId: 'o1', speech: 'New order. 2 Butter Naan.', speechHi: 'x' },
            channelId: NEW_ORDER_CHANNEL, sound: 'new_order',
        });
        const silent = calls.filter((c) => c.dataOnly);
        assert.equal(silent.length, 1);
        assert.deepEqual(silent[0].tokens, [T_LOUD]);        // not the phone that switched Soundbox off
        assert.equal(silent[0].data.speakOnly, '1');
        assert.equal(silent[0].data.speech, 'New order. 2 Butter Naan.');
        assert.equal(silent[0].title, undefined);           // no notification inside: nothing shows, nothing plays
        assert.equal(silent[0].channelId, undefined);
    });

    test('the silent message is sent AFTER the notification, so the voice follows the clip', async () => {
        const base = { tenantId: world.tenant._id, userId: world.owner.user._id };
        await DeviceToken.create({ ...base, token: T_LOUD, loudAlerts: true });
        process.env.SPEECH_DELAY_MS = '150';
        try {
            await pushChannel.send({
                tenantId: world.tenant._id, title: 'New order', body: '#5',
                data: { orderId: 'o3', speech: 'New order.' }, channelId: NEW_ORDER_CHANNEL, sound: 'new_order',
            });
            assert.equal(calls.filter((c) => c.dataOnly).length, 0, 'not yet');
            assert.equal(calls.filter((c) => !c.dataOnly).length, 1, 'the notification itself goes first');
            await f.sleep(400);
            assert.equal(calls.filter((c) => c.dataOnly).length, 1, 'and the silent message follows');
        } finally { process.env.SPEECH_DELAY_MS = '0'; }
    });

    test('no silent message when there is nothing to read out (a plain reminder)', async () => {
        const base = { tenantId: world.tenant._id, userId: world.owner.user._id };
        await DeviceToken.create({ ...base, token: T_LOUD, loudAlerts: true });
        await pushChannel.send({ tenantId: world.tenant._id, title: 'Waiting', body: '#4', data: { orderId: 'o2' }, channelId: NEW_ORDER_CHANNEL, sound: 'new_order' });
        assert.equal(calls.filter((c) => c.dataOnly).length, 0);
    });

    test('a push without a channel (everything else) goes to every phone in one call', async () => {
        const base = { tenantId: world.tenant._id, userId: world.owner.user._id };
        await DeviceToken.create({ ...base, token: T_LOUD, loudAlerts: true });
        await DeviceToken.create({ ...base, token: T_QUIET, loudAlerts: false });

        await pushChannel.send({ tenantId: world.tenant._id, title: 'Rent', body: 'due' });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].tokens.length, 2);
        assert.equal(calls[0].channelId, undefined);
    });

    test('when only quiet phones exist the loud channel is never used', async () => {
        const base = { tenantId: world.tenant._id, userId: world.owner.user._id };
        await DeviceToken.create({ ...base, token: T_QUIET, loudAlerts: false });
        await pushChannel.send({ tenantId: world.tenant._id, title: 'New order', body: '#2', channelId: NEW_ORDER_CHANNEL, sound: 'new_order' });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].channelId, undefined);
    });
});

describe('the owner can send himself a test of the real alert', () => {
    const post = (headers, body = { delaySec: 0 }) => request(app).post('/api/shop/test-alert').set(headers).send(body);

    test('goes to the owner\'s own loud phones only, on the loud channel, with the spoken order', async () => {
        const mine = { tenantId: world.tenant._id, userId: world.owner.user._id };
        const other = await f.makeUser(world.tenant, 'admin', '9000000011');
        await DeviceToken.create({ ...mine, token: T_LOUD, loudAlerts: true });
        await DeviceToken.create({ ...mine, token: T_QUIET, loudAlerts: false });
        await DeviceToken.create({ tenantId: world.tenant._id, userId: other.user._id, token: T_OLD });   // another owner

        const r = await post(world.owner.headers);
        assert.equal(r.status, 200);
        const loud = calls.find((c) => c.channelId === NEW_ORDER_CHANNEL);
        assert.deepEqual(loud.tokens, [T_LOUD]);
        assert.equal(loud.sound, 'new_order');
        assert.equal(loud.data.type, 'order_new');
        assert.equal(loud.data.test, '1');
        assert.match(loud.data.speech, /^New order\. 2 Butter Naan/);
        assert.match(loud.data.speechHi, /^नया ऑर्डर/);
        // the quiet phone still gets the message, just not on the loud channel; nobody else's phone is touched
        const quiet = calls.find((c) => !c.channelId && !c.dataOnly);
        assert.deepEqual(quiet.tokens, [T_QUIET]);
        // the silent data message that lets the app read the order goes to the loud phone only
        const silent = calls.find((c) => c.dataOnly);
        assert.deepEqual(silent.tokens, [T_LOUD]);
        assert.equal(silent.data.speakOnly, '1');
        assert.ok(!calls.some((c) => c.tokens.includes(T_OLD)));
    });

    test('a customer can not use it, and it can not be spammed', async () => {
        assert.equal((await post(world.customer.headers)).status, 403);
        assert.equal((await post(world.owner.headers)).status, 200);
        assert.equal((await post(world.owner.headers)).status, 429);   // straight away again
    });
});
