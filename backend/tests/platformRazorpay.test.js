require('./helpers/env');
process.env.SECRETS_KEY = process.env.SECRETS_KEY || require('crypto').randomBytes(32).toString('base64');
// YOUR Razorpay account (SMS top-ups and rent): keys saved from the app, write-only, tested, webhook secret once.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const payments = require('../src/services/adapters/payments');

let token;
const auth = () => ({ Authorization: `Bearer ${token}` });

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    payments.setPlatformOverride(null);
    token = (await f.makeSuperAdmin('root@test.com')).token;
});

describe('my own Razorpay account', () => {
    test('keys are saved write-only, tested, a webhook secret is made once, and the payment code uses them', async () => {
        const first = await request(app).get('/api/admin/platform/payments').set(auth());
        assert.equal(first.status, 200);

        const bad = await request(app).put('/api/admin/platform/payments/keys').set(auth()).send({ keyId: 'bad', keySecret: 'x'.repeat(20) });
        assert.equal(bad.status, 400);

        const saved = await request(app).put('/api/admin/platform/payments/keys').set(auth()).send({ keyId: 'rzp_test_abcdef123456', keySecret: 'secretsecretsecret1234' });
        assert.equal(saved.status, 200, JSON.stringify(saved.body));
        assert.equal(saved.body.source, 'saved');
        assert.equal(saved.body.keyId, 'rzp_test_abcdef123456');
        assert.ok(!JSON.stringify(saved.body).includes('secretsecret'));
        assert.equal(payments.platformCredentials().keyId, 'rzp_test_abcdef123456');

        const w = await request(app).post('/api/admin/platform/payments/webhook-secret').set(auth()).send({});
        assert.equal(w.status, 200);
        assert.equal(w.body.secret.length, 24);
        assert.ok(w.body.webhookUrl.endsWith('/api/webhooks/razorpay/platform'));
        assert.equal(payments.platformCredentials().webhookSecret, w.body.secret);

        const tested = await request(app).post('/api/admin/platform/payments/test').set(auth()).send({});
        assert.equal(tested.status, 200, JSON.stringify(tested.body));
        const after2 = await request(app).get('/api/admin/platform/payments').set(auth());
        assert.equal(after2.body.checklist.find((c) => c.step === 'connection_tested').done, true);
        assert.equal(after2.body.hasWebhookSecret, true);
    });

    test('a stranger cannot read or change them', async () => {
        assert.equal((await request(app).get('/api/admin/platform/payments')).status, 401);
        assert.equal((await request(app).put('/api/admin/platform/payments/keys').send({})).status, 401);
    });
});
