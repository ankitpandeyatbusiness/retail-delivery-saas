require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const tb = require('../src/services/tableBooking');
const wl = require('../src/services/bookingWaitlist');
const tableBill = require('../src/services/tableBill');
const TableBooking = require('../src/models/TableBooking');
const TableSession = require('../src/models/TableSession');
const BookingTableLock = require('../src/models/BookingTableLock');
const BookingUserLock = require('../src/models/BookingUserLock');
const Notification = require('../src/models/Notification');
const Tenant = require('../src/models/Tenant');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const pushChannel = require('../src/notifications/channels/push');

// Cinema style: the guest picks a day, a time and a table. One table, one slot, one winner. Nobody holds two tables for the same time.
const TABLES = [{ no: '1', seats: 2 }, { no: '2', seats: 4 }, { no: '3', seats: 4 }, { no: '4', seats: 8 }];
let n = 0;
const wait = (ms = 300) => new Promise((r) => setTimeout(r, ms));
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(() => mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 })));
afterEach(() => mock.restoreAll());

async function shop(tables = TABLES) {
    await db.clear();
    const slug = `tables-${++n}`;
    const w = await f.makeWorld(slug);
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.dineIn': { enabled: true, tableCount: 10 } } });
    tenantRecognizer.invalidateTenant(slug);
    const date = tb.addDays(tb.todayYmd(), 2);
    const r = await request(app).put('/api/shop/booking/settings').set(w.owner.headers).send({
        windows: [{ days: [], open: '19:00', close: '22:00' }], tables, maxParty: 8, depositType: 'per_person', depositAmount: 200, enabled: true,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const guest = (phone) => f.makeUser(w.tenant, 'customer', phone);
    const book = (h, time, table, party = 2) => request(app).post('/api/bookings').set(h).send({ date, time, table, party, name: 'Anil', phone: '9000000030' });
    const tablesOf = async (time, party = 2) => (await request(app).get(`/api/bookings/tables?date=${date}&time=${time}&party=${party}`).set(w.customer.headers)).body.tables;
    return { w, date, guest, book, tablesOf };
}

describe('choosing a table', () => {
    test('the guest sees the tables of a slot: free, taken, and too small for his group', async () => {
        const { w, tablesOf, book } = await shop();
        const cfg = (await request(app).get('/api/bookings/config').set(w.customer.headers)).body;
        assert.deepEqual([cfg.maxParty, cfg.tables.length], [8, 4]);
        assert.deepEqual((await tablesOf('19:00', 3)).map((t) => [t.no, t.state]), [['1', 'small'], ['2', 'free'], ['3', 'free'], ['4', 'free']]);
        assert.equal((await book(w.customer.headers, '19:00', '2', 3)).status, 201);
        assert.deepEqual((await tablesOf('19:00', 3)).map((t) => [t.no, t.state]), [['1', 'small'], ['2', 'taken'], ['3', 'free'], ['4', 'free']]);
        assert.deepEqual((await tablesOf('20:00', 3)).map((t) => t.state), ['small', 'free', 'free', 'free']);   // another time: the table is free
    });

    test('the booking is for that table, and nobody else can take it for that time', async () => {
        const { w, guest, book } = await shop();
        const first = await book(w.customer.headers, '19:00', '2');
        assert.equal(first.status, 201, JSON.stringify(first.body));
        assert.equal(first.body.booking.table, '2');
        const other = await guest('9300000001');
        const taken = await book(other.headers, '19:00', '2');
        assert.equal(taken.status, 409);
        assert.match(taken.body.error, /table 2 was just taken/);
        assert.equal((await book(other.headers, '19:00', '3')).status, 201);   // another table is fine
        assert.equal((await book(other.headers, '20:00', '2')).status, 201);   // another time is fine (his older unpaid hold is let go)
    });

    test('a group bigger than the table, or than any table, is refused', async () => {
        const { w, book } = await shop();
        const small = await book(w.customer.headers, '19:00', '1', 3);
        assert.equal(small.status, 400);
        assert.match(small.body.error, /Table 1 seats 2/);
        assert.equal((await book(w.customer.headers, '19:00', '4', 9)).status, 400);
        assert.equal((await book(w.customer.headers, '19:00', '99', 2)).status, 400);   // a table that does not exist
        assert.equal((await book(w.customer.headers, '19:00', undefined, 2)).status, 400);   // no table picked
    });

    test('the same guest cannot hold two tables for the same time, but can book other times', async () => {
        const { w, book } = await shop();
        const a = await book(w.customer.headers, '19:00', '2');
        assert.equal(a.status, 201);
        // asking again for the very same table gives him his own booking back (no second one)
        const again = await book(w.customer.headers, '19:00', '2');
        assert.equal(again.status, 200);
        assert.equal(again.body.booking._id, a.body.booking._id);
        assert.equal(await TableBooking.countDocuments({ tenantId: w.tenant._id, userId: w.customer.user._id, status: 'held' }), 1);
    });

    test('one table, eight guests at the same moment: exactly one gets it', async () => {
        const { w, guest, book } = await shop();
        const guests = await Promise.all(Array.from({ length: 8 }, (_, i) => guest(`931000000${i}`)));
        const res = await Promise.all(guests.map((g) => book(g.headers, '21:00', '4', 2)));
        assert.equal(res.filter((r) => r.status === 201).length, 1);
        assert.equal(res.filter((r) => r.status === 409).length, 7);
        assert.equal(await BookingTableLock.countDocuments({ tenantId: w.tenant._id, time: '21:00', table: '4' }), 1);
        assert.equal(await TableBooking.countDocuments({ tenantId: w.tenant._id, table: '4', time: '21:00', status: 'held' }), 1);
    });

    test('one guest, five taps for different tables at once: he ends with one table, never two', async () => {
        const { w, book } = await shop();
        await Promise.all(['1', '2', '3', '4', '2'].map((t) => book(w.customer.headers, '21:00', t, 2)));
        assert.equal(await BookingUserLock.countDocuments({ tenantId: w.tenant._id, userId: w.customer.user._id, time: '21:00' }), 1);
        assert.equal(await BookingTableLock.countDocuments({ tenantId: w.tenant._id, time: '21:00' }), 1);
        assert.equal(await TableBooking.countDocuments({ tenantId: w.tenant._id, userId: w.customer.user._id, time: '21:00', status: 'held' }), 1);
    });

    test('a cancelled or let-go booking gives the table back', async () => {
        const { w, guest, book, tablesOf } = await shop();
        const r = await book(w.customer.headers, '19:00', '3');
        assert.equal((await tablesOf('19:00')).find((t) => t.no === '3').state, 'taken');
        await request(app).post(`/api/bookings/${r.body.booking._id}/cancel`).set(w.customer.headers);
        assert.equal((await tablesOf('19:00')).find((t) => t.no === '3').state, 'free');
        assert.equal((await book((await guest('9320000001')).headers, '19:00', '3')).status, 201);
    });
});

describe('a table is free again when the guest leaves early', () => {
    const at = (date, hhmm) => new Date(`${date}T${hhmm}:00+05:30`).getTime();
    async function setup() {
        const s = await shop();
        const config = await tb.getConfig(s.w.tenant._id);
        return { ...s, config, date: tb.todayYmd() };   // "today", with a clock the test controls
    }

    test('seated guest pays and leaves at 20:20: the table is free for the rest of the 20:00 slot', async () => {
        const { w, guest, config, date } = await setup();
        const a = await guest('9330000001');
        const b = await guest('9330000002');
        const booking = await tb.book({ config, userId: a.user._id, name: 'A', phone: '9330000001', date, time: '20:00', party: 2, table: '2', now: at(date, '18:00') });
        const session = await tableBill.joinOrOpen({ tenantId: w.tenant._id, table: '2', userId: a.user._id });
        await TableBooking.updateOne({ _id: booking._id }, { $set: { status: 'seated', sessionId: session._id } });
        // while he eats, the table is taken (the slot is running and the visit is open)
        const during = at(date, '20:10');
        assert.equal((await tb.tablesFor(config, date, '20:00', 2, during)).find((t) => t.no === '2').state, 'taken');
        await assert.rejects(() => tb.book({ config, userId: b.user._id, name: 'B', phone: '9330000002', date, time: '20:00', party: 2, table: '2', now: during }), /in use right now|just taken/);
        // he pays and the visit closes; the minute sweep gives the table back
        await TableSession.updateOne({ _id: session._id }, { $set: { status: 'closed', closedAt: new Date() } });
        assert.equal(await tb.freeFinished(new Date(at(date, '20:20'))), 1);
        assert.equal(await tb.freeFinished(new Date(at(date, '20:21'))), 0);   // once
        const after = at(date, '20:20');   // 40 minutes of the slot are left
        assert.equal((await tb.tablesFor(config, date, '20:00', 2, after)).find((t) => t.no === '2').state, 'free');
        const second = await tb.book({ config, userId: b.user._id, name: 'B', phone: '9330000002', date, time: '20:00', party: 2, table: '2', now: after });
        assert.equal(second.table, '2');
    });

    test('too little of the slot is left: it is not offered any more', async () => {
        const { config, date } = await setup();
        assert.deepEqual(await tb.tablesFor(config, date, '20:00', 2, at(date, '20:45')), []);   // 15 minutes left
    });

    test('a guest still eating keeps the table; a booking in the future is not touched', async () => {
        const { w, guest, config, date } = await setup();
        const a = await guest('9330000003');
        const fut = await tb.book({ config, userId: a.user._id, name: 'A', phone: '9330000003', date, time: '21:00', party: 2, table: '3', now: at(date, '18:00') });
        await TableBooking.updateOne({ _id: fut._id }, { $set: { status: 'seated' } });   // seated by the owner, no visit tied to it
        assert.equal(await tb.freeFinished(new Date(at(date, '19:00'))), 0);
        assert.equal(await BookingTableLock.countDocuments({ tenantId: w.tenant._id, table: '3', time: '21:00' }), 1);
    });

    test('the owner can say "the table is free now" himself', async () => {
        const { w, guest, config, date } = await setup();
        const a = await guest('9330000004');
        const booking = await tb.book({ config, userId: a.user._id, name: 'A', phone: '9330000004', date, time: '20:00', party: 2, table: '2', now: at(date, '18:00') });
        await TableBooking.updateOne({ _id: booking._id }, { $set: { status: 'seated', endsAt: new Date(Date.now() + 60 * 60000) } });
        const r = await request(app).post(`/api/shop/booking/${booking._id}/free`).set(w.owner.headers);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(await BookingTableLock.countDocuments({ tenantId: w.tenant._id, table: '2', time: '20:00' }), 0);
        assert.equal((await request(app).post(`/api/shop/booking/${booking._id}/free`).set(w.owner.headers)).status, 400);   // once
    });
});

describe('the waitlist', () => {
    const ONE = [{ no: '1', seats: 4 }];

    test('a full slot can be waited for; a slot with a free table cannot', async () => {
        const { w, guest, book, date } = await shop(ONE);
        await book(w.customer.headers, '19:00', '1');
        const b = await guest('9340000001');
        const slots = (await request(app).get(`/api/bookings/slots?date=${date}&party=2`).set(b.headers)).body.slots;
        assert.deepEqual(slots.map((s) => [s.time, s.ok, s.full]), [['19:00', false, true], ['20:00', true, false], ['21:00', true, false]]);
        const join = await request(app).post('/api/bookings/waitlist').set(b.headers).send({ date, time: '19:00', party: 2, name: 'Bina', phone: '9340000001' });
        assert.equal(join.status, 201, JSON.stringify(join.body));
        assert.equal((await request(app).post('/api/bookings/waitlist').set(b.headers).send({ date, time: '20:00', party: 2, name: 'Bina', phone: '9340000001' })).status, 409);   // a table is free then
        assert.equal((await request(app).post('/api/bookings/waitlist').set(b.headers).send({ date, time: '19:00', party: 5, name: 'Bina', phone: '9340000001' })).status, 400);   // no table is big enough
        assert.equal((await request(app).get('/api/bookings/waitlist/mine').set(b.headers)).body.items.length, 1);
        assert.equal((await request(app).get(`/api/shop/booking?date=${date}`).set(w.owner.headers)).body.waiting, 1);
    });

    test('when the table comes free the waiting guest is told, once, and booking it ends the wait', async () => {
        const { w, guest, book, date } = await shop(ONE);
        const a = await book(w.customer.headers, '19:00', '1');
        const b = await guest('9340000002');
        const c = await guest('9340000003');
        await request(app).post('/api/bookings/waitlist').set(b.headers).send({ date, time: '19:00', party: 2, name: 'Bina', phone: '9340000002' });
        await request(app).post('/api/bookings/waitlist').set(c.headers).send({ date, time: '19:00', party: 3, name: 'Chandra', phone: '9340000003' });
        assert.equal(await Notification.countDocuments({ type: 'booking_waitlist_free' }), 0);
        await request(app).post(`/api/bookings/${a.body.booking._id}/cancel`).set(w.customer.headers);   // the table comes free
        await wait();
        const told = await Notification.find({ type: 'booking_waitlist_free' }).lean();
        assert.equal(told.length, 2);   // both fit the one free table; the first to book wins it
        assert.match(told[0].body, /free on .* at 19:00/);
        await wl.notifyFreed(w.tenant._id, date, '19:00');   // told again right away? no
        await wait();
        assert.equal(await Notification.countDocuments({ type: 'booking_waitlist_free' }), 2);
        // Bina books it: she is no longer waiting, Chandra is told "taken" by the usual message when she tries
        assert.equal((await book(b.headers, '19:00', '1')).status, 201);
        assert.equal((await request(app).get('/api/bookings/waitlist/mine').set(b.headers)).body.items.length, 0);
        const late = await book(c.headers, '19:00', '1', 3);
        assert.equal(late.status, 409);
        assert.equal((await request(app).get('/api/bookings/waitlist/mine').set(c.headers)).body.items.length, 1);   // she is still waiting
    });

    test('a guest can leave the waitlist and join again', async () => {
        const { w, guest, book, date } = await shop(ONE);
        await book(w.customer.headers, '19:00', '1');
        const b = await guest('9340000004');
        const join = () => request(app).post('/api/bookings/waitlist').set(b.headers).send({ date, time: '19:00', party: 2, name: 'Bina', phone: '9340000004' });
        const e = await join();
        assert.equal((await request(app).delete(`/api/bookings/waitlist/${e.body._id}`).set(b.headers)).status, 200);
        assert.equal((await request(app).get('/api/bookings/waitlist/mine').set(b.headers)).body.items.length, 0);
        assert.equal((await join()).status, 201);
        assert.equal((await request(app).get('/api/bookings/waitlist/mine').set(b.headers)).body.items.length, 1);
        assert.equal((await join()).status, 201);   // twice is still one entry
        assert.equal((await request(app).get('/api/bookings/waitlist/mine').set(b.headers)).body.items.length, 1);
    });
});
