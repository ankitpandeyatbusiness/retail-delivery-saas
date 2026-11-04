require('./helpers/env');
process.env.SECRETS_KEY = process.env.SECRETS_KEY || require('crypto').randomBytes(32).toString('base64');
// More tab: its Needs attention, the SMS and DLT setup screen's backend, and the searches of the audit log and the alerts inbox.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const PlatformSettings = require('../src/models/PlatformSettings');
const Notification = require('../src/models/Notification');

let token;
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); require('../src/services/smsPlatformSetup').invalidate(); token = (await f.makeSuperAdmin('root@test.com')).token; });
const auth = () => ({ Authorization: 'Bearer ' + token });
const get = (u, q) => request(app).get(u).set(auth()).query(q || {});
const put = (u, b) => request(app).put(u).set(auth()).send(b || {});
const post = (u, b) => request(app).post(u).set(auth()).send(b || {});

describe('more attention', () => {
    test('shows maintenance, and a maintenance-free platform has no such item', async () => {
        let b = (await get('/api/admin/more/attention')).body;
        assert.ok(!b.items.find((i) => i.key === 'maintenance'));
        await PlatformSettings.updateOne({ _id: 'main' }, { $set: { 'maintenance.on': true } }, { upsert: true });
        b = (await get('/api/admin/more/attention')).body;
        assert.equal(b.items[0].key, 'maintenance');
        assert.equal(b.items[0].level, 'bad');
    });
    test('unread alerts are not listed here (the bell in the header shows them)', async () => {
        await Notification.create({ role: 'superadmin', type: 'admin_test', title: 'Late orders at Savera', body: 'x' });
        const b = (await get('/api/admin/more/attention')).body;
        assert.ok(!b.items.find((i) => i.key === 'alerts'));
    });
});

describe('inbox search', () => {
    test('finds an alert by words in any order', async () => {
        await Notification.create({ role: 'superadmin', type: 'admin_test', title: 'Late orders at Savera', body: 'three orders' });
        await Notification.create({ role: 'superadmin', type: 'admin_test', title: 'Bill paid', body: 'ok' });
        const r = (await get('/api/admin/notifications', { q: 'savera late' })).body;
        assert.equal(r.items.length, 1);
        assert.equal((await get('/api/admin/notifications', { q: 'nothingmatches' })).body.items.length, 0);
    });
});

describe('SMS and DLT setup', () => {
    test('saves the sender, entity, key and template IDs; the key is never shown back', async () => {
        const w = await get('/api/admin/platform/sms-setup');
        assert.equal(w.status, 200);
        assert.equal(w.body.ready, false);
        assert.ok(w.body.templates.length >= 12);
        const saved = await put('/api/admin/platform/sms-setup', { senderId: 'SAVERA', entityId: '1101234567890', authKey: 'abcDEF1234567890xyz', templateIds: { otp: '1107000000000001', order_new: '1107000000000002' } });
        assert.equal(saved.status, 200, JSON.stringify(saved.body));
        assert.equal(saved.body.ready, !!process.env.SECRETS_KEY ? true : saved.body.ready);
        assert.equal(saved.body.senderId.value, process.env.SMS_SENDER_ID || 'SAVERA');
        assert.equal(JSON.stringify(saved.body).includes('abcDEF1234567890xyz'), false);
        assert.equal(saved.body.templates.find((t) => t.key === 'otp').templateId, process.env.SMS_TEMPLATE_OTP || process.env.DLT_TEMPLATE_OTP || '1107000000000001');
        // the sending side uses it
        const r = await require('../src/services/smsConfig').resolve({ tenantId: null, purpose: 'order', templateKey: 'order_new' });
        assert.equal(r.templateId, process.env.SMS_TEMPLATE_ORDER_NEW || process.env.DLT_TEMPLATE_ORDER_NEW || '1107000000000002');
    });
    test('refuses odd values', async () => {
        assert.equal((await put('/api/admin/platform/sms-setup', { senderId: 'a b' })).status, 400);
        assert.equal((await put('/api/admin/platform/sms-setup', { templateIds: { nonsense: '1' } })).status, 400);
        assert.equal((await put('/api/admin/platform/sms-setup', {})).status, 400);
        assert.equal((await post('/api/admin/platform/sms-setup/test', { phone: '123' })).status, 400);
    });
});
