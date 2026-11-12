require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const smsAdapter = require('../src/services/adapters/sms');
const demoMode = require('../src/services/demoMode');
const Session = require('../src/models/Session');
const AuditLog = require('../src/models/AuditLog');
const PlatformSettings = require('../src/models/PlatformSettings');
const Order = require('../src/models/Order');

let n = 0;
const slug = () => `demo-shop-${++n}-${Date.now()}`;
const PHONE = '9123456780';
const OTP = '482913';
let sent;

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    demoMode.invalidate();
    sent = [];
    mock.method(smsAdapter, 'sendOtp', async (a) => { sent.push(a); return { providerMessageId: 't' }; });
});
afterEach(() => { mock.restoreAll(); demoMode.invalidate(); });

const admin = async (phones) => f.makeSuperAdmin(`boss${++n}@test.com`, phones ? { phones } : undefined);
const setDemo = (token, body) => request(app).put('/api/admin/demo').set('Authorization', `Bearer ${token}`).send(body);

describe('demo login: supreme admin settings', () => {
    test('the supreme admin sets the number and OTP, and the OTP is never shown or stored plainly', async () => {
        const { token } = await admin();
        const res = await setDemo(token, { phone: PHONE, otp: OTP });
        assert.equal(res.status, 200);
        assert.equal(res.body.enabled, true);
        assert.equal(res.body.phone, PHONE);
        assert.ok(!JSON.stringify(res.body).includes(OTP));
        const raw = await PlatformSettings.findById('main').select('+demo.otpHash').lean();
        assert.ok(raw.demo.otpHash && raw.demo.otpHash !== OTP);
        const get = await request(app).get('/api/admin/demo').set('Authorization', `Bearer ${token}`);
        assert.equal(get.body.hasOtp, true);
        assert.ok(!JSON.stringify(get.body).includes(raw.demo.otpHash));
    });

    test('another superadmin can look but not change', async () => {
        const { token } = await admin([]);
        assert.equal((await request(app).get('/api/admin/demo').set('Authorization', `Bearer ${token}`)).status, 200);
        assert.equal((await setDemo(token, { phone: PHONE, otp: OTP })).status, 403);
    });

    test('bad number, bad OTP, and the number of a real owner are refused', async () => {
        const { token } = await admin();
        assert.equal((await setDemo(token, { phone: '12345', otp: OTP })).status, 400);
        assert.equal((await setDemo(token, { phone: PHONE, otp: '12' })).status, 400);
        const t = await f.makeTenant(slug());
        await f.makeUser(t, 'admin', PHONE);
        assert.equal((await setDemo(token, { phone: PHONE, otp: OTP })).status, 400);
    });

    test('switch off and remove', async () => {
        const { token } = await admin();
        await setDemo(token, { phone: PHONE, otp: OTP });
        const off = await request(app).put('/api/admin/demo/enabled').set('Authorization', `Bearer ${token}`).send({ enabled: false });
        assert.equal(off.body.enabled, false);
        assert.equal(off.body.hasOtp, true);
        const del = await request(app).delete('/api/admin/demo').set('Authorization', `Bearer ${token}`);
        assert.equal(del.body.phone, null);
        assert.equal(del.body.hasOtp, false);
    });
});

describe('demo login: signing in', () => {
    test('no SMS is sent, the right OTP opens ANY shop as a demo customer, and it is audited', async () => {
        const { token } = await admin();
        await setDemo(token, { phone: PHONE, otp: OTP });
        const t = await f.makeTenant(slug());
        const s = await request(app).post('/api/auth/send-otp').set('x-tenant-slug', t.slug).send({ phone: PHONE });
        assert.equal(s.status, 200);
        assert.equal(sent.length, 0);
        const v = await request(app).post('/api/auth/verify-otp').set('x-tenant-slug', t.slug).send({ phone: PHONE, otp: OTP });
        assert.equal(v.status, 200);
        assert.equal(v.body.demo, true);
        assert.equal(v.body.user.role, 'customer');
        assert.equal(await Session.countDocuments({ demo: true, tenantId: t._id }), 1);
        assert.equal(await AuditLog.countDocuments({ action: 'DEMO_LOGIN' }), 1);
        const t2 = await f.makeTenant(slug());
        const v2 = await request(app).post('/api/auth/verify-otp').set('x-tenant-slug', t2.slug).send({ phone: PHONE, otp: OTP });
        assert.equal(v2.status, 200);
    });

    test('a wrong OTP is refused, and the login is locked after repeated failures', async () => {
        const { token } = await admin();
        await setDemo(token, { phone: PHONE, otp: OTP });
        const t = await f.makeTenant(slug());
        for (let i = 0; i < 10; i += 1) {
            const r = await request(app).post('/api/auth/verify-otp').set('x-tenant-slug', t.slug).send({ phone: PHONE, otp: '111111' });
            assert.equal(r.status, 400);
        }
        const locked = await request(app).post('/api/auth/verify-otp').set('x-tenant-slug', t.slug).send({ phone: PHONE, otp: OTP });
        assert.equal(locked.status, 429);
    });

    test('when switched off, the number is an ordinary one (the OTP no longer works)', async () => {
        const { token } = await admin();
        await setDemo(token, { phone: PHONE, otp: OTP });
        await request(app).put('/api/admin/demo/enabled').set('Authorization', `Bearer ${token}`).send({ enabled: false });
        demoMode.invalidate();
        const t = await f.makeTenant(slug());
        const v = await request(app).post('/api/auth/verify-otp').set('x-tenant-slug', t.slug).send({ phone: PHONE, otp: OTP });
        assert.equal(v.status, 400);
    });

    test('other numbers still get a real OTP SMS', async () => {
        const { token } = await admin();
        await setDemo(token, { phone: PHONE, otp: OTP });
        const t = await f.makeTenant(slug());
        const s = await request(app).post('/api/auth/send-otp').set('x-tenant-slug', t.slug).send({ phone: '9876500001' });
        assert.equal(s.status, 200);
        assert.equal(sent.length, 1);
    });
});

describe('demo login: write protection', () => {
    async function demoSession() {
        const { token } = await admin();
        await setDemo(token, { phone: PHONE, otp: OTP });
        const t = await f.makeTenant(slug());
        const v = await request(app).post('/api/auth/verify-otp').set('x-tenant-slug', t.slug).send({ phone: PHONE, otp: OTP });
        return { t, h: { Authorization: `Bearer ${v.body.accessToken}`, 'x-tenant-slug': t.slug } };
    }

    test('reading works, the cart works', async () => {
        const { h } = await demoSession();
        assert.equal((await request(app).get('/api/me').set(h)).status, 200);
        const put = await request(app).put('/api/cart').set(h).send({ items: [] });
        assert.notEqual(put.status, 403);
    });

    test('a real order, a payment, a booking, a bulk order and a chat message are refused', async () => {
        const { t, h } = await demoSession();
        const tries = [
            ['post', '/api/orders'],
            ['post', '/api/orders/507f1f77bcf86cd799439011/pay'],
            ['post', '/api/bookings'],
            ['post', '/api/bulk'],
            ['post', '/api/chat/anything'],
            ['post', '/api/dinein/pay-bill'],
            ['post', '/api/me/uploads'],
            ['post', '/api/notifications/devices'],
        ];
        for (const [m, url] of tries) {
            const r = await request(app)[m](url).set(h).send({});
            assert.equal(r.status, 403, `${url} must be refused`);
            assert.equal(r.body.demo, true);
        }
        assert.equal(await Order.countDocuments({ tenantId: t._id }), 0);
    });

    test('an ordinary customer session is not affected by the guard', async () => {
        const t = await f.makeTenant(slug());
        const u = await f.makeUser(t, 'customer', '9000000555');
        const r = await request(app).post('/api/orders/507f1f77bcf86cd799439011/cancel').set(u.headers).send({});
        assert.notEqual(r.body.demo, true);
    });

    test('guard rules: allowed and refused paths', () => {
        const g = require('../src/middlewares/demoGuard');
        assert.equal(g.isAllowed('GET', '/api/orders/123'), true);
        assert.equal(g.isAllowed('POST', '/api/orders'), false);
        assert.equal(g.isAllowed('POST', '/api/orders/quote'), true);
        assert.equal(g.isAllowed('PUT', '/api/cart'), true);
        assert.equal(g.isAllowed('POST', '/api/me/uploads'), false);
        assert.equal(g.isAllowed('POST', '/api/shop/anything'), false);
    });

    test('no real SMS goes to the demo number', async () => {
        const { token } = await admin();
        await setDemo(token, { phone: PHONE, otp: OTP });
        const r = await smsAdapter.send({ to: PHONE, text: 'hello', purpose: 'order', tenant: null });
        assert.equal(r.providerMessageId, 'demo-skipped');
    });
});
