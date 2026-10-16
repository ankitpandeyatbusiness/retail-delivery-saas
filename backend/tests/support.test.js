require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const SupportTicket = require('../src/models/SupportTicket');
const Notification = require('../src/models/Notification');
const Tenant = require('../src/models/Tenant');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');

// Help & support between the shop owner and the platform team.
let a; let b; let auth;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    a = await f.makeWorld('sup-a');
    b = await f.makeWorld('sup-b');
    tenantRecognizer.invalidateTenant('sup-a'); tenantRecognizer.invalidateTenant('sup-b');
    auth = { Authorization: `Bearer ${(await f.makeSuperAdmin('support@example.com')).token}` };
});
const own = (w, m, path, body) => request(app)[m](`/api/shop/support${path}`).set(w.owner.headers).send(body);
const adm = (m, path, body) => request(app)[m](`/api/admin/support${path}`).set(auth).send(body);
const open = (w = a, over = {}) => own(w, 'post', '', { category: 'billing', subject: 'My bill is wrong', message: 'The amount looks too high.', ...over });
const waitFor = async (fn) => { for (let i = 0; i < 30; i += 1) { if (await fn()) return true; await f.sleep(100); } return false; };

describe('owner: new requests', () => {
    test('a new request has a number, my message, and tells the superadmin', async () => {
        const r = await open();
        assert.equal(r.status, 201, JSON.stringify(r.body));
        assert.equal(r.body.number, 1001);
        assert.equal(r.body.status, 'open');
        assert.equal(r.body.messages.length, 1);
        assert.equal(r.body.messages[0].from, 'owner');
        assert.ok(await waitFor(async () => (await Notification.countDocuments({ role: 'superadmin', type: 'admin_support_new' })) === 1));
        assert.equal((await open(a, { subject: 'Second' })).body.number, 1002, 'numbers go up');
    });

    test('bad input is refused, and 5 new requests a day is the limit', async () => {
        assert.equal((await open(a, { category: 'nope' })).status, 400);
        assert.equal((await open(a, { subject: 'ab' })).status, 400);
        assert.equal((await open(a, { message: '   ' })).status, 400);
        assert.equal((await open(a, { photos: ['http://x.test/a.png'] })).status, 400, 'https links only');
        assert.equal((await open(a, { photos: ['https://x/1', 'https://x/2', 'https://x/3', 'https://x/4'] })).status, 400);
        for (let i = 0; i < 5; i += 1) assert.equal((await open(a, { subject: `Request ${i}` })).status, 201);
        assert.equal((await open(a, { subject: 'one too many' })).status, 429);
        assert.equal((await open(b)).status, 201, 'another shop is not affected');
    });

    test('it works while the shop is paused for rent', async () => {
        await Tenant.updateOne({ _id: a.tenant._id }, { $set: { 'billing.state': 'paused' } });
        assert.equal((await open()).status, 201);
        assert.equal((await own(a, 'get', '')).status, 200);
    });

    test('a customer cannot use it', async () => {
        const r = await request(app).post('/api/shop/support').set(a.customer.headers).send({ category: 'other', subject: 'hello there', message: 'x' });
        assert.ok([401, 403].includes(r.status));
    });
});

describe('the conversation', () => {
    test('platform replies, the owner is told and sees it as new, then reads it', async () => {
        const id = (await open()).body.id;
        const r = await adm('post', `/${id}/reply`, { message: 'We checked: it includes GST.' });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.status, 'answered');
        assert.ok(await waitFor(async () => (await Notification.countDocuments({ tenantId: a.tenant._id, role: 'owner', 'data.kind': 'support' })) === 1));

        const list = await own(a, 'get', '');
        assert.equal(list.body.unreadCount, 1);
        assert.equal(list.body.items[0].ownerUnread, true);
        assert.equal(list.body.items[0].last.from, 'platform');
        const read = await own(a, 'get', `/${id}`);
        assert.equal(read.body.messages.length, 2);
        assert.equal((await own(a, 'get', '')).body.unreadCount, 0, 'opening it reads it');
    });

    test('a private note is never shown to the owner', async () => {
        const id = (await open()).body.id;
        await adm('post', `/${id}/note`, { message: 'Owner is a repeat complainer, be firm.' });
        const mine = await own(a, 'get', `/${id}`);
        assert.equal(mine.body.messages.length, 1);
        assert.ok(!JSON.stringify(mine.body).includes('repeat complainer'));
        const theirs = await adm('get', `/${id}`);
        assert.equal(theirs.body.messages.length, 2);
        assert.equal(theirs.body.messages[1].from, 'note');
        assert.equal((await own(a, 'get', '')).body.items[0].ownerUnread, false, 'a note does not notify the owner');
    });

    test('the owner replies, resolves, rates once, and can reopen within 7 days but not after', async () => {
        const id = (await open()).body.id;
        await adm('post', `/${id}/reply`, { message: 'Done.' });
        const back = await own(a, 'post', `/${id}/reply`, { message: 'Thanks, one more thing.' });
        assert.equal(back.body.status, 'open');
        const done = await own(a, 'post', `/${id}/resolve`);
        assert.equal(done.body.status, 'resolved');
        assert.equal(done.body.canReopen, true);
        assert.equal((await own(a, 'post', `/${id}/rate`, { stars: 9 })).status, 400);
        assert.equal((await own(a, 'post', `/${id}/rate`, { stars: 5, comment: 'Quick help' })).body.rating.stars, 5);
        assert.equal((await own(a, 'post', `/${id}/rate`, { stars: 4 })).status, 409, 'rate only once');
        assert.equal((await own(a, 'post', `/${id}/reply`, { message: 'Another question' })).body.status, 'open', 'reopened');

        await own(a, 'post', `/${id}/resolve`);
        await SupportTicket.updateOne({ _id: id }, { $set: { resolvedAt: new Date(Date.now() - 8 * 86400000) } });
        assert.equal((await own(a, 'post', `/${id}/reply`, { message: 'Too late' })).status, 409);
    });

    test('one shop cannot read another shops request', async () => {
        const id = (await open(a)).body.id;
        assert.equal((await own(b, 'get', `/${id}`)).status, 404);
        assert.equal((await own(b, 'post', `/${id}/reply`, { message: 'hi' })).status, 404);
    });
});

describe('the support inbox', () => {
    test('list, filter, search, counts, priority and status', async () => {
        const one = (await open(a, { subject: 'Printer problem' })).body.id;
        await open(b, { subject: 'Menu question' });
        const all = await adm('get', '');
        assert.equal(all.body.items.length, 2);
        assert.equal(all.body.counts.open, 2);
        assert.equal(all.body.counts.unread, 2);
        assert.equal((await adm('get', '?q=printer')).body.items.length, 1);
        assert.equal((await adm('get', '?q=1002')).body.items[0].subject, 'Menu question');
        assert.equal((await adm('get', `?tenantId=${a.tenant._id}`)).body.items.length, 1);

        const set = await adm('patch', `/${one}`, { priority: 'urgent' });
        assert.equal(set.body.priority, 'urgent');
        assert.equal((await adm('patch', `/${one}`, { priority: 'huge' })).status, 400);
        const res = await adm('patch', `/${one}`, { status: 'resolved' });
        assert.equal(res.body.status, 'resolved');
        assert.equal((await adm('get', '?status=resolved')).body.items.length, 1);
        assert.equal((await adm('get', '/counts')).body.resolved, 1);
        const detail = await adm('get', `/${one}`);
        assert.ok(detail.body.shop.name.length > 0);
        assert.equal(detail.body.owner.phone, '9000000010');
        assert.equal((await adm('get', '?status=bogus')).status, 400);
    });

    test('the contact card: set by the platform, read by the owner', async () => {
        assert.match((await own(a, 'get', '/info')).body.replyPromise, /24 hours/);
        const put = await adm('put', '/settings', { phone: '+91 98765 43210', hours: 'Mon to Sat, 10 AM to 7 PM', email: 'help@example.com' });
        assert.equal(put.status, 200, JSON.stringify(put.body));
        const info = (await own(a, 'get', '/info')).body;
        assert.equal(info.phone, '+91 98765 43210');
        assert.equal(info.hours, 'Mon to Sat, 10 AM to 7 PM');
        assert.equal((await adm('put', '/settings', { email: 'not-email' })).status, 400);
    });

    test('an owner cannot reach the inbox', async () => {
        const r = await request(app).get('/api/admin/support').set(a.owner.headers);
        assert.ok([401, 403].includes(r.status));
    });
});

describe('push taps', () => {
    test('the superadmin push names the request, so tapping it can open it', async () => {
        const { mock } = require('node:test');
        const mongoose = require('mongoose');
        const pushAdapter = require('../src/services/adapters/push');
        const AdminDevice = require('../src/models/AdminDevice');
        await AdminDevice.create({ adminId: new mongoose.Types.ObjectId(), token: 'tok_support_test_1234567890', platform: 'android' });
        const push = mock.method(pushAdapter, 'send', async () => ({ sent: 1, invalidTokens: [] }));
        try {
            const id = (await open()).body.id;
            assert.ok(await waitFor(async () => push.mock.calls.length >= 1));
            const sent = push.mock.calls[0].arguments[0];
            assert.equal(sent.data.ticketId, id);
            assert.equal(sent.data.type, 'admin_support_new');
        } finally { mock.restoreAll(); }
    });

    test('the owner push for a team reply carries kind support and the request id', async () => {
        const { mock } = require('node:test');
        const pushChannel = require('../src/notifications/channels/push');
        const push = mock.method(pushChannel, 'send', async () => ({ sent: 1 }));
        try {
            const id = (await open()).body.id;
            await adm('post', `/${id}/reply`, { message: 'Please check again.' });
            assert.ok(await waitFor(async () => push.mock.calls.length >= 1));
            const sent = push.mock.calls[0].arguments[0];
            assert.equal(sent.data.kind, 'support');
            assert.equal(sent.data.ticketId, id);
        } finally { mock.restoreAll(); }
    });
});

describe('notifications lead somewhere', () => {
    test('a complaint can be opened by its id, only by its own shop', async () => {
        const Complaint = require('../src/models/Complaint');
        const o = await f.makeOrder(a.tenant, a.customer.user, { status: 'delivered' });
        const c = await Complaint.create({ tenantId: a.tenant._id, userId: a.customer.user._id, orderId: o._id, orderNo: o.orderNo, type: 'late', text: 'It was late', customerName: 'Cust' });
        const mine = await request(app).get(`/api/shop/complaints/${c._id}`).set(a.owner.headers);
        assert.equal(mine.status, 200, JSON.stringify(mine.body));
        assert.equal(mine.body.text, 'It was late');
        assert.equal(mine.body.orderId, String(o._id));
        assert.equal((await request(app).get(`/api/shop/complaints/${c._id}`).set(b.owner.headers)).status, 404);
        assert.equal((await request(app).get('/api/shop/complaints/not-an-id').set(a.owner.headers)).status, 404);
    });

    test('the superadmin push for a bill names the invoice and the shop', async () => {
        const { mock } = require('node:test');
        const mongoose = require('mongoose');
        const pushAdapter = require('../src/services/adapters/push');
        const AdminDevice = require('../src/models/AdminDevice');
        const adminAlerts = require('../src/services/adminAlerts');
        await AdminDevice.create({ adminId: new mongoose.Types.ObjectId(), token: 'tok_route_test_1234567890', platform: 'android' });
        const push = mock.method(pushAdapter, 'send', async () => ({ sent: 1, invalidTokens: [] }));
        try {
            const invoiceId = String(new mongoose.Types.ObjectId());
            await adminAlerts.alert('admin_bill_issued', { tenantId: a.tenant._id, data: { invoiceId } });
            const sent = push.mock.calls[0].arguments[0];
            assert.equal(sent.data.invoiceId, invoiceId);
            assert.ok(sent.data.shopName);
            assert.equal(sent.data.tenantId, String(a.tenant._id));
        } finally { mock.restoreAll(); }
    });
});
