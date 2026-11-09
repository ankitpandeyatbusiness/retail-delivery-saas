require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const adminAlerts = require('../src/services/adminAlerts');
const alertSmsRotation = require('../src/services/alertSmsRotation');
const center = require('../src/notifications/center');
const rules = require('../src/notifications/rules');
const smsChannel = require('../src/notifications/channels/sms');
const pushAdapter = require('../src/services/adapters/push');
const smsAdapter = require('../src/services/adapters/sms');
const wallet = require('../src/services/smsWalletService');
const AdminDevice = require('../src/models/AdminDevice');
const PlatformSettings = require('../src/models/PlatformSettings');
const PlatformSmsCost = require('../src/models/PlatformSmsCost');
const Notification = require('../src/models/Notification');
const NotificationRule = require('../src/models/NotificationRule');
const SmsTransaction = require('../src/models/SmsTransaction');
const SmsWallet = require('../src/models/SmsWallet');
const { makeTenant, makeWorld, makeSuperAdmin } = require('./helpers/factory');

const ADMIN_PHONE = '9000000099';
// a LIVE shop: only live shops can pay for an alert SMS
const makeLive = (slug, extra = {}) => makeTenant(slug, { ...extra, billing: { state: 'active', isLive: true, ...(extra.billing || {}) } });
const actor = { type: 'system' };
const enableSms = (extra = {}) => PlatformSettings.findByIdAndUpdate(
    'main', { $set: { 'alerts.smsToAdmin': true, 'alerts.phone': ADMIN_PHONE, ...extra } }, { upsert: true },
);
const fund = (tenant, paise) => wallet.credit({ tenantId: tenant._id, amountPaise: paise, type: 'adjust', note: 'test', actor });
const balance = async (tenant) => (await SmsWallet.findOne({ tenantId: tenant._id })).balancePaise;
const smsSpy = () => mock.method(smsAdapter, 'send', async () => ({ providerMessageId: 'p1' }));
const pushSpy = (r = { sent: 1, invalidTokens: [] }) => mock.method(pushAdapter, 'send', async () => r);
const rotate = () => alertSmsRotation.send({ phone: ADMIN_PHONE, text: 'Platform alert: test', eventKey: 'admin_plan_ended' });

describe('superadmin alerts', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(async () => {
        await db.clear();
        wallet.refreshPlatform();
        rules.invalidate();
        process.env.SMS_WALLET_IN_MOCK = 'true';   // the wallet really charges, even in mock SMS mode
    });
    afterEach(() => {
        mock.restoreAll();
        delete process.env.SMS_WALLET_IN_MOCK;
    });

    test('an alert is saved in the superadmin inbox and pushed to his phones', async () => {
        const w = await makeWorld('adm-inbox');
        const token = 't'.repeat(30);
        await AdminDevice.create({ adminId: new mongoose.Types.ObjectId(), token, platform: 'android' });
        const push = pushSpy();
        const doc = await adminAlerts.alert('admin_plan_ending', { tenantId: w.tenant._id, vars: { summary: 'Plan ends on 20 Nov' } });
        assert.equal(doc.role, 'superadmin');
        assert.equal(doc.type, 'admin_plan_ending');
        assert.equal(doc.title, `${w.tenant.name}: plan ending`);   // the shop is named in the title
        assert.ok(doc.body.includes('Plan ends on 20 Nov'));
        assert.equal(String(doc.tenantId), String(w.tenant._id));
        assert.equal(push.mock.calls.length, 1);
        assert.deepEqual(push.mock.calls[0].arguments[0].tokens, [token]);
    });

    test('dead push tokens are removed', async () => {
        const w = await makeWorld('adm-dead');
        const token = 'd'.repeat(30);
        await AdminDevice.create({ adminId: new mongoose.Types.ObjectId(), token });
        pushSpy({ sent: 0, invalidTokens: [token] });
        await adminAlerts.alert('admin_plan_ended', { tenantId: w.tenant._id });
        assert.equal(await AdminDevice.countDocuments({ token }), 0);
    });

    test('an unknown alert key sends nothing, a rule can switch an alert off', async () => {
        const w = await makeWorld('adm-off');
        pushSpy();
        assert.equal(await adminAlerts.alert('admin_does_not_exist', { tenantId: w.tenant._id }), null);
        await NotificationRule.create({ eventKey: 'admin_plan_ended', enabled: false });
        rules.invalidate();
        assert.equal(await adminAlerts.alert('admin_plan_ended', { tenantId: w.tenant._id }), null);
        assert.equal(await Notification.countDocuments({ role: 'superadmin' }), 0);
    });

    test('the SMS switch is OFF by default: no SMS at all', async () => {
        const w = await makeWorld('adm-sms-off');
        await fund(w.tenant, 20000);
        pushSpy();
        const sms = smsSpy();
        await adminAlerts.alert('admin_plan_ended', { tenantId: w.tenant._id });
        assert.equal(sms.mock.calls.length, 0);
    });

    test('with the switch on: critical alerts go by SMS, others only if allEvents is on', async () => {
        const w = await makeWorld('adm-sms-on');
        await fund(w.tenant, 20000);
        await enableSms();
        pushSpy();
        const sms = smsSpy();

        await adminAlerts.alert('admin_plan_ended', { tenantId: w.tenant._id, vars: { summary: 'S1' } });
        assert.equal(sms.mock.calls.length, 0);                      // not critical

        await adminAlerts.alert('admin_sms_provider_empty', { vars: { amount: 'Rs 10' } });
        assert.equal(sms.mock.calls.length, 1);
        const arg = sms.mock.calls[0].arguments[0];
        assert.equal(arg.to, ADMIN_PHONE);
        assert.match(arg.text, /^Platform alert: SMS balance almost empty: add . Open your panel/);

        await PlatformSettings.updateOne({ _id: 'main' }, { $set: { 'alerts.allEvents': true } });
        await adminAlerts.alert('admin_plan_ended', { tenantId: w.tenant._id, vars: { summary: 'S1' } });
        assert.equal(sms.mock.calls.length, 2);
    });

    test('the platform pays every alert SMS: shop wallets are never charged, and each SMS is counted', async () => {
        const shops = [];
        for (const slug of ['rr-a', 'rr-b']) {
            const t = await makeLive(slug);
            await fund(t, 20000);
            shops.push(t);
        }
        const sms = smsSpy();
        for (let i = 0; i < 3; i += 1) assert.equal((await rotate()).mode, 'platform');
        assert.equal(sms.mock.calls.length, 3);
        for (const t of shops) assert.equal(await balance(t), 20000);
        assert.equal(await SmsTransaction.countDocuments({ purpose: 'platform_alert' }), 0);
        const rows = await PlatformSmsCost.find({}).lean();
        assert.equal(rows.length, 3);
        assert.equal(rows[0].costPaise, 20);
        assert.equal(rows[0].phoneMasked, '90XXXXXX99');
    });

    test('a failed SMS saves no cost and charges nobody', async () => {
        const a = await makeLive('fail-a');
        await fund(a, 20000);
        mock.method(smsAdapter, 'send', async () => { throw new Error('provider down'); });
        const r = await rotate();
        assert.equal(r.mode, 'failed');
        assert.equal(await balance(a), 20000);
        assert.equal(await PlatformSmsCost.countDocuments({}), 0);
    });

    test('in mock SMS mode nobody is charged, the SMS is only printed', async () => {
        const a = await makeLive('mock-a');
        await fund(a, 20000);
        delete process.env.SMS_WALLET_IN_MOCK;
        const sms = smsSpy();
        const r = await rotate();
        assert.equal(r.mode, 'mock');
        assert.equal(sms.mock.calls.length, 1);
        assert.equal(await balance(a), 20000);
        assert.equal(await PlatformSmsCost.countDocuments({}), 0);
    });

    test('customer and rider events never alert the superadmin', async () => {
        const w = await makeWorld('adm-quiet');
        pushSpy();
        mock.method(smsChannel, 'send', async () => ({ sent: false }));
        await center.notify('order_status', {
            tenantId: w.tenant._id, userId: w.customer.user._id,
            vars: { orderNo: 1, status: 'accepted' }, data: { status: 'accepted' },
        });
        await center.notify('order_new', { tenantId: w.tenant._id, vars: { orderNo: 2, total: 100, orderType: 'delivery' }, data: { orderNo: 2 } });
        assert.equal(await Notification.countDocuments({ role: 'superadmin' }), 0);
    });

    test('the top-up and SMS balance events reach the superadmin', async () => {
        const w = await makeWorld('adm-events');
        pushSpy();
        mock.method(smsChannel, 'send', async () => ({ sent: false }));
        await center.notify('sms_topup_done', { tenantId: w.tenant._id, title: 'Added', data: { amountPaise: 20000 } });
        await center.notify('sms_low', { tenantId: w.tenant._id, title: 'Low' });
        await center.notify('sms_zero', { tenantId: w.tenant._id, title: 'Zero' });
        const types = (await Notification.find({ role: 'superadmin' }).lean()).map((n) => n.type).sort();
        assert.deepEqual(types, ['admin_sms_low', 'admin_sms_topup_done', 'admin_sms_zero']);
        const topup = await Notification.findOne({ type: 'admin_sms_topup_done' });
        assert.ok(topup.title.includes(w.tenant.name));
    });
});

describe('superadmin alert routes', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(async () => { await db.clear(); wallet.refreshPlatform(); rules.invalidate(); });
    afterEach(() => mock.restoreAll());

    const auth = (token) => ({ Authorization: `Bearer ${token}` });

    test('nobody without a superadmin token can use them', async () => {
        assert.equal((await request(app).put('/api/admin/platform/alerts').send({ allEvents: true })).status, 401);
        assert.equal((await request(app).post('/api/admin/devices').send({ token: 'x'.repeat(30) })).status, 401);
        assert.equal((await request(app).get('/api/admin/alerts/sms-cost')).status, 401);
    });

    test('the SMS switch needs a valid phone and answers with the new state', async () => {
        const { token } = await makeSuperAdmin();
        const put = (body) => request(app).put('/api/admin/platform/alerts').set(auth(token)).send(body);
        assert.equal((await put({})).status, 400);
        assert.equal((await put({ smsToAdmin: 'yes' })).status, 400);
        assert.equal((await put({ phone: '12345' })).status, 400);
        assert.equal((await put({ smsToAdmin: true })).status, 400);          // no phone yet
        const ok = await put({ smsToAdmin: true, phone: ADMIN_PHONE });
        assert.equal(ok.status, 200);
        assert.deepEqual(ok.body.alerts, { smsToAdmin: true, allEvents: false, phone: ADMIN_PHONE });
        assert.equal((await put({ phone: '' })).status, 400);                 // the switch is on, so the phone cannot be removed
        const off = await put({ smsToAdmin: false, phone: '' });
        assert.equal(off.status, 200);
        assert.deepEqual(off.body.alerts, { smsToAdmin: false, allEvents: false, phone: null });
    });

    test('push devices: register, repeat, remove, keep the newest 10', async () => {
        const { token } = await makeSuperAdmin();
        const post = (path, body) => request(app).post(path).set(auth(token)).send(body);
        assert.equal((await post('/api/admin/devices', { token: 'short' })).status, 400);
        assert.equal((await post('/api/admin/devices', { token: 'a'.repeat(30), platform: 'tv' })).status, 400);
        assert.equal((await post('/api/admin/devices', { token: 'a'.repeat(30), platform: 'android' })).status, 201);
        assert.equal((await post('/api/admin/devices', { token: 'a'.repeat(30) })).status, 201);   // repeat is fine
        assert.equal(await AdminDevice.countDocuments({}), 1);
        for (let i = 0; i < 12; i += 1) await post('/api/admin/devices', { token: String(i).padStart(30, '0') });
        assert.equal(await AdminDevice.countDocuments({}), 10);
        const gone = String(11).padStart(30, '0');
        assert.equal((await post('/api/admin/devices/remove', { token: gone })).status, 200);
        assert.equal(await AdminDevice.countDocuments({ token: gone }), 0);
    });

    test('the cost list shows what the platform paid, split into alerts and login OTPs', async () => {
        const { token } = await makeSuperAdmin();
        process.env.SMS_WALLET_IN_MOCK = 'true';
        try {
            const a = await makeLive('cost-a');
            await fund(a, 20000);
            smsSpy();
            await rotate();                                              // the platform pays, never shop a
            await PlatformSmsCost.create({ eventKey: 'admin_login_otp', costPaise: 20, phoneMasked: '90XXXXXX99' });
        } finally {
            delete process.env.SMS_WALLET_IN_MOCK;
        }
        const res = await request(app).get('/api/admin/alerts/sms-cost').set(auth(token));
        assert.equal(res.status, 200);
        assert.equal(res.body.shops.count, 0);
        assert.equal(res.body.alerts.count, 1);
        assert.equal(res.body.loginOtp.count, 1);
        assert.equal(res.body.platform.count, 2);
        assert.equal(res.body.platform.costPaise, 40);
        assert.equal((await request(app).get('/api/admin/alerts/sms-cost?from=nope').set(auth(token))).status, 400);
    });

    test('the inbox route shows the alert with its shop name', async () => {
        const { token } = await makeSuperAdmin();
        const w = await makeWorld('adm-route');
        mock.method(pushAdapter, 'send', async () => ({ sent: 0, invalidTokens: [] }));
        await adminAlerts.alert('admin_shop_first_order', { tenantId: w.tenant._id });
        const res = await request(app).get('/api/admin/notifications').set(auth(token));
        assert.equal(res.status, 200);
        assert.equal(res.body.items[0].type, 'admin_shop_first_order');
        assert.equal(res.body.items[0].shop.name, w.tenant.name);
        assert.equal(res.body.unreadCount, 1);
    });
});