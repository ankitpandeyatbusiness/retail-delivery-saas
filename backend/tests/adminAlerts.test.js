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
const SubscriptionInvoice = require('../src/models/SubscriptionInvoice');
const { makeTenant, makeWorld, makeSuperAdmin } = require('./helpers/factory');

const ADMIN_PHONE = '9000000099';
const actor = { type: 'system' };
const enableSms = (extra = {}) => PlatformSettings.findByIdAndUpdate(
    'main', { $set: { 'alerts.smsToAdmin': true, 'alerts.phone': ADMIN_PHONE, ...extra } }, { upsert: true },
);
const fund = (tenant, paise) => wallet.credit({ tenantId: tenant._id, amountPaise: paise, type: 'adjust', note: 'test', actor });
const balance = async (tenant) => (await SmsWallet.findOne({ tenantId: tenant._id })).balancePaise;
const smsSpy = () => mock.method(smsAdapter, 'send', async () => ({ providerMessageId: 'p1' }));
const pushSpy = (r = { sent: 1, invalidTokens: [] }) => mock.method(pushAdapter, 'send', async () => r);
const rotate = () => alertSmsRotation.send({ phone: ADMIN_PHONE, text: 'Platform alert: test', eventKey: 'admin_shop_paused' });

let invoiceSeq = 0;
const makeInvoice = (tenant) => SubscriptionInvoice.create({
    tenantId: tenant._id, kind: 'custom', invoiceNo: `SUB/2026-27/${String(++invoiceSeq + 70).padStart(4, '0')}`,
    issueDate: new Date(), dueDate: new Date(Date.now() + 7 * 86400000), graceEndsAt: new Date(Date.now() + 5 * 86400000),
    description: 'Setup', lineItems: [{ description: 'Setup', qty: 1, rate: 1000, amount: 1000 }],
    baseAmount: 1000, gstPercent: 18, gstAmount: 180, total: 1180,
    seller: { legalName: 'Acme Pvt Ltd' }, buyer: { legalName: tenant.name },
});

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
        const doc = await adminAlerts.alert('admin_bill_issued', { tenantId: w.tenant._id, vars: { invoiceNo: 'SUB/2026-27/0001', amount: '1180' } });
        assert.equal(doc.role, 'superadmin');
        assert.equal(doc.type, 'admin_bill_issued');
        assert.equal(doc.title, 'Bill issued');
        assert.ok(doc.body.includes(w.tenant.name) && doc.body.includes('SUB/2026-27/0001'));
        assert.equal(String(doc.tenantId), String(w.tenant._id));
        assert.equal(push.mock.calls.length, 1);
        assert.deepEqual(push.mock.calls[0].arguments[0].tokens, [token]);
    });

    test('dead push tokens are removed', async () => {
        const w = await makeWorld('adm-dead');
        const token = 'd'.repeat(30);
        await AdminDevice.create({ adminId: new mongoose.Types.ObjectId(), token });
        pushSpy({ sent: 0, invalidTokens: [token] });
        await adminAlerts.alert('admin_shop_paused', { tenantId: w.tenant._id });
        assert.equal(await AdminDevice.countDocuments({ token }), 0);
    });

    test('the invoice number is found from the invoice id', async () => {
        const w = await makeWorld('adm-invoice');
        const inv = await makeInvoice(w.tenant);
        pushSpy();
        const doc = await adminAlerts.alert('admin_bill_paid', { tenantId: w.tenant._id, data: { invoiceId: String(inv._id) } });
        assert.ok(doc.body.includes(inv.invoiceNo));
    });

    test('an unknown alert key sends nothing, a rule can switch an alert off', async () => {
        const w = await makeWorld('adm-off');
        pushSpy();
        assert.equal(await adminAlerts.alert('admin_does_not_exist', { tenantId: w.tenant._id }), null);
        await NotificationRule.create({ eventKey: 'admin_shop_paused', enabled: false });
        rules.invalidate();
        assert.equal(await adminAlerts.alert('admin_shop_paused', { tenantId: w.tenant._id }), null);
        assert.equal(await Notification.countDocuments({ role: 'superadmin' }), 0);
    });

    test('the SMS switch is OFF by default: no SMS at all', async () => {
        const w = await makeWorld('adm-sms-off');
        await fund(w.tenant, 20000);
        pushSpy();
        const sms = smsSpy();
        await adminAlerts.alert('admin_shop_paused', { tenantId: w.tenant._id });
        assert.equal(sms.mock.calls.length, 0);
    });

    test('with the switch on: critical alerts go by SMS, others only if allEvents is on', async () => {
        const w = await makeWorld('adm-sms-on');
        await fund(w.tenant, 20000);
        await enableSms();
        pushSpy();
        const sms = smsSpy();

        await adminAlerts.alert('admin_bill_issued', { tenantId: w.tenant._id, vars: { invoiceNo: 'S1', amount: '1' } });
        assert.equal(sms.mock.calls.length, 0);                      // not critical

        await adminAlerts.alert('admin_shop_paused', { tenantId: w.tenant._id });
        assert.equal(sms.mock.calls.length, 1);
        const arg = sms.mock.calls[0].arguments[0];
        assert.equal(arg.to, ADMIN_PHONE);
        assert.match(arg.text, /^Platform alert: Shop paused: Shop adm-sms-on\. Open your panel/);

        await PlatformSettings.updateOne({ _id: 'main' }, { $set: { 'alerts.allEvents': true } });
        await adminAlerts.alert('admin_bill_issued', { tenantId: w.tenant._id, vars: { invoiceNo: 'S1', amount: '1' } });
        assert.equal(sms.mock.calls.length, 2);
    });

    test('shops pay alert SMS in turns, and the turn wraps around', async () => {
        const shops = [];
        for (const slug of ['rr-a', 'rr-b', 'rr-c']) {
            const t = await makeTenant(slug);
            await fund(t, 20000);
            shops.push(t);
        }
        smsSpy();
        const paid = [];
        for (let i = 0; i < 4; i += 1) paid.push((await rotate()).tenantId);
        assert.deepEqual(paid.map(String), [shops[0], shops[1], shops[2], shops[0]].map((t) => String(t._id)));
        assert.equal(await balance(shops[0]), 20000 - 60);
        assert.equal(await balance(shops[1]), 20000 - 30);
        assert.equal(await balance(shops[2]), 20000 - 30);
        const debit = await SmsTransaction.findOne({ tenantId: shops[0]._id, type: 'debit' });
        assert.equal(debit.purpose, 'platform_alert');
        for (const t of shops) assert.equal((await wallet.reconcileWallet(t._id)).differencePaise, 0);
    });

    test('a shop that would fall below its low-balance level is skipped', async () => {
        const [a, b, c] = [await makeTenant('lo-a'), await makeTenant('lo-b'), await makeTenant('lo-c')];
        await fund(a, 20000);
        await fund(b, 5020);          // after one SMS it would be 4990, below the Rs 50 level
        await fund(c, 20000);
        smsSpy();
        assert.equal(String((await rotate()).tenantId), String(a._id));
        assert.equal(String((await rotate()).tenantId), String(c._id));   // b is skipped
        assert.equal(String((await rotate()).tenantId), String(a._id));
        assert.equal(await balance(b), 5020);
    });

    test('a suspended shop and a shop paused for rent never pay', async () => {
        const a = await makeTenant('sk-a', { status: 'suspended' });
        const b = await makeTenant('sk-b', { billing: { state: 'paused' } });
        const c = await makeTenant('sk-c');
        for (const t of [a, b, c]) await fund(t, 20000);
        smsSpy();
        assert.equal(String((await rotate()).tenantId), String(c._id));
        assert.equal(await balance(a), 20000);
        assert.equal(await balance(b), 20000);
    });

    test('when no shop can pay, the platform pays and the cost is saved', async () => {
        const a = await makeTenant('pp-a');
        const b = await makeTenant('pp-b');
        await fund(a, 5000);
        await fund(b, 5000);
        const sms = smsSpy();
        const r = await rotate();
        assert.equal(r.mode, 'platform');
        assert.equal(sms.mock.calls.length, 1);
        const rows = await PlatformSmsCost.find({}).lean();
        assert.equal(rows.length, 1);
        assert.equal(rows[0].costPaise, 20);
        assert.equal(rows[0].phoneMasked, '90XXXXXX99');
        assert.equal(await SmsTransaction.countDocuments({ purpose: 'platform_alert' }), 0);
        assert.equal(await balance(a), 5000);
    });

    test('a failed SMS gives the shop its money back and saves no cost', async () => {
        const a = await makeTenant('fail-a');
        await fund(a, 20000);
        mock.method(smsAdapter, 'send', async () => { throw new Error('provider down'); });
        const r = await rotate();
        assert.equal(r.mode, 'failed');
        assert.equal(await balance(a), 20000);
        assert.equal((await wallet.reconcileWallet(a._id)).differencePaise, 0);
        assert.equal(await SmsTransaction.countDocuments({ tenantId: a._id, type: 'refund' }), 1);
        assert.equal(await PlatformSmsCost.countDocuments({}), 0);
    });

    test('in mock SMS mode nobody is charged, the SMS is only printed', async () => {
        const a = await makeTenant('mock-a');
        await fund(a, 20000);
        delete process.env.SMS_WALLET_IN_MOCK;
        const sms = smsSpy();
        const r = await rotate();
        assert.equal(r.mode, 'mock');
        assert.equal(sms.mock.calls.length, 1);
        assert.equal(await balance(a), 20000);
        assert.equal(await PlatformSmsCost.countDocuments({}), 0);
    });

    test('an owner event also alerts the superadmin, even when the owner rule is off', async () => {
        const w = await makeWorld('adm-hook');
        const inv = await makeInvoice(w.tenant);
        pushSpy();
        mock.method(smsChannel, 'send', async () => ({ sent: false }));
        await NotificationRule.create({ eventKey: 'bill_issued', enabled: false });   // the owner hears nothing
        rules.invalidate();
        await center.notify('bill_issued', { tenantId: w.tenant._id, title: 'New bill', data: { invoiceId: String(inv._id) } });
        assert.equal(await Notification.countDocuments({ tenantId: w.tenant._id, role: 'owner' }), 0);
        const admin = await Notification.findOne({ role: 'superadmin', type: 'admin_bill_issued' });
        assert.ok(admin);
        assert.ok(admin.body.includes(w.tenant.name) && admin.body.includes(inv.invoiceNo));
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
        assert.ok(topup.body.includes('Rs 200.00'));
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

    test('the cost list shows what the shops paid and what the platform paid', async () => {
        const { token } = await makeSuperAdmin();
        process.env.SMS_WALLET_IN_MOCK = 'true';
        try {
            const a = await makeTenant('cost-a');
            await fund(a, 20000);
            smsSpy();
            await rotate();                                              // charged to shop a
            await SmsWallet.updateOne({ tenantId: a._id }, { $set: { balancePaise: 100 } });   // now below its level
            await rotate();                                              // the platform pays
        } finally {
            delete process.env.SMS_WALLET_IN_MOCK;
        }
        const res = await request(app).get('/api/admin/alerts/sms-cost').set(auth(token));
        assert.equal(res.status, 200);
        assert.equal(res.body.shops.count, 1);
        assert.equal(res.body.shops.chargedPaise, 30);
        assert.equal(res.body.platform.count, 1);
        assert.equal(res.body.platform.costPaise, 20);
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