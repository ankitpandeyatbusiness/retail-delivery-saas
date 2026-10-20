require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const TableSession = require('../src/models/TableSession');

// Phase 4 of the kitchen and waiter panels: the guest sees where his order is in the kitchen, and about how long it will take.
let w;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('queue-shop');
    await setShop();
});

async function setShop(staff = {}, extra = {}) {
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: {
        'settings.orders.staff': { kitchenOn: true, waiterOn: true, max: 10, kitchenLanes: 3, ...staff },
        'settings.orders.prepTimeMin': 10,
        ...extra,
    } });
    tenantRecognizer.invalidateTenant('queue-shop');
}
const minsAgo = (m) => new Date(Date.now() - m * 60000);
// an order the kitchen has accepted m minutes ago, by another guest unless `who` is given
let phone = 9100000000;
const others = async () => f.makeUser(w.tenant, 'customer', String(++phone));
const mk = async (m, o = {}, who) => {
    const u = who || (await others()).user;
    return f.makeOrder(w.tenant, u, { status: 'accepted', orderType: 'pickup', statusHistory: [{ status: 'placed' }, { status: 'accepted', at: minsAgo(m) }], createdAt: minsAgo(m), ...o });
};
const mine = (o) => request(app).get(`/api/orders/${o._id}`).set(w.customer.headers);

describe('where my order is', () => {
    test('orders ahead of mine, and about how long: one more round of cooking for every full kitchen', async () => {
        await mk(30); await mk(25); await mk(20);
        const me = await mk(5, {}, w.customer.user);
        const r = await mine(me);
        assert.equal(r.status, 200);
        assert.deepEqual({ ...r.body.queue }, { stage: 'waiting', position: 4, ahead: 3, total: 4, etaMin: 20 });   // 3 ahead, 3 cooked at a time: one round, then mine (10 + 10)
    });

    test('the first in line is ready in one cooking time', async () => {
        const me = await mk(5, {}, w.customer.user);
        const r = await mine(me);
        assert.equal(r.body.queue.ahead, 0);
        assert.equal(r.body.queue.etaMin, 10);
    });

    test('an order being cooked says how much time is left', async () => {
        const me = await mk(12, { status: 'preparing', kitchen: { startedAt: minsAgo(4) } }, w.customer.user);
        const r = await mine(me);
        assert.equal(r.body.queue.stage, 'cooking');
        assert.equal(r.body.queue.etaMin, 6);
    });

    test('a ready order says ready', async () => {
        const me = await mk(12, { status: 'preparing', kitchen: { startedAt: minsAgo(9), readyAt: minsAgo(1) } }, w.customer.user);
        assert.equal((await mine(me)).body.queue.stage, 'ready');
    });

    test('the time uses how long this shop really takes', async () => {
        for (let i = 0; i < 6; i += 1) await mk(60, { status: 'delivered', kitchen: { startedAt: minsAgo(50 + i), readyAt: minsAgo(42 + i) } });   // 8 minutes each
        const me = await mk(5, {}, w.customer.user);
        assert.equal((await mine(me)).body.queue.etaMin, 8);
    });

    test('an order that moves ahead of mine, or is cancelled, moves me up', async () => {
        const a = await mk(30);
        await mk(25);
        const me = await mk(5, {}, w.customer.user);
        assert.equal((await mine(me)).body.queue.position, 3);
        await Order.updateOne({ _id: a._id }, { $set: { status: 'cancelled' } });
        assert.equal((await mine(me)).body.queue.position, 2);
    });

    test('the queue carries no names or numbers of other guests', async () => {
        await mk(30);
        const me = await mk(5, {}, w.customer.user);
        const text = JSON.stringify((await mine(me)).body.queue);
        assert.ok(!/91000|phone|customer|name/i.test(text));
    });

    test('the guest never sees the cook name or a problem the kitchen reported', async () => {
        const me = await mk(5, { status: 'preparing', kitchen: { startedAt: minsAgo(3), startedByName: 'Ramesh', problem: { kind: 'other', note: 'gas is low', at: new Date(), byName: 'Ramesh' } } }, w.customer.user);
        const text = JSON.stringify((await mine(me)).body);
        assert.ok(!/Ramesh|gas is low|problem/.test(text), text.slice(0, 300));
    });

    test('my orders list carries it too', async () => {
        await mk(30);
        const me = await mk(5, {}, w.customer.user);
        const r = await request(app).get('/api/orders?active=true').set(w.customer.headers);
        assert.equal(r.body.items.find((o) => o.id === String(me._id)).queue.ahead, 1);
    });
});

describe('when nothing is said', () => {
    test('the kitchen screen is off, or the super admin hides the queue', async () => {
        const me = await mk(5, {}, w.customer.user);
        await setShop({ kitchenOn: false });
        assert.equal((await mine(me)).body.queue, undefined);
        await setShop({ queueShown: false });
        assert.equal((await mine(me)).body.queue, undefined);
    });

    test('with the time switched off only the place is shown', async () => {
        await mk(30);
        const me = await mk(5, {}, w.customer.user);
        await setShop({ queueEta: false });
        const q = (await mine(me)).body.queue;
        assert.equal(q.ahead, 1);
        assert.equal(q.etaMin, null);
    });

    test('a kind of order the cook does not see has no queue; a pickup for much later is not in the queue yet', async () => {
        await setShop({ kitchenSees: ['dine_in'] });
        const pickup = await mk(5, {}, w.customer.user);
        assert.equal((await mine(pickup)).body.queue, undefined);
        await setShop({});
        const later = await mk(5, { scheduledFor: new Date(Date.now() + 3 * 3600000) }, w.customer.user);
        assert.equal((await mine(later)).body.queue, undefined);
    });

    test('a placed order, not yet accepted, has no queue', async () => {
        const me = await mk(1, { status: 'placed' }, w.customer.user);
        assert.equal((await mine(me)).body.queue, undefined);
    });

    test('another guest cannot read my order', async () => {
        const me = await mk(5, {}, w.customer.user);
        const other = await f.makeUser(w.tenant, 'customer', '9300000000');
        assert.equal((await request(app).get(`/api/orders/${me._id}`).set(other.headers)).status, 404);
    });
});

describe('at a table', () => {
    test('each round on the guest\'s bill says where it is; the owner\'s view does not', async () => {
        const s = await TableSession.create({ tenantId: w.tenant._id, table: '4', customers: [w.customer.user._id], status: 'open' });
        await mk(30, { orderType: 'dine_in', tableNo: '9' });
        const round = await mk(5, { orderType: 'dine_in', tableNo: '4', tableSessionId: s._id }, w.customer.user);
        const tableBill = require('../src/services/tableBill');
        const session = await TableSession.findById(s._id);
        const bill = await tableBill.billOf(session);
        assert.equal(bill.rounds.find((r) => r.id === String(round._id)).queue.ahead, 1);
        const owner = await tableBill.billOf(session, { owner: true });
        assert.equal(owner.rounds[0].queue, null);
    });
});
