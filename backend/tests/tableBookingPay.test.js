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
const BookingSlotUse = require('../src/models/BookingSlotUse');
const { makeWorld, makeUser } = require('./helpers/factory');

// The guest's phone pays at Razorpay; the server is then shown the proof.
const sign = (orderId, paymentId) => crypto.createHmac('sha256', 'mock_key_secret').update(`${orderId}|${paymentId}`).digest('hex');
let payN = 0;
const capture = (pay) => { const id = `pay_mock_${++payN}`; payments._mock.setPayment({ id, orderId: pay.rzpOrderId, status: 'captured', amountPaise: pay.amountPaise }); return id; };

describe('table booking with a paid deposit', () => {
    let w; let date;
    before(async () => {
        await db.connect(); w = await makeWorld('book-pay'); date = tb.addDays(tb.todayYmd(), 2);
        const r = await request(app).put('/api/shop/booking/settings').set(w.owner.headers).send({
            windows: [{ days: [], open: '19:00', close: '22:00' }], seatsPerSlot: 6, maxParty: 6, depositType: 'per_person', depositAmount: 200, refundHours: 2, enabled: true,
        });
        assert.equal(r.status, 200, JSON.stringify(r.body));
    });
    after(() => db.disconnect());

    const settings = (body) => request(app).put('/api/shop/booking/settings').set(w.owner.headers).send(body);
    const fresh = (time) => BookingSlotUse.deleteMany({ tenantId: w.tenant._id, date, time });
    const guest = (phone) => makeUser(w.tenant, 'customer', phone);
    const book = (time, party = 2, h = w.customer.headers) => request(app).post('/api/bookings').set(h).send({ date, time, party, name: 'Anil', phone: '9000000030' });
    const payIt = (res, h = w.customer.headers) => {
        const pid = capture(res.body.pay);
        return request(app).post(`/api/bookings/${res.body.booking._id}/verify`).set(h).send({ razorpay_order_id: res.body.pay.rzpOrderId, razorpay_payment_id: pid, razorpay_signature: sign(res.body.pay.rzpOrderId, pid) });
    };
    const left = async (time) => (await request(app).get(`/api/bookings/slots?date=${date}&party=1`).set(w.customer.headers)).body.slots.find((x) => x.time === time).left;
    const row = (id) => TableBooking.findById(id).lean();

    test('booking holds the seats and asks for the deposit; it is not confirmed until paid', async () => {
        const r = await book('19:00', 4);
        assert.equal(r.status, 201, JSON.stringify(r.body));
        assert.equal(r.body.booking.status, 'held');
        assert.equal(r.body.pay.amountPaise, 80000);
        assert.ok(r.body.pay.rzpOrderId && r.body.pay.keyId);
        assert.equal(await left('19:00'), 2);   // held seats are taken
        assert.equal((await request(app).get(`/api/shop/booking?date=${date}`).set(w.owner.headers)).body.items.length, 0);   // the owner sees only paid bookings
        const paid = await payIt(r);
        assert.equal(paid.body.paid, true, JSON.stringify(paid.body));
        assert.equal(paid.body.booking.status, 'confirmed');
        assert.equal(paid.body.booking.deposit.status, 'paid');
        assert.equal((await request(app).get(`/api/shop/booking?date=${date}`).set(w.owner.headers)).body.items.length, 1);
        assert.equal((await payIt(r)).body.paid, true);   // a repeat changes nothing
        assert.equal(await left('19:00'), 2);
    });

    test('a wrong proof confirms nothing; cancelling a held booking gives the seats back', async () => {
        const r = await book('20:00', 2);
        const pid = capture(r.body.pay);
        const bad = await request(app).post(`/api/bookings/${r.body.booking._id}/verify`).set(w.customer.headers).send({ razorpay_order_id: r.body.pay.rzpOrderId, razorpay_payment_id: pid, razorpay_signature: 'nope' });
        assert.equal(bad.status, 400);
        assert.equal((await row(r.body.booking._id)).status, 'held');
        await request(app).post(`/api/bookings/${r.body.booking._id}/cancel`).set(w.customer.headers);
        assert.equal(await left('20:00'), 6);
    });

    test('an unpaid hold is let go after its time and the seats come back, once', async () => {
        const r = await book('21:00', 3, (await guest('9200000001')).headers);
        assert.equal(await left('21:00'), 3);
        await bp.sweep(Date.now() + 5 * 60000);   // inside the hold: nothing happens
        assert.equal((await row(r.body.booking._id)).status, 'held');
        await bp.sweep(Date.now() + 11 * 60000);
        assert.equal((await row(r.body.booking._id)).status, 'expired');
        assert.equal(await left('21:00'), 6);
        await bp.sweep(Date.now() + 12 * 60000);
        assert.equal(await left('21:00'), 6);
    });

    test('a payment that arrives after the hold ran out confirms the booking when the seats are free', async () => {
        const r = await book('21:00', 2, (await guest('9200000002')).headers);
        await bp.sweep(Date.now() + 11 * 60000);
        assert.equal((await row(r.body.booking._id)).status, 'expired');
        const pid = capture(r.body.pay);
        const hook = await bp.onWebhook({ account: w.tenant._id, rzp: { id: pid, orderId: r.body.pay.rzpOrderId, status: 'captured', amountPaise: r.body.pay.amountPaise } });
        assert.equal(hook.paid, true);
        assert.equal((await row(r.body.booking._id)).status, 'confirmed');
        assert.equal(await left('21:00'), 4);
    });

    test('a late payment for seats that are gone is sent straight back', async () => {
        await fresh('20:00');
        const a = await guest('9200000003');
        const c = await book('20:00', 6, (await guest('9200000004')).headers);
        await bp.sweep(Date.now() + 11 * 60000);
        assert.equal((await book('20:00', 6, a.headers)).status, 201);   // someone else took the whole slot
        const pid = capture(c.body.pay);
        const hook = await bp.onWebhook({ account: w.tenant._id, rzp: { id: pid, orderId: c.body.pay.rzpOrderId, status: 'captured', amountPaise: c.body.pay.amountPaise } });
        assert.equal(hook.refunded, true);
        const b = await row(c.body.booking._id);
        assert.equal(b.status, 'cancelled');
        assert.equal(b.deposit.status, 'refunded');
    });

    test('the guest cancels early: the deposit goes back', async () => {
        await fresh('19:00');
        const g = await guest('9200000005');
        const r = await book('19:00', 2, g.headers);
        await payIt(r, g.headers);
        const c = await request(app).post(`/api/bookings/${r.body.booking._id}/cancel`).set(g.headers);
        assert.equal(c.status, 200, JSON.stringify(c.body));
        assert.equal(c.body.status, 'cancelled');
        assert.equal(c.body.deposit.status, 'refunded');
        assert.ok(c.body.deposit.refundId);
        assert.equal((await request(app).post(`/api/bookings/${r.body.booking._id}/cancel`).set(g.headers)).status, 400);
    });

    test('the guest cancels too late: the shop keeps it, by the rule he saw when he booked', async () => {
        await settings({ refundHours: 100 });
        await fresh('19:00');
        const g = await guest('9200000006');
        const r = await book('19:00', 2, g.headers);
        await payIt(r, g.headers);
        await settings({ refundHours: 0 });   // a later change does not rescue him
        assert.equal((await request(app).post(`/api/bookings/${r.body.booking._id}/cancel`).set(g.headers)).body.deposit.status, 'kept');
        await settings({ refundHours: 2 });
    });

    test('when the owner cancels, the deposit always goes back', async () => {
        await settings({ refundHours: 100 });
        await fresh('19:00');
        const g = await guest('9200000007');
        const r = await book('19:00', 2, g.headers);
        await payIt(r, g.headers);
        assert.equal((await request(app).post(`/api/shop/booking/${r.body.booking._id}/cancel`).set(w.owner.headers)).body.deposit.status, 'refunded');
        await settings({ refundHours: 2 });
    });

    test('no-show keeps the deposit; seated waits for the bill (adjust) or is kept (keep)', async () => {
        await fresh('19:00');
        const mk = async (phone, time = '19:00') => { const g = await guest(phone); const r = await book(time, 1, g.headers); await payIt(r, g.headers); return r.body.booking._id; };
        const [a, b] = [await mk('9200000008'), await mk('9200000009')];
        assert.equal((await request(app).post(`/api/shop/booking/${a}/no-show`).set(w.owner.headers)).body.deposit.status, 'kept');
        const seat = await request(app).post(`/api/shop/booking/${b}/seat`).set(w.owner.headers);
        assert.equal(seat.body.status, 'seated');
        assert.equal(seat.body.deposit.status, 'paid');
        assert.equal(seat.body.deposit.credit, 'pending');
        const done = await request(app).post(`/api/shop/booking/${b}/adjusted`).set(w.owner.headers);   // the waiter took it off the bill
        assert.equal(done.body.deposit.status, 'adjusted');
        assert.equal(done.body.deposit.credit, 'applied');
        assert.equal((await request(app).post(`/api/shop/booking/${b}/adjusted`).set(w.owner.headers)).status, 400);   // only once
        await settings({ depositMode: 'keep' });
        await fresh('20:00');
        const k = await mk('9200000010', '20:00');
        assert.equal((await request(app).post(`/api/shop/booking/${k}/seat`).set(w.owner.headers)).body.deposit.status, 'kept');
    });

    test('a refund that failed is tried again by the sweeper, and sent only once', async () => {
        await fresh('21:00');
        const g = await guest('9200000011');
        const r = await book('21:00', 1, g.headers);
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
        const r = await book('19:00', 2, g.headers);
        const proof = (pid) => ({ razorpay_order_id: r.body.pay.rzpOrderId, razorpay_payment_id: pid, razorpay_signature: sign(r.body.pay.rzpOrderId, pid) });
        const verify = (pid) => request(app).post(`/api/bookings/${r.body.booking._id}/verify`).set(g.headers).send(proof(pid));
        // paid but only authorised, not captured
        payments._mock.setPayment({ id: 'pay_auth', orderId: r.body.pay.rzpOrderId, status: 'authorized', amountPaise: r.body.pay.amountPaise });
        assert.equal((await verify('pay_auth')).body.paid, false);
        // captured, but less than the deposit
        payments._mock.setPayment({ id: 'pay_less', orderId: r.body.pay.rzpOrderId, status: 'captured', amountPaise: r.body.pay.amountPaise - 100 });
        assert.equal((await verify('pay_less')).body.paid, false);
        // a payment that belongs to a different Razorpay order
        payments._mock.setPayment({ id: 'pay_other', orderId: 'order_someone_else', status: 'captured', amountPaise: r.body.pay.amountPaise });
        assert.equal((await verify('pay_other')).body.paid, false);
        const still = await row(r.body.booking._id);
        assert.deepEqual([still.status, still.deposit.status], ['held', 'unpaid']);
        assert.equal((await request(app).get(`/api/shop/booking?date=${date}`).set(w.owner.headers)).body.items.filter((b) => b._id === String(r.body.booking._id)).length, 0);
        // the full amount captured: now it is confirmed
        assert.equal((await payIt(r, g.headers)).body.paid, true);
    });

    test('a guest holds seats for one unpaid booking at a time', async () => {
        await fresh('19:00'); await fresh('20:00');
        const g = await guest('9200000021');
        const first = await book('19:00', 4, g.headers);
        assert.equal(await left('19:00'), 2);
        const second = await book('20:00', 4, g.headers);   // changed his mind: the first unpaid hold is let go
        assert.equal(second.status, 201);
        assert.equal((await row(first.body.booking._id)).status, 'cancelled');
        assert.equal(await left('19:00'), 6);
        assert.equal(await left('20:00'), 2);
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
        const r = await book('19:00', 1, (await guest('9200000012')).headers);
        const other = await guest('9200000013');
        assert.equal((await request(app).post(`/api/bookings/${r.body.booking._id}/pay`).set(other.headers)).status, 404);
        assert.equal((await request(app).post(`/api/bookings/${r.body.booking._id}/cancel`).set(other.headers)).status, 404);
    });
});
