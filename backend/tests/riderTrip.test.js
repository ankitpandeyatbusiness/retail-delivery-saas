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
        await Rider.updateOne({ tenantId: w.tenant._id, userId: w.rider.user._id }, { $set: { lastLocation: { lat: 26.4499, lng: 80.3319, at: new Date(Date.now() - 20 * 60000) } } });
        const r = await rider('post', `/orders/${o._id}/deliver`, {});
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal((await Order.findById(o._id)).delivery.deliveredPoint.noGps, true);
    });

    test('a fresh server position is used when the phone sends none', async () => {
        const o = await trip();
        await Rider.updateOne({ tenantId: w.tenant._id, userId: w.rider.user._id }, { $set: { lastLocation: { ...{ lat: 26.4499, lng: 80.3319 }, at: new Date() } } });
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
