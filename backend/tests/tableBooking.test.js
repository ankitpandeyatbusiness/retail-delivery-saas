require('./helpers/env');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const tb = require('../src/services/tableBooking');
const { makeWorld, makeUser } = require('./helpers/factory');

describe('table booking rules', () => {
    const base = { ...tb.DEFAULTS, tenantId: 'x', windows: [{ days: [], open: '19:00', close: '22:00' }, { days: ['sat'], open: '12:00', close: '14:00' }], slotMinutes: 60, minNoticeMinutes: 0, advanceDays: 10 };
    const NOW = new Date('2026-11-02T06:00:00Z').getTime();   // 11:30 in India, a Monday
    test('slots follow the windows and the day of the week', () => {
        assert.deepEqual(tb.slotsFor(base, '2026-11-03', NOW), ['19:00', '20:00', '21:00']);
        assert.deepEqual(tb.slotsFor(base, '2026-11-07', NOW), ['12:00', '13:00', '19:00', '20:00', '21:00']);   // a Saturday has lunch too
    });
    test('closed days, closed slots, past times and too far ahead give nothing', () => {
        assert.deepEqual(tb.slotsFor({ ...base, closedDates: ['2026-11-03'] }, '2026-11-03', NOW), []);
        assert.deepEqual(tb.slotsFor({ ...base, closedSlots: [{ date: '2026-11-03', time: '20:00' }] }, '2026-11-03', NOW), ['19:00', '21:00']);
        assert.deepEqual(tb.slotsFor(base, '2026-11-01', NOW), []);
        assert.deepEqual(tb.slotsFor(base, '2026-12-25', NOW), []);
    });
    test('a slot that starts too soon is hidden', () => {
        const soon = new Date('2026-11-03T13:00:00Z').getTime();   // 18:30 in India
        assert.deepEqual(tb.slotsFor({ ...base, minNoticeMinutes: 60 }, '2026-11-03', soon), ['20:00', '21:00']);
    });
    test('the deposit is flat or per person', () => {
        assert.equal(tb.depositFor({ depositType: 'per_person', depositAmount: 200 }, 20), 4000);
        assert.equal(tb.depositFor({ depositType: 'flat', depositAmount: 500 }, 20), 500);
    });
    test('the settings are checked', () => {
        const cur = { ...tb.DEFAULTS, depositAmount: 100 };
        assert.throws(() => tb.cleanConfig({ enabled: true }, { ...tb.DEFAULTS }), /deposit/);
        assert.throws(() => tb.cleanConfig({ windows: [{ open: '22:00', close: '20:00' }] }, cur), /end after/);
        assert.throws(() => tb.cleanConfig({ windows: [{ open: '9am', close: '20:00' }] }, cur), /like 19:30/);
        assert.throws(() => tb.cleanConfig({ maxParty: 30 }, { ...cur, seatsPerSlot: 20 }), /seats per slot/);
        assert.equal(tb.cleanConfig({ enabled: true }, cur).enabled, true);
    });
});

describe('table booking flow', () => {
    let w; let date; let id;
    before(async () => { await db.connect(); w = await makeWorld('book-shop'); date = tb.addDays(tb.todayYmd(), 2); });
    after(() => db.disconnect());
    const slots = (party = 2, h = w.customer.headers) => request(app).get(`/api/bookings/slots?date=${date}&party=${party}`).set(h);

    test('booking is off until the owner sets a deposit and switches it on', async () => {
        assert.equal((await request(app).get('/api/bookings/config').set(w.customer.headers)).body.enabled, false);
        assert.equal((await slots()).status, 404);
        const bad = await request(app).put('/api/shop/booking/settings').set(w.owner.headers).send({ enabled: true });
        assert.equal(bad.status, 400);
        const ok = await request(app).put('/api/shop/booking/settings').set(w.owner.headers).send({
            windows: [{ days: [], open: '19:00', close: '21:00' }], seatsPerSlot: 6, maxParty: 6, depositType: 'per_person', depositAmount: 200, enabled: true,
        });
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
        assert.equal(ok.body.enabled, true);
    });

    test('a customer cannot change the rules', async () => {
        assert.ok([401, 403].includes((await request(app).put('/api/shop/booking/settings').set(w.customer.headers).send({ seatsPerSlot: 100 })).status));
    });

    test('the guest sees slots with the deposit, then books', async () => {
        const s = await slots(4);
        assert.deepEqual(s.body.slots.map((x) => x.time), ['19:00', '20:00']);
        assert.equal(s.body.deposit, 800);
        const r = await request(app).post('/api/bookings').set(w.customer.headers).send({ date, time: '19:00', party: 4, name: 'Anil', phone: '9000000030', note: 'Window seat' });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        assert.equal(r.body.deposit.amount, 800);
        assert.equal(r.body.code.length, 5);
        id = r.body._id;
        const after = (await slots(4)).body.slots.find((x) => x.time === '19:00');
        assert.deepEqual([after.left, after.ok], [2, false]);
    });

    test('a group that does not fit, or a time that is not a slot, is refused', async () => {
        const full = await request(app).post('/api/bookings').set(w.customer.headers).send({ date, time: '19:00', party: 3, name: 'Anil', phone: '9000000030' });
        assert.equal(full.status, 409);
        const odd = await request(app).post('/api/bookings').set(w.customer.headers).send({ date, time: '19:30', party: 2, name: 'Anil', phone: '9000000030' });
        assert.equal(odd.status, 400);
        const huge = await request(app).post('/api/bookings').set(w.customer.headers).send({ date, time: '20:00', party: 9, name: 'Anil', phone: '9000000030' });
        assert.equal(huge.status, 400);
    });

    test('many guests booking the last seats at the same moment never overbook', async () => {
        const guests = await Promise.all(['9100000001', '9100000002', '9100000003', '9100000004', '9100000005', '9100000006'].map((p) => makeUser(w.tenant, 'customer', p)));
        const res = await Promise.all(guests.map((g) => request(app).post('/api/bookings').set(g.headers).send({ date, time: '20:00', party: 2, name: 'G', phone: '9100000000' })));
        assert.equal(res.filter((r) => r.status === 201).length, 3);   // 6 seats, 2 each
        assert.equal(res.filter((r) => r.status === 409).length, 3);
    });

    test('the owner sees the day, and cancelling gives the seats back', async () => {
        const day = await request(app).get(`/api/shop/booking?date=${date}`).set(w.owner.headers);
        assert.equal(day.body.items.length, 4);
        assert.equal(day.body.seats, 10);
        const c = await request(app).post(`/api/shop/booking/${id}/cancel`).set(w.owner.headers);
        assert.equal(c.body.status, 'cancelled');
        assert.equal((await slots(4)).body.slots.find((x) => x.time === '19:00').left, 6);
        assert.equal((await request(app).post(`/api/shop/booking/${id}/cancel`).set(w.owner.headers)).status, 400);
    });

    test('the guest cancels his own booking, and sees his list', async () => {
        const r = await request(app).post('/api/bookings').set(w.customer.headers).send({ date, time: '19:00', party: 2, name: 'Anil', phone: '9000000030' });
        const mine = await request(app).get('/api/bookings/mine').set(w.customer.headers);
        assert.equal(mine.body.items.length, 2);   // the one the owner cancelled, and this one
        const c = await request(app).post(`/api/bookings/${r.body._id}/cancel`).set(w.customer.headers);
        assert.equal(c.body.status, 'cancelled');
        assert.equal(c.body.cancelledBy, 'customer');
    });

    test('the owner seats a guest and marks a no-show; neither can be undone', async () => {
        const day = (await request(app).get(`/api/shop/booking?date=${date}`).set(w.owner.headers)).body.items.filter((b) => b.status === 'confirmed');
        const seat = await request(app).post(`/api/shop/booking/${day[0]._id}/seat`).set(w.owner.headers);
        assert.equal(seat.body.status, 'seated');
        assert.equal((await request(app).post(`/api/shop/booking/${day[0]._id}/no-show`).set(w.owner.headers)).status, 400);
        assert.equal((await request(app).post(`/api/shop/booking/${day[1]._id}/no-show`).set(w.owner.headers)).body.status, 'no_show');
    });
});
