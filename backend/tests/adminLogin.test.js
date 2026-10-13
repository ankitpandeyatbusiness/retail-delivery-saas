require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const SuperAdmin = require('../src/models/SuperAdmin');
const AdminOtp = require('../src/models/AdminOtp');
const PlatformSmsCost = require('../src/models/PlatformSmsCost');
const smsAdapter = require('../src/services/adapters/sms');

let n = 0;
let sent;
const newPhone = () => `98765${String(10000 + ++n)}`;
async function adminWith(phones, extra = {}) {
    const { admin, token } = await f.makeSuperAdmin(`root${++n}@test.com`);
    await SuperAdmin.updateOne({ _id: admin._id }, { $set: { phones, ...extra } });
    return { admin, token };
}
const sendOtp = (phone) => request(app).post('/api/admin/auth/send-otp').send({ phone });
const verify = (phone, otp) => request(app).post('/api/admin/auth/verify-otp').send({ phone, otp });
const wrongFor = (otp) => (otp === '000000' ? '111111' : '000000');

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    sent = [];
    mock.method(smsAdapter, 'sendOtp', async (a) => { sent.push(a); return { providerMessageId: 't' }; });
});
afterEach(() => {
    mock.restoreAll();
    delete process.env.SUPERADMIN_OTP_CONSOLE;
    delete process.env.SUPERADMIN_PASSWORD_LOGIN;
    delete process.env.SMS_WALLET_IN_MOCK;
});

describe('superadmin phone OTP login', () => {
    test('a phone that is not registered gets the same answer and no SMS', async () => {
        const phone = newPhone();
        const res = await sendOtp(phone);
        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.equal(sent.length, 0);
        assert.equal(await AdminOtp.countDocuments({}), 0);
    });

    test('registered phone: OTP is sent, verify gives a token that works', async () => {
        const phone = newPhone();
        await adminWith([phone]);
        assert.equal((await sendOtp(phone)).status, 200);
        assert.equal(sent.length, 1);
        assert.match(sent[0].otp, /^\d{6}$/);

        const res = await verify(phone, sent[0].otp);
        assert.equal(res.status, 200);
        assert.ok(res.body.token);
        const meRes = await request(app).get('/api/admin/me').set('Authorization', `Bearer ${res.body.token}`);
        assert.equal(meRes.status, 200);
    });

    test('wrong OTP is refused, and the right OTP works only once', async () => {
        const phone = newPhone();
        await adminWith([phone]);
        await sendOtp(phone);
        const otp = sent[0].otp;
        assert.equal((await verify(phone, wrongFor(otp))).status, 400);
        assert.equal((await verify(phone, otp)).status, 200);
        assert.equal((await verify(phone, otp)).status, 400);
    });

    test('after 5 wrong tries even the right OTP is refused', async () => {
        const phone = newPhone();
        await adminWith([phone]);
        await sendOtp(phone);
        const otp = sent[0].otp;
        for (let i = 0; i < 5; i += 1) assert.equal((await verify(phone, wrongFor(otp))).status, 400);
        assert.equal((await verify(phone, otp)).status, 400);
    });

    test('verify for an unknown phone gives the same 400', async () => {
        const res = await verify(newPhone(), '123456');
        assert.equal(res.status, 400);
        assert.equal(res.body.error, 'Invalid or expired OTP');
    });

    test('a second send within 30 seconds is stopped', async () => {
        const phone = newPhone();
        await adminWith([phone]);
        assert.equal((await sendOtp(phone)).status, 200);
        const second = await sendOtp(phone);
        assert.equal(second.status, 429);
        assert.equal(sent.length, 1);
    });

    test('a switched-off superadmin gets no OTP', async () => {
        const phone = newPhone();
        await adminWith([phone], { isActive: false });
        await sendOtp(phone);
        assert.equal(sent.length, 0);
    });

    test('console mode prints the OTP and sends no SMS', async () => {
        process.env.SUPERADMIN_OTP_CONSOLE = 'true';
        const lines = [];
        mock.method(console, 'log', (...a) => { lines.push(a.join(' ')); });
        const phone = newPhone();
        await adminWith([phone]);
        await sendOtp(phone);
        assert.equal(sent.length, 0);
        const line = lines.find((l) => l.includes('[ADMIN OTP]') && l.includes(phone));
        assert.ok(line);
        const otp = line.match(/: (\d{6})/)[1];
        assert.equal((await verify(phone, otp)).status, 200);
    });

    test('real SMS mode writes a platform cost row', async () => {
        process.env.SMS_WALLET_IN_MOCK = 'true';
        const phone = newPhone();
        await adminWith([phone]);
        await sendOtp(phone);
        assert.equal(sent.length, 1);
        const rows = await PlatformSmsCost.find({}).lean();
        assert.equal(rows.length, 1);
        assert.equal(rows[0].eventKey, 'admin_login_otp');
    });

    test('a failed SMS gives 503 and the OTP cannot be used', async () => {
        mock.restoreAll();
        mock.method(smsAdapter, 'sendOtp', async () => { throw new Error('provider down'); });
        const phone = newPhone();
        await adminWith([phone]);
        assert.equal((await sendOtp(phone)).status, 503);
        assert.equal(await AdminOtp.countDocuments({ consumed: false }), 0);
    });
});

describe('superadmin password login and phones', () => {
    test('a superadmin without a password can be saved', async () => {
        const a = await new SuperAdmin({ email: `nopass${++n}@test.com`, phones: [newPhone()] }).save();
        assert.ok(a._id);
    });

    test('password login is off by default and works when switched on', async () => {
        const { admin } = await adminWith([]);
        const acc = await SuperAdmin.findById(admin._id);
        await acc.setPassword('a-long-password-1');
        await acc.save();
        const body = { email: acc.email, password: 'a-long-password-1' };

        const off = await request(app).post('/api/admin/auth/login').send(body);
        assert.equal(off.status, 403);
        process.env.SUPERADMIN_PASSWORD_LOGIN = 'true';
        const on = await request(app).post('/api/admin/auth/login').send(body);
        assert.equal(on.status, 200);
        assert.ok(on.body.token);
    });

    test('phones can be changed with a fresh OTP of a current phone', async () => {
        const p1 = newPhone();
        const p2 = newPhone();
        const { admin, token } = await adminWith([p1]);
        await sendOtp(p1);
        const res = await request(app).put('/api/admin/me/phones').set('Authorization', `Bearer ${token}`)
            .send({ phones: [p1, p2], verifyPhone: p1, otp: sent[0].otp });
        assert.equal(res.status, 200);
        const after2 = await SuperAdmin.findById(admin._id).lean();
        assert.deepEqual(after2.phones, [p1, p2]);
    });

    test('phones cannot be changed with a wrong OTP, too many numbers, or a number of another admin', async () => {
        const p1 = newPhone();
        const { token } = await adminWith([p1]);
        const put = (b) => request(app).put('/api/admin/me/phones').set('Authorization', `Bearer ${token}`).send(b);
        assert.equal((await put({ phones: [newPhone()], verifyPhone: p1, otp: '123456' })).status, 400);
        assert.equal((await put({ phones: [newPhone(), newPhone(), newPhone()], verifyPhone: p1, otp: '123456' })).status, 400);

        const p9 = newPhone();
        await adminWith([p9]);
        const p5 = newPhone();
        const second = await adminWith([p5]);
        await sendOtp(p5);
        const res = await request(app).put('/api/admin/me/phones').set('Authorization', `Bearer ${second.token}`)
            .send({ phones: [p9], verifyPhone: p5, otp: sent[0].otp });
        assert.equal(res.status, 409);
    });
});