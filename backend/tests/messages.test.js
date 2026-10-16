require('./helpers/env');
const { describe, test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const User = require('../src/models/User');
const Broadcast = require('../src/models/Broadcast');
const Notification = require('../src/models/Notification');
const EmailJob = require('../src/models/EmailJob');
const AuditLog = require('../src/models/AuditLog');
const FeedEvent = require('../src/models/FeedEvent');
const smsAdapter = require('../src/services/adapters/sms');

before(() => db.connect());
after(() => db.disconnect());
afterEach(() => mock.restoreAll());

const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const post = (w, b) => request(app).post('/api/shop/messages').set(w.owner.headers).send(b);
const finished = (id) => f.waitFor(async () => (await Broadcast.findById(id).lean()).status === 'done');
const got = (tenantId, userId) => Notification.countDocuments({ tenantId, userId, type: 'broadcast' });

// a shop with three customers (c1 = world customer, c2, c3)
async function shop(slug) {
    const w = await f.makeWorld(slug);
    const c2 = await f.makeUser(w.tenant, 'customer', '9000000031');
    const c3 = await f.makeUser(w.tenant, 'customer', '9000000032');
    return { ...w, c1: w.customer, c2, c3 };
}

describe('owner broadcast', () => {
    test('an information message reaches every customer, by inbox and push, and never by SMS', async () => {
        const sms = mock.method(smsAdapter, 'send', async () => ({ providerMessageId: 'x' }));
        const w = await shop('msg-info');
        const res = await post(w, { title: 'We are open on Sunday', body: 'Come and eat with us.' });
        assert.equal(res.status, 202);
        assert.equal(res.body.recipients, 3);
        await finished(res.body.id);
        for (const c of [w.c1, w.c2, w.c3]) assert.equal(await got(w.tenant._id, c.user._id), 1);
        assert.equal(await got(w.tenant._id, w.rider.user._id), 0);   // riders were not in the audience
        const row = await Broadcast.findById(res.body.id).lean();
        assert.equal(row.sent, 3);
        assert.equal(row.failed, 0);
        assert.equal(sms.mock.callCount(), 0);
    });

    test('a promotion skips the customers who switched promotions off, and counts them', async () => {
        const w = await shop('msg-promo');
        await User.updateOne({ _id: w.c3.user._id }, { $set: { 'prefs.promotions': false } });
        const res = await post(w, { title: '20% off', body: 'Only today.', kind: 'promo' });
        assert.equal(res.status, 202);
        assert.equal(res.body.recipients, 2);
        assert.equal(res.body.skippedOptOut, 1);
        await finished(res.body.id);
        assert.equal(await got(w.tenant._id, w.c3.user._id), 0);
        assert.equal(await got(w.tenant._id, w.c1.user._id), 1);

        // an information message still reaches him
        const info = await post(w, { title: 'Shop closed on Monday', body: 'Sorry.' });
        await finished(info.body.id);
        assert.equal(await got(w.tenant._id, w.c3.user._id), 1);
    });

    test('promotions go to customers only; riders can get an information message', async () => {
        const w = await shop('msg-riders');
        assert.equal((await post(w, { title: 'Sale', body: 'x', kind: 'promo', audience: 'riders' })).status, 400);
        assert.equal((await post(w, { title: 'Sale', body: 'x', kind: 'promo', audience: 'both' })).status, 400);
        const res = await post(w, { title: 'Meeting at 5', body: 'Riders please come.', audience: 'riders' });
        assert.equal(res.status, 202);
        assert.equal(res.body.recipients, 1);
        await finished(res.body.id);
        assert.equal(await got(w.tenant._id, w.rider.user._id), 1);
        assert.equal(await got(w.tenant._id, w.c1.user._id), 0);
    });

    test('blocked customers get nothing', async () => {
        const w = await shop('msg-blocked');
        await User.updateOne({ _id: w.c2.user._id }, { $set: { isBlocked: true } });
        const res = await post(w, { title: 'Hello', body: 'World' });
        assert.equal(res.body.recipients, 2);
        await finished(res.body.id);
        assert.equal(await got(w.tenant._id, w.c2.user._id), 0);
    });

    test('a shop never sends email: sendEmail is ignored for an owner', async () => {
        const w = await shop('msg-mail');
        await User.updateOne({ _id: w.c1.user._id }, { $set: { email: 'c1@mail.test' } });

        const quiet = await post(w, { title: 'No mail', body: 'Inbox only.' });
        await finished(quiet.body.id);
        assert.equal(await EmailJob.countDocuments({ to: 'c1@mail.test' }), 0);

        const loud = await post(w, { title: 'With mail', body: 'Inbox only.', sendEmail: true });
        await finished(loud.body.id);
        await f.sleep(300);
        assert.equal(await EmailJob.countDocuments({}), 0);
        assert.equal((await Broadcast.findById(loud.body.id).lean()).sendEmail, false);
    });

    test('bad input is refused: title, body, kind, audience, sendEmail', async () => {
        const w = await shop('msg-bad');
        assert.equal((await post(w, { body: 'no title' })).status, 400);
        assert.equal((await post(w, { title: 'x'.repeat(121), body: 'ok' })).status, 400);
        assert.equal((await post(w, { title: 'ok' })).status, 400);
        assert.equal((await post(w, { title: 'ok', body: 'x'.repeat(1001) })).status, 400);
        assert.equal((await post(w, { title: 'ok', body: 'ok', kind: 'spam' })).status, 400);
        assert.equal((await post(w, { title: 'ok', body: 'ok', audience: 'everyone' })).status, 400);
        assert.equal((await post(w, { title: 'ok', body: 'ok', sendEmail: 'yes' })).status, 400);
        assert.equal(await Broadcast.countDocuments({ tenantId: w.tenant._id }), 0);
    });

    test('a shop with nobody to send to is refused', async () => {
        const tenant = await f.makeTenant('msg-empty');
        const owner = await f.makeUser(tenant, 'admin', '9000000010');
        const res = await request(app).post('/api/shop/messages').set(owner.headers).send({ title: 'Hi', body: 'There' });
        assert.equal(res.status, 400);
    });

    test('5 broadcasts a day per sender, the 6th is refused with 429', async () => {
        const w = await shop('msg-limit');
        for (let i = 0; i < 5; i += 1) {
            const r = await post(w, { title: `Message ${i}`, body: 'Hello' });
            assert.equal(r.status, 202);
        }
        assert.equal((await post(w, { title: 'Message 6', body: 'Hello' })).status, 429);
        await f.waitFor(async () => (await Broadcast.countDocuments({ tenantId: w.tenant._id, status: 'done' })) === 5);
    });

    test('a broadcast leaves ONE audit row and one feed line', async () => {
        const w = await shop('msg-audit');
        const res = await post(w, { title: 'Audit me', body: 'Please' });
        await finished(res.body.id);
        await f.waitFor(async () => (await AuditLog.countDocuments({ tenantId: w.tenant._id, action: 'BROADCAST' })) === 1);
        const row = await AuditLog.findOne({ tenantId: w.tenant._id, action: 'BROADCAST' }).lean();
        assert.equal(row.params.recipients, 3);
        await f.waitFor(async () => (await FeedEvent.countDocuments({ tenantId: w.tenant._id, type: 'message.sent' })) === 1);
    });

    test('the owner sees his own broadcasts and their progress, not those of another shop', async () => {
        const a = await shop('msg-list-a');
        const b = await shop('msg-list-b');
        const one = await post(a, { title: 'Only mine', body: 'Yes' });
        const other = await post(b, { title: 'Not yours', body: 'No' });
        await finished(one.body.id);
        await finished(other.body.id);
        const list = await request(app).get('/api/shop/messages').set(a.owner.headers);
        assert.deepEqual(list.body.items.map((i) => i.title), ['Only mine']);
        const detail = await request(app).get(`/api/shop/messages/${one.body.id}`).set(a.owner.headers);
        assert.equal(detail.body.status, 'done');
        assert.equal(detail.body.sent, 3);
        assert.equal((await request(app).get(`/api/shop/messages/${other.body.id}`).set(a.owner.headers)).status, 404);
    });

    test('a customer or a rider cannot send a broadcast', async () => {
        const w = await shop('msg-perm');
        assert.equal((await request(app).post('/api/shop/messages').set(w.c1.headers).send({ title: 'a', body: 'b' })).status, 403);
        assert.equal((await request(app).post('/api/shop/messages').set(w.rider.headers).send({ title: 'a', body: 'b' })).status, 403);
    });
});

describe('promotion setting of a customer', () => {
    test('a customer switches promotions off and on, and sees the setting', async () => {
        const w = await f.makeWorld('prefs-1');
        const url = '/api/me/prefs';
        assert.deepEqual((await request(app).get(url).set(w.customer.headers)).body, { promotions: true });
        const off = await request(app).put(url).set(w.customer.headers).send({ promotions: false });
        assert.equal(off.status, 200);
        assert.deepEqual(off.body, { promotions: false });
        assert.equal((await User.findById(w.customer.user._id).lean()).prefs.promotions, false);
        assert.equal((await request(app).get('/api/me').set(w.customer.headers)).body.promotions, false);
        assert.equal((await request(app).put(url).set(w.customer.headers).send({ promotions: 'no' })).status, 400);
        assert.equal((await request(app).put(url).set(w.customer.headers).send({ promotions: true })).body.promotions, true);
    });

    test('it needs a login', async () => {
        const w = await f.makeWorld('prefs-2');
        // keep the shop header, remove only the login
        const { Authorization, authorization, ...noLogin } = w.customer.headers;
        assert.equal((await request(app).put('/api/me/prefs').set(noLogin).send({ promotions: false })).status, 401);
    });
});

describe('platform broadcast', () => {
    test('the superadmin messages the owners of chosen shops, or of all shops', async () => {
        const a = await f.makeWorld('msg-sa-a');
        const b = await f.makeWorld('msg-sa-b');
        const { token } = await f.makeSuperAdmin('msg-sa@test.com');
        const send = (body) => request(app).post('/api/admin/messages').set(bearer(token)).send(body);

        const one = await send({ title: 'Maintenance tonight', body: 'From 2 am.', tenantIds: [String(a.tenant._id)] });
        assert.equal(one.status, 202);
        assert.equal(one.body.recipients, 1);
        await finished(one.body.id);
        assert.equal(await Notification.countDocuments({ tenantId: a.tenant._id, type: 'broadcast', role: 'owner' }), 1);
        assert.equal(await Notification.countDocuments({ tenantId: b.tenant._id, type: 'broadcast' }), 0);
        const inbox = await request(app).get('/api/shop/notifications').set(a.owner.headers);
        assert.equal(inbox.body.items[0].type, 'broadcast');

        const all = await send({ title: 'New feature', body: 'Look at the panel.' });
        assert.ok(all.body.recipients >= 2);
        await finished(all.body.id);
        assert.equal(await Notification.countDocuments({ tenantId: b.tenant._id, type: 'broadcast', role: 'owner' }), 1);
        await f.waitFor(async () => (await FeedEvent.countDocuments({ tenantId: b.tenant._id, type: 'message.broadcast' })) === 1);
    });

    test('the mail of a platform broadcast goes to the owner email, only when asked', async () => {
        const a = await f.makeWorld('msg-sa-mail');
        const { token } = await f.makeSuperAdmin('msg-sa-mail@test.com');
        await User.updateOne({ _id: a.owner.user._id }, { $set: { email: 'boss@shop.test' } });
        const res = await request(app).post('/api/admin/messages').set(bearer(token))
            .send({ title: 'Please read', body: 'Important.', tenantIds: [String(a.tenant._id)], sendEmail: true });
        await finished(res.body.id);
        await f.waitFor(async () => (await EmailJob.countDocuments({ to: 'boss@shop.test' })) === 1);
        assert.equal((await EmailJob.findOne({ to: 'boss@shop.test' }).lean()).priority, 3);
    });

    test('the platform sends information only; bad shop ids and unknown shops are refused; shop tokens cannot use it', async () => {
        const a = await f.makeWorld('msg-sa-bad');
        const { token } = await f.makeSuperAdmin('msg-sa-bad@test.com');
        const send = (body) => request(app).post('/api/admin/messages').set(bearer(token)).send(body);
        assert.equal((await send({ title: 'a', body: 'b', kind: 'promo' })).status, 400);
        assert.equal((await send({ title: 'a', body: 'b', tenantIds: ['nope'] })).status, 400);
        assert.equal((await send({ title: 'a', body: 'b', tenantIds: ['64b64b64b64b64b64b64b64b'] })).status, 400);
        assert.equal((await request(app).post('/api/admin/messages').set(a.owner.headers).send({ title: 'a', body: 'b' })).status, 401);
    });
});