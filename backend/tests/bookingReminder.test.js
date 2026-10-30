require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const TableBooking = require('../src/models/TableBooking');
const Notification = require('../src/models/Notification');
const pushChannel = require('../src/notifications/channels/push');
const bp = require('../src/services/bookingPayment');
const hi = require('../src/notifications/templates/textsHi');
const alerts = require('../src/notifications/alertGroups');

// Half an hour before a booked table, the guest and the owner are both reminded, once. After the owner allows a booking the guest's table card stays until the slot is over.
let w; let n = 0;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => { await db.clear(); mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 })); w = await f.makeWorld(`remind-${++n}`); });
afterEach(() => mock.restoreAll());

const MIN = 60000;
const make = (o = {}) => {
    const startsAt = o.startsAt || new Date(Date.now() + 20 * MIN);
    return TableBooking.create({
        tenantId: w.tenant._id, userId: w.customer.user._id, code: 'ABCDE', name: 'Anil', phone: '9000000030', date: '2026-11-20', time: '20:00', party: 4,
        startsAt, endsAt: new Date(startsAt.getTime() + 60 * MIN), status: 'confirmed', createdAt: new Date(startsAt.getTime() - 3 * 60 * MIN),
        rules: { refundHours: 2, depositMode: 'adjust' }, deposit: { amount: 800, status: 'paid' }, ...o,
    });
};
const wait = () => new Promise((r) => setTimeout(r, 300));
const card = () => request(app).get('/api/bookings/card').set(w.customer.headers);

describe('the 30 minute reminder', () => {
    test('both sides are reminded, once', async () => {
        await make();
        assert.equal(await bp.remind(), 1);
        await wait();
        const owner = await Notification.findOne({ tenantId: w.tenant._id, type: 'booking_reminder' }).lean();
        assert.match(owner.title, /30 minutes/);
        assert.match(owner.body, /Anil, 4 guests at 20:00/);
        const guest = await Notification.findOne({ userId: w.customer.user._id, type: 'booking_reminder_customer' }).lean();
        assert.match(guest.body, /ABCDE/);
        assert.equal(await bp.remind(), 0);
        assert.equal(await Notification.countDocuments({ type: 'booking_reminder' }), 1);
    });

    test('it comes at half an hour, not before', async () => {
        await make({ startsAt: new Date(Date.now() + 50 * MIN) });
        assert.equal(await bp.remind(), 0);
        assert.equal(await bp.remind(Date.now() + 25 * MIN), 1);
    });

    test('a booking made inside the half hour is not reminded, and neither is a cancelled one', async () => {
        const soon = new Date(Date.now() + 20 * MIN);
        await make({ createdAt: new Date(Date.now() - 5 * MIN), startsAt: soon });
        await make({ startsAt: soon, status: 'cancelled' });
        assert.equal(await bp.remind(), 0);
    });

    test('the owner\'s reminder has its own alert switches and a Hindi sentence for the voice', () => {
        const g = alerts.groupOf('admin', 'booking_reminder');
        assert.equal(g.id, 'booking_reminders');
        assert.ok(g.sample.en && g.sample.hi);
        assert.deepEqual(Object.keys(g.can).sort(), ['n', 'p', 's', 'v']);
        assert.match(hi.build('booking_reminder', { name: 'Anil', party: 4, time: '20:00' }), /आधे घंटे में टेबल बुकिंग/);
    });
});

describe('the table card', () => {
    test('nothing until the owner allows the booking', async () => {
        await make();
        assert.equal((await card()).body.card, null);
    });

    test('after Allow the card shows, from then until the slot is over', async () => {
        const b = await make({ startsAt: new Date(Date.now() + 5 * 60 * MIN) });   // hours away
        assert.equal((await request(app).post(`/api/shop/booking/${b._id}/allow`).set(w.owner.headers)).status, 200);
        const c = (await card()).body.card;
        assert.deepEqual([c.code, c.time, c.party], ['ABCDE', '20:00', 4]);
        // during the slot it is still there
        await TableBooking.updateOne({ _id: b._id }, { $set: { startsAt: new Date(Date.now() - 20 * MIN), endsAt: new Date(Date.now() + 40 * MIN) } });
        assert.ok((await card()).body.card);
        // once the slot is over it goes
        await TableBooking.updateOne({ _id: b._id }, { $set: { startsAt: new Date(Date.now() - 90 * MIN), endsAt: new Date(Date.now() - 30 * MIN) } });
        assert.equal((await card()).body.card, null);
    });

    test('a cancelled or seated booking has no card, and the card is the guest\'s own', async () => {
        const b = await make({ approvedAt: new Date() });
        assert.ok((await card()).body.card);
        const other = await f.makeUser(w.tenant, 'customer', '9000000077');
        assert.equal((await request(app).get('/api/bookings/card').set(other.headers)).body.card, null);
        await TableBooking.updateOne({ _id: b._id }, { $set: { status: 'seated' } });
        assert.equal((await card()).body.card, null);
        await TableBooking.updateOne({ _id: b._id }, { $set: { status: 'cancelled' } });
        assert.equal((await card()).body.card, null);
    });
});
