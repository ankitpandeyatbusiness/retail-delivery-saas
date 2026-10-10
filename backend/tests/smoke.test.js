require('./helpers/env');   // must be the first line: sets the fake test settings before the app loads
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');

describe('smoke', () => {
    before(() => db.connect());
    after(() => db.disconnect());

    test('GET /health answers ok', async () => {
        const res = await request(app).get('/health');
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { ok: true });
    });

    test('unknown URL gives 404', async () => {
        const res = await request(app).get('/nothing-here');
        assert.equal(res.status, 404);
    });

    test('bad JSON gives 400', async () => {
        const res = await request(app).post('/api/auth/send-otp')
            .set('Content-Type', 'application/json').send('{bad json');
        assert.equal(res.status, 400);
        assert.equal(res.body.error, 'Invalid JSON');
    });

    test('missing shop header gives 400', async () => {
        const res = await request(app).post('/api/auth/send-otp').send({ phone: '9876543210' });
        assert.equal(res.status, 400);
        assert.equal(res.body.error, 'Missing tenant');
    });

    test('unknown shop gives 404', async () => {
        const res = await request(app).post('/api/auth/send-otp')
            .set('x-tenant-slug', 'no-such-shop').send({ phone: '9876543210' });
        assert.equal(res.status, 404);
    });
});