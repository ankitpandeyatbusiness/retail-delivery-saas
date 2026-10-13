require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const smsChannel = require('../src/notifications/channels/sms');
const pushChannel = require('../src/notifications/channels/push');
const Category = require('../src/models/Category');
const Product = require('../src/models/Product');
const Order = require('../src/models/Order');
const { makeTenant, makeUser } = require('./helpers/factory');
const { validateSettings, openStatus, resolveConfig } = require('../src/services/tenantConfigService');
const { isOpenNow, timingsError } = require('../src/services/categoryTimings');

const SETTINGS = { orders: { types: ['delivery', 'pickup', 'dine_in'], payments: ['cod'] } };

// India date, plus N days
const istDay = (plus = 0) => new Date(Date.now() + 330 * 60000 + plus * 86400000).toISOString().slice(0, 10);
const istMins = () => { const d = new Date(Date.now() + 330 * 60000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const hhmm = (m) => { const x = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };

async function shop(slug, { settings = {}, stock, timings } = {}) {
    const tenant = await makeTenant(slug, { settings: { ...SETTINGS, ...settings } });
    const owner = await makeUser(tenant, 'admin', '9000000010');
    const customer = await makeUser(tenant, 'customer', '9000000030');
    const cat = await Category.create({ tenantId: tenant._id, name: 'Main', ...(timings ? { timings } : {}) });
    const product = await Product.create({
        tenantId: tenant._id, categoryId: cat._id, name: 'Dosa', price: 100, isVeg: true, ...(stock ? { stock } : {}),
    });
    return { tenant, owner, customer, product, cat };
}
const body = (w, o = {}, qty = 1) => ({
    orderType: 'dine_in', tableNo: '5', paymentMethod: 'cod',
    items: [{ productId: String(w.product._id), quantity: qty }], ...o,
});
const place = (w, qty = 1, who = w.customer) => request(app).post('/api/orders').set(who.headers).send(body(w, {}, qty));
const stockOf = async (w) => (await Product.findById(w.product._id).lean());

describe('holiday mode and menu timings (no database)', () => {
    test('a holiday closes the shop for whole India days, and "paused" still wins', () => {
        const ranges = [{ from: '2026-11-01', to: '2026-11-03', message: 'Diwali' }, { from: '2026-11-04', to: '2026-11-04' }];
        const at = (iso) => new Date(iso);
        // 31 Oct 23:30 India = open; 1 Nov 00:30 India = closed
        assert.equal(openStatus(null, true, at('2026-10-31T18:00:00Z'), ranges).isOpen, true);
        const s = openStatus(null, true, at('2026-10-31T19:00:00Z'), ranges);
        assert.equal(s.isOpen, false);
        assert.equal(s.reason, 'holiday');
        assert.equal(s.message, 'Diwali');
        assert.equal(s.reopensOn, '2026-11-05');                      // the next day is a holiday too
        assert.equal(openStatus(null, true, at('2026-11-04T10:00:00Z'), ranges).message, null);
        assert.equal(openStatus(null, true, at('2026-11-05T01:00:00Z'), ranges).isOpen, true);
        assert.equal(openStatus(null, false, at('2026-11-02T10:00:00Z'), ranges).reason, 'paused');
        assert.equal(openStatus(null, true, at('2026-11-02T10:00:00Z')).isOpen, true);   // old callers still work
    });

    test('the config shows the holiday message and the day the shop opens again', () => {
        const now = new Date('2026-11-02T06:00:00Z');
        const cfg = resolveConfig({ name: 'Shop', settings: { hours: { closedDates: [{ from: '2026-11-01', to: '2026-11-03', message: 'Back soon' }] } } }, now);
        assert.equal(cfg.restaurant.isOpen, false);
        assert.equal(cfg.restaurant.closedReason, 'holiday');
        assert.equal(cfg.restaurant.closedMessage, 'Back soon');
        assert.equal(cfg.restaurant.reopensOn, '2026-11-04');
        assert.equal(cfg.hours.closedDates.length, 1);
    });

    test('closedDates is checked: real dates, order, length, up to 30', () => {
        const ok = validateSettings({ hours: { closedDates: [{ from: '2026-11-01', to: '2026-11-01', message: ' Closed ' }] } });
        assert.equal(ok.ok, true);
        assert.deepEqual(ok.clean.hours.closedDates, [{ from: '2026-11-01', to: '2026-11-01', message: 'Closed' }]);
        const bad = (v) => validateSettings({ hours: { closedDates: v } }).ok;
        assert.equal(bad('x'), false);
        assert.equal(bad([{ from: '2026-02-30', to: '2026-03-01' }]), false);       // 30 Feb does not exist
        assert.equal(bad([{ from: '2026-11-05', to: '2026-11-01' }]), false);       // to before from
        assert.equal(bad([{ from: '01-11-2026', to: '02-11-2026' }]), false);
        assert.equal(bad([{ from: '2026-11-01', to: '2026-11-01', message: 'x'.repeat(121) }]), false);
        assert.equal(bad(Array.from({ length: 31 }, () => ({ from: '2026-11-01', to: '2026-11-01' }))), false);
        assert.equal(bad(Array.from({ length: 30 }, () => ({ from: '2026-11-01', to: '2026-11-01' }))), true);
    });

    test('menu timings: days, hours, past midnight, and no timings = always', () => {
        const monMorning = [{ days: ['mon'], open: '07:00', close: '11:00' }];
        assert.equal(isOpenNow(undefined), true);
        assert.equal(isOpenNow([]), true);
        assert.equal(isOpenNow(monMorning, new Date('2026-10-12T04:30:00Z')), true);    // Monday 10:00 India
        assert.equal(isOpenNow(monMorning, new Date('2026-10-12T06:00:00Z')), false);   // Monday 11:30
        assert.equal(isOpenNow(monMorning, new Date('2026-10-13T04:30:00Z')), false);   // Tuesday 10:00
        const night = [{ days: ['fri'], open: '22:00', close: '02:00' }];
        assert.equal(isOpenNow(night, new Date('2026-10-16T17:00:00Z')), true);         // Friday 22:30
        assert.equal(isOpenNow(night, new Date('2026-10-16T19:30:00Z')), true);         // Saturday 01:00 (still Friday's slot)
        assert.equal(isOpenNow(night, new Date('2026-10-16T21:30:00Z')), false);        // Saturday 03:00
        assert.equal(isOpenNow([{ open: '00:00', close: '23:59' }], new Date('2026-10-13T04:30:00Z')), true);   // no days = every day
    });

    test('timings are checked before they are saved', () => {
        assert.equal(timingsError([{ days: ['mon', 'tue'], open: '07:00', close: '11:00' }]), null);
        assert.ok(timingsError('x'));
        assert.ok(timingsError([{ open: '25:00', close: '11:00' }]));
        assert.ok(timingsError([{ open: '07:00', close: '07:00' }]));
        assert.ok(timingsError([{ days: ['funday'], open: '07:00', close: '11:00' }]));
        assert.ok(timingsError([{ days: ['mon', 'mon'], open: '07:00', close: '11:00' }]));
        assert.ok(timingsError(Array.from({ length: 7 }, () => ({ open: '07:00', close: '08:00' }))));
    });
});

describe('holiday, timings and stock in orders', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(() => {
        mock.method(smsChannel, 'send', async () => ({ sent: false }));
        mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
    });
    afterEach(() => mock.restoreAll());

    /* ------------------------------ holiday ------------------------------ */
    test('on a holiday the quote says closed with the message, and the order is refused', async () => {
        const w = await shop('h1-holiday', { settings: { hours: { closedDates: [{ from: istDay(0), to: istDay(1), message: 'Closed for Diwali' }] } } });
        const q = await request(app).post('/api/orders/quote').set(w.customer.headers).send(body(w));
        assert.equal(q.status, 200);
        assert.equal(q.body.shopOpen, false);
        assert.equal(q.body.canPlace, false);
        assert.equal(q.body.problem, 'Closed for Diwali');
        const res = await place(w);
        assert.equal(res.status, 409);
        assert.match(res.body.error, /Closed for Diwali/);
        assert.equal(await Order.countDocuments({ tenantId: w.tenant._id }), 0);
    });

    test('a holiday in the past does nothing', async () => {
        const w = await shop('h1-past', { settings: { hours: { closedDates: [{ from: istDay(-3), to: istDay(-2) }] } } });
        assert.equal((await place(w)).status, 201);
    });

    /* ------------------------------ menu timings ------------------------------ */
    test('a category outside its timings is hidden, and its items cannot be ordered', async () => {
        const m = istMins();
        const w = await shop('h1-closed-cat', { timings: [{ open: hhmm(m + 120), close: hhmm(m + 180) }] });
        const cats = await request(app).get('/api/catalog/categories').set(w.customer.headers);
        assert.equal(cats.body.items.length, 0);
        const menu = await request(app).get('/api/catalog/menu').set(w.customer.headers);
        assert.equal(menu.body.categories.length, 0);
        const one = await request(app).get(`/api/catalog/products/${w.product._id}`).set(w.customer.headers);
        assert.equal(one.status, 404);
        const res = await place(w);
        assert.equal(res.status, 409);
        assert.match(res.body.error, /not served at this time/);
    });

    test('a category inside its timings (even past midnight) is shown and can be ordered', async () => {
        const m = istMins();
        const w = await shop('h1-open-cat', { timings: [{ open: hhmm(m - 60), close: hhmm(m + 60) }] });
        const cats = await request(app).get('/api/catalog/categories').set(w.customer.headers);
        assert.equal(cats.body.items.length, 1);
        assert.equal((await place(w)).status, 201);
    });

    test('the owner saves timings, and a bad slot is refused', async () => {
        const w = await shop('h1-owner-timings');
        const bad = await request(app).post('/api/shop/categories').set(w.owner.headers).send({ name: 'Breakfast', timings: [{ open: '25:00', close: '10:00' }] });
        assert.equal(bad.status, 400);
        const good = await request(app).post('/api/shop/categories').set(w.owner.headers)
            .send({ name: 'Breakfast', timings: [{ days: ['mon', 'tue'], open: '07:00', close: '11:00' }] });
        assert.ok([200, 201].includes(good.status));
        assert.equal(good.body.timings[0].open, '07:00');
    });

    /* ------------------------------ stock ------------------------------ */
    test('an order takes units from the stock; an item that is not tracked is untouched', async () => {
        const w = await shop('h1-take', { stock: { enabled: true, qty: 5 } });
        assert.equal((await place(w, 2)).status, 201);
        assert.equal((await stockOf(w)).stock.qty, 3);
        const free = await shop('h1-untracked');
        assert.equal((await place(free, 2)).status, 201);
        assert.equal((await stockOf(free)).stock.qty, 0);
        assert.equal((await stockOf(free)).isAvailable, true);
    });

    test('asking for more than is left is refused and takes nothing', async () => {
        const w = await shop('h1-short', { stock: { enabled: true, qty: 2 } });
        const q = await request(app).post('/api/orders/quote').set(w.customer.headers).send(body(w, {}, 3));
        assert.equal(q.status, 409);
        assert.match(q.body.error, /Only 2 left/);
        const res = await place(w, 3);
        assert.equal(res.status, 409);
        assert.equal((await stockOf(w)).stock.qty, 2);
        assert.equal(await Order.countDocuments({ tenantId: w.tenant._id }), 0);
    });

    test('the last unit switches the item off, and the next order is refused', async () => {
        const w = await shop('h1-last', { stock: { enabled: true, qty: 1 } });
        assert.equal((await place(w)).status, 201);
        const p = await stockOf(w);
        assert.equal(p.stock.qty, 0);
        assert.equal(p.isAvailable, false);
        const c2 = await makeUser(w.tenant, 'customer', '9000000031');
        const again = await place(w, 1, c2);
        assert.equal(again.status, 409);
        assert.match(again.body.error, /out of stock/);
    });

    test('two customers, one last unit: exactly one order is made', async () => {
        const w = await shop('h1-race', { stock: { enabled: true, qty: 1 } });
        const c2 = await makeUser(w.tenant, 'customer', '9000000031');
        const [a, b] = await Promise.all([place(w, 1, w.customer), place(w, 1, c2)]);
        assert.deepEqual([a.status, b.status].sort(), [201, 409]);
        assert.equal(await Order.countDocuments({ tenantId: w.tenant._id }), 1);
        assert.equal((await stockOf(w)).stock.qty, 0);
    });

    test('a cancel that costs the customer nothing gives the stock back and switches the item on again', async () => {
        const w = await shop('h1-cancel', { stock: { enabled: true, qty: 1 } });
        const placed = await place(w);
        assert.equal(placed.status, 201);
        assert.equal((await stockOf(w)).isAvailable, false);
        const c = await request(app).post(`/api/orders/${placed.body.id}/cancel`).set(w.customer.headers).send({ reason: 'changed my mind' });
        assert.equal(c.status, 200);
        const p = await stockOf(w);
        assert.equal(p.stock.qty, 1);
        assert.equal(p.isAvailable, true);
    });

    test('an order that fails after the units were taken gives them back', async () => {
        const w = await shop('h1-fail', { stock: { enabled: true, qty: 4 } });
        const create = mock.method(Order, 'create', async () => { throw new Error('database is down'); });
        mock.method(console, 'error', () => { });
        const res = await place(w, 2);
        assert.equal(res.status, 500);
        create.mock.restore();
        assert.equal((await stockOf(w)).stock.qty, 4);
        assert.equal((await place(w, 2)).status, 201);   // the retry works
    });

    test('the owner sets the stock; restocking switches the item on, and turning tracking off too', async () => {
        const w = await shop('h1-owner-stock', { stock: { enabled: true, qty: 1 } });
        const url = `/api/shop/products/${w.product._id}/stock`;
        const patch = (b) => request(app).patch(url).set(w.owner.headers).send(b);
        assert.equal((await place(w)).status, 201);                       // now 0 and off
        const up = await patch({ qty: 10 });
        assert.equal(up.status, 200);
        assert.deepEqual(up.body.stock, { enabled: true, qty: 10 });
        assert.equal(up.body.isAvailable, true);
        const zero = await patch({ qty: 0 });
        assert.equal(zero.body.isAvailable, false);
        const off = await patch({ enabled: false });
        assert.equal(off.body.stock.enabled, false);
        assert.equal(off.body.isAvailable, true);
    });

    test('the stock route refuses bad input, other shops and customers', async () => {
        const w = await shop('h1-stock-bad');
        const other = await shop('h1-stock-other');
        const url = `/api/shop/products/${w.product._id}/stock`;
        const patch = (b, who = w.owner) => request(app).patch(url).set(who.headers).send(b);
        assert.equal((await patch({})).status, 400);
        assert.equal((await patch({ qty: -1 })).status, 400);
        assert.equal((await patch({ qty: 2.5 })).status, 400);
        assert.equal((await patch({ qty: 100001 })).status, 400);
        assert.equal((await patch({ enabled: 'yes' })).status, 400);
        assert.equal((await patch({ qty: 3 }, other.owner)).status, 404);           // other shop, other slug: the item is not his
        assert.equal((await request(app).patch('/api/shop/products/abc/stock').set(w.owner.headers).send({ qty: 3 })).status, 404);
        assert.equal((await patch({ qty: 3 }, w.customer)).status, 403);
    });

    test('customers never see the stock count', async () => {
        const w = await shop('h1-hidden', { stock: { enabled: true, qty: 7 } });
        const one = await request(app).get(`/api/catalog/products/${w.product._id}`).set(w.customer.headers);
        assert.equal(one.status, 200);
        assert.equal(one.body.stock, undefined);
        const menu = await request(app).get('/api/catalog/menu').set(w.customer.headers);
        assert.equal(menu.body.categories[0].items[0].stock, undefined);
    });
});