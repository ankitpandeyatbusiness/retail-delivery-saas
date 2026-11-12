require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const demoReset = require('../src/services/demoReset');
const demoTenant = require('../src/services/demoTenant');
const PlatformSettings = require('../src/models/PlatformSettings');

let n = 0;
const KEYS = ['QR_BASE_URL', 'DEMO_SITE_URL', 'PLATFORM_WEB_DOMAIN', 'WEB_BASE_DOMAIN', 'CORS_ORIGINS', 'SERVER_URL', 'DEMO_ENGINE'];
let saved;
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    KEYS.forEach((k) => delete process.env[k]);
    require('../src/middlewares/tenantRecognizer').invalidateTenant(demoTenant.SLUG);
});
afterEach(() => { KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); });

const admin = async () => ({ Authorization: `Bearer ${(await f.makeSuperAdmin(`gl${++n}@test.com`)).token}` });
const check = (r, key) => r.body.checks.find((c) => c.key === key);

describe('go-live checks for the demo and the banners', () => {
    test('a fresh server is not ready: it says what to do first', async () => {
        const r = await request(app).get('/api/admin/demo/readiness').set(await admin());
        assert.equal(r.status, 200);
        assert.equal(r.body.ready, false);
        assert.ok(r.body.todo >= 3);
        assert.equal(check(r, 'shop').status, 'todo');
        assert.equal(check(r, 'qr').status, 'todo');
        assert.match(check(r, 'qr').detail, /QR_BASE_URL/);
        assert.equal(check(r, 'site').status, 'todo');
        assert.equal(check(r, 'awake').status, 'todo');
        assert.equal(check(r, 'login').status, 'warn');
        assert.equal(check(r, 'engine').status, 'ok');
    });

    test('once the shop is built and the addresses are set, nothing is left to do', async () => {
        await demoReset.ensureReady();
        process.env.QR_BASE_URL = 'https://vivyaan.co.in';
        process.env.PLATFORM_WEB_DOMAIN = 'vivyaan.co.in';
        process.env.SERVER_URL = 'https://api.vivyaan.co.in';
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            await PlatformSettings.updateOne({ _id: 'main' }, { $set: { 'business.legalName': 'Vivyaan Business Systems Pvt. Ltd.' } }, { upsert: true });
            const r = await request(app).get('/api/admin/demo/readiness').set(await admin());
            assert.equal(check(r, 'shop').status, 'ok');
            assert.equal(check(r, 'qr').status, 'ok');
            assert.equal(check(r, 'site').status, 'ok');
            assert.equal(check(r, 'cors').status, 'ok');
            assert.equal(check(r, 'company').status, 'ok');
            assert.equal(r.body.todo, 0, JSON.stringify(r.body.checks.filter((c) => c.status === 'todo')));
            assert.equal(r.body.ready, true);
            assert.equal(check(r, 'awake').status, 'warn');   // it can only advise about a pinger
        } finally { process.env.NODE_ENV = prev; }
    });

    test('a demo website that the server would refuse is flagged', async () => {
        await demoReset.ensureReady();
        process.env.DEMO_SITE_URL = 'https://some-demo.vercel.app';
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            let r = await request(app).get('/api/admin/demo/readiness').set(await admin());
            assert.equal(check(r, 'cors').status, 'todo');
            process.env.CORS_ORIGINS = 'https://some-demo.vercel.app';
            r = await request(app).get('/api/admin/demo/readiness').set(await admin());
            assert.equal(check(r, 'cors').status, 'ok');
        } finally { process.env.NODE_ENV = prev; }
    });

    test('with the engine switched off it is not ready', async () => {
        process.env.DEMO_ENGINE = 'off';
        const r = await request(app).get('/api/admin/demo/readiness').set(await admin());
        assert.equal(check(r, 'engine').status, 'todo');
    });

    test('Server setup lists the new settings', async () => {
        const r = await request(app).get('/api/admin/ops/setup').set(await admin());
        assert.equal(r.status, 200);
        const g = JSON.stringify(r.body).includes('QR_BASE_URL');
        assert.ok(g, 'QR_BASE_URL is in the setup list');
    });

    test('it needs a superadmin login', async () => {
        assert.equal((await request(app).get('/api/admin/demo/readiness')).status, 401);
    });
});
