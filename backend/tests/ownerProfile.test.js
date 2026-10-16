require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const User = require('../src/models/User');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');

// The owner's own profile: name and email can change; the registered phone cannot.
let w;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('prof-shop');
    tenantRecognizer.invalidateTenant('prof-shop');
});
const call = (m, body, headers = w.owner.headers) => request(app)[m]('/api/shop/profile').set(headers).send(body);

describe('owner profile', () => {
    test('shows the phone, name and email', async () => {
        const r = await call('get');
        assert.equal(r.status, 200);
        assert.equal(r.body.phone, '9000000010');
        assert.equal(r.body.avatarUrl, null);
    });

    test('name and email can be changed, the email can be removed', async () => {
        const r = await call('put', { name: '  Anita Rao ', email: 'Anita@Example.com' });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.name, 'Anita Rao');
        assert.equal(r.body.email, 'anita@example.com');
        assert.equal((await User.findById(w.owner.user._id).lean()).name, 'Anita Rao');
        const gone = await call('put', { email: '' });
        assert.equal(gone.body.email, null);
        assert.equal(gone.body.name, 'Anita Rao', 'the name stays');
    });

    test('the registered phone cannot be changed, bad values are refused', async () => {
        const r = await call('put', { phone: '9111111111' });
        assert.equal(r.status, 400);
        assert.match(r.body.error, /cannot be changed/);
        assert.equal((await User.findById(w.owner.user._id).lean()).phone, '9000000010');
        assert.equal((await call('put', { name: 'A' })).status, 400);
        assert.equal((await call('put', { email: 'not-an-email' })).status, 400);
        assert.equal((await call('put', { notes: 'x' })).status, 400, 'only name and email');
        assert.equal((await call('put', {})).status, 400);
    });

    test('a customer cannot open the owner profile', async () => {
        assert.ok([401, 403].includes((await call('get', undefined, w.customer.headers)).status));
    });
});
