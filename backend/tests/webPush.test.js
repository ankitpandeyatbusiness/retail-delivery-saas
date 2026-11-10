require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const DeviceToken = require('../src/models/DeviceToken');
const User = require('../src/models/User');
const phoneAdapter = require('../src/services/adapters/push');
const webAdapter = require('../src/services/adapters/webPush');
const pushChannel = require('../src/notifications/channels/push');
const { makeWorld, makeUser } = require('./helpers/factory');

const KEYS = { p256dh: 'BPk-test-p256dh-key', auth: 'test-auth' };
// every test uses its own addresses (T changes per test): a device token is unique across the whole collection
let run = 0; let T = '';
const sub = (n) => ({ endpoint: `https://push.example.com/send/${T}-${n}`, keys: KEYS });
const PHONE_OF = () => `fcm-phone-token-${T}-aaaaaaaaaaaaaaaaaaaa`;

let phoneCalls; let webCalls;
const old = {};
beforeEach(() => {
    run += 1; T = `t${run}`;
    for (const k of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) old[k] = process.env[k];
    process.env.VAPID_PUBLIC_KEY = 'test-public-key'; process.env.VAPID_PRIVATE_KEY = 'test-private-key'; process.env.VAPID_SUBJECT = 'mailto:test@example.com';
    phoneCalls = []; webCalls = [];
    mock.method(phoneAdapter, 'send', async (a) => { phoneCalls.push(a); return { sent: a.tokens.length, invalidTokens: [] }; });
    mock.method(webAdapter, 'send', async (a) => { webCalls.push(a); return { sent: a.subscriptions.length, invalidEndpoints: [] }; });
});
afterEach(() => {
    mock.restoreAll();
    for (const k of Object.keys(old)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; }
});

const phone = (w, user, token = PHONE_OF()) => DeviceToken.create({ tenantId: w.tenant._id, userId: user._id, token, platform: 'android' });
const browser = (w, user, n = 1, extra = {}) => DeviceToken.create({ tenantId: w.tenant._id, userId: user._id, token: sub(n).endpoint, platform: 'web', webKeys: KEYS, ...extra });
const notify = (w, user) => pushChannel.send({ tenantId: w.tenant._id, userId: user._id, title: 'Hello', body: 'World', data: { type: 'x_unknown', orderId: '1' } });

describe('browser push: who is told', () => {
    before(() => db.connect());
    after(() => db.disconnect());

    test('a person with only the phone app: the phone is told, no browser', async () => {
        const w = await makeWorld('wp-phone');
        await phone(w, w.customer.user);
        const r = await notify(w, w.customer.user);
        assert.equal(phoneCalls.length, 1);
        assert.deepEqual(phoneCalls[0].tokens, [PHONE_OF()]);
        assert.equal(webCalls.length, 0);
        assert.equal(r.sent, 1);
    });

    test('app first: with a phone AND a browser, the browser is silent until "Also notify me on this browser" is on', async () => {
        const w = await makeWorld('wp-both');
        const u = w.customer.user;
        await phone(w, u); await browser(w, u, 1);
        await notify(w, u);
        assert.equal(phoneCalls.length, 1);
        assert.equal(webCalls.length, 0, 'off by default: the phone alone is told');

        await User.updateOne({ _id: u._id }, { $set: { alsoWebPush: true } });
        phoneCalls.length = 0;
        const r = await notify(w, u);
        assert.equal(phoneCalls.length, 1);
        assert.deepEqual(phoneCalls[0].tokens, [PHONE_OF()], 'the browser address never goes to the phone sender');
        assert.equal(webCalls.length, 1);
        assert.deepEqual(webCalls[0].subscriptions, [sub(1)]);
        assert.equal(webCalls[0].title, 'Hello');
        assert.equal(r.sent, 2);
    });

    test('a person with no phone is told on the browser they subscribed', async () => {
        const w = await makeWorld('wp-web-only');
        const u = w.customer.user;
        await browser(w, u, 2);
        await User.updateOne({ _id: u._id }, { $set: { alsoWebPush: true } });
        const r = await notify(w, u);
        assert.equal(phoneCalls.length, 0);
        assert.equal(webCalls.length, 1);
        assert.equal(r.sent, 1);
    });

    test('a browser row without keys (not a real subscription) is never sent anywhere', async () => {
        const w = await makeWorld('wp-nokeys');
        const u = w.customer.user;
        await DeviceToken.create({ tenantId: w.tenant._id, userId: u._id, token: 'https://push.example.com/send/bad', platform: 'web' });
        await User.updateOne({ _id: u._id }, { $set: { alsoWebPush: true } });
        const r = await notify(w, u);
        assert.equal(phoneCalls.length, 0); assert.equal(webCalls.length, 0);
        assert.equal(r.sent, 0, 'so the next step (SMS) can start');
    });

    test('a browser that the push service says is gone is forgotten; the phone stays', async () => {
        const w = await makeWorld('wp-gone');
        const u = w.customer.user;
        await phone(w, u); await browser(w, u, 3);
        await User.updateOne({ _id: u._id }, { $set: { alsoWebPush: true } });
        webAdapter.send.mock.mockImplementation(async (a) => { webCalls.push(a); return { sent: 0, invalidEndpoints: [sub(3).endpoint] }; });
        await notify(w, u);
        assert.equal(await DeviceToken.countDocuments({ userId: u._id, platform: 'web' }), 0);
        assert.equal(await DeviceToken.countDocuments({ userId: u._id, platform: 'android' }), 1);
    });

    test('an alert the person switched off reaches neither phone nor browser', async () => {
        const w = await makeWorld('wp-muted');
        const u = w.owner.user;
        await phone(w, u, `fcm-owner-phone-${T}-aaaaaaaaaaaa`); await browser(w, u, 4);
        const grp = require('../src/notifications/alertGroups').groupOf('admin', 'order_new');
        assert.ok(grp, 'the new-order alert group exists');
        await User.updateOne({ _id: u._id }, { $set: { alsoWebPush: true, alertPrefs: { [grp.id]: { n: false } } } });
        const r = await pushChannel.send({ tenantId: w.tenant._id, userId: u._id, title: 'New order', body: '#1', data: { type: 'order_new' } });
        assert.equal(phoneCalls.length, 0); assert.equal(webCalls.length, 0); assert.equal(r.sent, 0);

        // and switched back on, both hear it
        await User.updateOne({ _id: u._id }, { $set: { alertPrefs: {} } });
        const r2 = await pushChannel.send({ tenantId: w.tenant._id, userId: u._id, title: 'New order', body: '#1', data: { type: 'order_new' } });
        assert.equal(phoneCalls.length, 1); assert.equal(webCalls.length, 1); assert.equal(r2.sent, 2);
    });
});

describe('browser push: the endpoints', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    const get = (h) => request(app).get('/api/notifications/web-push').set(h);
    const post = (h, path, body) => request(app).post(`/api/notifications/web-push/${path}`).set(h).send(body);

    test('without keys on the server the website is told there is nothing to switch on', async () => {
        delete process.env.VAPID_PUBLIC_KEY;
        const w = await makeWorld('wp-ep-off');
        const r = await get(w.customer.headers);
        assert.equal(r.status, 200);
        assert.equal(r.body.publicKey, null);
        assert.equal((await post(w.customer.headers, 'subscribe', { subscription: sub(1) })).status, 409);
    });

    test('subscribing turns it on, once per browser; unsubscribing the last one turns it off', async () => {
        const w = await makeWorld('wp-ep-on');
        const h = w.customer.headers; const uid = w.customer.user._id;
        const s0 = await get(h);
        assert.equal(s0.body.publicKey, 'test-public-key'); assert.equal(s0.body.enabled, false, 'off by default');

        assert.equal((await post(h, 'subscribe', { subscription: sub(1) })).status, 201);
        assert.equal((await post(h, 'subscribe', { subscription: sub(1) })).status, 201);   // the same browser twice
        assert.equal((await post(h, 'subscribe', { subscription: sub(2) })).status, 201);
        assert.equal(await DeviceToken.countDocuments({ userId: uid, platform: 'web' }), 2);
        assert.equal((await get(h)).body.enabled, true);
        const row = await DeviceToken.findOne({ token: sub(1).endpoint }).lean();
        assert.equal(row.webKeys.auth, 'test-auth');

        const u1 = await post(h, 'unsubscribe', { endpoint: sub(1).endpoint });
        assert.equal(u1.body.enabled, true, 'another browser is still on');
        const u2 = await post(h, 'unsubscribe', { endpoint: sub(2).endpoint });
        assert.equal(u2.body.enabled, false);
        assert.equal((await get(h)).body.enabled, false);
    });

    test('bad subscriptions are refused', async () => {
        const w = await makeWorld('wp-ep-bad');
        const h = w.customer.headers;
        for (const subscription of [undefined, {}, { endpoint: 'http://insecure.example.com/x', keys: KEYS }, { endpoint: 'https://x.example.com/a' }, { endpoint: 'https://x.example.com/a', keys: { p256dh: 1, auth: 2 } }, { endpoint: `https://x.example.com/${'a'.repeat(2100)}`, keys: KEYS }]) {
            assert.equal((await post(h, 'subscribe', { subscription })).status, 400, String(JSON.stringify(subscription)).slice(0, 60));
        }
        assert.equal((await post(h, 'unsubscribe', {})).status, 400);
        assert.equal((await request(app).get('/api/notifications/web-push').set('x-tenant-slug', w.tenant.slug)).status, 401, 'a login is needed');
    });

    test('a browser belongs to one person at a time, and nobody removes another person\'s browser', async () => {
        const w = await makeWorld('wp-ep-share');
        const other = await makeUser(w.tenant, 'customer', '9000000077');
        await post(w.customer.headers, 'subscribe', { subscription: sub(9) });
        await post(other.headers, 'subscribe', { subscription: sub(9) });   // the same browser, now used by someone else
        assert.equal((await DeviceToken.findOne({ token: sub(9).endpoint })).userId.toString(), other.user._id.toString());

        await post(w.customer.headers, 'unsubscribe', { endpoint: sub(9).endpoint });   // not his any more: nothing happens
        assert.equal(await DeviceToken.countDocuments({ token: sub(9).endpoint }), 1);
    });
});

describe('browser push: the sender', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    let sentTo; let behave;
    beforeEach(() => {
        process.env.PUSH_MOCK = 'false';
        sentTo = []; behave = () => { };
        mock.method(webAdapter.impl, 'load', () => ({ sendNotification: async (s, payload, opts) => { sentTo.push({ s, payload: JSON.parse(payload), opts }); behave(s); return { statusCode: 201 }; } }));
    });
    afterEach(() => { process.env.PUSH_MOCK = 'true'; });

    test('sends the message, counts it, and reports browsers that are gone (404 / 410) but not ones that just failed', async () => {
        webAdapter.send.mock.restore();   // the real sender here
        behave = (s) => { if (s.endpoint.endsWith('-gone')) throw Object.assign(new Error('gone'), { statusCode: 410 }); if (s.endpoint.endsWith('-oops')) throw Object.assign(new Error('x'), { statusCode: 500 }); };
        const r = await webAdapter.send({
            subscriptions: [sub('ok'), sub('gone'), sub('oops'), { endpoint: 'https://x/nokeys' }],
            title: 'Hi', body: 'There', data: { type: 'order', orderId: '5' }, tag: 't1', icon: 'https://cdn/icon.png', silent: true,
        });
        assert.equal(r.sent, 1);
        assert.deepEqual(r.invalidEndpoints, [sub('gone').endpoint]);
        assert.equal(sentTo.length, 3, 'the one without keys is skipped');
        const m = sentTo.find((x) => x.s.endpoint.endsWith('-ok'));
        assert.deepEqual(m.payload, { title: 'Hi', body: 'There', data: { type: 'order', orderId: '5' }, tag: 't1', icon: 'https://cdn/icon.png', silent: true });
        assert.equal(m.opts.urgency, 'high');
    });

    test('a big payload is cut down to the few facts the website needs', async () => {
        webAdapter.send.mock.restore();
        await webAdapter.send({ subscriptions: [sub('big')], title: 'T', body: 'B', data: { type: 'order', orderId: '5', junk: 'x'.repeat(5000) } });
        assert.deepEqual(sentTo[0].payload.data, { type: 'order', orderId: '5' });   // (the other facts were empty and are left out)
    });

    test('with no keys set it sends nothing and does not fail', async () => {
        webAdapter.send.mock.restore();
        delete process.env.VAPID_PRIVATE_KEY;
        const r = await webAdapter.send({ subscriptions: [sub('a')], title: 'T', body: 'B' });
        assert.deepEqual(r, { sent: 0, invalidEndpoints: [] });
        assert.equal(sentTo.length, 0);
    });
});
