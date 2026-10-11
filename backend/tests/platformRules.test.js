require('./helpers/env');
process.env.SMS_WALLET_IN_MOCK = 'true';   // wallets really charge in these tests, even in mock SMS mode
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { enforce, enforceTenant } = require('../src/services/billingEnforcement');
const alertSmsRotation = require('../src/services/alertSmsRotation');
const adminAlerts = require('../src/services/adminAlerts');
const wallet = require('../src/services/smsWalletService');
const rules = require('../src/notifications/rules');
const smsChannel = require('../src/notifications/channels/sms');
const pushChannel = require('../src/notifications/channels/push');
const pushAdapter = require('../src/services/adapters/push');
const smsAdapter = require('../src/services/adapters/sms');
const Tenant = require('../src/models/Tenant');
const Notification = require('../src/models/Notification');
const NotificationRule = require('../src/models/NotificationRule');
const PlatformSettings = require('../src/models/PlatformSettings');
const PlatformSmsCost = require('../src/models/PlatformSmsCost');
const SmsLog = require('../src/models/SmsLog');
const SmsWallet = require('../src/models/SmsWallet');
const SubscriptionInvoice = require('../src/models/SubscriptionInvoice');
const { makeTenant, makeUser, makeSuperAdmin, waitFor, sleep } = require('./helpers/factory');

const DAY = 86400000;
const adminCount = (type, tenantId) => Notification.countDocuments({ role: 'superadmin', type, ...(tenantId && { tenantId }) });
const ownerCount = (type, tenantId) => Notification.countDocuments({ role: 'owner', type, tenantId });
const quiet = () => {
    mock.method(smsChannel, 'send', async () => ({ sent: false }));
    mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
    mock.method(pushAdapter, 'send', async () => ({ sent: 0, invalidTokens: [] }));
};

let invoiceSeq = 0;
const makeInvoice = (tenant, o = {}) => SubscriptionInvoice.create({
    tenantId: tenant._id, kind: 'custom', invoiceNo: `SUB/2026-27/${String(++invoiceSeq + 600).padStart(4, '0')}`,
    issueDate: new Date(), dueDate: new Date(Date.now() + 7 * DAY), graceEndsAt: new Date(Date.now() + 5 * DAY),
    description: 'Setup', lineItems: [{ description: 'Setup', qty: 1, rate: 1000, amount: 1000 }],
    baseAmount: 1000, gstPercent: 0, gstAmount: 0, total: 1000,
    seller: { legalName: 'Acme Pvt Ltd' }, buyer: { legalName: tenant.name }, ...o,
});

describe('a shop that is open again', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(quiet);
    afterEach(() => mock.restoreAll());

    test('paying (no unpaid bill left) tells the owner and the superadmin, once', async () => {
        const t = await makeTenant('pr-unpause', { billing: { state: 'paused' } });
        await makeUser(t, 'admin', '9000000010');

        await enforceTenant(t._id);
        assert.ok(await waitFor(async () => (await ownerCount('shop_unpaused', t._id)) === 1));
        assert.ok(await waitFor(async () => (await adminCount('admin_shop_unpaused', t._id)) === 1));
        assert.notEqual((await Tenant.findById(t._id)).billing.state, 'paused');

        await enforceTenant(t._id);   // already open: nothing more
        await sleep(500);
        assert.equal(await ownerCount('shop_unpaused', t._id), 1);
        assert.equal(await adminCount('admin_shop_unpaused', t._id), 1);
    });

    test('more grace on an unpaid bill also counts as open again (the scheduler path)', async () => {
        const t = await makeTenant('pr-grace', { billing: { state: 'paused' } });
        await makeInvoice(t, { graceEndsAt: new Date(Date.now() + 3 * DAY) });
        await enforce();
        assert.equal((await Tenant.findById(t._id)).billing.state, 'grace');
        assert.ok(await waitFor(async () => (await adminCount('admin_shop_unpaused', t._id)) === 1));

        await enforce();   // nothing changed
        await sleep(400);
        assert.equal(await adminCount('admin_shop_unpaused', t._id), 1);
    });

    test('a shop that goes from free to grace is NOT announced as open again', async () => {
        const t = await makeTenant('pr-notpaused', { billing: { state: 'active' } });
        await makeInvoice(t, { graceEndsAt: new Date(Date.now() + 3 * DAY) });
        await enforce();
        await sleep(500);
        assert.equal(await adminCount('admin_shop_unpaused', t._id), 0);
        assert.equal(await ownerCount('shop_unpaused', t._id), 0);
    });
});

describe('SMS provider failing', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(quiet);
    afterEach(() => mock.restoreAll());

    test('3 failed SMS in 10 minutes alert the superadmin once, then stay quiet', async () => {
        await SmsLog.deleteMany({});
        await PlatformSettings.deleteMany({});
        const t = await makeTenant('pr-smsfail');
        const fail = () => wallet.logSms({ tenantId: t._id, phone: '9000000010', purpose: 'otp', debit: null, status: 'failed' });

        await fail();
        await fail();
        await sleep(300);
        assert.equal(await adminCount('admin_sms_provider_failing'), 0);   // two are not enough
        await fail();
        assert.ok(await waitFor(async () => (await adminCount('admin_sms_provider_failing')) === 1));
        await fail();                                                       // a fourth one: still one alert
        await sleep(500);
        assert.equal(await adminCount('admin_sms_provider_failing'), 1);
        const alert = await Notification.findOne({ role: 'superadmin', type: 'admin_sms_provider_failing' });
        assert.match(alert.body, /3 SMS failed in the last 10 minutes/);
    });

    test('SMS that were sent fine, or failed long ago, do not count', async () => {
        await SmsLog.deleteMany({});
        await Notification.deleteMany({ type: 'admin_sms_provider_failing' });
        await PlatformSettings.deleteMany({});
        const t = await makeTenant('pr-smsfine');
        const log = (status) => wallet.logSms({ tenantId: t._id, phone: '9000000010', purpose: 'otp', debit: null, status });
        await log('sent'); await log('sent'); await log('mock');
        await SmsLog.collection.insertMany([1, 2, 3].map(() => ({
            tenantId: t._id, phoneMasked: '90XXXXXX10', purpose: 'otp', status: 'failed', createdAt: new Date(Date.now() - 30 * 60000),
        })));
        await log('failed');   // one fresh failure
        await sleep(500);
        assert.equal(await adminCount('admin_sms_provider_failing'), 0);
    });
});

describe('who pays the alert SMS', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(async () => { await db.clear(); wallet.refreshPlatform(); mock.method(smsAdapter, 'send', async () => ({ providerMessageId: 'x' })); });
    afterEach(() => mock.restoreAll());

    const fund = (t, paise) => wallet.credit({ tenantId: t._id, amountPaise: paise, type: 'adjust', note: 'test', actor: { type: 'system' } });
    const balance = async (t) => (await SmsWallet.findOne({ tenantId: t._id })).balancePaise;
    const send = () => alertSmsRotation.send({ phone: '9000000099', text: 'Platform alert: test', eventKey: 'admin_shop_paused' });

    test('a shop that is not live never pays, a live one does, and the platform pays when no live shop can', async () => {
        const notLive = await makeTenant('rl-notlive');
        const liveShop = await makeTenant('rl-live', { billing: { state: 'active', isLive: true } });
        await fund(notLive, 20000);
        await fund(liveShop, 20000);

        const r1 = await send();
        assert.equal(r1.mode, 'shop');
        assert.equal(String(r1.tenantId), String(liveShop._id));
        assert.equal(await balance(notLive), 20000);
        assert.equal(await balance(liveShop), 19970);

        await SmsWallet.updateOne({ tenantId: liveShop._id }, { $set: { balancePaise: 100 } });   // now below its low level
        const r2 = await send();
        assert.equal(r2.mode, 'platform');
        assert.equal(await balance(notLive), 20000);                                              // still not charged
        assert.equal(await PlatformSmsCost.countDocuments({}), 1);
    });
});

describe('notification rules routes and B18', () => {
    let auth;
    before(async () => {
        await db.connect();
        auth = { Authorization: `Bearer ${(await makeSuperAdmin('rules@example.com')).token}` };
    });
    after(() => db.disconnect());
    beforeEach(quiet);
    afterEach(() => { mock.restoreAll(); rules.invalidate(); });

    const put = (body) => request(app).put('/api/admin/notification-rules').set(auth).send(body);

    test('only a superadmin can read or change the rules, and wrong values are refused', async () => {
        assert.equal((await request(app).get('/api/admin/notification-rules')).status, 401);
        assert.equal((await request(app).put('/api/admin/notification-rules').send({ eventKey: 'order_new', enabled: false })).status, 401);

        const list = await request(app).get('/api/admin/notification-rules').set(auth);
        assert.equal(list.status, 200);
        const keys = list.body.events.map((e) => e.eventKey);
        assert.ok(keys.includes('order_new') && keys.includes('admin_shop_paused') && keys.includes('shop_unpaused'));
        assert.equal(list.body.events.find((e) => e.eventKey === 'admin_shop_paused').critical, true);
        assert.equal(list.body.events.find((e) => e.eventKey === 'order_new').escalateSmsAfterSec, 180);

        assert.equal((await put({ eventKey: 'no_such_event', enabled: false })).status, 404);
        assert.equal((await put({ eventKey: 'order_new', channels: ['inapp', 'fax'] })).status, 400);
        assert.equal((await put({ eventKey: 'order_new', channels: 'sms' })).status, 400);
        assert.equal((await put({ eventKey: 'order_new', escalateSmsAfterSec: -5 })).status, 400);
        assert.equal((await put({ eventKey: 'order_new', escalateSmsAfterSec: 1.5 })).status, 400);
        assert.equal((await put({ eventKey: 'order_new', enabled: 'no' })).status, 400);
        assert.equal((await put({ eventKey: 'order_new' })).status, 400);
        assert.equal((await put({ eventKey: 'order_new', tenantId: '5f0000000000000000000000', enabled: false })).status, 404);
        assert.equal((await put({ eventKey: 'order_new', tenantId: 'bad', enabled: false })).status, 404);
        assert.equal(await NotificationRule.countDocuments({}), 0);
    });

    test('a rule changes the delivery at once, a null goes back to the default, reset removes the rule', async () => {
        try {
            const ok = await put({ eventKey: 'order_new', escalateSmsAfterSec: 60, channels: ['inapp', 'push'] });
            assert.equal(ok.status, 200);
            const merged = await rules.get('order_new');
            assert.equal(merged.escalateSmsAfterSec, 60);
            assert.deepEqual(merged.channels, ['inapp', 'push']);

            await put({ eventKey: 'order_new', escalateSmsAfterSec: null });         // this field back to its default
            const back = await rules.get('order_new');
            assert.equal(back.escalateSmsAfterSec, 180);
            assert.deepEqual(back.channels, ['inapp', 'push']);                       // the other field is still changed

            const t = await makeTenant('rules-shop');
            await put({ eventKey: 'order_new', tenantId: String(t._id), enabled: false });
            assert.equal((await rules.get('order_new', t._id)).enabled, false);       // that shop only
            assert.notEqual((await rules.get('order_new')).enabled, false);

            assert.equal((await put({ eventKey: 'order_new', reset: true })).status, 200);
            assert.equal((await put({ eventKey: 'order_new', tenantId: String(t._id), reset: true })).status, 200);
            assert.equal(await NotificationRule.countDocuments({}), 0);
            assert.equal((await rules.get('order_new')).escalateSmsAfterSec, 180);
        } finally {
            await NotificationRule.deleteMany({});
        }
    });

    test('an alert switched off by a rule sends nothing, and comes back after a reset', async () => {
        try {
            await put({ eventKey: 'admin_bill_paid', enabled: false });
            assert.equal(await adminAlerts.alert('admin_bill_paid', { vars: { shop: 'X' } }), null);
            assert.equal(await adminCount('admin_bill_paid'), 0);
            await put({ eventKey: 'admin_bill_paid', reset: true });
            assert.ok(await adminAlerts.alert('admin_bill_paid', { vars: { shop: 'X' } }));
            assert.equal(await adminCount('admin_bill_paid'), 1);
        } finally {
            await NotificationRule.deleteMany({});
        }
    });

    test('B18: monthlyFee is ignored when a shop is made or changed, the other billing fields still work', async () => {
        const made = await request(app).post('/api/admin/tenants').set(auth)
            .send({ slug: 'b18-new-shop', name: 'B18 shop', subscription: { monthlyFee: 99, startMonth: '2026-10' } });
        assert.equal(made.status, 201);
        const created = await Tenant.findOne({ slug: 'b18-new-shop' }).lean();
        assert.equal(created.subscription.monthlyFee, undefined);
        assert.equal(created.subscription.startMonth, '2026-10');

        const changed = await request(app).put(`/api/admin/tenants/${created._id}`).set(auth)
            .send({ subscription: { monthlyFee: 500, gstPercent: 12 } });
        assert.equal(changed.status, 200);
        const after = await Tenant.findById(created._id).lean();
        assert.equal(after.subscription.monthlyFee, undefined);
        assert.equal(after.subscription.gstPercent, 12);
        assert.equal(after.subscription.startMonth, '2026-10');
    });
});