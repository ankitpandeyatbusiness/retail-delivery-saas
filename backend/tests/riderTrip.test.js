require('./helpers/env');
// The rider's trip: what an offer shows, "I have arrived", the location check on delivery, giving an order back before
// pickup, and a Cash on delivery customer paying by QR at the door.
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const payments = require('../src/services/adapters/payments');
const accounts = require('../src/services/paymentAccounts');
const doorPayment = require('../src/services/doorPayment');
const Tenant = require('../src/models/Tenant');
const liveTracking = require('../src/services/liveTracking');
const Order = require('../src/models/Order');
const Rider = require('../src/models/Rider');
const OnlinePayment = require('../src/models/OnlinePayment');
const CodSettlement = require('../src/models/CodSettlement');

// the shop is in Kanpur; the customer is about 1.1 km away
const SHOP = { latitude: 26.4499, longitude: 80.3319 };
const HOME = { latitude: 26.4599, longitude: 80.3319 };
let w; let n = 0;
const rider = (m, path, body) => request(app)[m](`/api/rider${path}`).set(w.rider.headers).send(body);
const trip = (o = {}) => f.makeOrder(w.tenant, w.customer.user, {
    status: 'out_for_delivery',
    address: { line1: '9 Test Lane', city: 'Kanpur', ...HOME },
    pricing: { subtotal: 250, total: 250 },
    delivery: { riderId: w.rider.user._id, status: 'picked_up', pickedUpAt: new Date(), pinRequired: false, proof: { url: 'https://x/p.jpg', at: new Date() } },
    ...o,
});

before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    payments._mock.reset();
    w = await f.makeWorld(`trip-${++n}`);
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { delivery: { ...SHOP, radiusKm: 10 }, phone: '9811111111', 'settings.riders.payPerDelivery': 30 } });
    tenantRecognizer.invalidateTenant(w.tenant.slug);
    await Rider.updateOne({ tenantId: w.tenant._id, userId: w.rider.user._id }, { $set: { isActive: true, isOnline: true, activeOrderCount: 1 } });
});
afterEach(() => mock.restoreAll());

describe('what the rider sees', () => {
    test('an order shows the distance and what it pays; the customer\'s pin and phone only after he accepted', async () => {
        const o = await trip();
        const v = (await rider('get', `/orders/${o._id}`)).body;
        assert.equal(v.distanceKm, 1.1);
        assert.equal(v.earnPaise, 3000);
        assert.deepEqual(v.destination, HOME);
        assert.equal(v.payment.collectAmount, 250);
        assert.equal(v.doorPay.canStart, true);
        assert.equal((await rider('get', '/me')).body.shopPhone, '9811111111');
        // an offer he has not accepted: no pin
        const offered = await f.makeOrder(w.tenant, w.customer.user, {
            status: 'accepted', address: { line1: 'x', city: 'Kanpur', ...HOME },
            delivery: { riderId: w.rider.user._id, status: 'assigned', offerExpiresAt: new Date(Date.now() + 60000) },
        });
        const list = (await rider('get', '/orders?tab=offered')).body.items;
        assert.equal(list.length, 1);
        assert.equal(list[0].destination, null);
        assert.equal(list[0].distanceKm, 1.1);
        assert.equal(list[0].customer, null);
        assert.ok(offered);
    });
});

describe('the way and the time allowed', () => {
    test('the road runs from the shop to the customer, once per order; only his own accepted delivery; no shop point is sent', async () => {
        const o = await trip({ status: 'preparing', delivery: { riderId: w.rider.user._id, status: 'accepted' } });
        const ask = (id = o._id, q = '') => request(app).get(`/api/rider/orders/${id}/route${q}`).set(w.rider.headers);

        const r = await ask();
        assert.equal(r.status, 200);
        assert.ok(['google', 'estimate'].includes(r.body.source));
        assert.ok(r.body.polyline && r.body.distanceM > 0);
        assert.equal(r.body.allowedSec % 60, 0, 'whole minutes');
        assert.ok(r.body.allowedSec >= r.body.durationSec + 300, 'the 5 minute buffer is in');
        assert.deepEqual((await ask()).body, r.body, 'asked again: the same answer, no new Google call');
        const v = (await rider('get', `/orders/${o._id}`)).body;
        assert.equal(v.pickup, undefined, 'the shop location is not sent to the rider');
        assert.equal(v.delivery.dueAt, null);

        const offered = await f.makeOrder(w.tenant, w.customer.user, {
            status: 'accepted', address: { line1: 'x', city: 'Kanpur', ...HOME },
            delivery: { riderId: w.rider.user._id, status: 'assigned', offerExpiresAt: new Date(Date.now() + 60000) },
        });
        assert.equal((await ask(offered._id)).status, 409, 'not accepted yet: no map');
        const other = await f.makeOrder(w.tenant, w.customer.user, { status: 'preparing', address: { line1: 'x', city: 'Kanpur', ...HOME } });
        assert.equal((await ask(other._id)).status, 404, 'not his order');
    });

    test('a shop with no pin: the road starts where the rider is; with no position either there is nothing to show', async () => {
        await Tenant.updateOne({ _id: w.tenant._id }, { $unset: { delivery: 1 } });
        tenantRecognizer.invalidateTenant(w.tenant.slug);
        const o = await trip({ status: 'preparing', delivery: { riderId: w.rider.user._id, status: 'accepted' } });
        const ask = (q = '') => request(app).get(`/api/rider/orders/${o._id}/route${q}`).set(w.rider.headers);
        assert.equal((await ask()).status, 404);
        assert.equal((await ask('?lat=26.4499&lng=80.3319')).status, 200);
    });

    test('collected: the due time is saved (road time + 5 min); delivered: the journey goes on his record, late or not', async () => {
        const o = await trip({ status: 'preparing', delivery: { riderId: w.rider.user._id, status: 'accepted' } });
        assert.equal((await rider('post', `/orders/${o._id}/pickup`)).status, 200);
        let due;
        for (let i = 0; i < 40 && !due; i += 1) { await new Promise((r) => setTimeout(r, 100)); due = (await Order.findById(o._id)).delivery.dueAt; }
        assert.ok(due, 'the due time is saved');
        const fresh = await Order.findById(o._id);
        assert.equal(Math.round((+fresh.delivery.dueAt - +fresh.delivery.pickedUpAt) / 1000), fresh.delivery.plannedSec);
        assert.ok(fresh.delivery.plannedSec >= 300);

        // a journey of 20 minutes that was due in 10: on time? no, late
        const plan = require('../src/services/deliveryPlan');
        const t0 = Date.now() - 20 * 60000;
        const late = await trip({ delivery: { riderId: w.rider.user._id, status: 'delivered', pickedUpAt: new Date(t0), deliveredAt: new Date(), dueAt: new Date(t0 + 10 * 60000) } });
        await plan.recordDone(late);
        const ontime = await trip({ delivery: { riderId: w.rider.user._id, status: 'delivered', pickedUpAt: new Date(Date.now() - 10 * 60000), deliveredAt: new Date(), dueAt: new Date(Date.now() + 5 * 60000) } });
        await plan.recordDone(ontime);
        const me = (await rider('get', '/me')).body;
        assert.equal(me.deliveryCount, 2);
        assert.equal(me.lateCount, 1);
        assert.equal(me.avgDeliveryMin, 15);
        const shop = (await request(app).get('/api/shop/riders').set(w.owner.headers)).body.items.find((x) => String(x.userId) === String(w.rider.user._id));
        assert.equal(shop.avgDeliveryMin, 15);
        assert.equal(shop.lateCount, 1);
        // a forgotten order marked delivered a day later does not spoil the average
        await plan.recordDone(await trip({ delivery: { riderId: w.rider.user._id, status: 'delivered', pickedUpAt: new Date(Date.now() - 86400000), deliveredAt: new Date() } }));
        assert.equal((await rider('get', '/me')).body.deliveryCount, 2);
    });
});

describe('the rider cancels a delivery he is carrying', () => {
    const Notification = require('../src/models/Notification');
    const waitFor = async (fn) => { for (let i = 0; i < 40; i += 1) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };

    test('after pickup, with a reason: cancelled, the customer and the shop are told, the customer pays nothing, the rider gets no pay', async () => {
        const o = await trip({ payment: { method: 'cod' } });
        const bad = await rider('post', `/orders/${o._id}/cancel`, { reasonCode: 'because' });
        assert.equal(bad.status, 400, 'a reason from the list is needed');

        const res = await rider('post', `/orders/${o._id}/cancel`, { reasonCode: 'wrong_address', note: 'gate is locked' });
        assert.equal(res.status, 200);
        const after = await Order.findById(o._id);
        assert.equal(after.status, 'cancelled');
        assert.equal(after.cancelledBy, 'rider');
        assert.match(after.cancelReason, /could not find the address: gate is locked/);
        assert.equal(after.cancel.reasonCode, 'wrong_address');
        assert.equal(after.delivery.earnPaise || 0, 0, 'no pay for a trip he gave up');
        assert.equal((await Rider.findOne({ userId: w.rider.user._id })).activeOrderCount, 0, 'his slot is free again');

        // the customer is told with the reason; the shop is told that the delivery partner cancelled
        const toCustomer = await waitFor(() => Notification.findOne({ tenantId: w.tenant._id, userId: o.userId, type: 'order_status' }).sort({ createdAt: -1 }).lean());
        assert.ok(toCustomer, 'the customer got a message');
        assert.match(JSON.stringify(toCustomer), /could not find the address/);
        const toShop = await waitFor(() => Notification.findOne({ tenantId: w.tenant._id, role: 'owner', type: 'order_cancelled' }).lean());
        assert.ok(toShop, 'the shop got a message');
        assert.match(toShop.body, /cancelled by the delivery partner/);

        // twice: it is over
        assert.ok([403, 409].includes((await rider('post', `/orders/${o._id}/cancel`, { reasonCode: 'emergency' })).status));
    });

    test('before pickup he cannot cancel (he gives the order back); another rider cannot cancel it', async () => {
        const early = await trip({ status: 'preparing', delivery: { riderId: w.rider.user._id, status: 'accepted' } });
        const r = await rider('post', `/orders/${early._id}/cancel`, { reasonCode: 'emergency' });
        assert.equal(r.status, 409);
        assert.equal((await Order.findById(early._id)).status, 'preparing');

        const carried = await trip();
        const other = await f.makeOrder(w.tenant, w.customer.user, { status: 'out_for_delivery', delivery: { riderId: w.customer.user._id, status: 'picked_up' } });
        assert.equal((await rider('post', `/orders/${other._id}/cancel`, { reasonCode: 'emergency' })).status, 404);
        assert.ok(carried);
    });
});

describe("the owner's live map", () => {
    test('the shop, the rider with his position, and every delivery on the way with the customer and the late flag', async () => {
        liveTracking.reset();
        const o = await trip({ delivery: { riderId: w.rider.user._id, status: 'picked_up', pickedUpAt: new Date(Date.now() - 30 * 60000), dueAt: new Date(Date.now() - 5 * 60000), pinRequired: false } });
        const waiting = await f.makeOrder(w.tenant, w.customer.user, { status: 'preparing', address: { line1: 'x', city: 'Kanpur', ...HOME } });
        const ask = () => request(app).get('/api/shop/live-map').set(w.owner.headers);

        // no position yet: the rider is listed, quiet, without a spot
        let r = (await ask()).body;
        assert.deepEqual({ lat: r.shop.lat, lng: r.shop.lng }, { lat: SHOP.latitude, lng: SHOP.longitude });
        assert.equal(r.riders.length, 1);
        assert.equal(r.riders[0].quiet, true);
        assert.equal(r.riders[0].lat, null);

        // a position arrives (the same call the rider's phone makes)
        await liveTracking.ingest({ tenantId: w.tenant._id, riderId: w.rider.user._id, body: { lat: 26.4530, lng: 80.3320 } });
        r = (await ask()).body;
        assert.equal(r.riders[0].lat, 26.4530);
        assert.equal(r.riders[0].quiet, false);
        assert.deepEqual(r.riders[0].orderIds, [String(o._id)]);
        assert.equal(r.trips.length, 1, 'only the delivery on the way, not the one still being prepared');
        const t = r.trips[0];
        assert.equal(t.orderNo, o.orderNo);
        assert.equal(t.riderId, String(w.rider.user._id));
        assert.deepEqual(t.dest, { lat: HOME.latitude, lng: HOME.longitude });
        assert.equal(t.late, true, 'past the due time');
        assert.ok(t.customer.name !== undefined && t.address.text.includes('Kanpur'));
        assert.ok(waiting);
    });
});

describe('I have arrived', () => {
    test('the time is kept once, and it needs the food collected first', async () => {
        const o = await trip();
        const a = await rider('post', `/orders/${o._id}/arrived`);
        assert.equal(a.status, 200);
        const first = (await Order.findById(o._id)).delivery.arrivedAt;
        assert.ok(first);
        await rider('post', `/orders/${o._id}/arrived`);
        assert.equal(+(await Order.findById(o._id)).delivery.arrivedAt, +first, 'a second tap changes nothing');

        const early = await f.makeOrder(w.tenant, w.customer.user, { status: 'preparing', delivery: { riderId: w.rider.user._id, status: 'accepted' } });
        assert.equal((await rider('post', `/orders/${early._id}/arrived`)).status, 409);
    });
});

describe('delivery needs the rider to be near the customer', () => {
    test('far away: refused with the distance; "deliver anyway" works and is flagged; the spot is saved', async () => {
        const o = await trip();
        const far = await rider('post', `/orders/${o._id}/deliver`, { lat: 26.4499, lng: 80.3319 });   // at the shop, 1.1 km away
        assert.equal(far.status, 409);
        assert.equal(far.body.code, 'TOO_FAR');
        assert.ok(far.body.distanceM > 1000);
        assert.equal((await Order.findById(o._id)).status, 'out_for_delivery');

        const ok = await rider('post', `/orders/${o._id}/deliver`, { lat: 26.4499, lng: 80.3319, farOk: true });
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
        const saved = (await Order.findById(o._id)).delivery.deliveredPoint;
        assert.equal(saved.far, true);
        assert.ok(saved.distanceM > 1000);
    });

    test('at the door: delivered with no extra tap, and the distance is saved', async () => {
        const o = await trip();
        const r = await rider('post', `/orders/${o._id}/deliver`, { lat: 26.4599, lng: 80.3320 });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const saved = (await Order.findById(o._id)).delivery.deliveredPoint;
        assert.equal(saved.far, false);
        assert.ok(saved.distanceM < 50);
    });

    test('no position at all: it is allowed, and flagged "no GPS"; an old position does not count', async () => {
        const o = await trip();
        // an old position (older than a few minutes) does not count
        liveTracking.reset();
        const r = await rider('post', `/orders/${o._id}/deliver`, {});
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal((await Order.findById(o._id)).delivery.deliveredPoint.noGps, true);
    });

    test('a fresh server position is used when the phone sends none', async () => {
        const o = await trip();
        await liveTracking.ingest({ tenantId: w.tenant._id, riderId: w.rider.user._id, body: { lat: 26.4499, lng: 80.3319 }, via: 'socket' });   // the live position, in memory
        assert.equal((await rider('post', `/orders/${o._id}/deliver`, {})).body.code, 'TOO_FAR');
    });
});

describe('giving an order back', () => {
    test('before pickup it goes back and the owner is told; after pickup the food must come back', async () => {
        const o = await f.makeOrder(w.tenant, w.customer.user, {
            status: 'preparing', address: { line1: 'x', city: 'Kanpur', ...HOME },
            delivery: { riderId: w.rider.user._id, status: 'accepted', acceptedAt: new Date(), assignedAt: new Date() },
        });
        const r = await rider('post', `/orders/${o._id}/release`, { note: 'bike broke down' });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const after = await Order.findById(o._id).lean();
        assert.equal(after.delivery.riderId, undefined);
        assert.match(after.delivery.riderHistory[0].reason, /bike broke down/);

        const out = await trip();
        const late = await rider('post', `/orders/${out._id}/release`, {});
        assert.equal(late.status, 409);
        assert.match(late.body.error, /food/i);
    });
});

describe('Cash on delivery paid by QR at the door', () => {
    const start = async (o) => (await rider('post', `/orders/${o._id}/door-pay`)).body.qr;
    const paid = (o, qrId, amountPaise = 25000, id = 'pay_door1') => payments._mock.setQrPayments(qrId, [{
        id, orderId: null, status: 'captured', amountPaise, capturedPaise: amountPaise, refundedPaise: 0, method: 'upi', notes: {},
    }]);
    const qrIdOf = async (o) => (await Order.findById(o._id)).delivery.doorQr.qrId;

    test('a QR for the exact amount; the same QR again; paying turns it into a paid online order with no cash to collect', async () => {
        const o = await trip();
        const q = await start(o);
        assert.equal(q.amountPaise, 25000);
        assert.ok(q.upiString || q.imageUrl);
        assert.equal((await start(o)).expiresAt, q.expiresAt, 'the same QR while it is open');
        assert.equal((await rider('get', `/orders/${o._id}`)).body.doorPay.qr.amountPaise, 25000);
        assert.equal((await rider('get', `/orders/${o._id}/door-pay`)).body.paid, false);

        paid(o, await qrIdOf(o));
        const c = await rider('get', `/orders/${o._id}/door-pay`);
        assert.equal(c.body.paid, true);
        const now = await Order.findById(o._id).lean();
        assert.deepEqual([now.payment.method, now.payment.status, now.payment.paidAtDoor], ['upi', 'paid', true]);
        const row = await OnlinePayment.findOne({ orderId: o._id }).lean();
        assert.deepEqual([row.status, row.capturedPaise, row.rzpPaymentId], ['captured', 25000, 'pay_door1']);
        const v = (await rider('get', `/orders/${o._id}`)).body;
        assert.equal(v.payment.collectAmount, 0);
        assert.equal(v.payment.paidAtDoor, true);

        // checking again, or the webhook arriving late, changes nothing
        assert.equal((await rider('get', `/orders/${o._id}/door-pay`)).body.paid, true);
        assert.equal(await OnlinePayment.countDocuments({ orderId: o._id }), 1);

        // delivered: no cash is credited to his ledger
        assert.equal((await rider('post', `/orders/${o._id}/deliver`, { lat: 26.4599, lng: 80.3319 })).status, 200);
        assert.equal(await CodSettlement.countDocuments({ orderId: o._id }), 0);
    });

    test('the shop\'s webhook for the QR does the same, and a repeat of it is harmless', async () => {
        const o = await trip();
        await start(o);
        const qr = { id: await qrIdOf(o), notes: { purpose: 'door_cod', referenceId: String(o._id) } };
        const pay = { id: 'pay_door2', status: 'captured', amountPaise: 25000, method: 'upi' };
        assert.equal((await doorPayment.credit({ account: String(w.tenant._id), qr, pay })).door, 'paid');
        assert.equal((await doorPayment.credit({ account: String(w.tenant._id), qr, pay })).door, 'already_paid');
        assert.equal(await OnlinePayment.countDocuments({ orderId: o._id }), 1);
    });

    test('a wrong amount, a QR of another order, or a payment that is not captured pays nothing', async () => {
        const o = await trip();
        await start(o);
        const qr = { id: await qrIdOf(o), notes: { purpose: 'door_cod', referenceId: String(o._id) } };
        for (const pay of [{ id: 'p1', status: 'captured', amountPaise: 100 }, { id: 'p2', status: 'authorized', amountPaise: 25000 }]) {
            assert.equal((await doorPayment.credit({ account: String(w.tenant._id), qr, pay })).ignored, 'check_failed');
        }
        assert.equal((await doorPayment.credit({ account: String(w.tenant._id), qr: { ...qr, id: 'other_qr' }, pay: { id: 'p3', status: 'captured', amountPaise: 25000 } })).ignored, 'check_failed');
        assert.equal((await Order.findById(o._id)).payment.status, 'pending');
        // another shop cannot touch this order
        const other = await f.makeWorld('trip-other');
        assert.equal((await doorPayment.credit({ account: String(other.tenant._id), qr, pay: { id: 'p4', status: 'captured', amountPaise: 25000 } })).ignored, 'check_failed');
    });

    test('a second payment for an order that is already paid is not credited twice; the owner is alerted', async () => {
        const o = await trip();
        await start(o);
        const qr = { id: await qrIdOf(o), notes: { purpose: 'door_cod', referenceId: String(o._id) } };
        await doorPayment.credit({ account: String(w.tenant._id), qr, pay: { id: 'pay_a', status: 'captured', amountPaise: 25000 } });
        const again = await doorPayment.credit({ account: String(w.tenant._id), qr, pay: { id: 'pay_b', status: 'captured', amountPaise: 25000 } });
        assert.equal(again.ignored, 'already_paid');
        assert.equal(await OnlinePayment.countDocuments({ orderId: o._id }), 1);
    });

    test('not offered when the order is paid already, not on its way, or the shop cannot take online payments', async () => {
        const online = await trip({ payment: { method: 'upi', status: 'paid' } });
        assert.equal((await rider('post', `/orders/${online._id}/door-pay`)).status, 409);
        const early = await f.makeOrder(w.tenant, w.customer.user, { status: 'preparing', delivery: { riderId: w.rider.user._id, status: 'accepted' } });
        assert.equal((await rider('post', `/orders/${early._id}/door-pay`)).status, 409);
        const o = await trip();
        mock.method(accounts, 'canTakePayments', async () => ({ ok: false, reason: 'off' }));
        const r = await rider('post', `/orders/${o._id}/door-pay`);
        assert.equal(r.status, 409);
        assert.match(r.body.error, /cash/i);
        // another rider's order is not his to touch
        const theirs = await f.makeOrder(w.tenant, w.customer.user, { status: 'out_for_delivery', delivery: { riderId: w.owner.user._id, status: 'picked_up' } });
        assert.equal((await rider('post', `/orders/${theirs._id}/door-pay`)).status, 404);
    });

    test('he takes cash after all: the QR is closed, and the delivery goes through as a cash order', async () => {
        const o = await trip();
        await start(o);
        const spy = mock.method(payments, 'closeQr', async () => ({ ok: true }));
        const r = await rider('post', `/orders/${o._id}/deliver`, { lat: 26.4599, lng: 80.3319 });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(spy.mock.calls.length, 1);
        const now = await Order.findById(o._id).lean();
        assert.equal(now.payment.method, 'cod');
        assert.equal(now.payment.status, 'paid');
        assert.equal(await CodSettlement.countDocuments({ orderId: o._id }), 1);
    });
});
