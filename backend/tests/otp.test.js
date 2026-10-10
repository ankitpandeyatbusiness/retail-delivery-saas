require('./helpers/env');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const { RateLimiterMongo } = require('rate-limiter-flexible');
const db = require('./helpers/db');
const app = require('../src/server/app');
const wallet = require('../src/services/smsWalletService');
const OtpRequest = require('../src/models/OtpRequest');
const SmsWallet = require('../src/models/SmsWallet');
const { makeTenant, plantOtp } = require('./helpers/factory');

describe('OTP rules', () => {
    before(() => db.connect());
    after(() => db.disconnect());

    test('B2: 10 wrong OTPs lock the phone, even the right OTP is refused', async () => {
        const t = await makeTenant('lock-shop');
        const phone = '9000000060';
        const verify = (p, otp) => request(app).post('/api/auth/verify-otp')
            .set('x-tenant-slug', t.slug).send({ phone: p, otp });

        for (let round = 0; round < 2; round += 1) {
            await plantOtp(t, phone, '654321');
            for (let i = 0; i < 5; i += 1) assert.equal((await verify(phone, '111111')).status, 400);
        }
        await plantOtp(t, phone, '654321');
        const locked = await verify(phone, '654321');   // the RIGHT code
        assert.equal(locked.status, 429);
        assert.ok(Number(locked.headers['retry-after']) >= 1);

        // another phone is not affected
        await plantOtp(t, '9000000061', '654321');
        assert.equal((await verify('9000000061', '654321')).status, 200);
    });

    test('B2: a good login clears the wrong-OTP counter', async () => {
        const t = await makeTenant('reset-shop');
        const phone = '9000000062';
        const verify = (otp) => request(app).post('/api/auth/verify-otp')
            .set('x-tenant-slug', t.slug).send({ phone, otp });
        const counter = new RateLimiterMongo({
            storeClient: mongoose.connection, points: 10, duration: 30 * 60, keyPrefix: 'rl_ver_lockout',
        });
        const key = `${t._id}-${phone}`;

        await plantOtp(t, phone, '654321');
        for (let i = 0; i < 3; i += 1) await verify('111111');
        assert.equal((await counter.get(key)).consumedPoints, 3);

        const ok = await verify('654321');
        assert.equal(ok.status, 200);
        assert.ok(ok.body.accessToken);
        assert.equal(await counter.get(key), null);
    });

    test('B5: with zero SMS balance, the earlier valid OTP is NOT destroyed', async () => {
        const t = await makeTenant('empty-wallet-shop');
        const phone = '9000000063';
        const send = () => request(app).post('/api/auth/send-otp').set('x-tenant-slug', t.slug).send({ phone });

        const before = process.env.SMS_WALLET_IN_MOCK;
        process.env.SMS_WALLET_IN_MOCK = 'true';   // make the wallet really charge, even in mock SMS mode
        try {
            await wallet.credit({ tenantId: t._id, amountPaise: 30, type: 'adjust', note: 'test', actor: { type: 'system' } });

            const first = await send();
            assert.equal(first.status, 200);
            assert.equal((await SmsWallet.findOne({ tenantId: t._id })).balancePaise, 0);
            assert.equal(await OtpRequest.countDocuments({ tenantId: t._id, phone, consumed: false }), 1);

            const second = await send();   // the wallet is empty now
            assert.equal(second.status, 503);
            assert.equal(second.body.code, 'SMS_BALANCE_ZERO');
            assert.equal(await OtpRequest.countDocuments({ tenantId: t._id, phone, consumed: false }), 1);   // still alive
        } finally {
            if (before === undefined) delete process.env.SMS_WALLET_IN_MOCK;
            else process.env.SMS_WALLET_IN_MOCK = before;
        }
    });
});