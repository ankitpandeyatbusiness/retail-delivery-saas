require('./helpers/env');
// Your balance at the SMS provider: asked, estimated, two lines, alerts once, and below the reserve only OTPs and your own alerts go.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const svc = require('../src/services/smsProviderBalance');
const PlatformSettings = require('../src/models/PlatformSettings');
const SmsLog = require('../src/models/SmsLog');
const Notification = require('../src/models/Notification');

let token;
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); svc.resetCache(); token = (await f.makeSuperAdmin('root@test.com')).token; });
const auth = (t = token) => ({ Authorization: 'Bearer ' + t });
const told = (type) => Notification.find({ role: 'superadmin', type }).lean();

describe('sms provider balance', () => {
    test('reads the provider answer (a number or JSON) and refuses nonsense', () => {
        assert.equal(svc.parseBalance('1234.50'), 1234.5);
        assert.equal(svc.parseBalance('{"balance": 99}'), 99);
        assert.equal(svc.parseBalance('{"data":{"balance":"7.5"}}'), 7.5);
        assert.throws(() => svc.parseBalance('Invalid authkey'));
        assert.throws(() => svc.parseBalance(''));
    });

    test('with no answer from the provider the estimate is what you added minus what the SMS since then cost', async () => {
        const w = await f.makeWorld('sb-' + Date.now().toString(36));
        let c = await svc.current();
        assert.equal(c.level, 'unknown');
        await svc.added(200000);                                    // Rs 2000
        const since = new Date(Date.now() + 1000);
        await SmsLog.create({ tenantId: w.tenant._id, purpose: 'order', status: 'sent', costPaise: 2000, createdAt: since });
        await SmsLog.create({ tenantId: w.tenant._id, purpose: 'order', status: 'sent', own: true, costPaise: 9000, createdAt: since });   // a shop's own account costs you nothing
        c = await svc.current(Date.now() + 5000);
        assert.equal(c.source, 'estimate');
        assert.equal(c.paise, 198000);
        assert.equal(c.level, 'ok');
    });

    test('lines: low warns once, empty alerts once and pauses everything except OTPs and your own alerts', async () => {
        await svc.saveSettings({ lowPaise: 50000, reservePaise: 10000 });
        await svc.added(40000);                                      // Rs 400: low
        let c = await svc.current();
        assert.equal(c.level, 'low');
        assert.equal(await svc.alertIfNeeded(c), true);
        assert.equal(await svc.alertIfNeeded(c), false, 'not again');
        await new Promise((ok) => setTimeout(ok, 300));
        assert.equal((await told('admin_sms_provider_low')).length >= 1, true);
        assert.equal(await svc.pauseFor('order'), false, 'low is only a warning');

        await svc.added(5000);                                       // Rs 50: almost empty
        svc.resetCache();
        c = await svc.current();
        assert.equal(c.level, 'empty');
        assert.equal(await svc.alertIfNeeded(c), true);
        await new Promise((ok) => setTimeout(ok, 300));
        assert.ok((await told('admin_sms_provider_empty')).length >= 1);
        assert.equal(await svc.pauseFor('order'), true);
        assert.equal(await svc.pauseFor('bill'), true);
        assert.equal(await svc.pauseFor('otp'), false, 'login OTPs always go');
        assert.equal(await svc.pauseFor('platform_alert'), false, 'your own alerts always go');

        await svc.saveSettings({ protectOtp: false });
        svc.resetCache();
        assert.equal(await svc.pauseFor('order'), false, 'the pause can be switched off');

        await svc.added(900000);                                     // topped up
        c = await svc.current();
        assert.equal(c.level, 'ok');
        assert.equal(await svc.alertIfNeeded(c), false);
        assert.equal((await PlatformSettings.findById('main').lean()).smsProvider.alertedLevel, 'ok', 'recovered: the next drop alerts again');
    });

    test('the routes: read, change the lines (reserve below low), I added money; only the supreme admin may change', async () => {
        const ordinary = (await f.makeSuperAdmin('other@test.com', { phones: [] })).token;
        let r = await request(app).get('/api/admin/platform/sms-balance').set(auth(ordinary));
        assert.equal(r.status, 200);
        assert.equal(r.body.level, 'unknown');
        assert.equal((await request(app).put('/api/admin/platform/sms-balance').set(auth(ordinary)).send({ lowPaise: 1 })).status, 403);

        r = await request(app).put('/api/admin/platform/sms-balance').set(auth()).send({ lowPaise: 60000, reservePaise: 20000 });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.lowPaise, 60000);
        assert.equal((await request(app).put('/api/admin/platform/sms-balance').set(auth()).send({ lowPaise: 100, reservePaise: 5000 })).status, 400);
        assert.equal((await request(app).put('/api/admin/platform/sms-balance').set(auth()).send({ unit: 'dollars' })).status, 400);

        r = await request(app).post('/api/admin/platform/sms-balance/added').set(auth()).send({ amountPaise: 150000 });
        assert.equal(r.status, 200);
        assert.equal(r.body.paise, 150000);
        assert.equal(r.body.level, 'ok');
        assert.equal((await request(app).post('/api/admin/platform/sms-balance/added').set(auth()).send({ amountPaise: -5 })).status, 400);
    });

    test('the Money attention list shows a low balance', async () => {
        await svc.added(3000);
        const r = await request(app).get('/api/admin/finance/attention').set(auth());
        const it = r.body.items.find((x) => x.key === 'sms_provider');
        assert.ok(it);
        assert.equal(it.level, 'bad');
        assert.match(it.hint, /estimate/);
    });

    test('the SMS adapter refuses a shop message below the reserve with a clear reason, but lets an OTP through to the provider', async () => {
        const sms = require('../src/services/adapters/sms');
        await svc.saveSettings({ lowPaise: 50000, reservePaise: 10000 });
        await svc.added(2000);
        svc.resetCache();
        const before = process.env.SMS_MOCK;
        process.env.SMS_MOCK = 'false';
        const key = process.env.SMS_AUTH_KEY;
        delete process.env.SMS_AUTH_KEY;                           // no provider in the test: an allowed message fails later, at the provider
        try {
            await assert.rejects(() => sms.send({ to: '9876543210', text: 'x', purpose: 'order' }), /SMS paused/);
            await assert.rejects(() => sms.send({ to: '9876543210', text: 'x', purpose: 'otp' }), /not configured/);
        } finally {
            process.env.SMS_MOCK = before;
            if (key !== undefined) process.env.SMS_AUTH_KEY = key;
        }
    });
});
