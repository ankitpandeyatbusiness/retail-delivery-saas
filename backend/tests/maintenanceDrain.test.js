require('./helpers/env');
// Maintenance: NO NEW WORK starts, but what is already running can be finished, so no order or delivery hangs in the middle. A shop with nothing running goes fully offline.
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const db = require('./helpers/db');
const app = require('../src/server/app');
const f = require('./helpers/factory');
const Tenant = require('../src/models/Tenant');
const PlatformSettings = require('../src/models/PlatformSettings');
const Order = require('../src/models/Order');
const pushChannel = require('../src/notifications/channels/push');
const recog = require('../src/middlewares/tenantRecognizer');
const maintenanceState = require('../src/services/maintenanceState');

let w; let n = 0; let slug;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
    slug = `drain-${++n}`;
    w = await f.makeWorld(slug);
    maintenanceState.invalidatePlatform();
});
afterEach(() => mock.restoreAll());

const platformOn = async (since = new Date(), extra = {}) => {
    await PlatformSettings.findByIdAndUpdate('main', { $set: { maintenance: { on: true, message: 'Upgrading the servers', since, ...extra } } }, { upsert: true });
    maintenanceState.invalidatePlatform();
};
const shopOn = async (since = new Date()) => {
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { maintenance: { on: true, message: 'Shop work', since } } });
    recog.invalidateTenant(slug);
};
const running = (extra = {}) => f.makeOrder(w.tenant, w.customer.user, { orderType: 'pickup', status: 'accepted', ...extra });
const place = () => request(app).post('/api/orders').set(w.customer.headers).send({ items: [] });
const accept = (o) => request(app).patch(`/api/shop/orders/${o._id}/status`).set(w.owner.headers).send({ status: 'preparing' });

describe('maintenance with work still running (draining)', () => {
    for (const [name, turnOn] of [['the whole platform', () => platformOn()], ["one shop's own switch", () => shopOn()]]) {
        test(`${name}: reading works, a new order is refused, and the running order can be finished`, async () => {
            const o = await running();
            await turnOn();
            const cfg = await request(app).get('/api/tenants/config').set({ 'x-tenant-slug': slug });
            assert.equal(cfg.status, 200, 'the apps can still read, to show the badge');
            const placed = await place();
            assert.equal(placed.status, 503, JSON.stringify(placed.body));
            assert.equal(placed.body.maintenance, true);
            assert.equal(placed.body.draining, true, 'the app is told the shop is only finishing what it has');
            const moved = await accept(o);
            assert.equal(moved.status, 200, 'the owner can still move the running order along: ' + JSON.stringify(moved.body));
            assert.equal((await Order.findById(o._id).lean()).status, 'preparing');
            const cancel = await request(app).post(`/api/orders/${o._id}/cancel`).set(w.customer.headers).send({});
            assert.notEqual(cancel.status, 503, 'the customer can still act on his own order');
        });
    }

    test('a rider can finish a delivery during the maintenance', async () => {
        const o = await running({ orderType: 'delivery', status: 'out_for_delivery', delivery: { riderId: w.rider.user._id, status: 'picked_up' } });
        await platformOn();
        const r = await request(app).get('/api/rider/orders').set(w.rider.headers);
        assert.notEqual(r.status, 503, 'the rider app keeps working');
        const act = await request(app).post(`/api/rider/orders/${o._id}/deliver`).set(w.rider.headers).send({});
        assert.notEqual(act.status, 503, 'the rider is never stopped in the middle of a delivery');
    });
});

describe('maintenance with nothing running (offline)', () => {
    test('every change is refused for the owner, new orders too, but an existing order can still be cancelled and the sign-in kept alive', async () => {
        await platformOn();
        const owner = await request(app).patch('/api/shop/orders/000000000000000000000000/status').set(w.owner.headers).send({ status: 'accepted' });
        assert.equal(owner.status, 503, 'nothing is running: the shop panel is offline');
        assert.equal(owner.body.draining, false);
        assert.equal((await place()).status, 503);
        const done = await f.makeOrder(w.tenant, w.customer.user, { orderType: 'pickup', status: 'delivered' });
        const view = await request(app).get(`/api/orders/${done._id}`).set(w.customer.headers);
        assert.notEqual(view.status, 503, 'he can still see his order');
        const refresh = await request(app).post('/api/auth/refresh').set({ 'x-tenant-slug': slug }).send({ refreshToken: w.customer.refreshToken });
        assert.notEqual(refresh.status, 503, 'the sign-in is kept alive');
    });

    test('a paid bulk order for a day far away is not "running": the shop goes offline', async () => {
        await running({ status: 'accepted', bulkId: new mongoose.Types.ObjectId(), bulkCode: 'B7K2QX', scheduledFor: new Date(Date.now() + 5 * 86400000) });
        await platformOn();
        const st = await maintenanceState.stateOf(await recog.lookup(slug));
        assert.equal(st.running, 0);
        assert.equal(st.offline, true);
    });

    test('an order still waiting for the shop, a pickup ready for its customer and an unpaid table bill all count as running', async () => {
        await platformOn();
        for (const extra of [{ status: 'placed' }, { status: 'ready' }, { orderType: 'dine_in', status: 'delivered', tableSessionId: new mongoose.Types.ObjectId(), payment: { method: 'cod', status: 'pending' } }]) {
            await Order.deleteMany({});
            maintenanceState.forgetWork(w.tenant._id);
            await running(extra);
            const st = await maintenanceState.stateOf(await recog.lookup(slug));
            assert.equal(st.draining, true, JSON.stringify(extra));
        }
    });
});

describe('the safety limit and the end', () => {
    test('after two hours a shop that still shows work is taken offline (a stuck order must not keep it open), but its rider and customer can still finish what exists', async () => {
        const o = await running();
        await platformOn(new Date(Date.now() - 3 * 3600000));
        const st = await maintenanceState.stateOf(await recog.lookup(slug));
        assert.equal(st.running, 1);
        assert.equal(st.offline, true, 'the limit passed');
        assert.equal((await accept(o)).status, 503, 'the owner panel is offline');
        const cancel = await request(app).post(`/api/orders/${o._id}/cancel`).set(w.customer.headers).send({});
        assert.notEqual(cancel.status, 503, 'but the customer can still cancel his order');
    });

    test('when maintenance ends everything works again', async () => {
        await running();
        await platformOn();
        assert.equal((await place()).status, 503);
        await PlatformSettings.findByIdAndUpdate('main', { $set: { 'maintenance.on': false } });
        maintenanceState.invalidatePlatform();
        const placed = await place();
        assert.notEqual(placed.status, 503, 'not refused for maintenance any more (it may fail for another reason)');
        assert.notEqual(placed.body?.maintenance, true);
    });
});

describe("the shop's order switch follows maintenance", () => {
    const { sweep } = require('../src/services/maintenanceShopSwitch');
    const accepting = async () => (await Tenant.findById(w.tenant._id).lean()).settings?.orders?.acceptingOrders;
    const flag = async () => (await Tenant.findById(w.tenant._id).lean()).settings?.orders?.maintenancePaused;

    test('a shop with nothing running is switched off, and switched back on when maintenance is over', async () => {
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.acceptingOrders': true } });
        await shopOn();
        await sweep();
        assert.equal(await accepting(), false, 'nothing running: the switch is slid off');
        assert.equal(await flag(), true);
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'maintenance.on': false } });
        recog.invalidateTenant(slug);
        await sweep();
        assert.equal(await accepting(), true, 'maintenance over: back on');
        assert.ok(!(await flag()));
    });

    test('a shop that still has a running order stays on until it is done; a shop its owner switched off is left alone', async () => {
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.acceptingOrders': true } });
        const o = await running();
        await shopOn();
        await sweep();
        assert.equal(await accepting(), true, 'still draining');
        await Order.updateOne({ _id: o._id }, { $set: { status: 'delivered', 'payment.status': 'paid' } });
        maintenanceState.forgetWork(w.tenant._id);
        await sweep();
        assert.equal(await accepting(), false, 'the last order is done');
        // the owner's own off stays off
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.acceptingOrders': false }, $unset: { 'settings.orders.maintenancePaused': '' } });
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'maintenance.on': false } });
        recog.invalidateTenant(slug);
        await sweep();
        assert.equal(await accepting(), false, 'not ours to switch on');
    });
});
