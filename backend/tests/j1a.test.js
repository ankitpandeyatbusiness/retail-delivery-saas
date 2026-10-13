require('./helpers/env');
process.env.SECRETS_KEY = process.env.SECRETS_KEY || Buffer.alloc(32, 7).toString('base64');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const request = require('supertest');
const db = require('./helpers/db');
const factory = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Tenant = require('../src/models/Tenant');
const payments = require('../src/services/adapters/payments');
const accounts = require('../src/services/paymentAccounts');

before(db.connect);
after(db.disconnect);
beforeEach(db.clear);

const KEY_ID = 'rzp_test_AbCdEf123456';
const KEY_SECRET = 'my-very-secret-key-123';
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const raw = (id) => Tenant.collection.findOne({ _id: id }, { projection: { payments: 1 } });

async function setup(slug) {
    const tenant = await factory.makeTenant(slug);
    const { token } = await factory.makeSuperAdmin(`${slug}@x.test`);
    return { tenant, token, url: `/api/admin/tenants/${tenant._id}/payments` };
}

// full setup through the routes (the global mock mode makes "test connection" pass)
async function connect({ token, url }) {
    await request(app).put(`${url}/keys`).set(auth(token)).send({ keyId: KEY_ID, keySecret: KEY_SECRET });
    await request(app).post(`${url}/test`).set(auth(token));
    await request(app).post(`${url}/webhook-secret`).set(auth(token));
    return request(app).put(`${url}/enabled`).set(auth(token)).send({ enabled: true });
}

async function withEnv(vars, fn) {
    const old = {};
    for (const k of Object.keys(vars)) {
        old[k] = process.env[k];
        if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k];
    }
    try { return await fn(); } finally {
        for (const k of Object.keys(old)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; }
    }
}
async function withFetch(stub, fn) {
    const real = global.fetch;
    global.fetch = stub;
    try { return await fn(); } finally { global.fetch = real; }
}

test('only a superadmin can use the payment routes', async () => {
    const { tenant, token, url } = await setup('pay-auth');
    assert.strictEqual((await request(app).get(url)).status, 401);
    const owner = await factory.makeUser(tenant, 'admin', '9000000701');
    const r = await request(app).get(url).set(owner.headers);
    assert.ok([401, 403].includes(r.status), `got ${r.status}`);
    assert.strictEqual((await request(app).get(url).set(auth(token))).status, 200);
});

test('keys: bad input is refused, the secret is stored encrypted and never comes back', async () => {
    const { tenant, token, url } = await setup('pay-keys');
    const badId = await request(app).put(`${url}/keys`).set(auth(token)).send({ keyId: 'nope', keySecret: KEY_SECRET });
    assert.strictEqual(badId.status, 400);
    const badSecret = await request(app).put(`${url}/keys`).set(auth(token)).send({ keyId: KEY_ID, keySecret: 'short' });
    assert.strictEqual(badSecret.status, 400);

    const ok = await request(app).put(`${url}/keys`).set(auth(token)).send({ keyId: KEY_ID, keySecret: KEY_SECRET });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(ok.body.keyId, KEY_ID);
    assert.strictEqual(ok.body.keyMode, 'test');
    assert.strictEqual(ok.body.hasKeySecret, true);
    assert.strictEqual(ok.body.enabled, false);
    assert.ok(!JSON.stringify(ok.body).includes(KEY_SECRET));

    const doc = await raw(tenant._id);
    assert.ok(doc.payments.keySecretEnc);
    assert.ok(!JSON.stringify(doc).includes(KEY_SECRET));
    assert.strictEqual((await accounts.forTenant(tenant._id)).keySecret, KEY_SECRET);

    const get = await request(app).get(url).set(auth(token));
    assert.ok(!JSON.stringify(get.body).includes(KEY_SECRET));
});

test('test connection: real mode calls Razorpay with the shop keys, and bad keys are refused', async () => {
    const a = await setup('pay-ping-a');
    await request(app).put(`${a.url}/keys`).set(auth(a.token)).send({ keyId: KEY_ID, keySecret: KEY_SECRET });
    const calls = [];
    await withEnv({ PAYMENTS_MOCK: 'false' }, async () => {
        await withFetch(async (u, o) => { calls.push({ u, o }); return { ok: true, status: 200, json: async () => ({ items: [] }) }; }, async () => {
            const r = await request(app).post(`${a.url}/test`).set(auth(a.token));
            assert.strictEqual(r.status, 200, JSON.stringify(r.body));
            assert.ok(r.body.verifiedAt);
        });
    });
    assert.ok(calls[0].u.endsWith('/payments?count=1'));
    assert.strictEqual(calls[0].o.headers.authorization, `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}`);

    const b = await setup('pay-ping-b');
    await request(app).put(`${b.url}/keys`).set(auth(b.token)).send({ keyId: KEY_ID, keySecret: KEY_SECRET });
    await withEnv({ PAYMENTS_MOCK: 'false' }, async () => {
        await withFetch(async () => ({ ok: false, status: 401, json: async () => ({ error: { description: 'Authentication failed' } }) }), async () => {
            const r = await request(app).post(`${b.url}/test`).set(auth(b.token));
            assert.strictEqual(r.status, 400);
        });
    });
    assert.ok(!(await raw(b.tenant._id)).payments.verifiedAt);

    const c = await setup('pay-ping-c');   // no keys saved
    await withEnv({ PAYMENTS_MOCK: 'false' }, async () => {
        const r = await request(app).post(`${c.url}/test`).set(auth(c.token));
        assert.strictEqual(r.status, 400);
    });
});

test('the webhook secret is shown once, stored encrypted, and a new one replaces it', async () => {
    const { tenant, token, url } = await setup('pay-hook');
    const a = await request(app).post(`${url}/webhook-secret`).set(auth(token));
    assert.strictEqual(a.status, 200);
    assert.ok(a.body.webhookUrl.endsWith(`/api/webhooks/razorpay/${tenant._id}`));
    assert.ok(a.body.secret.length >= 20);
    const b = await request(app).post(`${url}/webhook-secret`).set(auth(token));
    assert.notStrictEqual(a.body.secret, b.body.secret);

    const doc = await raw(tenant._id);
    assert.ok(!JSON.stringify(doc).includes(b.body.secret));
    assert.strictEqual((await accounts.forTenant(tenant._id)).webhookSecret, b.body.secret);

    const get = await request(app).get(url).set(auth(token));
    assert.strictEqual(get.body.hasWebhookSecret, true);
    assert.ok(!JSON.stringify(get.body).includes(b.body.secret));
});

test('payments can be switched on only after keys, a passed test and a webhook secret', async () => {
    const { token, url } = await setup('pay-enable');
    const on = () => request(app).put(`${url}/enabled`).set(auth(token)).send({ enabled: true });

    assert.strictEqual((await on()).status, 409);   // no keys
    await request(app).put(`${url}/keys`).set(auth(token)).send({ keyId: KEY_ID, keySecret: KEY_SECRET });
    assert.strictEqual((await on()).status, 409);   // not tested
    await request(app).post(`${url}/test`).set(auth(token));
    assert.strictEqual((await on()).status, 409);   // no webhook secret
    await request(app).post(`${url}/webhook-secret`).set(auth(token));

    const ok = await on();
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(ok.body.enabled, true);
    const done = Object.fromEntries(ok.body.checklist.map((c) => [c.step, c.done]));
    assert.deepStrictEqual(done, {
        keys_saved: true, connection_tested: true, webhook_secret_created: true, webhook_event_received: false, enabled: true,
    });
    assert.ok(ok.body.warnings.some((w) => /webhook/i.test(w)));

    assert.strictEqual((await request(app).put(`${url}/enabled`).set(auth(token)).send({ enabled: 'yes' })).status, 400);
    const off = await request(app).put(`${url}/enabled`).set(auth(token)).send({ enabled: false });
    assert.strictEqual(off.body.enabled, false);
});

test('keys cannot change while payments are on; new keys reset the test and the webhook proof', async () => {
    const s = await setup('pay-change');
    await connect(s);
    const again = await request(app).put(`${s.url}/keys`).set(auth(s.token)).send({ keyId: 'rzp_live_ZyXwVu987654', keySecret: 'another-secret-value' });
    assert.strictEqual(again.status, 409);

    await Tenant.updateOne({ _id: s.tenant._id }, { $set: { 'payments.lastWebhookAt': new Date() } });
    await request(app).put(`${s.url}/enabled`).set(auth(s.token)).send({ enabled: false });
    const ok = await request(app).put(`${s.url}/keys`).set(auth(s.token)).send({ keyId: 'rzp_live_ZyXwVu987654', keySecret: 'another-secret-value' });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.body.keyMode, 'live');
    assert.strictEqual(ok.body.enabled, false);
    assert.strictEqual(ok.body.verifiedAt, null);
    assert.strictEqual(ok.body.lastWebhookAt, null);
    assert.ok(ok.body.hasWebhookSecret);   // the webhook secret stays until it is replaced
});

test('canTakePayments: mock mode allows, real mode needs the full setup of that shop', async () => {
    const fresh = await setup('pay-can-a');
    const ready = await setup('pay-can-b');
    assert.strictEqual((await ready && (await connect(ready))).status, 200);

    assert.strictEqual((await accounts.canTakePayments(fresh.tenant._id)).ok, true);   // the test setup runs in mock mode
    await withEnv({ PAYMENTS_MOCK: 'false' }, async () => {
        const a = await accounts.canTakePayments(fresh.tenant._id);
        assert.strictEqual(a.ok, false);
        assert.match(a.reason, /not switched on/);
        const b = await accounts.canTakePayments(ready.tenant._id);
        assert.strictEqual(b.ok, true);
        assert.strictEqual(b.keyMode, 'test');
    });
});

test('signatures: the checkout proof and the webhook are checked with the right secret', async () => {
    const sig = crypto.createHmac('sha256', KEY_SECRET).update('order_1|pay_1').digest('hex');
    const ok = { orderId: 'order_1', paymentId: 'pay_1', signature: sig, secret: KEY_SECRET };
    assert.strictEqual(payments.verifyPaymentSignature(ok), true);
    assert.strictEqual(payments.verifyPaymentSignature({ ...ok, paymentId: 'pay_2' }), false);
    assert.strictEqual(payments.verifyPaymentSignature({ ...ok, secret: 'other-secret-value' }), false);
    assert.strictEqual(payments.verifyPaymentSignature({ ...ok, signature: '' }), false);

    await withEnv({ PAYMENTS_MOCK: 'false' }, async () => {
        const body = Buffer.from('{"event":"payment.captured"}');
        const good = crypto.createHmac('sha256', 'whsec-123456789').update(body).digest('hex');
        assert.strictEqual(payments.verifyWebhook({ rawBody: body, signature: good, secret: 'whsec-123456789' }), true);
        assert.strictEqual(payments.verifyWebhook({ rawBody: body, signature: good, secret: 'wrong-secret-xyz' }), false);
        assert.strictEqual(payments.verifyWebhook({ rawBody: Buffer.from('{"event":"x"}'), signature: good, secret: 'whsec-123456789' }), false);
        assert.strictEqual(payments.verifyWebhook({ rawBody: body.toString(), signature: good, secret: 'whsec-123456789' }), false);
    });
});

test('real QR: needs the platform keys, and sends the amount in paise', async () => {
    await withEnv({ PAYMENTS_MOCK: 'false', RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined }, async () => {
        await assert.rejects(() => payments.createQr({ amountPaise: 10000, purpose: 'sms_topup', referenceId: 'r1' }), /not configured/);
    });
    const calls = [];
    await withEnv({ PAYMENTS_MOCK: 'false', RAZORPAY_KEY_ID: 'rzp_test_PlatformKey1', RAZORPAY_KEY_SECRET: 'platform-secret-123' }, async () => {
        await withFetch(async (u, o) => { calls.push({ u, o }); return { ok: true, status: 200, json: async () => ({ id: 'qr_1', image_url: 'https://x.test/qr.png' }) }; }, async () => {
            const r = await payments.createQr({ amountPaise: 10000, purpose: 'sms_topup', referenceId: 'r1' });
            assert.strictEqual(r.qrId, 'qr_1');
            assert.strictEqual(r.imageUrl, 'https://x.test/qr.png');
            assert.ok(r.expiresAt > new Date());
        });
    });
    assert.ok(calls[0].u.endsWith('/payments/qr_codes'));
    assert.strictEqual(JSON.parse(calls[0].o.body).payment_amount, 10000);
});

test('mock provider: order, payment lookup, refund and QR answer without any network', async () => {
    const o = await payments.createOrder({ amountPaise: 12300, receipt: 'r1' });
    assert.strictEqual(o.id, 'order_mock_r1');
    assert.strictEqual(o.amountPaise, 12300);
    await assert.rejects(() => payments.fetchPayment({ paymentId: 'pay_x' }), /not found/);
    payments._mock.setPayment({ id: 'pay_x', orderId: 'order_mock_r1', status: 'captured', amountPaise: 12300, capturedPaise: 12300, refundedPaise: 0 });
    assert.strictEqual((await payments.fetchPayment({ paymentId: 'pay_x' })).status, 'captured');
    payments._mock.reset();
    const r = await payments.refund({ paymentId: 'pay_x', amountPaise: 500 });
    assert.strictEqual(r.status, 'processed');
    assert.deepStrictEqual(await payments.listRefunds({ paymentId: 'pay_x' }), []);
    assert.strictEqual((await payments.createQr({ amountPaise: 10000, purpose: 'sms_topup', referenceId: 'r9' })).qrId, 'mock_qr_r9');
});