require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const auto = require('../src/services/automations');
const tb = require('../src/services/tableBooking');
const closures = require('../src/services/bookingClosures');
const Tenant = require('../src/models/Tenant');
const TableBooking = require('../src/models/TableBooking');
const Notification = require('../src/models/Notification');

// A holiday, a day off or a closed slot added AFTER guests booked: those reservations are found, the owner is reminded, and one button cancels them all.
let w;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
let n = 0;
beforeEach(async () => { await db.clear(); n += 1; w = await f.makeWorld('closure-shop-' + n); });   // a new slug each time: the app remembers a shop by its slug

const day = (n) => tb.addDays(tb.todayYmd(), n);
const booking = (date, time = '20:00', o = {}) => TableBooking.create({
    tenantId: w.tenant._id, userId: w.customer.user._id, code: 'ABCDE', name: 'Asha', phone: '9000000030', date, time, party: 2, table: '4',
    startsAt: new Date(`${date}T${time}:00+05:30`), endsAt: new Date(new Date(`${date}T${time}:00+05:30`).getTime() + 3600000), status: 'confirmed', deposit: { amount: 200, status: 'unpaid' }, ...o,
});
const setHours = (hours) => Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.hours': hours } });

describe('reservations on a closed time', () => {
    test('closedFor knows the holiday, the day off, the closed day and slot, and the hours of the weekday', () => {
        const date = '2026-11-18';   // a Wednesday
        const open = [{ open: '12:00', close: '22:00' }];
        const base = { ...tb.DEFAULTS, slotMinutes: 60, shopHours: { weekly: { wed: open }, closedDates: [] } };
        assert.equal(tb.closedFor(base, date, '20:00'), false);
        assert.equal(tb.closedFor(base, date, '22:30'), true);                                                         // after closing
        assert.equal(tb.closedFor({ ...base, shopHours: { weekly: { wed: [] }, closedDates: [] } }, date, '20:00'), true);   // a day off
        assert.equal(tb.closedFor({ ...base, shopHours: { weekly: { wed: open }, closedDates: [{ from: '2026-11-17', to: '2026-11-19' }] } }, date, '20:00'), true);   // a holiday
        assert.equal(tb.closedFor({ ...base, closedDates: [date] }, date, '20:00'), true);                             // the owner's closed day
        assert.equal(tb.closedFor({ ...base, closedSlots: [{ date, time: '20:00' }] }, date, '20:00'), true);           // a closed slot
        assert.equal(tb.closedFor({ ...base, shopHours: null }, date, '03:00'), false);                                 // no hours set: no limit
    });

    test('a holiday added later finds the guests, and one button cancels them all', async () => {
        const a = await booking(day(3), '20:00');
        const b = await booking(day(3), '21:00', { code: 'ZZZZZ' });
        const other = await booking(day(5), '20:00', { code: 'YYYYY' });
        assert.equal((await closures.closed(w.tenant._id)).length, 0);
        await setHours({ weekly: {}, closedDates: [{ from: day(3), to: day(3), message: 'Festival' }] });
        const rows = await closures.closed(w.tenant._id);
        assert.deepEqual(rows.map((r) => String(r._id)).sort(), [String(a._id), String(b._id)].sort());

        const list = await request(app).get('/api/shop/booking/closed').set(w.owner.headers);
        assert.equal(list.status, 200);
        assert.equal(list.body.count, 2);

        const done = await request(app).post('/api/shop/booking/closed/cancel').set(w.owner.headers).send({});
        assert.equal(done.status, 200);
        assert.equal(done.body.cancelled, 2);
        assert.equal((await TableBooking.findById(a._id)).status, 'cancelled');
        assert.equal((await TableBooking.findById(b._id)).status, 'cancelled');
        assert.equal((await TableBooking.findById(other._id)).status, 'confirmed');   // another day: untouched
        assert.equal((await TableBooking.findById(a._id)).cancelNote, 'The restaurant is closed on that day.');
    });

    test('saving the hours or a closed day says how many reservations it hits', async () => {
        await booking(day(2), '20:00');
        const hours = await request(app).put('/api/shop/settings').set(w.owner.headers).send({ hours: { weekly: {}, closedDates: [{ from: day(2), to: day(2), message: 'Closed' }] } });
        assert.equal(hours.status, 200, JSON.stringify(hours.body));
        assert.equal(hours.body.closedBookings, 1);
        const plain = await request(app).put('/api/shop/settings').set(w.owner.headers).send({ hours: { weekly: {}, closedDates: [] } });
        assert.equal(plain.body.closedBookings, 0);
    });

    test('the owner is reminded once a day, and only while the switch is on', async () => {
        await booking(day(2), '20:00');
        await setHours({ weekly: {}, closedDates: [{ from: day(2), to: day(2), message: 'Closed' }] });
        const cfgOf = async (id) => auto.get(id);
        const told = () => Notification.countDocuments({ tenantId: w.tenant._id, type: 'automation_remind', 'data.kind': 'booking' });
        assert.equal(await auto.closedDayBookings(Date.now(), cfgOf), 1);
        assert.equal(await told(), 1);
        assert.equal(await auto.closedDayBookings(Date.now() + 3600000, cfgOf), 0);   // the same day: not again
        await auto.save(w.tenant._id, { closedDayReminders: false });
        assert.equal(await auto.closedDayBookings(Date.now() + 25 * 3600000, cfgOf), 0);   // switched off
    });
});
