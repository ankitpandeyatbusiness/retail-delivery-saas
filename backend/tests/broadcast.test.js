require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const assignment = require('../src/services/assignmentService');
const { DEFAULTS } = require('../src/services/tenantConfigService');
const realtime = require('../src/services/realtime');
const smsChannel = require('../src/notifications/channels/sms');
const pushChannel = require('../src/notifications/channels/push');
const { EVENTS } = require('../src/notifications/events');
const texts = require('../src/notifications/templates/texts');
const Order = require('../src/models/Order');
const Rider = require('../src/models/Rider');
const Notification = require('../src/models/Notification');
const { makeTenant, makeUser, makeOrder, waitFor, sleep } = require('./helpers/factory');

let live = [];   // every live message sent to one person: { userId, event, payload }

async function shop(slug, { riders = 3, extra = {} } = {}) {
    const tenant = await makeTenant(slug, extra);
    const owner = await makeUser(tenant, 'admin', '9000000010');
    const customer = await makeUser(tenant, 'customer', '9000000030');
    const team = [];
    for (let i = 0; i < riders; i += 1) team.push(await makeUser(tenant, 'rider', `900000002${i + 1}`));
    return { tenant, owner, customer, team };
}
const deliveryOrder = (s, extra = {}) => makeOrder(s.tenant, s.customer.user, {
    status: 'placed', orderType: 'delivery',
    address: { line1: '12 Secret Street', city: 'Lucknow', pincode: '226001', landmark: 'Near the temple', phone: '9111111111' },
    ...extra,
});
const fresh = (o) => Order.findById(o._id);
const ownerPatch = (s, o, b) => request(app).patch(`/api/shop/orders/${o._id}/status`).set(s.owner.headers).send(b);
const riderCall = (r, o, action) => request(app).post(`/api/rider/orders/${o._id}/${action}`).set(r.headers).send({});
const slots = async (r) => (await Rider.findOne({ userId: r.user._id })).activeOrderCount;
const noteCount = (s, q) => Notification.countDocuments({ tenantId: s.tenant._id, ...q });
const waitOffers = (o, n) => waitFor(async () => ((await fresh(o)).delivery?.offers || []).length === n);
const waitEnded = (o) => waitFor(async () => !!(await fresh(o)).delivery?.broadcast?.endedAt);
const resultOf = (d, r) => d.offers.find((x) => String(x.riderId) === String(r.user._id)).result;
const closedFor = () => live.filter((e) => e.event === 'offer:closed');

// the owner accepts the order, then we wait until the riders were asked
async function startBroadcast(s, o, riders) {
    assert.equal((await ownerPatch(s, o, { status: 'accepted' })).status, 200);
    assert.ok(await waitOffers(o, riders), 'the riders should be asked');
}

describe('rider broadcast', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(async () => {
        await Order.deleteMany({});   // the broadcast job looks at every shop, so each test starts with no orders left over from the one before
        live = [];
        mock.method(smsChannel, 'send', async () => ({ sent: false }));
        mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
        mock.method(realtime, 'toUser', (tenantId, userId, event, payload) => { live.push({ userId: String(userId), event, payload }); });
    });
    afterEach(() => mock.restoreAll());

    test('accepting a delivery order asks ALL free riders at once, and the card hides the customer', async () => {
        const s = await shop('bc-start');
        const o = await deliveryOrder(s);
        await startBroadcast(s, o, 3);

        const d = (await fresh(o)).delivery;
        assert.equal(d.broadcast.active, true);
        assert.equal(d.riderId, undefined);
        assert.equal(d.pinRequired, true);
        assert.equal((new Date(d.broadcast.expiresAt) - new Date(d.broadcast.startedAt)) / 1000, 120);
        assert.deepEqual(d.offers.map((x) => String(x.riderId)).sort(), s.team.map((r) => String(r.user._id)).sort());
        for (const offer of d.offers) {
            assert.equal(offer.result, 'offered');
            assert.equal(offer.by, 'system');
        }

        const cards = live.filter((e) => e.event === 'rider:offer');
        assert.equal(cards.length, 3);
        assert.deepEqual(cards.map((c) => c.userId).sort(), s.team.map((r) => String(r.user._id)).sort());
        const card = cards[0].payload;
        assert.equal(card.orderNo, o.orderNo);
        assert.deepEqual(card.items, [{ name: 'Test item', quantity: 1 }]);
        assert.deepEqual(card.address, { city: 'Lucknow', pincode: '226001', landmark: 'Near the temple' });
        assert.deepEqual(card.payment, { method: 'cod', collectAmount: 100 });
        const text = JSON.stringify(cards.map((c) => c.payload));
        for (const secret of ['Secret Street', '9000000030', '9111111111']) assert.ok(!text.includes(secret), secret);

        assert.ok(await waitFor(async () => (await noteCount(s, { type: 'rider_offer' })) === 3));   // an inbox message (and a push) each
        assert.equal(await noteCount(s, { type: 'rider_offer', userId: s.owner.user._id }), 0);
        assert.equal(await noteCount(s, { type: 'rider_offer', userId: s.customer.user._id }), 0);
    });

    test('only riders who are online, active and have NO active order get the offer', async () => {
        const s = await shop('bc-eligible', { riders: 4 });
        const [free, busy, offline, off] = s.team;
        await Rider.updateOne({ userId: busy.user._id }, { $set: { activeOrderCount: 1 } });
        await Rider.updateOne({ userId: offline.user._id }, { $set: { isOnline: false } });
        await Rider.updateOne({ userId: off.user._id }, { $set: { isActive: false } });
        const o = await deliveryOrder(s);
        await startBroadcast(s, o, 1);
        const d = (await fresh(o)).delivery;
        assert.deepEqual(d.offers.map((x) => String(x.riderId)), [String(free.user._id)]);
        assert.equal(live.filter((e) => e.event === 'rider:offer').length, 1);
    });

    test('a rider sees the offer in his "offered" tab without the customer data, a rider who was not asked sees nothing', async () => {
        const s = await shop('bc-tab', { riders: 2 });
        const [asked, other] = s.team;
        await Rider.updateOne({ userId: other.user._id }, { $set: { activeOrderCount: 1 } });   // busy: not asked
        const o = await deliveryOrder(s);
        await startBroadcast(s, o, 1);

        const mine = await request(app).get('/api/rider/orders?tab=offered').set(asked.headers);
        assert.equal(mine.status, 200);
        assert.equal(mine.body.items.length, 1);
        assert.equal(mine.body.counts.offered, 1);
        assert.equal(mine.body.items[0].customer, null);
        assert.ok(mine.body.items[0].delivery.offerExpiresAt);
        assert.deepEqual(mine.body.items[0].items, [{ name: 'Test item', quantity: 1 }]);
        const text = JSON.stringify(mine.body);
        for (const secret of ['Secret Street', '9000000030', '9111111111']) assert.ok(!text.includes(secret), secret);

        const none = await request(app).get('/api/rider/orders?tab=offered').set(other.headers);
        assert.equal(none.body.items.length, 0);
    });

    test('the first rider to accept gets the order, the others are told "Taken by someone else"', async () => {
        const s = await shop('bc-win');
        const o = await deliveryOrder(s);
        await startBroadcast(s, o, 3);
        const [r1, r2, r3] = s.team;

        const win = await riderCall(r1, o, 'accept');
        assert.equal(win.status, 200);
        assert.equal(win.body.customer.phone, '9000000030');               // after accepting he may see the customer
        assert.equal(win.body.delivery.status, 'accepted');

        const d = (await fresh(o)).delivery;
        assert.equal(String(d.riderId), String(r1.user._id));
        assert.equal(d.status, 'accepted');
        assert.ok(d.acceptedAt);
        assert.equal(d.broadcast.active, false);
        assert.equal(d.broadcast.endReason, 'accepted');
        assert.deepEqual([resultOf(d, r1), resultOf(d, r2), resultOf(d, r3)], ['accepted', 'taken', 'taken']);
        assert.deepEqual([await slots(r1), await slots(r2), await slots(r3)], [1, 0, 0]);

        const late = await riderCall(r2, o, 'accept');
        assert.equal(late.status, 409);
        assert.equal(late.body.error, 'Taken by someone else');
        assert.equal(await slots(r2), 0);
        assert.equal((await riderCall(r3, o, 'reject')).status, 409);       // too late to say no as well

        const closed = closedFor();
        assert.deepEqual(closed.map((e) => e.userId).sort(), [String(r2.user._id), String(r3.user._id)].sort());
        assert.equal(closed[0].payload.message, 'Taken by someone else');
        assert.equal(closed[0].payload.orderNo, o.orderNo);

        assert.ok(await waitFor(async () => (await noteCount(s, { type: 'rider_assigned', userId: s.customer.user._id })) === 1));
        assert.ok(await waitFor(async () => (await noteCount(s, { type: 'rider_accepted', role: 'owner' })) === 1));
        assert.equal((await riderCall(r1, o, 'accept')).status, 409);       // the winner pressing again: nothing changes twice
        assert.equal(await slots(r1), 1);
    });

    test('riders accepting at the very same moment: exactly one wins, the others stay at 0 active orders', async () => {
        const s = await shop('bc-race');
        const o = await deliveryOrder(s);
        await startBroadcast(s, o, 3);
        const results = await Promise.all(s.team.map((r) => riderCall(r, o, 'accept')));
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409]);
        const winnerIndex = results.findIndex((r) => r.status === 200);
        const d = (await fresh(o)).delivery;
        assert.equal(String(d.riderId), String(s.team[winnerIndex].user._id));
        const counts = await Promise.all(s.team.map(slots));
        assert.equal(counts.reduce((a, b) => a + b, 0), 1);
        assert.equal(counts[winnerIndex], 1);
        for (const r of results.filter((x) => x.status === 409)) assert.equal(r.body.error, 'Taken by someone else');
        assert.equal(d.offers.filter((x) => x.result === 'accepted').length, 1);
        assert.equal(d.offers.filter((x) => x.result === 'taken').length, 2);
    });

    test('a rider who says no stops seeing it, and when ALL say no the owner gets ONE alert', async () => {
        const s = await shop('bc-reject');
        const o = await deliveryOrder(s);
        await startBroadcast(s, o, 3);
        const [r1, r2, r3] = s.team;

        const no = await riderCall(r1, o, 'reject');
        assert.equal(no.status, 200);
        assert.equal(resultOf((await fresh(o)).delivery, r1), 'rejected');
        assert.equal((await request(app).get('/api/rider/orders?tab=offered').set(r1.headers)).body.items.length, 0);
        assert.equal((await request(app).get('/api/rider/orders?tab=offered').set(r2.headers)).body.items.length, 1);
        assert.equal((await riderCall(r1, o, 'reject')).status, 409);
        const again = await riderCall(r1, o, 'accept');                      // he already said no
        assert.equal(again.status, 409);
        assert.equal(await slots(r1), 0);
        assert.equal((await fresh(o)).delivery.broadcast.active, true);      // the others can still answer
        assert.equal(await noteCount(s, { type: 'rider_none' }), 0);

        assert.equal((await riderCall(r2, o, 'reject')).status, 200);
        assert.equal((await riderCall(r3, o, 'reject')).status, 200);
        const d = (await fresh(o)).delivery;
        assert.equal(d.broadcast.active, false);
        assert.equal(d.broadcast.endReason, 'all_rejected');
        assert.ok(await waitFor(async () => (await noteCount(s, { type: 'rider_none', role: 'owner' })) === 1));
        assert.ok(await waitFor(async () => (await noteCount(s, { type: 'rider_rejected', role: 'owner' })) === 3));
        await sleep(300);
        assert.equal(await noteCount(s, { type: 'rider_none' }), 1);         // only one alert
        assert.equal((await riderCall(r1, o, 'accept')).status, 409);
    });

    test('120 seconds pass: the broadcast ends, the owner is alerted ONCE, the offer shows as missed, and a rider can still take the open order', async () => {
        const s = await shop('bc-timeout');
        const o = await deliveryOrder(s);
        await startBroadcast(s, o, 3);

        assert.equal(await assignment.expireBroadcasts(new Date(Date.now() + 60 * 1000)), 0);   // too early
        assert.equal(await assignment.expireBroadcasts(new Date(Date.now() + 121 * 1000)), 1);
        const d = (await fresh(o)).delivery;
        assert.equal(d.broadcast.active, false);
        assert.equal(d.broadcast.endReason, 'timeout');
        assert.ok(d.offers.every((x) => x.result === 'timeout'));
        assert.ok(await waitFor(async () => (await noteCount(s, { type: 'rider_none', role: 'owner' })) === 1));

        assert.equal(await assignment.expireBroadcasts(new Date(Date.now() + 200 * 1000)), 0);   // never twice
        await sleep(300);
        assert.equal(await noteCount(s, { type: 'rider_none' }), 1);
        assert.equal(closedFor().length, 3);                                  // every rider was told it is closed
        // not in "offered" any more, but in "missed" (with the red-dot count), and still takeable
        const head = s.team[0].headers;
        assert.equal((await request(app).get('/api/rider/orders?tab=offered').set(head)).body.items.length, 0);
        const miss = await request(app).get('/api/rider/orders?tab=missed&since=2000-01-01').set(head);
        assert.equal(miss.body.items.length, 1);
        assert.equal(miss.body.items[0].missed.canTake, true);
        assert.equal(miss.body.counts.missed, 1);
        assert.equal((await request(app).get(`/api/rider/orders?tab=missed&since=${new Date(Date.now() + 60000).toISOString()}`).set(head)).body.counts.missed, 0);
        assert.equal((await riderCall(s.team[0], o, 'accept')).status, 200);   // late, but nobody else had it
        assert.equal((await fresh(o)).delivery.riderId?.toString(), String(s.team[0].user._id));
        assert.equal(await slots(s.team[0]), 1);
        assert.equal((await riderCall(s.team[1], o, 'accept')).status, 409);   // now it is taken
        assert.equal(await slots(s.team[1]), 0);
    });

    test('accepting after the 120 seconds but before the job runs still works while the order is free, and the slot is kept', async () => {
        const s = await shop('bc-expired');
        const o = await deliveryOrder(s);
        await startBroadcast(s, o, 3);
        await Order.updateOne({ _id: o._id }, { $set: { 'delivery.broadcast.expiresAt': new Date(Date.now() - 1000) } });
        const res = await riderCall(s.team[0], o, 'accept');
        assert.equal(res.status, 200);
        assert.equal(await slots(s.team[0]), 1);
        assert.equal((await request(app).get('/api/rider/orders?tab=offered').set(s.team[1].headers)).body.items.length, 0);   // the others lost it
    });

    test('cancelling the order ends the broadcast: no alert, the riders are told it is closed', async () => {
        const s = await shop('bc-cancel');
        const o = await deliveryOrder(s);
        await startBroadcast(s, o, 3);
        assert.equal((await ownerPatch(s, o, { status: 'cancelled', reasonCode: 'busy' })).status, 200);
        assert.ok(await waitEnded(o));
        const d = (await fresh(o)).delivery;
        assert.equal(d.broadcast.endReason, 'cancelled');
        assert.ok(d.offers.every((x) => x.result === 'cancelled'));
        assert.ok(await waitFor(() => closedFor().length === 3));
        assert.equal(closedFor()[0].payload.message, 'This request is closed');
        await sleep(300);
        assert.equal(await noteCount(s, { type: 'rider_none' }), 0);
        assert.equal((await riderCall(s.team[0], o, 'accept')).status, 409);
        assert.equal(await slots(s.team[0]), 0);
    });

    test('no rider is free: the broadcast ends at once, the owner is alerted once, and he can assign by hand', async () => {
        const s = await shop('bc-nobody', { riders: 1 });
        await Rider.updateMany({ tenantId: s.tenant._id }, { $set: { isOnline: false } });
        const o = await deliveryOrder(s);
        assert.equal((await ownerPatch(s, o, { status: 'accepted' })).status, 200);
        assert.ok(await waitEnded(o));
        const d = (await fresh(o)).delivery;
        assert.equal(d.broadcast.endReason, 'no_rider');
        assert.equal((d.offers || []).length, 0);
        assert.ok(await waitFor(async () => (await noteCount(s, { type: 'rider_none', role: 'owner' })) === 1));
        assert.equal(EVENTS.rider_none.alsoPush, true);                      // live AND push

        const by = await request(app).post(`/api/shop/orders/${o._id}/assign`).set(s.owner.headers).send({ riderId: String(s.team[0].user._id) });
        assert.equal(by.status, 201);
        const after = (await fresh(o)).delivery;
        assert.equal(String(after.riderId), String(s.team[0].user._id));
        assert.equal(after.status, 'assigned');
        assert.equal(await slots(s.team[0]), 1);
    });

    test('the owner picks a rider by hand while the broadcast is open: it ends, the others are told, "auto" is refused', async () => {
        const s = await shop('bc-by-hand');
        const o = await deliveryOrder(s);
        await startBroadcast(s, o, 3);
        const [r1, r2] = s.team;

        const auto = await request(app).post(`/api/shop/orders/${o._id}/assign`).set(s.owner.headers).send({ auto: true });
        assert.equal(auto.status, 409);
        assert.match(auto.body.error, /already being asked/);
        assert.equal((await fresh(o)).delivery.broadcast.active, true);      // the refused "auto" changed nothing

        const by = await request(app).post(`/api/shop/orders/${o._id}/assign`).set(s.owner.headers).send({ riderId: String(r2.user._id) });
        assert.equal(by.status, 201);
        const d = (await fresh(o)).delivery;
        assert.equal(d.broadcast.active, false);
        assert.equal(d.broadcast.endReason, 'cancelled');
        assert.equal(String(d.riderId), String(r2.user._id));
        assert.equal(d.status, 'assigned');
        assert.equal(d.offers.filter((x) => x.result === 'cancelled').length, 3);
        assert.equal(d.offers.filter((x) => x.result === 'offered').length, 1);   // the new offer to the chosen rider
        assert.equal(await slots(r2), 1);
        assert.ok(await waitFor(() => closedFor().length === 3));
        assert.equal((await riderCall(r1, o, 'accept')).status, 409);
        assert.equal(await slots(r1), 0);
        assert.equal((await riderCall(r2, o, 'accept')).status, 200);         // the chosen rider accepts the normal way
        await sleep(200);
        assert.equal(await noteCount(s, { type: 'rider_none' }), 0);
    });

    test('manual mode, and pickup orders: no broadcast', async () => {
        const manual = await shop('bc-manual', {
            extra: { settings: { orders: { types: ['delivery', 'pickup'], payments: ['cod'] }, riders: { assignMode: 'manual' } } },
        });
        const a = await deliveryOrder(manual);
        assert.equal((await ownerPatch(manual, a, { status: 'accepted' })).status, 200);

        const auto = await shop('bc-pickup');
        const b = await deliveryOrder(auto, { orderType: 'pickup' });
        assert.equal((await ownerPatch(auto, b, { status: 'accepted' })).status, 200);
        await sleep(500);
        for (const x of [a, b]) {
            const d = (await fresh(x)).delivery;
            assert.equal(d?.broadcast?.active, undefined);
            assert.equal((d?.offers || []).length, 0);
        }
        assert.equal(live.filter((e) => e.event === 'rider:offer').length, 0);
    });

    test('a rider who accepts when the food already left takes over as "picked up"', async () => {
        const s = await shop('bc-takeover');
        const o = await deliveryOrder(s);
        await startBroadcast(s, o, 3);
        await Order.updateOne({ _id: o._id }, { $set: { status: 'out_for_delivery' } });
        const res = await riderCall(s.team[0], o, 'accept');
        assert.equal(res.status, 200);
        const d = (await fresh(o)).delivery;
        assert.equal(d.status, 'picked_up');
        assert.ok(d.pickedUpAt);
        assert.equal(String(d.riderId), String(s.team[0].user._id));
    });

    test('the broadcast is hidden from the normal order JSON, and the owner can read it from the delivery view', async () => {
        const s = await shop('bc-json');
        const o = await deliveryOrder(s);
        await startBroadcast(s, o, 3);
        const view = await request(app).get(`/api/shop/orders/${o._id}`).set(s.owner.headers);
        assert.equal(view.status, 200);
        assert.equal(view.body.delivery?.broadcast, undefined);
        assert.equal(view.body.delivery?.offers, undefined);
        const delivery = await request(app).get(`/api/shop/orders/${o._id}/delivery`).set(s.owner.headers);
        assert.equal(delivery.status, 200);
        assert.equal(delivery.body.delivery.broadcast.active, true);
        assert.equal(delivery.body.delivery.offers.length, 3);
        const mine = await request(app).get(`/api/orders/${o._id}`).set(s.customer.headers);   // the customer never sees it either
        assert.equal(mine.body.delivery?.broadcast, undefined);
    });

    test('the default mode is automatic, and the offer words', () => {
        assert.equal(DEFAULTS.riders.assignMode, 'automatic');
        assert.equal(DEFAULTS.riders.offerSeconds, 120);
        assert.equal(
            texts.build('rider_offer', { orderNo: 5, secs: 120, items: 3, collect: 480 }).body,
            'Order #5 (3 items, collect Rs 480). Please accept within 120 seconds.',
        );
        assert.equal(texts.build('rider_offer', { orderNo: 5, secs: 120, items: 1, collect: null }).body, 'Order #5 (1 item). Please accept within 120 seconds.');
        assert.equal(texts.build('rider_offer', { orderNo: 5, secs: 90 }).body, 'Order #5. Please accept within 90 seconds.');   // the old one-rider offer is unchanged
    });
});