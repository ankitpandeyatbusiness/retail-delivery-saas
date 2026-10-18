require('./helpers/env');
// "I never got this order": one tap for the customer; the owner sees what the system knew about the delivery
// (who marked it delivered, PIN or photo, where the rider was) and decides, including whether the rider was at fault.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const Complaint = require('../src/models/Complaint');
const Rider = require('../src/models/Rider');
const Notification = require('../src/models/Notification');

let w; let n = 0;
const send = (orderId, body = { type: 'not_received' }, who = 'customer') => request(app).post(`/api/orders/${orderId}/complaints`).set(w[who].headers).send(body);
const owner = (m, path, body) => request(app)[m](`/api/shop${path}`).set(w.owner.headers).send(body);

// a delivered order. by: who marked it delivered
const delivered = (over = {}, by = 'rider') => f.makeOrder(w.tenant, w.customer.user, {
    status: 'delivered', deliveredAt: new Date(), pricing: { total: 250 }, payment: { method: 'cod', status: 'paid' },
    statusHistory: [{ status: 'placed' }, { status: 'delivered', byType: by }],
    delivery: {
        riderId: w.rider.user._id, status: 'delivered', pickedUpAt: new Date(Date.now() - 20 * 60000), arrivedAt: new Date(Date.now() - 5 * 60000),
        pinRequired: true, deliveredPoint: { lat: 26.45, lng: 80.33, distanceM: 40, far: false, noGps: false, at: new Date() },
    },
    ...over,
});

before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld(`nr-${++n}`);
    await Rider.updateOne({ tenantId: w.tenant._id, userId: w.rider.user._id }, { $set: { name: 'Raju' } });
});

describe('the customer says he did not get the order', () => {
    test('one tap, no text needed; the owner is told with the right words', async () => {
        const o = await delivered();
        const r = await send(o._id);
        assert.equal(r.status, 201, JSON.stringify(r.body));
        assert.equal(r.body.type, 'not_received');
        assert.match(r.body.text, /did not receive/i);
        assert.equal(r.body.evidence, undefined, 'the customer is not shown the evidence');
        await f.waitFor(async () => (await Notification.countDocuments({ tenantId: w.tenant._id, type: 'complaint_new' })) === 1);
        assert.match((await Notification.findOne({ type: 'complaint_new' })).title, /did not arrive/);
    });

    test('only after delivery, only once, and only within 24 hours', async () => {
        const placed = await f.makeOrder(w.tenant, w.customer.user, { status: 'out_for_delivery' });
        assert.equal((await send(placed._id)).status, 409);
        const old = await delivered({ deliveredAt: new Date(Date.now() - 25 * 3600000) });
        assert.equal((await send(old._id)).status, 409);
        const o = await delivered();
        assert.equal((await send(o._id)).status, 201);
        assert.equal((await send(o._id)).status, 409);
    });
});

describe('what the owner sees', () => {
    test('PIN delivery: who, when, that the PIN was used, and how close the rider was', async () => {
        const o = await delivered();
        const c = (await send(o._id)).body;
        const e = (await owner('get', `/complaints/${c.id}`)).body.evidence;
        assert.equal(e.riderName, 'Raju');
        assert.equal(e.markedBy, 'rider');
        assert.equal(e.confirmedBy, 'pin');
        assert.deepEqual(e.spot, { distanceM: 40, far: false, noGps: false });
        assert.equal(e.payment.cashPaise, 25000);
        assert.ok(e.collectedAt && e.arrivedAt && e.deliveredAt);
        assert.equal(e.priorClaims, 0);
    });

    test('photo delivery, shop-completed delivery, and a far or GPS-less one are told apart', async () => {
        const photo = await delivered({ delivery: { riderId: w.rider.user._id, status: 'delivered', pinRequired: false, proof: { url: 'https://x/p.jpg', at: new Date() }, deliveredPoint: { distanceM: 1500, far: true, noGps: false } } });
        let e = (await owner('get', `/complaints/${(await send(photo._id)).body.id}`)).body.evidence;
        assert.equal(e.confirmedBy, 'photo');
        assert.equal(e.proofUrl, 'https://x/p.jpg');
        assert.equal(e.spot.far, true);

        const shop = await delivered({}, 'owner');
        e = (await owner('get', `/complaints/${(await send(shop._id)).body.id}`)).body.evidence;
        assert.equal(e.markedBy, 'owner');
        assert.equal(e.confirmedBy, 'shop');

        const none = await delivered({ delivery: { riderId: w.rider.user._id, status: 'delivered', pinRequired: false, deliveredPoint: { noGps: true, far: false } } });
        e = (await owner('get', `/complaints/${(await send(none._id)).body.id}`)).body.evidence;
        assert.equal(e.confirmedBy, 'none');
        assert.equal(e.spot.noGps, true);
    });

    test('a customer who says this again and again is flagged', async () => {
        for (let i = 0; i < 2; i += 1) {
            const c = (await send((await delivered())._id)).body;
            await owner('patch', `/complaints/${c.id}`, { resolution: 'no_refund', ownerReply: 'The PIN was used', riderFault: false });
        }
        const third = (await send((await delivered())._id)).body;
        const e = (await owner('get', `/complaints/${third.id}`)).body.evidence;
        assert.equal(e.priorClaims, 2);
        assert.equal(e.priorRefused, 2);
    });

    test('other complaint types carry no evidence', async () => {
        const c = (await send((await delivered())._id, { type: 'missing_item', text: 'The raita was missing' })).body;
        assert.equal((await owner('get', `/complaints/${c.id}`)).body.evidence, null);
    });
});

describe('the owner decides', () => {
    test('rider at fault: counted once on the rider; a refund is noted for a cash order', async () => {
        const c = (await send((await delivered())._id)).body;
        const r = await owner('patch', `/complaints/${c.id}`, { resolution: 'refund_full', ownerReply: 'Sorry, we are checking with the rider', riderFault: true });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.riderFault, true);
        assert.equal(r.body.refundStatus, 'noted');
        assert.equal((await Rider.findOne({ userId: w.rider.user._id }).lean()).faultCount, 1);
        assert.equal((await owner('patch', `/complaints/${c.id}`, { resolution: 'no_refund', ownerReply: 'x' })).status, 409, 'decided only once');
        assert.equal((await Rider.findOne({ userId: w.rider.user._id }).lean()).faultCount, 1);
        assert.equal((await owner('get', '/riders')).body.items[0].faultCount, 1);
    });

    test('not the rider\'s fault, or a plain reply: nothing is counted', async () => {
        const c = (await send((await delivered())._id)).body;
        await owner('patch', `/complaints/${c.id}`, { ownerReply: 'We are looking into it' });
        await owner('patch', `/complaints/${c.id}`, { resolution: 'no_refund', ownerReply: 'He gave the PIN', riderFault: false });
        assert.equal((await Rider.findOne({ userId: w.rider.user._id }).lean()).faultCount, 0);
        assert.equal((await Complaint.findById(c.id).lean()).riderFault, false);
    });

    test('a complaint of another type ignores the rider-fault field', async () => {
        const c = (await send((await delivered())._id, { type: 'late', text: 'It came very late' })).body;
        await owner('patch', `/complaints/${c.id}`, { resolution: 'no_refund', ownerReply: 'ok', riderFault: true });
        assert.equal((await Rider.findOne({ userId: w.rider.user._id }).lean()).faultCount, 0);
    });
});
