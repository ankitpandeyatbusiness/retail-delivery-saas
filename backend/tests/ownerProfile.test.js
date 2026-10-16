require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const User = require('../src/models/User');
const EmailCode = require('../src/models/EmailCode');
const EmailJob = require('../src/models/EmailJob');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');

// The owner's own profile: the name can change, the email only with a code, the registered phone never.
let w;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('prof-shop');
    tenantRecognizer.invalidateTenant('prof-shop');
});
const call = (m, body, headers = w.owner.headers, path = '') => request(app)[m](`/api/shop/profile${path}`).set(headers).send(body);
const sendCode = (email) => call('post', { email }, w.owner.headers, '/email/send-code');
const verify = (email, code) => call('post', { email, code }, w.owner.headers, '/email/verify');

describe('owner profile', () => {
    test('shows the phone, name and email, and says when the email is missing', async () => {
        const r = await call('get');
        assert.equal(r.status, 200);
        assert.equal(r.body.emailRequired, !r.body.email);
        assert.equal(r.body.phone, '9000000010');
        assert.equal(r.body.avatarUrl, null);
    });

    test('the name can be changed; the email cannot be changed this way; nothing else', async () => {
        const r = await call('put', { name: '  Anita Rao ' });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.name, 'Anita Rao');
        assert.equal((await call('put', { email: 'x@example.com' })).status, 400);
        assert.equal((await call('put', { name: 'A' })).status, 400);
        assert.equal((await call('put', { notes: 'x' })).status, 400);
        assert.equal((await call('put', {})).status, 400);
        assert.equal((await call('put', { phone: '9111111111' })).status, 400);
        assert.equal((await User.findById(w.owner.user._id).lean()).phone, '9000000010');
    });

    test('a customer cannot open the owner profile', async () => {
        assert.ok([401, 403].includes((await call('get', undefined, w.customer.headers)).status));
    });
});

describe('email with a code', () => {
    test('the code is mailed, and the right code saves the address', async () => {
        const s = await sendCode('Anita@Example.com');
        assert.equal(s.status, 200, JSON.stringify(s.body));
        assert.match(s.body.devCode, /^\d{6}$/);
        const job = await EmailJob.findOne({ kind: 'email_code' }).lean();
        assert.equal(job.to, 'anita@example.com');
        assert.ok(job.subject.includes(s.body.devCode), 'the code is in the mail');
        assert.equal((await User.findById(w.owner.user._id).lean()).email, undefined, 'not saved before the code is right');

        const v = await verify('anita@example.com', s.body.devCode);
        assert.equal(v.status, 200, JSON.stringify(v.body));
        assert.equal(v.body.email, 'anita@example.com');
        assert.equal(v.body.emailRequired, false);
        const saved = await User.findById(w.owner.user._id).lean();
        assert.equal(saved.email, 'anita@example.com');
        assert.ok(saved.emailVerifiedAt);
        assert.equal(await EmailCode.countDocuments({ userId: w.owner.user._id }), 0, 'the code is used up');
        assert.equal((await verify('anita@example.com', s.body.devCode)).status, 400, 'a code works once');
    });

    test('a wrong code is refused, five wrong tries kill the code, an old code is replaced', async () => {
        const s = await sendCode('a@example.com');
        const wrong = s.body.devCode === '000000' ? '111111' : '000000';
        const bad = await verify('a@example.com', wrong);
        assert.equal(bad.status, 400);
        assert.match(bad.body.error, /4 tries left/);
        for (let i = 0; i < 4; i += 1) await verify('a@example.com', wrong);
        assert.equal((await verify('a@example.com', wrong)).status, 429);
        assert.equal((await verify('a@example.com', s.body.devCode)).status, 400, 'the right code no longer works either');
        assert.equal((await User.findById(w.owner.user._id).lean()).email, undefined);
    });

    test('an expired code, another address, bad input and asking too fast are refused', async () => {
        const s = await sendCode('a@example.com');
        assert.equal((await verify('b@example.com', s.body.devCode)).status, 400, 'the code is for one address');
        assert.equal((await verify('a@example.com', 'abc')).status, 400);
        assert.equal((await sendCode('a@example.com')).status, 429, 'wait 30 seconds before another code');
        assert.equal((await sendCode('not-an-email')).status, 400);
        await EmailCode.updateOne({ userId: w.owner.user._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
        assert.equal((await verify('a@example.com', s.body.devCode)).status, 400);
    });

    test('changing to the same address is refused, and a changed address tells the old one', async () => {
        const first = await sendCode('old@example.com');
        await verify('old@example.com', first.body.devCode);
        assert.equal((await sendCode('old@example.com')).status, 409);
        await EmailCode.deleteMany({});   // skip the 30 second wait
        const second = await sendCode('new@example.com');
        assert.equal((await verify('new@example.com', second.body.devCode)).status, 200);
        const told = await EmailJob.findOne({ kind: 'owner_email_changed' }).lean();
        assert.ok(told, 'the old address is warned');
        assert.equal(told.to, 'old@example.com');
    });

    test('a customer cannot ask for a code', async () => {
        const r = await call('post', { email: 'a@example.com' }, w.customer.headers, '/email/send-code');
        assert.ok([401, 403].includes(r.status));
    });
});

describe('owner messages never use email', () => {
    test('even when the app asks for email, a shop message goes by notification only', async () => {
        const Broadcast = require('../src/models/Broadcast');
        const r = await request(app).post('/api/shop/messages').set(w.owner.headers).send({ title: 'Diwali offer', body: 'Sweets at 10 percent off today', audience: 'customers', kind: 'promo', sendEmail: true });
        assert.equal(r.status, 202, JSON.stringify(r.body));
        assert.equal(r.body.sendEmail, false);
        assert.equal((await Broadcast.findById(r.body.id).lean()).sendEmail, false);
    });
});
