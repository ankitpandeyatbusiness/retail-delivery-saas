require('./helpers/env');
const { test, describe, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const request = require('supertest');
const db = require('./helpers/db');
const { makeWorld, makeSuperAdmin } = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;

process.env.SECRETS_KEY = process.env.SECRETS_KEY || crypto.randomBytes(32).toString('base64');
const Tenant = require('../src/models/Tenant');
const SmsLog = require('../src/models/SmsLog');
const SmsWallet = require('../src/models/SmsWallet');
const smsAdapter = require('../src/services/adapters/sms');
const smsConfig = require('../src/services/smsConfig');
const wallet = require('../src/services/smsWalletService');

const OWN_KEY = 'own-provider-key-123456';
let admin;
const api = (tid) => `/api/admin/tenants/${tid}/sms-provider`;
const put = (tid, body) => request(app).put(api(tid)).set('Authorization', `Bearer ${admin.token}`).send(body);
const fullOwn = (extra = {}) => ({ own: { enabled: true, senderId: 'shopaa', entityId: '1101234567890', authKey: OWN_KEY, templateIds: { otp: '1107000000001', order_new: '1107000000002' }, ...extra } });

let fetchMock;
let lastCall;
const fakeFetch = (reply = { ok: true, status: 200, text: async () => 'req-777' }) => {
    fetchMock = mock.method(globalThis, 'fetch', async (url, opts) => {
        lastCall = { url: String(url), body: new URLSearchParams(String(opts.body)) };
        return reply;
    });
};
const sendOtpTo = (w, extra = {}) => smsAdapter.send({ to: '9876543210', text: 'OTP 123456', purpose: 'otp', tenant: { _id: w.tenant._id, name: w.tenant.name }, templateKey: 'otp', ...extra });

describe('H4 per-shop SMS provider', () => {
    before(async () => {
        await db.connect();
        admin = await makeSuperAdmin('h4sms@test.in');
    });
    after(() => db.disconnect());
    beforeEach(() => {
        process.env.SMS_MOCK = 'false';
        process.env.SMS_AUTH_KEY = 'PLATKEY-123456';
        process.env.SMS_SENDER_ID = 'PLATFM';
        process.env.SMS_DEFAULT_TEMPLATE_ID = '1111111111';
        delete process.env.SMS_TEMPLATE_OTP;
        smsConfig.invalidate();
        lastCall = null;
    });
    afterEach(() => {
        process.env.SMS_MOCK = 'true';
        delete process.env.SMS_WALLET_IN_MOCK;
        mock.restoreAll();
    });

    test('the superadmin saves the own sender; keys are encrypted and never come back', async () => {
        const w = await makeWorld('h4s-set');
        const tid = String(w.tenant._id);
        const r = await put(tid, fullOwn());
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.own.enabled, true);
        assert.equal(r.body.own.senderId, 'SHOPAA');
        assert.equal(r.body.own.hasKeys, true);
        assert.ok(!JSON.stringify(r.body).includes(OWN_KEY));

        const raw = await Tenant.findById(w.tenant._id).select('+sms.own.providerKeysEnc').lean();
        assert.match(raw.sms.own.providerKeysEnc, /^v1:/);
        assert.ok(!raw.sms.own.providerKeysEnc.includes(OWN_KEY));
        const plain = await Tenant.findById(w.tenant._id).lean();          // normal reads do not carry it
        assert.equal(plain.sms.own.providerKeysEnc, undefined);

        const g = await request(app).get(api(tid)).set('Authorization', `Bearer ${admin.token}`);
        assert.equal(g.status, 200);
        assert.equal(g.body.own.hasKeys, true);
        assert.ok(!JSON.stringify(g.body).includes(OWN_KEY));
    });

    test('bad input is refused, a half-ready sender cannot be switched on, and a login is needed', async () => {
        const w = await makeWorld('h4s-bad');
        const tid = String(w.tenant._id);
        assert.equal((await put(tid, { own: { senderId: 'ab' } })).status, 400);
        assert.equal((await put(tid, { own: { entityId: 'xx' } })).status, 400);
        assert.equal((await put(tid, { own: { templateIds: { 'Bad Key': '1107000000001' } } })).status, 400);
        assert.equal((await put(tid, { own: { templateIds: { otp: 'abc' } } })).status, 400);
        assert.equal((await put(tid, { templateId: 'abc' })).status, 400);
        assert.equal((await put(tid, {})).status, 400);
        assert.equal((await put(tid, { own: { enabled: true } })).status, 400);       // nothing saved yet
        const ok = await put(tid, fullOwn({ enabled: false }));
        assert.equal(ok.status, 200);
        assert.equal((await put(tid, { own: { enabled: true, authKey: null } })).status, 400);   // keys removed
        const anon = await request(app).put(api(tid)).send(fullOwn());
        assert.equal(anon.status, 401);
    });

    test('an OTP of a shop with its own sender goes out with the shop keys, sender and template', async () => {
        const w = await makeWorld('h4s-own');
        assert.equal((await put(String(w.tenant._id), fullOwn())).status, 200);
        fakeFetch();
        const r = await sendOtpTo(w);
        assert.equal(r.providerMessageId, 'req-777');
        assert.equal(fetchMock.mock.calls.length, 1);
        assert.equal(lastCall.body.get('authkey'), OWN_KEY);
        assert.equal(lastCall.body.get('sender'), 'SHOPAA');
        assert.equal(lastCall.body.get('DLT_TE_ID'), '1107000000001');
        assert.equal(lastCall.body.get('mobiles'), '919876543210');
        assert.ok(!lastCall.url.includes(OWN_KEY));            // the key is in the body, not in the web address
    });

    test('a shop without its own sender uses the platform sender; the shop template wins, then the message template, then the default', async () => {
        const w = await makeWorld('h4s-plat');
        fakeFetch();
        await sendOtpTo(w);
        assert.equal(lastCall.body.get('authkey'), 'PLATKEY-123456');
        assert.equal(lastCall.body.get('sender'), 'PLATFM');
        assert.equal(lastCall.body.get('DLT_TE_ID'), '1111111111');

        process.env.SMS_TEMPLATE_OTP = '3333333333';
        await sendOtpTo(w);
        assert.equal(lastCall.body.get('DLT_TE_ID'), '3333333333');

        assert.equal((await put(String(w.tenant._id), { templateId: '2222222222' })).status, 200);
        await sendOtpTo(w);
        assert.equal(lastCall.body.get('DLT_TE_ID'), '2222222222');
        assert.equal(lastCall.body.get('authkey'), 'PLATKEY-123456');      // still the platform sender
    });

    test('bills and platform alerts never use the shop sender, even when it is on', async () => {
        const w = await makeWorld('h4s-alert');
        assert.equal((await put(String(w.tenant._id), fullOwn())).status, 200);
        fakeFetch();
        await sendOtpTo(w, { purpose: 'alert', templateKey: 'alert' });
        assert.equal(lastCall.body.get('authkey'), 'PLATKEY-123456');
        await sendOtpTo(w, { purpose: 'bill', templateKey: 'bill' });
        assert.equal(lastCall.body.get('authkey'), 'PLATKEY-123456');
    });

    test('a refusing provider, a missing template and missing keys all throw', async () => {
        const w = await makeWorld('h4s-fail');
        fakeFetch({ ok: false, status: 500, text: async () => 'error' });
        await assert.rejects(() => sendOtpTo(w), /refused/);
        mock.restoreAll();

        delete process.env.SMS_DEFAULT_TEMPLATE_ID;
        smsConfig.invalidate();
        fakeFetch();
        await assert.rejects(() => sendOtpTo(w), /template/);
        assert.equal(fetchMock.mock.calls.length, 0);

        process.env.SMS_DEFAULT_TEMPLATE_ID = '1111111111';
        delete process.env.SMS_AUTH_KEY;
        await assert.rejects(() => sendOtpTo(w), /not configured/);
    });

    test('own sender: the wallet is not charged, even at zero balance, and the log says so', async () => {
        const w = await makeWorld('h4s-wallet');
        assert.equal((await put(String(w.tenant._id), fullOwn())).status, 200);
        process.env.SMS_WALLET_IN_MOCK = 'true';
        const before = await wallet.getWallet(w.tenant._id);
        const d = await wallet.debitForSms(w.tenant._id, { purpose: 'otp' });
        assert.equal(d.ok, true);
        assert.equal(d.own, true);
        assert.equal(d.chargedPaise, 0);
        assert.equal(d.txnId, null);
        assert.equal((await SmsWallet.findById(before._id)).balancePaise, before.balancePaise);

        await wallet.logSms({ tenantId: w.tenant._id, phone: '9876543210', purpose: 'otp', debit: d, status: 'sent' });
        const log = await SmsLog.findOne({ tenantId: w.tenant._id });
        assert.equal(log.own, true);
        assert.equal(log.chargedPaise, 0);
        assert.equal(log.costPaise, 0);
        assert.equal((await wallet.refund(d.txnId)).ok, true);          // a failed own SMS has nothing to give back
    });

    test('a shop without its own sender still pays, and platform alert SMS still charge an own-sender shop', async () => {
        const plain = await makeWorld('h4s-pay');
        const own = await makeWorld('h4s-pay-own');
        assert.equal((await put(String(own.tenant._id), fullOwn())).status, 200);
        process.env.SMS_WALLET_IN_MOCK = 'true';
        const actor = { type: 'system' };
        for (const w of [plain, own]) await wallet.credit({ tenantId: w.tenant._id, amountPaise: 5000, type: 'adjust', note: 't', actor });

        const a = await wallet.debitForSms(plain.tenant._id, { purpose: 'otp' });
        assert.ok(a.chargedPaise > 0);
        const b = await wallet.debitForSms(own.tenant._id, { purpose: 'platform_alert' });
        assert.ok(b.chargedPaise > 0);
    });

    test('an own sender that is switched on but has no keys saved is ignored: platform sender, normal charge', async () => {
        const w = await makeWorld('h4s-nokeys');
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'sms.own.enabled': true, 'sms.own.senderId': 'SHOPAA', 'sms.own.entityId': '1101234567890' } });
        smsConfig.invalidate();
        process.env.SMS_WALLET_IN_MOCK = 'true';
        await wallet.credit({ tenantId: w.tenant._id, amountPaise: 5000, type: 'adjust', note: 't', actor: { type: 'system' } });
        assert.ok((await wallet.debitForSms(w.tenant._id, { purpose: 'otp' })).chargedPaise > 0);
        fakeFetch();
        await sendOtpTo(w);
        assert.equal(lastCall.body.get('authkey'), 'PLATKEY-123456');
    });
});