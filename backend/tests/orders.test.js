require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const smsChannel = require('../src/notifications/channels/sms');
const pushChannel = require('../src/notifications/channels/push');
const { hashPhone } = require('../src/utils/phoneHash');
const Category = require('../src/models/Category');
const Product = require('../src/models/Product');
const Order = require('../src/models/Order');
const OrderGuard = require('../src/models/OrderGuard');
const CustomerRisk = require('../src/models/CustomerRisk');
const { makeTenant, makeUser, makeOrder, makeSuperAdmin } = require('./helpers/factory');
const Counter = require('../src/models/Counter');

// dine-in orders need no address and no pickup time, so they keep these tests short
const SETTINGS = { orders: { types: ['delivery', 'pickup', 'dine_in'], payments: ['cod'], dineIn: { enabled: true, tabLimitNew: 0, tabLimitTrusted: 0 }, mixRules: { exposureOn: false } } };   // the cash-together limit is tested in its own file

async function shop(slug, price = 100) {
    const tenant = await makeTenant(slug, { settings: SETTINGS });
    const owner = await makeUser(tenant, 'admin', '9000000010');
    const customer = await makeUser(tenant, 'customer', '9000000030');
    const cat = await Category.create({ tenantId: tenant._id, name: 'Main' });
    const product = await Product.create({ tenantId: tenant._id, categoryId: cat._id, name: 'Dosa', price, isVeg: true });
    return { tenant, owner, customer, product };
}
const body = (w, o = {}) => ({
    orderType: 'dine_in', tableNo: '5', paymentMethod: 'cod',
    items: [{ productId: String(w.product._id), quantity: 1 }], ...o,
});
const place = (w, o, who = w.customer, extraHeaders = {}) =>
    request(app).post('/api/orders').set(who.headers).set(extraHeaders).send(body(w, o));
const orders = (w) => Order.countDocuments({ tenantId: w.tenant._id });

describe('orders: price changed, double tap, Cash on delivery limit', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(() => {
        mock.method(smsChannel, 'send', async () => ({ sent: false }));
        mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
    });
    afterEach(() => mock.restoreAll());

    /* ------------------------------ the split still works ------------------------------ */
    test('quote, pickup slots, place, reorder and cancel still work after the split', async () => {
        const w = await shop('od-basic');
        const q = await request(app).post('/api/orders/quote').set(w.customer.headers).send(body(w));
        assert.equal(q.status, 200);
        assert.equal(q.body.pricing.total, 100);
        assert.equal(q.body.canPlace, true);

        const slots = await request(app).get('/api/orders/pickup-slots').set(w.customer.headers);
        assert.equal(slots.status, 200);
        assert.equal(slots.body.open, true);
        assert.ok(Array.isArray(slots.body.slots));

        const placed = await place(w);
        assert.equal(placed.status, 201);
        assert.equal(placed.body.orderNo, 1001);
        assert.equal(placed.body.customer.phone, '9000000030');
        assert.equal(placed.body.customer.phoneHash, undefined);
        const doc = await Order.findById(placed.body.id);
        assert.equal(doc.customer.phoneHash, hashPhone(w.tenant._id, '9000000030'));

        const again = await request(app).post(`/api/orders/${placed.body.id}/reorder`).set(w.customer.headers);
        assert.equal(again.status, 200);
        assert.equal(again.body.items.length, 1);

        const cancelled = await request(app).post(`/api/orders/${placed.body.id}/cancel`).set(w.customer.headers).send({ reason: 'changed my mind' });
        assert.equal(cancelled.status, 200);
        assert.equal(cancelled.body.status, 'cancelled');
    });

    /* ------------------------------ D9: price changed ------------------------------ */
    test('D9: the right expectedTotal places the order, and an order without it still works (older apps)', async () => {
        const w = await shop('od-price-ok');
        assert.equal((await place(w, { expectedTotal: 100 })).status, 201);
        const w2 = await shop('od-price-none');
        assert.equal((await place(w2)).status, 201);
    });

    test('D9: a different expectedTotal gives 409 PRICE_CHANGED with the new total, and no order is made', async () => {
        const w = await shop('od-price-changed');
        await Product.updateOne({ _id: w.product._id }, { $set: { price: 120 } });   // the price changed after the customer opened his cart
        const res = await place(w, { expectedTotal: 100 });
        assert.equal(res.status, 409);
        assert.equal(res.body.code, 'PRICE_CHANGED');
        assert.equal(res.body.newTotal, 120);
        assert.equal(res.body.items.length, 1);
        assert.equal(res.body.items[0].unitPrice, 120);
        assert.ok(res.body.error);
        assert.equal(await orders(w), 0);

        assert.equal((await place(w, { expectedTotal: 120 })).status, 201);           // with the new total it works
    });

    test('D9: a bad expectedTotal gives 400, and rounding works (3 x 99.99 = 299.97)', async () => {
        const w = await shop('od-price-bad', 99.99);
        assert.equal((await place(w, { expectedTotal: 'abc' })).status, 400);
        assert.equal((await place(w, { expectedTotal: -5 })).status, 400);
        assert.equal((await place(w, { expectedTotal: 299.97, items: [{ productId: String(w.product._id), quantity: 3 }] })).status, 201);
    });

    /* ------------------------------ B12: double tap ------------------------------ */
    test('B12: the same cart twice in a row is refused with 409 Duplicate order', async () => {
        const w = await shop('od-dup');
        assert.equal((await place(w)).status, 201);
        const second = await place(w);
        assert.equal(second.status, 409);
        assert.equal(second.body.error, 'Duplicate order');
        assert.equal(await orders(w), 1);
    });

    test('B12: two parallel taps make exactly ONE order', async () => {
        const w = await shop('od-dup-parallel');
        const results = await Promise.all([place(w), place(w)]);
        assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
        assert.equal(await orders(w), 1);
    });

    test('B12: another cart, another person, or the same cart after 10 seconds is allowed', async () => {
        const w = await shop('od-dup-allowed');
        assert.equal((await place(w)).status, 201);
        assert.equal((await place(w, { items: [{ productId: String(w.product._id), quantity: 2 }] })).status, 201);   // another cart

        const other = await makeUser(w.tenant, 'customer', '9000000031');
        assert.equal((await place(w, {}, other)).status, 409, 'another person at the same table must first be let in');                // another person: asked first
        assert.equal((await place(w, { tableNo: '6' }, other)).status, 201);                                                    // another person, another table

        await OrderGuard.updateMany({}, { $set: { at: new Date(Date.now() - 11000) } });                               // 11 seconds later
        assert.equal((await place(w)).status, 201);
        assert.equal(await orders(w), 4);
    });

    test('B12: the same Idempotency-Key still returns the same order (200), also when sent at the same moment', async () => {
        const w = await shop('od-idem');
        const key = { 'Idempotency-Key': 'key-0123456789' };
        const first = await place(w, {}, w.customer, key);
        assert.equal(first.status, 201);
        const second = await place(w, {}, w.customer, key);
        assert.equal(second.status, 200);
        assert.equal(second.body.id, first.body.id);

        const w2 = await shop('od-idem-parallel');
        const k2 = { 'Idempotency-Key': 'key-parallel-99' };
        const both = await Promise.all([place(w2, {}, w2.customer, k2), place(w2, {}, w2.customer, k2)]);
        assert.deepEqual(both.map((r) => r.status).sort(), [200, 201]);
        assert.equal(both[0].body.id, both[1].body.id);
        assert.equal(await orders(w2), 1);
    });

    test('B12: a failed order does not block the retry', async () => {
        const w = await shop('od-dup-fail');
        mock.method(Order, 'create', async () => { throw new Error('database is down'); });
        assert.equal((await place(w)).status, 500);
        mock.restoreAll();
        mock.method(smsChannel, 'send', async () => ({ sent: false }));
        mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
        assert.equal((await place(w)).status, 201);
        assert.equal(await orders(w), 1);
    });

    /* ------------------------------ N2: Cash on delivery limit ------------------------------ */
    const big = (w, qty) => ({ items: [{ productId: String(w.product._id), quantity: qty }] });
    const delivered = (w, n) => Promise.all(Array.from({ length: n }, () => makeOrder(w.tenant, w.customer.user, { status: 'delivered' })));

    test('N2: a new phone cannot pay more than Rs 1000 by cash on its first orders, 1000 itself is fine', async () => {
        const w = await shop('od-cap');
        const refused = await place(w, big(w, 15));                                    // Rs 1500
        assert.equal(refused.status, 400);
        assert.equal(refused.body.error, 'Cash on delivery is limited to Rs 1000 for your first 3 orders. Pay online or reduce the order.');
        assert.equal(await orders(w), 0);

        const quote = await request(app).post('/api/orders/quote').set(w.customer.headers).send(body(w, big(w, 15)));
        assert.equal(quote.body.canPlace, false);                                      // the cart screen already knows
        assert.match(quote.body.problem, /limited to Rs 1000/);

        assert.equal((await place(w, big(w, 10))).status, 201);                        // exactly Rs 1000
    });

    test('N2: after 3 earlier orders the limit is gone, 2 earlier orders are not enough', async () => {
        const w = await shop('od-cap-lift');
        await delivered(w, 2);
        assert.equal((await place(w, big(w, 15))).status, 400);
        await delivered(w, 1);
        // the helper numbers its orders by itself, so move the real counter past them
        await Counter.updateOne({ _id: `order:${w.tenant._id}` }, { $set: { seq: 100 } }, { upsert: true });
        assert.equal((await place(w, big(w, 15))).status, 201);
    });

    test('N2: cancelled orders do not count, and it works by phone: another shop starts again', async () => {
        const w = await shop('od-cap-cancelled');
        await Promise.all(Array.from({ length: 3 }, () => makeOrder(w.tenant, w.customer.user, { status: 'cancelled' })));
        assert.equal((await place(w, big(w, 15))).status, 400);

        const other = await shop('od-cap-other-shop');                                  // the same phone number, another shop
        await delivered(w, 3);                                                          // 3 orders in the first shop
        assert.equal((await place(other, big(other, 15))).status, 400);                 // a new customer there
    });

    test('N2: a blocked phone cannot pay by cash at all, even for a small order', async () => {
        const w = await shop('od-cap-blocked');
        await CustomerRisk.create({ tenantId: w.tenant._id, phoneHash: hashPhone(w.tenant._id, '9000000030'), codBlocked: true, strikes: 2 });
        const res = await place(w);
        assert.equal(res.status, 400);
        assert.equal(res.body.error, 'Paying by cash is not available for this number because of earlier unpaid or missed orders. Please pay online, or call the shop to sort it out.');
    });

    test('N2: a blocked phone stays blocked after the customer deletes his account and comes back', async () => {
        const w = await shop('od-cap-deleted');
        await CustomerRisk.create({ tenantId: w.tenant._id, phoneHash: hashPhone(w.tenant._id, '9000000030'), codBlocked: true });
        const del = await request(app).delete('/api/me').set(w.customer.headers).send({ confirm: true });
        assert.equal(del.status, 200);
        const again = await makeUser(w.tenant, 'customer', '9000000030');              // registers again with the same phone
        const res = await request(app).post('/api/orders').set(again.headers).send(body(w));
        assert.equal(res.status, 400);
        assert.equal(res.body.error, 'Paying by cash is not available for this number because of earlier unpaid or missed orders. Please pay online, or call the shop to sort it out.');
    });

    test('N2: the owner can change the limit or switch it off, and not the tax or payment settings', async () => {
        const w = await shop('od-cap-owner');
        const put = (b) => request(app).put('/api/shop/settings').set(w.owner.headers).send(b);

        assert.equal((await put({ orders: { codCap: { amount: -1 } } })).status, 400);
        assert.equal((await put({ orders: { codCap: { firstOrders: 1.5 } } })).status, 400);
        assert.equal((await put({ orders: { codCap: { price: 1 } } })).status, 400);
        assert.equal((await put({ orders: { gst: { mode: 'inclusive', percent: 5 } } })).status, 400);   // tax and payment methods are not for owners

        const ok = await put({ orders: { codCap: { amount: 500 } } });
        assert.equal(ok.status, 200);
        assert.equal(ok.body.codCap.amount, 500);
        const refused = await place(w, big(w, 6));                                       // Rs 600
        assert.equal(refused.status, 400);
        assert.match(refused.body.error, /limited to Rs 500 for your first 3 orders/);

        assert.equal((await put({ orders: { codCap: { amount: 0 } } })).status, 200);    // 0 = off
        assert.equal((await place(w, big(w, 15))).status, 201);
        assert.equal((await request(app).put('/api/shop/settings').set(w.customer.headers).send({ orders: { codCap: { amount: 1 } } })).status, 403);
    });

    test('N2: the superadmin can change the limit for a shop with the settings form', async () => {
        const w = await shop('od-cap-super');
        const { token } = await makeSuperAdmin('cap-admin@example.com');
        const res = await request(app).put(`/api/admin/tenants/${w.tenant._id}`).set('Authorization', `Bearer ${token}`)
            .send({ settings: { ...SETTINGS, orders: { ...SETTINGS.orders, codCap: { amount: 300, firstOrders: 1 } } } });
        assert.equal(res.status, 200);
        assert.equal(res.body.resolved.orders.codCap.amount, 300);
        assert.equal(res.body.resolved.orders.codCap.firstOrders, 1);
    });

    test('N2: the default limit is on for every shop (Rs 1000, first 3 orders)', async () => {
        const w = await shop('od-cap-default');
        const cfg = await request(app).get('/api/tenants/config').set('x-tenant-slug', w.tenant.slug);
        assert.equal(cfg.status, 200);
        assert.deepEqual(cfg.body.config.orders.codCap, { amount: 1000, firstOrders: 3 });
    });

    /* ------------------------------ clear the block ------------------------------ */
    describe('clearing the Cash on delivery block', () => {
        const risk = (w) => CustomerRisk.findOne({ tenantId: w.tenant._id, phoneHash: hashPhone(w.tenant._id, '9000000030') }).lean();
        const clear = (w, headers, id, b = { blocked: false }) =>
            request(app).patch(`/api/shop/customers/${id}/cod-block`).set(headers).send(b);

        test('the owner clears the block and the strikes, and cash works again', async () => {
            const w = await shop('od-clear-owner');
            await CustomerRisk.create({
                tenantId: w.tenant._id, phoneHash: hashPhone(w.tenant._id, '9000000030'),
                codBlocked: true, codBlockedAt: new Date(), strikes: 2,
            });
            assert.equal((await place(w)).status, 400);

            const res = await clear(w, w.owner.headers, w.customer.user._id);
            assert.equal(res.status, 200);
            assert.deepEqual({ ok: res.body.ok, codBlocked: res.body.codBlocked, strikes: res.body.strikes }, { ok: true, codBlocked: false, strikes: 0 });
            const row = await risk(w);
            assert.equal(row.codBlocked, false);
            assert.equal(row.strikes, 0);
            assert.equal(row.codBlockedAt, undefined);
            assert.equal((await place(w)).status, 201);
        });

        test('a person with no record is fine too, and wrong input is refused', async () => {
            const w = await shop('od-clear-input');
            assert.equal((await clear(w, w.owner.headers, w.customer.user._id)).status, 200);
            assert.equal(await CustomerRisk.countDocuments({ tenantId: w.tenant._id }), 0);   // nothing was invented
            assert.equal((await clear(w, w.owner.headers, w.customer.user._id, { blocked: true })).status, 400);
            assert.equal((await clear(w, w.owner.headers, w.customer.user._id, {})).status, 400);
            assert.equal((await clear(w, w.owner.headers, 'not-an-id')).status, 404);
            assert.equal((await clear(w, w.owner.headers, '5f0000000000000000000000')).status, 404);
        });

        test('a customer or a rider cannot use it, and one shop cannot clear the people of another', async () => {
            const w = await shop('od-clear-perm');
            const rider = await makeUser(w.tenant, 'rider', '9000000020');
            assert.equal((await clear(w, w.customer.headers, w.customer.user._id)).status, 403);
            assert.equal((await clear(w, rider.headers, w.customer.user._id)).status, 403);
            assert.equal((await request(app).patch(`/api/shop/customers/${w.customer.user._id}/cod-block`).send({ blocked: false })).status, 400);   // no shop header

            const other = await shop('od-clear-perm-b');
            await CustomerRisk.create({ tenantId: w.tenant._id, phoneHash: hashPhone(w.tenant._id, '9000000030'), codBlocked: true });
            assert.equal((await clear(other, other.owner.headers, w.customer.user._id)).status, 404);   // not his customer
            assert.equal((await risk(w)).codBlocked, true);
        });

        test('the superadmin can clear it through the shop mount, in a paused shop too', async () => {
            const w = await shop('od-clear-super');
            const { token } = await makeSuperAdmin('cap-clear@example.com');
            await CustomerRisk.create({ tenantId: w.tenant._id, phoneHash: hashPhone(w.tenant._id, '9000000030'), codBlocked: true, strikes: 2 });
            const res = await request(app).patch(`/api/admin/tenants/${w.tenant._id}/shop/customers/${w.customer.user._id}/cod-block`)
                .set('Authorization', `Bearer ${token}`).send({ blocked: false });
            assert.equal(res.status, 200);
            assert.equal((await risk(w)).codBlocked, false);
        });
    });
});