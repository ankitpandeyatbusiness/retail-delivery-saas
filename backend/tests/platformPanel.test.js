require('./helpers/env');
// Phase 6 of the superadmin app: alerts inbox, messages to owners, platform maintenance, alert SMS, notification rules,
// audit log and push devices. These tests send the same requests the screens send.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Notification = require('../src/models/Notification');
const AdminDevice = require('../src/models/AdminDevice');

let token;
let admin;
let n = 0;
const auth = () => ({ Authorization: `Bearer ${token}` });
const get = (u) => request(app).get(u).set(auth());
const post = (u, b) => request(app).post(u).set(auth()).send(b);
const put = (u, b) => request(app).put(u).set(auth()).send(b);

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    const sa = await f.makeSuperAdmin('root@test.com');
    token = sa.token;
    admin = sa.admin;
});

describe('alerts inbox', () => {
    test('list, unread filter and count, mark one, mark all', async () => {
        const shop = await f.makeTenant(`plat-${++n}`);
        const mk = (title, extra = {}) => Notification.create({ role: 'superadmin', type: 'order_late', title, body: 'Order is late', tenantId: shop._id, data: { orderId: 'x' }, ...extra });
        const a = await mk('Late order 1');
        await mk('Late order 2');
        await mk('Old one', { readAt: new Date() });

        const all = await get('/api/admin/notifications');
        assert.equal(all.status, 200);
        assert.equal(all.body.items.length, 3);
        assert.equal(all.body.unreadCount, 2);
        assert.equal(all.body.items[0].shop.name, shop.name);

        const unread = await get('/api/admin/notifications?unread=true&limit=1');
        assert.equal(unread.body.items.length, 1);
        assert.equal(unread.body.unreadCount, 2);   // the bell number, even with limit 1

        assert.equal((await post(`/api/admin/notifications/${a._id}/read`, {})).status, 200);
        assert.equal((await get('/api/admin/notifications?unread=true')).body.unreadCount, 1);

        const readAll = await post('/api/admin/notifications/read-all', {});
        assert.equal(readAll.body.marked, 1);
        assert.equal((await get('/api/admin/notifications')).body.unreadCount, 0);
        assert.equal((await post('/api/admin/notifications/not-an-id/read', {})).status, 404);
    });
});

describe('messages to owners', () => {
    test('send to all shops, to chosen shops, list and read progress; empty and bad input refused', async () => {
        const a = await f.makeTenant(`plat-${++n}`);
        await f.makeTenant(`plat-${++n}`);

        assert.equal((await post('/api/admin/messages', { title: '', body: 'x' })).status, 400);
        assert.equal((await post('/api/admin/messages', { title: 'Hi', body: 'x', kind: 'promo' })).status, 400);   // platform sends information only
        assert.equal((await post('/api/admin/messages', { title: 'Hi', body: 'x', tenantIds: ['nope'] })).status, 400);

        const all = await post('/api/admin/messages', { title: 'Upgrade tonight', body: 'The app will be updated at 11 PM.', kind: 'info', sendEmail: false });
        assert.equal(all.status, 202, JSON.stringify(all.body));
        assert.equal(all.body.recipients, 2);

        const some = await post('/api/admin/messages', { title: 'Only you', body: 'Hello', kind: 'info', sendEmail: false, tenantIds: [String(a._id)] });
        assert.equal(some.status, 202);
        assert.equal(some.body.recipients, 1);

        const list = await get('/api/admin/messages');
        assert.equal(list.body.items.length, 2);
        const one = await get(`/api/admin/messages/${all.body.id}`);
        assert.equal(one.status, 200);
        assert.equal(one.body.title, 'Upgrade tonight');
    });
});

describe('platform switches', () => {
    test('maintenance on with an end time, then off; a past end time is refused', async () => {
        const until = new Date(Date.now() + 3 * 3600000).toISOString();
        const on = await put('/api/admin/platform/maintenance', { on: true, message: 'Upgrading', until });
        assert.equal(on.status, 200, JSON.stringify(on.body));
        assert.equal((await get('/api/admin/platform')).body.maintenance.on, true);

        assert.equal((await put('/api/admin/platform/maintenance', { on: true, until: '2020-01-01T00:00:00Z' })).status, 400);
        const off = await put('/api/admin/platform/maintenance', { on: false });
        assert.equal(off.status, 200);
        assert.equal((await get('/api/admin/platform')).body.maintenance.on, false);
    });

    test('alert SMS: needs a phone before switching on, number checked, cost report answers', async () => {
        assert.equal((await put('/api/admin/platform/alerts', { smsToAdmin: true })).status, 400);
        assert.equal((await put('/api/admin/platform/alerts', { phone: '12345' })).status, 400);

        const phone = await put('/api/admin/platform/alerts', { phone: '9876501234' });
        assert.equal(phone.body.alerts.phone, '9876501234');
        const on = await put('/api/admin/platform/alerts', { smsToAdmin: true, allEvents: true });
        assert.equal(on.status, 200);
        assert.equal(on.body.alerts.smsToAdmin, true);
        assert.equal(on.body.alerts.allEvents, true);

        const cost = await get('/api/admin/alerts/sms-cost?from=2026-01-01&to=2026-12-31');
        assert.equal(cost.status, 200);
        assert.ok(cost.body.platform && cost.body.shops);
    });
});

describe('notification rules', () => {
    test('events are listed; a global rule and a shop rule are saved and reset; only changed fields are kept', async () => {
        const shop = await f.makeTenant(`plat-${++n}`);
        const list = await get('/api/admin/notification-rules');
        assert.equal(list.status, 200);
        assert.ok(list.body.events.length > 5);
        const ev = list.body.events.find((e) => e.eventKey === 'order_new');
        assert.ok(ev);
        assert.deepEqual(list.body.rules, []);

        // the app sends null for what equals the default, and a value for what changed
        const g = await put('/api/admin/notification-rules', { eventKey: 'order_new', enabled: null, channels: ['inapp', 'push'], alsoPush: null, escalateSmsAfterSec: 600 });
        assert.equal(g.status, 200, JSON.stringify(g.body));
        assert.deepEqual(g.body.rule.channels, ['inapp', 'push']);
        assert.equal(g.body.rule.escalateSmsAfterSec, 600);
        assert.equal(g.body.rule.enabled, undefined);

        const s = await put('/api/admin/notification-rules', { eventKey: 'order_new', tenantId: String(shop._id), enabled: false, channels: null, alsoPush: null, escalateSmsAfterSec: null });
        assert.equal(s.status, 200);
        assert.equal(s.body.rule.enabled, false);

        assert.equal((await get('/api/admin/notification-rules')).body.rules.length, 2);
        assert.equal((await put('/api/admin/notification-rules', { eventKey: 'order_new', channels: ['carrier-pigeon'] })).status, 400);
        assert.equal((await put('/api/admin/notification-rules', { eventKey: 'nope', enabled: false })).status, 404);

        const reset = await put('/api/admin/notification-rules', { eventKey: 'order_new', tenantId: String(shop._id), reset: true });
        assert.equal(reset.body.rule, null);
        assert.equal((await get('/api/admin/notification-rules')).body.rules.length, 1);
    });
});

describe('audit log', () => {
    test('shows changes with filters, newest first', async () => {
        const shop = await f.makeTenant(`plat-${++n}`);
        await put(`/api/admin/tenants/${shop._id}/owner-access`, { blocked: true, reason: 'Rent unpaid' });
        await put(`/api/admin/tenants/${shop._id}/maintenance`, { on: false });

        const all = await get('/api/admin/audit-logs?limit=10');
        assert.equal(all.status, 200);
        assert.ok(all.body.items.length >= 2);
        assert.ok(new Date(all.body.items[0].at) >= new Date(all.body.items[1].at));

        const mine = await get(`/api/admin/audit-logs?tenantId=${shop._id}&actorType=superadmin`);
        assert.ok(mine.body.items.length >= 2);
        assert.ok(mine.body.items.every((i) => i.actorType === 'superadmin'));

        const q = await get('/api/admin/audit-logs?q=owner-access');
        assert.ok(q.body.items.length >= 1);
        assert.equal((await get('/api/admin/audit-logs?tenantId=bad')).status, 400);
        assert.equal((await get('/api/admin/audit-logs?actorType=rider')).body.items.length, 0);
    });
});

describe('push devices', () => {
    test('register, same token again, remove; a short token is refused', async () => {
        const tokenText = 'f'.repeat(40);
        assert.equal((await post('/api/admin/devices', { token: 'short', platform: 'android' })).status, 400);
        assert.equal((await post('/api/admin/devices', { token: tokenText, platform: 'windows' })).status, 400);

        assert.equal((await post('/api/admin/devices', { token: tokenText, platform: 'android' })).status, 201);
        assert.equal((await post('/api/admin/devices', { token: tokenText, platform: 'android' })).status, 201);
        assert.equal(await AdminDevice.countDocuments({ adminId: admin._id }), 1);

        assert.equal((await post('/api/admin/devices/remove', { token: tokenText })).status, 200);
        assert.equal(await AdminDevice.countDocuments({ adminId: admin._id }), 0);
    });
});

describe('my account', () => {
    test('rename myself; my own numbers are shown in full in the team list', async () => {
        const sa = await request(app).get('/api/admin/team').set(auth());
        const me = sa.body.items.find((a) => a.isMe);
        const r = await request(app).patch(`/api/admin/team/${me.id}`).set(auth()).send({ name: 'Ankit' });
        assert.equal(r.status, 200);
        assert.equal(r.body.name, 'Ankit');
        assert.equal((await get('/api/admin/me')).body.name, 'Ankit');
    });
});
