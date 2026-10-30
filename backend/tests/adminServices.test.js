require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const Tenant = require('../src/models/Tenant');
const ServiceInquiry = require('../src/models/ServiceInquiry');
const ShopService = require('../src/models/ShopService');
const TableBooking = require('../src/models/TableBooking');
const Notification = require('../src/models/Notification');
const pushChannel = require('../src/notifications/channels/push');
const reminders = require('../src/services/inquiryReminders');
const svc = require('../src/services/shopServices');

// Phase 5: the super admin's switches, his read-only overview, the defaults, and the reminder for an inquiry nobody answered.
let w; let admin; let n = 0; let slug;
const auth = () => ({ Authorization: `Bearer ${admin.token}` });
const HOUR = 3600000;
const wait = (ms = 300) => new Promise((r) => setTimeout(r, ms));
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
    slug = `admin-svc-${++n}`;
    w = await f.makeWorld(slug);
    admin = await f.makeSuperAdmin();
});
afterEach(() => mock.restoreAll());

const switchFeatures = async (features) => { await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.features': features } }); tenantRecognizer.invalidateTenant(slug); };
const service = () => ShopService.create({ tenantId: w.tenant._id, name: 'Bulk Order Booking', kind: 'bulk', questions: [] });
const inquiry = async (o = {}) => ServiceInquiry.create({
    tenantId: w.tenant._id, serviceId: (await service())._id, serviceName: 'Bulk Order Booking', userId: w.customer.user._id, name: 'Anil', phone: '9000000030',
    messages: [{ from: 'customer', text: 'Need a quote' }], ownerUnread: 1, ...o,
});

describe('the switches', () => {
    test('both add-ons are off for a new shop; the owner and the guest are told so', async () => {
        await switchFeatures({});
        const owner = await request(app).get('/api/shop/services').set(w.owner.headers);
        assert.equal(owner.status, 403);
        assert.match(owner.body.error, /not switched on for your shop/);
        assert.equal((await request(app).get('/api/shop/inquiries').set(w.owner.headers)).status, 403);
        const on = await request(app).put('/api/shop/booking/settings').set(w.owner.headers).send({ enabled: true });
        assert.equal(on.status, 403);
        assert.equal((await request(app).get('/api/services').set(w.customer.headers)).body.items.length, 0);
        assert.equal((await request(app).get('/api/bookings/config').set(w.customer.headers)).body.enabled, false);
    });

    test('switched on for the shop, the owner can use them and the guest sees the services', async () => {
        await switchFeatures({ services: true, tableBooking: true });
        assert.equal((await request(app).post('/api/shop/services').set(w.owner.headers).send({ kind: 'bulk' })).status, 201);
        assert.equal((await request(app).get('/api/services').set(w.customer.headers)).body.items.length, 1);
        assert.equal((await request(app).get('/api/shop/booking/settings').set(w.owner.headers)).body.featureOn, true);
    });

    test('switching Services off hides the shop\'s services from guests but keeps their open inquiries readable', async () => {
        await switchFeatures({ services: true });
        await request(app).post('/api/shop/services').set(w.owner.headers).send({ kind: 'bulk' });
        const i = await inquiry();
        await switchFeatures({});
        assert.equal((await request(app).get('/api/services').set(w.customer.headers)).body.items.length, 0);
        assert.equal((await request(app).get(`/api/services/inquiries/${i._id}`).set(w.customer.headers)).status, 200);
        assert.equal((await request(app).get('/api/services/inquiries/mine').set(w.customer.headers)).body.items.length, 1);
    });

    test('the super admin can change the switches in the shop\'s settings (the App features screen)', async () => {
        const s = await request(app).put(`/api/admin/tenants/${w.tenant._id}`).set(auth()).send({ settings: { features: { services: true, tableBooking: true } } });
        assert.equal(s.status, 200, JSON.stringify(s.body));
        tenantRecognizer.invalidateTenant(slug);
        assert.equal((await request(app).get('/api/shop/services').set(w.owner.headers)).status, 200);
    });
});

describe('the overview', () => {
    test('totals and a row for each shop: inquiries, bookings, the booking money, the waitlist', async () => {
        await switchFeatures({ services: true, tableBooking: true });
        await inquiry();   // new
        await inquiry({ status: 'replied', ownerUnread: 0, messages: [{ from: 'customer', text: 'q', at: new Date(Date.now() - 50 * 60000) }, { from: 'owner', text: 'a', at: new Date() }], createdAt: new Date(Date.now() - 60 * 60000) });
        await inquiry({ lastMessageAt: new Date(Date.now() - 30 * HOUR) });   // unanswered for more than a day
        const mk = (o) => TableBooking.create({ tenantId: w.tenant._id, userId: w.customer.user._id, code: 'ABCDE', name: 'A', phone: '1', date: '2026-11-20', time: '20:00', party: 2, startsAt: new Date(), endsAt: new Date(), ...o });
        await mk({ status: 'confirmed', deposit: { amount: 400, status: 'paid' }, payment: { rzpPaymentId: 'p1' } });
        await mk({ status: 'seated', deposit: { amount: 400, status: 'adjusted' }, payment: { rzpPaymentId: 'p2' } });
        await mk({ status: 'cancelled', deposit: { amount: 400, status: 'refunded' }, payment: { rzpPaymentId: 'p3' } });
        await mk({ status: 'no_show', deposit: { amount: 400, status: 'kept' }, payment: { rzpPaymentId: 'p4' } });
        await mk({ status: 'held', deposit: { amount: 400, status: 'unpaid' } });   // an unpaid hold is not a booking and has no money
        const r = await request(app).get('/api/admin/services/overview?days=30').set(auth());
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.deepEqual([r.body.totals.inquiries.total, r.body.totals.inquiries.new, r.body.totals.inquiries.unanswered], [3, 2, 1]);
        assert.equal(r.body.totals.inquiries.avgReplyMin, 60);   // from the inquiry to the owner's first reply
        assert.deepEqual([r.body.totals.bookings.total, r.body.totals.bookings.confirmed, r.body.totals.bookings.seated, r.body.totals.bookings.cancelled, r.body.totals.bookings.noShow], [4, 1, 1, 1, 1]);
        assert.deepEqual(r.body.totals.money, { collected: 1600, refunded: 400, kept: 400, adjusted: 400, held: 400 });
        assert.equal(r.body.shops.length, 1);
        assert.equal(r.body.shops[0].shop.name, w.tenant.name);
        const one = await request(app).get(`/api/admin/services/overview?tenantId=${w.tenant._id}`).set(auth());
        assert.equal(one.body.shops.length, 1);
        assert.equal((await request(app).get('/api/admin/services/overview?tenantId=nope').set(auth())).status, 400);
    });

    test('it needs a super admin', async () => {
        assert.equal((await request(app).get('/api/admin/services/overview')).status, 401);
        assert.ok([401, 403].includes((await request(app).get('/api/admin/services/overview').set(w.owner.headers)).status));
    });

    test('the lists and one thread are read-only; the owner\'s private note stays private', async () => {
        await switchFeatures({ services: true });
        const i = await inquiry({ note: 'ring him Friday', status: 'quoted' });
        const list = await request(app).get('/api/admin/services/inquiries?status=quoted').set(auth());
        assert.equal(list.body.items.length, 1);
        assert.equal(list.body.items[0].shop.name, w.tenant.name);
        assert.equal(list.body.items[0].note, undefined);
        const one = await request(app).get(`/api/admin/services/inquiries/${i._id}`).set(auth());
        assert.equal(one.body.messages[0].text, 'Need a quote');
        assert.equal(one.body.note, undefined);
        // there is no way to write: the replies belong to the owner
        assert.equal((await request(app).post(`/api/admin/services/inquiries/${i._id}/reply`).set(auth()).send({ text: 'hi' })).status, 404);
        assert.equal((await request(app).patch(`/api/admin/services/inquiries/${i._id}`).set(auth()).send({ status: 'closed' })).status, 404);
        const bookings = await request(app).get('/api/admin/services/bookings').set(auth());
        assert.equal(bookings.status, 200);
    });
});

describe('the defaults', () => {
    test('he sets the reminder delay and the texts of a starter service; new services begin with them', async () => {
        const before = (await request(app).get('/api/admin/services/defaults').set(auth())).body;
        assert.equal(before.reminderHours, 24);
        assert.equal(before.kinds.bulk.changed, false);
        const put = await request(app).put('/api/admin/services/defaults').set(auth()).send({
            reminderHours: 12,
            kinds: { bulk: { quickTexts: ['Need 100 plates'], quickReplies: ['Yes, we can do it'], questions: [{ id: 'date', type: 'date', label: 'Event date', required: true }, { type: 'number', label: 'How many plates?', min: 20 }] } },
        });
        assert.equal(put.status, 200, JSON.stringify(put.body));
        assert.equal(put.body.reminderHours, 12);
        assert.deepEqual(put.body.kinds.bulk.quickTexts, ['Need 100 plates']);
        assert.equal(put.body.kinds.bulk.changed, true);
        assert.equal(put.body.kinds.tiffin.changed, false);
        await switchFeatures({ services: true });
        const made = await request(app).post('/api/shop/services').set(w.owner.headers).send({ kind: 'bulk' });
        assert.deepEqual(made.body.quickTexts, ['Need 100 plates']);
        assert.deepEqual(made.body.quickReplies, ['Yes, we can do it']);
        assert.deepEqual(made.body.questions.map((q) => [q.label, q.recommended]), [['Event date', true], ['How many plates?', true]]);
        const tiffin = await request(app).post('/api/shop/services').set(w.owner.headers).send({ kind: 'tiffin' });
        assert.ok(tiffin.body.questions.length >= 5);   // the others keep the built-in set
        // "Use recommended settings" brings his new set back
        const owner = await request(app).patch(`/api/shop/services/${made.body._id}`).set(w.owner.headers).send({ questions: [] });
        assert.equal(owner.body.questions.length, 0);
        const back = await request(app).post(`/api/shop/services/${made.body._id}/recommended`).set(w.owner.headers);
        assert.equal(back.body.questions.length, 2);
    });

    test('bad defaults are refused, and one kind can be reset', async () => {
        assert.equal((await request(app).put('/api/admin/services/defaults').set(auth()).send({ reminderHours: 0 })).status, 400);
        assert.equal((await request(app).put('/api/admin/services/defaults').set(auth()).send({ reminderHours: 500 })).status, 400);
        assert.equal((await request(app).put('/api/admin/services/defaults').set(auth()).send({ kinds: { nope: {} } })).status, 400);
        assert.equal((await request(app).put('/api/admin/services/defaults').set(auth()).send({ kinds: { bulk: { questions: [{ type: 'choice', label: 'x', options: ['one'] }] } } })).status, 400);
        await request(app).put('/api/admin/services/defaults').set(auth()).send({ kinds: { bulk: { quickTexts: ['x'] } } });
        const r = await request(app).post('/api/admin/services/defaults/reset').set(auth()).send({ kind: 'bulk' });
        assert.equal(r.body.kinds.bulk.changed, false);
        assert.notDeepEqual(r.body.kinds.bulk.quickTexts, ['x']);
        assert.equal((await request(app).post('/api/admin/services/defaults/reset').set(auth()).send({ kind: 'custom' })).status, 400);
    });
});

describe('the reminder for an inquiry nobody answered', () => {
    test('after the delay the owner is reminded once; answering stops it; a new customer message starts it again', async () => {
        const i = await inquiry({ lastMessageAt: new Date(Date.now() - 30 * HOUR) });
        assert.equal(await reminders.sweep(), 1);
        await wait();
        const note = await Notification.findOne({ tenantId: w.tenant._id, type: 'inquiry_unanswered' }).lean();
        assert.match(note.title, /waiting for your reply/);
        assert.match(note.body, /Anil asked about Bulk Order Booking/);
        assert.equal(await reminders.sweep(), 0);   // once
        // the customer writes again and it waits another day
        await ServiceInquiry.updateOne({ _id: i._id }, { $set: { lastMessageAt: new Date(Date.now() - 26 * HOUR), unansweredNotifiedAt: new Date(Date.now() - 40 * HOUR) } });   // the new message is later than the last reminder
        assert.equal(await reminders.sweep(), 1);
        // the owner opened it (ownerUnread 0): no reminder
        await ServiceInquiry.updateOne({ _id: i._id }, { $set: { ownerUnread: 0, lastMessageAt: new Date(Date.now() - 80 * HOUR) } });
        assert.equal(await reminders.sweep(), 0);
    });

    test('a recent inquiry, a closed one and the delay he chose', async () => {
        await inquiry({ lastMessageAt: new Date(Date.now() - 2 * HOUR) });
        await inquiry({ lastMessageAt: new Date(Date.now() - 40 * HOUR), status: 'closed' });
        assert.equal(await reminders.sweep(), 0);
        await request(app).put('/api/admin/services/defaults').set(auth()).send({ reminderHours: 1 });   // he wants a nudge after an hour
        assert.equal(await reminders.sweep(), 1);
    });

    test('the owner\'s inquiry alert covers it, with a Hindi sentence for the voice', () => {
        const alerts = require('../src/notifications/alertGroups');
        assert.equal(alerts.groupOf('admin', 'inquiry_unanswered')?.id, 'inquiries');
        assert.match(require('../src/notifications/templates/textsHi').build('inquiry_unanswered', { name: 'Anil', service: 'Bulk', hours: 24 }), /जवाब नहीं गया/);
        assert.equal(svc.DEFAULT_REMINDER_HOURS, 24);
    });
});
