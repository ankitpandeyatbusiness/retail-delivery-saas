require('./helpers/env');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const tb = require('../src/services/tableBooking');
const bp = require('../src/services/bookingPayment');
const payments = require('../src/services/adapters/payments');
const TableBooking = require('../src/models/TableBooking');
const BookingTableLock = require('../src/models/BookingTableLock');
const BookingUserLock = require('../src/models/BookingUserLock');
const { makeWorld, makeUser } = require('./helpers/factory');

// The guest's phone pays at Razorpay; the server is then shown the proof.
const sign = (orderId, paymentId) => crypto.createHmac('sha256', 'mock_key_secret').update(`${orderId}|${paymentId}`).digest('hex');
let payN = 0;
const capture = (pay) => { const id = `pay_mock_${++payN}`; payments._mock.setPayment({ id, orderId: pay.rzpOrderId, status: 'captured', amountPaise: pay.amountPaise }); return id; };
const TABLES = Array.from({ length: 6 }, (_, i) => ({ no: String(i + 1), seats: 6 }));

describe('table booking with a paid deposit', () => {
    let w; let date;
    before(async () => {
        await db.connect(); w = await makeWorld('book-pay'); date = tb.addDays(tb.todayYmd(), 2);
        const r = await request(app).put('/api/shop/booking/settings').set(w.owner.headers).send({
            windows: [{ days: [], open: '19:00', close: '22:00' }], tables: TABLES, maxParty: 6, depositType: 'per_person', depositAmount: 200, refundHours: 2, enabled: true,
        });
        assert.equal(r.status, 200, JSON.stringify(r.body));
    });
    after(() => db.disconnect());

    const settings = (body) => request(app).put('/api/shop/booking/settings').set(w.owner.headers).send(body);
    const fresh = (time) => Promise.all([BookingTableLock.deleteMany({ tenantId: w.tenant._id, date, time }), BookingUserLock.deleteMany({ tenantId: w.tenant._id, date, time })]);
    const guest = (phone) => makeUser(w.tenant, 'customer', phone);
    const book = (time, party = 2, h = w.customer.headers, table = '1') => request(app).post('/api/bookings').set(h).send({ date, time, party, table, name: 'Anil', phone: '9000000030' });
    const payIt = (res, h = w.customer.headers) => {
        const pid = capture(res.body.pay);
        return request(app).post(`/api/bookings/${res.body.booking._id}/verify`).set(h).send({ razorpay_order_id: res.body.pay.rzpOrderId, razorpay_payment_id: pid, razorpay_signature: sign(res.body.pay.rzpOrderId, pid) });
    };
    const stateOf = async (time, table = '1') => (await request(app).get(`/api/bookings/tables?date=${date}&time=${time}&party=2`).set(w.customer.headers)).body.tables.find((t) => t.no === table).state;
    const row = (id) => TableBooking.findById(id).lean();

    test('booking holds the table and asks for the deposit; it is not confirmed until paid', async () => {
        const r = await book('19:00', 4);
        assert.equal(r.status, 201, JSON.stringify(r.body));
        assert.deepEqual([r.body.booking.status, r.body.booking.table], ['held', '1']);
        assert.equal(r.body.pay.amountPaise, 80000);
        assert.ok(r.body.pay.rzpOrderId && r.body.pay.keyId);
        assert.equal(await stateOf('19:00'), 'taken');   // a held table is taken
        assert.equal((await request(app).get(`/api/shop/booking?date=${date}`).set(w.owner.headers)).body.items.length, 0);   // the owner sees only paid bookings
        const paid = await payIt(r);
        assert.equal(paid.body.paid, true, JSON.stringify(paid.body));
        assert.deepEqual([paid.body.booking.status, paid.body.booking.deposit.status], ['confirmed', 'paid']);
        assert.equal((await request(app).get(`/api/shop/booking?date=${date}`).set(w.owner.headers)).body.items.length, 1);
        assert.equal((await payIt(r)).body.paid, true);   // a repeat changes nothing
        assert.equal(await stateOf('19:00'), 'taken');
    });

    test('a wrong proof confirms nothing; cancelling a held booking gives the table back', async () => {
        const r = await book('20:00', 2);
        const pid = capture(r.body.pay);
        const bad = await request(app).post(`/api/bookings/${r.body.booking._id}/verify`).set(w.customer.headers).send({ razorpay_order_id: r.body.pay.rzpOrderId, razorpay_payment_id: pid, razorpay_signature: 'nope' });
        assert.equal(bad.status, 400);
        assert.equal((await row(r.body.booking._id)).status, 'held');
        await request(app).post(`/api/bookings/${r.body.booking._id}/cancel`).set(w.customer.headers);
        assert.equal(await stateOf('20:00'), 'free');
    });

    test('an unpaid hold is let go after its time and the table comes back, once', async () => {
        const r = await book('21:00', 3, (await guest('9200000001')).headers, '2');
        assert.equal(await stateOf('21:00', '2'), 'taken');
        await bp.sweep(Date.now() + 5 * 60000);   // inside the hold: nothing happens
        assert.equal((await row(r.body.booking._id)).status, 'held');
        await bp.sweep(Date.now() + 11 * 60000);
        assert.equal((await row(r.body.booking._id)).status, 'expired');
        assert.equal(await stateOf('21:00', '2'), 'free');
        await bp.sweep(Date.now() + 12 * 60000);
        assert.equal(await stateOf('21:00', '2'), 'free');
    });

    test('a payment that arrives after the hold ran out confirms the booking when the table is still free', async () => {
        const r = await book('21:00', 2, (await guest('9200000002')).headers, '3');
        await bp.sweep(Date.now() + 11 * 60000);
        assert.equal((await row(r.body.booking._id)).status, 'expired');
        const pid = capture(r.body.pay);
        const hook = await bp.onWebhook({ account: w.tenant._id, rzp: { id: pid, orderId: r.body.pay.rzpOrderId, status: 'captured', amountPaise: r.body.pay.amountPaise } });
        assert.equal(hook.paid, true);
        assert.equal((await row(r.body.booking._id)).status, 'confirmed');
        assert.equal(await stateOf('21:00', '3'), 'taken');
    });

    test('a late payment for a table that someone else took is sent straight back', async () => {
        const a = await guest('9200000003');
        const c = await book('20:00', 2, (await guest('9200000004')).headers, '4');
        await bp.sweep(Date.now() + 11 * 60000);
        assert.equal((await book('20:00', 2, a.headers, '4')).status, 201);   // someone else took the table
        const pid = capture(c.body.pay);
        const hook = await bp.onWebhook({ account: w.tenant._id, rzp: { id: pid, orderId: c.body.pay.rzpOrderId, status: 'captured', amountPaise: c.body.pay.amountPaise } });
        assert.equal(hook.refunded, true);
        const b = await row(c.body.booking._id);
        assert.deepEqual([b.status, b.deposit.status], ['cancelled', 'refunded']);
    });

    test('the guest cancels early: the deposit goes back', async () => {
        await fresh('19:00');
        const g = await guest('9200000005');
        const r = await book('19:00', 2, g.headers, '5');
        await payIt(r, g.headers);
        const c = await request(app).post(`/api/bookings/${r.body.booking._id}/cancel`).set(g.headers);
        assert.equal(c.status, 200, JSON.stringify(c.body));
        assert.deepEqual([c.body.status, c.body.deposit.status], ['cancelled', 'refunded']);
        assert.ok(c.body.deposit.refundId);
        assert.equal((await request(app).post(`/api/bookings/${r.body.booking._id}/cancel`).set(g.headers)).status, 400);
        assert.equal(await stateOf('19:00', '5'), 'free');
    });

    test('the guest cancels too late: the shop keeps it, by the rule he saw when he booked', async () => {
        await settings({ refundHours: 100 });
        await fresh('19:00');
        const g = await guest('9200000006');
        const r = await book('19:00', 2, g.headers, '5');
        await payIt(r, g.headers);
        await settings({ refundHours: 0 });   // a later change does not rescue him
        assert.equal((await request(app).post(`/api/bookings/${r.body.booking._id}/cancel`).set(g.headers)).body.deposit.status, 'kept');
        await settings({ refundHours: 2 });
    });

    test('when the owner cancels, the deposit always goes back', async () => {
        await settings({ refundHours: 100 });
        await fresh('19:00');
        const g = await guest('9200000007');
        const r = await book('19:00', 2, g.headers, '5');
        await payIt(r, g.headers);
        assert.equal((await request(app).post(`/api/shop/booking/${r.body.booking._id}/cancel`).set(w.owner.headers)).body.deposit.status, 'refunded');
        await settings({ refundHours: 2 });
    });

    test('no-show keeps the deposit; seated waits for the bill (adjust) or is kept (keep)', async () => {
        await fresh('19:00');
        const mk = async (phone, time, table) => { const g = await guest(phone); const r = await book(time, 1, g.headers, table); await payIt(r, g.headers); return r.body.booking._id; };
        const [a, b] = [await mk('9200000008', '19:00', '1'), await mk('9200000009', '19:00', '2')];
        assert.equal((await request(app).post(`/api/shop/booking/${a}/no-show`).set(w.owner.headers)).body.deposit.status, 'kept');
        const seat = await request(app).post(`/api/shop/booking/${b}/seat`).set(w.owner.headers);
        assert.deepEqual([seat.body.status, seat.body.deposit.status, seat.body.deposit.credit], ['seated', 'paid', 'pending']);
        const done = await request(app).post(`/api/shop/booking/${b}/adjusted`).set(w.owner.headers);   // the waiter took it off the bill
        assert.deepEqual([done.body.deposit.status, done.body.deposit.credit], ['adjusted', 'applied']);
        assert.equal((await request(app).post(`/api/shop/booking/${b}/adjusted`).set(w.owner.headers)).status, 400);   // only once
        await settings({ depositMode: 'keep' });
        await fresh('20:00');
        const k = await mk('9200000010', '20:00', '1');
        assert.equal((await request(app).post(`/api/shop/booking/${k}/seat`).set(w.owner.headers)).body.deposit.status, 'kept');
    });

    test('a refund that failed is tried again by the sweeper, and sent only once', async () => {
        await fresh('21:00');
        const g = await guest('9200000011');
        const r = await book('21:00', 1, g.headers, '5');
        await payIt(r, g.headers);
        await TableBooking.updateOne({ _id: r.body.booking._id }, { $set: { status: 'cancelled', 'deposit.status': 'refund_failed' } });
        await bp.sweep();
        const done = await row(r.body.booking._id);
        assert.equal(done.deposit.status, 'refunded');
        await bp.sweep();
        assert.equal((await row(r.body.booking._id)).deposit.refundId, done.deposit.refundId);
    });

    test('a booking is never confirmed without the full deposit being captured', async () => {
        await fresh('19:00');
        const g = await guest('9200000020');
        const r = await book('19:00', 2, g.headers, '6');
        const proof = (pid) => ({ razorpay_order_id: r.body.pay.rzpOrderId, razorpay_payment_id: pid, razorpay_signature: sign(r.body.pay.rzpOrderId, pid) });
        const verify = (pid) => request(app).post(`/api/bookings/${r.body.booking._id}/verify`).set(g.headers).send(proof(pid));
        payments._mock.setPayment({ id: 'pay_auth', orderId: r.body.pay.rzpOrderId, status: 'authorized', amountPaise: r.body.pay.amountPaise });   // authorised, not captured
        assert.equal((await verify('pay_auth')).body.paid, false);
        payments._mock.setPayment({ id: 'pay_less', orderId: r.body.pay.rzpOrderId, status: 'captured', amountPaise: r.body.pay.amountPaise - 100 });   // less than the deposit
        assert.equal((await verify('pay_less')).body.paid, false);
        payments._mock.setPayment({ id: 'pay_other', orderId: 'order_someone_else', status: 'captured', amountPaise: r.body.pay.amountPaise });   // another Razorpay order
        assert.equal((await verify('pay_other')).body.paid, false);
        const still = await row(r.body.booking._id);
        assert.deepEqual([still.status, still.deposit.status], ['held', 'unpaid']);
        assert.equal((await request(app).get(`/api/shop/booking?date=${date}`).set(w.owner.headers)).body.items.filter((b) => b._id === String(r.body.booking._id)).length, 0);
        assert.equal((await payIt(r, g.headers)).body.paid, true);   // the full amount captured: now it is confirmed
    });

    test('a guest holds a table for one unpaid booking at a time', async () => {
        await fresh('19:00'); await fresh('20:00');
        const g = await guest('9200000021');
        const first = await book('19:00', 4, g.headers, '2');
        assert.equal(await stateOf('19:00', '2'), 'taken');
        const second = await book('20:00', 4, g.headers, '2');   // changed his mind: the first unpaid hold is let go
        assert.equal(second.status, 201);
        assert.equal((await row(first.body.booking._id)).status, 'cancelled');
        assert.equal(await stateOf('19:00', '2'), 'free');
        assert.equal(await stateOf('20:00', '2'), 'taken');
    });

    test('the deposit cannot be switched off while booking is on', async () => {
        assert.equal((await settings({ depositAmount: 0 })).status, 400);
        assert.equal((await settings({ enabled: false })).status, 200);
        assert.equal((await settings({ depositAmount: 0 })).status, 200);   // off: allowed
        assert.equal((await settings({ enabled: true })).status, 400);       // and it cannot be switched back on without a deposit
        assert.equal((await settings({ depositAmount: 200, enabled: true })).status, 200);
    });

    test("a guest cannot pay for or cancel another guest's booking", async () => {
        await fresh('19:00');
        const r = await book('19:00', 1, (await guest('9200000012')).headers, '3');
        const other = await guest('9200000013');
        assert.equal((await request(app).post(`/api/bookings/${r.body.booking._id}/pay`).set(other.headers)).status, 404);
        assert.equal((await request(app).post(`/api/bookings/${r.body.booking._id}/cancel`).set(other.headers)).status, 404);
    });
});
