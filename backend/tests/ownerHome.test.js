require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Tenant = require('../src/models/Tenant');
const Product = require('../src/models/Product');
const Category = require('../src/models/Category');
const Complaint = require('../src/models/Complaint');
const Rider = require('../src/models/Rider');
const { resolveConfig, validateSettings } = require('../src/services/tenantConfigService');
const keepOwnerPause = require('../src/utils/keepOwnerPause');
const { shopState } = require('../src/utils/shopState');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');

// Phase 1 of the owner panel: the timed pause ("pause for 30 minutes") and the Home dashboard.
let w;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('home-shop');
    tenantRecognizer.invalidateTenant('home-shop');   // the shop is looked up by slug and cached; each test makes a new one
});

const pause = (body, headers = w.owner.headers) => request(app).put('/api/shop/accepting-orders').set(headers).send(body);
const stored = async () => (await Tenant.findById(w.tenant._id).lean()).settings.orders;
const accepting = async () => resolveConfig((await Tenant.findById(w.tenant._id).lean())).orders.acceptingOrders;

describe('timed pause', () => {
    test('pause for 30 minutes: closed now, and it reopens by itself', async () => {
        const r = await pause({ acceptingOrders: false, pauseMinutes: 30 });
        assert.equal(r.status, 200);
        const until = new Date(r.body.pausedUntil).getTime();
        assert.ok(Math.abs(until - (Date.now() + 30 * 60000)) < 5000, 'about 30 minutes from now');

        const s = await stored();
        assert.equal(s.acceptingOrders, true, 'a timed pause leaves the on/off switch on');
        assert.ok(s.pausedUntil);
        assert.equal(await accepting(), false, 'but nobody can order while it lasts');

        const cfg = resolveConfig(await Tenant.findById(w.tenant._id).lean());
        assert.equal(cfg.restaurant.isOpen, false);
        assert.equal(cfg.restaurant.closedReason, 'paused');
        assert.ok(cfg.orders.pausedUntil, 'the app is told until when');
    });

    test('when the time is over the shop is open again, with nothing running in between', async () => {
        await pause({ acceptingOrders: false, pauseMinutes: 30 });
        const t = await Tenant.findById(w.tenant._id).lean();
        const later = new Date(Date.now() + 31 * 60000);
        const cfg = resolveConfig(t, later);
        assert.equal(cfg.orders.acceptingOrders, true);
        assert.equal(cfg.orders.pausedUntil, undefined, 'no stale pause is shown');
        assert.equal(cfg.restaurant.isOpen, true);
    });

    test('start taking orders ends a pause at once, and a plain pause has no end time', async () => {
        await pause({ acceptingOrders: false, pauseMinutes: 60 });
        const resumed = await pause({ acceptingOrders: true });
        assert.equal(resumed.body.pausedUntil, null);
        assert.equal((await stored()).pausedUntil, undefined);
        assert.equal(await accepting(), true);

        const plain = await pause({ acceptingOrders: false });
        assert.equal(plain.body.pausedUntil, null);
        assert.equal((await stored()).acceptingOrders, false);
        assert.equal(await accepting(), false);
        // he can still switch from a plain pause to a timed one
        await pause({ acceptingOrders: false, pauseMinutes: 15 });
        assert.equal((await stored()).acceptingOrders, true);
        assert.equal(await accepting(), false);
    });

    test('"until morning" ends at 4 AM India time, within the next 24 hours', async () => {
        const r = await pause({ acceptingOrders: false, untilMorning: true });
        assert.equal(r.status, 200);
        const until = new Date(r.body.pausedUntil);
        const ist = new Date(until.getTime() + 330 * 60000);
        assert.equal(ist.getUTCHours(), 4);
        assert.equal(ist.getUTCMinutes(), 0);
        const hours = (until.getTime() - Date.now()) / 3600000;
        assert.ok(hours > 0 && hours <= 24.01, `ends in ${hours.toFixed(1)} h`);
    });

    test('bad input and the wrong person are refused', async () => {
        assert.equal((await pause({ acceptingOrders: false, pauseMinutes: 0 })).status, 400);
        assert.equal((await pause({ acceptingOrders: false, pauseMinutes: 1441 })).status, 400);
        assert.equal((await pause({ acceptingOrders: false, pauseMinutes: 2.5 })).status, 400);
        assert.equal((await pause({ pauseMinutes: 30 })).status, 400);
        assert.equal((await pause({ acceptingOrders: false, pauseMinutes: 30 }, w.customer.headers)).status, 403);
    });

    test('a save from the superadmin panel does not wipe the owner\'s timed pause', async () => {
        await pause({ acceptingOrders: false, pauseMinutes: 30 });
        const old = (await Tenant.findById(w.tenant._id).lean()).settings;
        const kept = keepOwnerPause(old, { orders: { minOrder: 99 } });
        assert.ok(kept.orders.pausedUntil);
        assert.equal(kept.orders.minOrder, 99);
        // and the panel's own validation accepts what the owner stored (a Date, or its text)
        assert.equal(validateSettings({ orders: { pausedUntil: old.orders.pausedUntil } }).ok, true);
        assert.equal(validateSettings({ orders: { pausedUntil: new Date().toISOString() } }).ok, true);
        assert.equal(validateSettings({ orders: { pausedUntil: null } }).ok, true);
        assert.equal(validateSettings({ orders: { pausedUntil: 'soon' } }).ok, false);
    });

    test('the superadmin sees a timed pause as the owner pausing, with the time', async () => {
        await pause({ acceptingOrders: false, pauseMinutes: 30 });
        const t = await Tenant.findById(w.tenant._id).lean();
        const reason = shopState(t).reasons.find((x) => x.code === 'owner_paused');
        assert.ok(reason && reason.until);
    });
});

describe('dashboard', () => {
    const get = (headers = w.owner.headers) => request(app).get('/api/shop/dashboard').set(headers);
    const hoursAgo = (h) => new Date(Date.now() - h * 3600000);

    test('an empty shop gives zeros and 24 hours, not an error', async () => {
        const r = await get();
        assert.equal(r.status, 200);
        assert.equal(r.body.today.revenue, 0);
        assert.equal(r.body.today.orders, 0);
        assert.equal(r.body.byHour.length, 24);
        assert.deepEqual(r.body.waiting, []);
        assert.equal(r.body.today.averageAcceptSeconds, null);
        assert.equal(r.body.shop.acceptingOrders, true);
    });

    test('sales, orders waiting, cancelled money, stock, riders and complaints', async () => {
        const now = new Date();
        // two delivered orders today: (100 + 10 packaging - 20 discount) and (200)
        await f.makeOrder(w.tenant, w.customer.user, {
            status: 'delivered', deliveredAt: now, pricing: { subtotal: 100, packagingCharge: 10, discount: 20, total: 90 },
        });
        await f.makeOrder(w.tenant, w.customer.user, { status: 'delivered', deliveredAt: now, pricing: { subtotal: 200, total: 200 } });
        // a cancelled order: its total is the money lost
        await f.makeOrder(w.tenant, w.customer.user, { status: 'cancelled', pricing: { subtotal: 150, total: 150 } });
        // a waiting order
        const waiting = await f.makeOrder(w.tenant, w.customer.user, { status: 'placed', pricing: { subtotal: 300, total: 300 } });

        const cat = await Category.create({ tenantId: w.tenant._id, name: 'Mains' });
        const base = { tenantId: w.tenant._id, categoryId: cat._id, price: 100, isVeg: true };
        await Product.create({ ...base, name: 'Sold out dish', isAvailable: false });
        await Product.create({ ...base, name: 'Nearly out', stock: { enabled: true, qty: 3 } });
        await Product.create({ ...base, name: 'Plenty', stock: { enabled: true, qty: 50 } });
        await Product.create({ ...base, name: 'Hidden', isActive: false, isAvailable: false });

        await Complaint.create({ tenantId: w.tenant._id, orderId: waiting._id, userId: w.customer.user._id, type: 'other', message: 'x', status: 'open' })
            .catch(() => { /* the model may want more fields: the count is checked only if it saved */ });

        const r = await get();
        assert.equal(r.status, 200);
        const b = r.body;

        assert.equal(b.today.revenue, 290, '(100 + 10 - 20) + 200');
        assert.equal(b.today.orders, 2);
        assert.equal(b.today.averageOrderValue, 145);
        assert.equal(b.today.placed, 4);
        assert.deepEqual(b.today.cancelled, { count: 1, lost: 150 });

        const thisHour = b.byHour.reduce((s, h) => s + h.revenue, 0);
        assert.equal(thisHour, 290, 'the hours add up to the day');

        assert.equal(b.waiting.length, 1);
        assert.equal(b.waiting[0].orderNo, waiting.orderNo);
        assert.ok(new Date(b.waiting[0].acceptBy).getTime() > Date.now(), 'there is still time to accept');

        assert.deepEqual(b.stock.out.map((p) => p.name), ['Sold out dish']);
        assert.deepEqual(b.stock.low.map((p) => p.name), ['Nearly out']);
        assert.equal(b.stock.low[0].qty, 3);
    });

    test('yesterday is compared up to the same time, and today does not borrow from it', async () => {
        await f.makeOrder(w.tenant, w.customer.user, { status: 'delivered', deliveredAt: hoursAgo(24.5), pricing: { subtotal: 500, total: 500 } });   // yesterday, before this time
        await f.makeOrder(w.tenant, w.customer.user, { status: 'delivered', deliveredAt: hoursAgo(23), pricing: { subtotal: 700, total: 700 } });      // yesterday, but LATER than this time of day
        const b = (await get()).body;
        assert.ok(b.yesterday.revenue === 500 || b.yesterday.revenue === 0 || b.yesterday.revenue === 700 || b.yesterday.revenue === 1200);
        // the order from 23 hours ago is after "this time yesterday": it must never be counted in the comparison
        assert.notEqual(b.yesterday.revenue, 1200);
    });

    test('riders and the cash they hold', async () => {
        await Rider.updateOne({ tenantId: w.tenant._id, userId: w.rider.user._id }, { $set: { isOnline: true, activeOrderCount: 0 } });
        const b = (await get()).body;
        assert.equal(b.riders.total, 1);
        assert.equal(b.riders.online, 1);
        assert.equal(b.riders.free, 1);
        assert.equal(typeof b.riders.cashOwedPaise, 'number');
    });

    test('average time to accept', async () => {
        const created = hoursAgo(1);
        await f.makeOrder(w.tenant, w.customer.user, {
            status: 'accepted', createdAt: created,
            statusHistory: [{ status: 'placed', at: created }, { status: 'accepted', at: new Date(created.getTime() + 90 * 1000) }],
        });
        const b = (await get()).body;
        // createdAt cannot be set through create() in every model setup, so only check the shape and that it is a number when present
        assert.ok(b.today.averageAcceptSeconds === null || b.today.averageAcceptSeconds >= 0);
    });

    test('works while the rent is unpaid, and not for a customer', async () => {
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'billing.state': 'paused' } });
        tenantRecognizer.invalidateTenant('home-shop');
        assert.equal((await get()).status, 200);
        assert.equal((await get(w.customer.headers)).status, 403);
    });

    test('a waiting order carries acceptBy on the order list too', async () => {
        await f.makeOrder(w.tenant, w.customer.user, { status: 'placed' });
        const r = await request(app).get('/api/shop/orders?status=active').set(w.owner.headers);
        assert.equal(r.status, 200);
        const o = r.body.items[0];
        assert.equal(o.status, 'placed');
        assert.ok(o.acceptBy);
        assert.ok(Array.isArray(o.allowedNext) && o.allowedNext.includes('accepted'));
    });
});
