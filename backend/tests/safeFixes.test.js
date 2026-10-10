require('./helpers/env');   // must be the first line
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const publicRateLimit = require('../src/middlewares/publicRateLimit');
const storage = require('../src/services/adapters/storage');
const topups = require('../src/services/smsTopupService');
const { checkStuck } = require('../src/services/stuckOrders');
const Tenant = require('../src/models/Tenant');
const Notification = require('../src/models/Notification');
const { makeTenant, makeUser, makeWorld, makeOrder, makeSuperAdmin, sleep, waitFor } = require('./helpers/factory');

describe('safe fixes', () => {
    before(() => db.connect());
    after(() => db.disconnect());

    test('B13: /health/ready is 200 when the database is connected', async () => {
        const res = await request(app).get('/health/ready');
        assert.equal(res.status, 200);
        assert.equal(res.body.ok, true);
        assert.equal((await request(app).get('/health')).status, 200);   // the old one stays
    });

    test('B1: login refresh still works while the shop is suspended', async () => {
        const t = await makeTenant('frozen-shop');
        const c = await makeUser(t, 'customer', '9000000001');
        await Tenant.updateOne({ _id: t._id }, { $set: { status: 'suspended' } });
        tenantRecognizer.invalidateTenant(t.slug);

        const blocked = await request(app).post('/api/auth/send-otp')
            .set('x-tenant-slug', t.slug).send({ phone: '9000000001' });
        assert.equal(blocked.status, 402);   // other routes stay blocked

        const res = await request(app).post('/api/auth/refresh')
            .set('x-tenant-slug', t.slug).send({ refreshToken: c.refreshToken });
        assert.equal(res.status, 200);
        assert.ok(res.body.accessToken && res.body.refreshToken);
    });

    test('B1: login refresh also works while the shop is in maintenance', async () => {
        const t = await makeTenant('repair-shop');
        const c = await makeUser(t, 'customer', '9000000001');
        await Tenant.updateOne({ _id: t._id }, { $set: { 'maintenance.on': true } });
        tenantRecognizer.invalidateTenant(t.slug);
        const res = await request(app).post('/api/auth/refresh')
            .set('x-tenant-slug', t.slug).send({ refreshToken: c.refreshToken });
        assert.equal(res.status, 200);
    });

    test('B3: a superadmin answering a billing reminder gets 403, not 500', async () => {
        const t = await makeTenant('billing-shop');
        const { token } = await makeSuperAdmin();
        const res = await request(app)
            .post(`/api/admin/tenants/${t._id}/shop/billing/prompts/choice`)
            .set('Authorization', `Bearer ${token}`)
            .send({ kind: 'bill', choice: 'pay_now' });
        assert.equal(res.status, 403);
    });

    test('B14: public routes answer 429 with Retry-After after too many requests', async () => {
        const mini = express();
        mini.use(publicRateLimit.make({ points: 3, duration: 60 }));
        mini.get('/x', (req, res) => res.json({ ok: true }));
        const codes = [];
        let last;
        for (let i = 0; i < 4; i += 1) {
            last = await request(mini).get('/x');
            codes.push(last.status);
        }
        assert.deepEqual(codes, [200, 200, 200, 429]);
        assert.ok(Number(last.headers['retry-after']) >= 1);
    });

    test('B14: upload sign allows 50 per day per shop, then 429', async () => {
        const w = await makeWorld('upload-shop');
        const realPresign = storage.presignPut;
        storage.presignPut = async () => 'https://upload.test/file';   // no real R2 in tests
        try {
            const body = { kind: 'logo', contentType: 'image/png', bytes: 1000 };
            for (let i = 0; i < 50; i += 1) {
                const ok = await request(app).post('/api/shop/uploads/sign').set(w.owner.headers).send(body);
                assert.equal(ok.status, 200, `sign number ${i + 1} should work`);
            }
            const over = await request(app).post('/api/shop/uploads/sign').set(w.owner.headers).send(body);
            assert.equal(over.status, 429);
            assert.ok(Number(over.headers['retry-after']) >= 1);
        } finally {
            storage.presignPut = realPresign;
        }
    });

    test('B19: SMS top-up gives 503 (not 500) when real payments are not ready', async () => {
        const t = await makeTenant('topup-shop');
        const before = process.env.PAYMENTS_MOCK;
        process.env.PAYMENTS_MOCK = 'false';
        try {
            await assert.rejects(
                () => topups.create({ tenantId: t._id, amountPaise: 10000, actor: { type: 'owner' } }),
                (e) => e.status === 503 && /not available/i.test(e.message),
            );
        } finally {
            process.env.PAYMENTS_MOCK = before;
        }
        const ok = await topups.create({ tenantId: t._id, amountPaise: 10000, actor: { type: 'owner' } });
        assert.ok(ok.upiString);   // mock mode still works
    });

    test('B20: a late order alerts the owner only, never the superadmin', async () => {
        const t = await makeTenant('late-shop');
        const c = await makeUser(t, 'customer', '9000000002');
        await makeOrder(t, c.user, { status: 'accepted' });

        const t0 = new Date(Date.now() + 25 * 60000);   // 25 minutes later: the order is "not started"
        await checkStuck(t0);
        assert.ok(await waitFor(async () => (await Notification.countDocuments({ tenantId: t._id, role: 'owner' })) === 1));

        await checkStuck(new Date(t0.getTime() + 20 * 60000));   // 20 more minutes: used to escalate
        await sleep(500);
        assert.equal(await Notification.countDocuments({ role: 'superadmin' }), 0);
        assert.equal(await Notification.countDocuments({ tenantId: t._id, role: 'owner' }), 1);
    });
});