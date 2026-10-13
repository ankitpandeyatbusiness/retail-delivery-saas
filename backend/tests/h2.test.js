require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const smsChannel = require('../src/notifications/channels/sms');
const pushChannel = require('../src/notifications/channels/push');
const center = require('../src/notifications/center');
const Address = require('../src/models/Address');
const Category = require('../src/models/Category');
const Product = require('../src/models/Product');
const Order = require('../src/models/Order');
const Review = require('../src/models/Review');
const Tenant = require('../src/models/Tenant');
const orderStatus = require('../src/services/orderStatusService');
const { makeTenant, makeUser, makeOrder } = require('./helpers/factory');
const { validateSettings, resolveConfig, MIN_SHOP_RATINGS } = require('../src/services/tenantConfigService');
const { distanceFee } = require('../src/services/orderPricing');
const { isOlder } = require('../src/utils/appVersion');

const FEE = { type: 'distance', baseKm: 2, baseFee: 20, perKmFee: 10, maxFee: 0 };

describe('H2 rules (no database)', () => {
    test('distance fee: base for the first km, every started km after it, a top, and unknown distance', () => {
        assert.equal(distanceFee(FEE, 0.5), 20);
        assert.equal(distanceFee(FEE, 2), 20);                    // exactly the base distance
        assert.equal(distanceFee(FEE, 2.1), 30);                  // one started km
        assert.equal(distanceFee(FEE, 4.5), 50);                  // 3 started km
        assert.equal(distanceFee({ ...FEE, maxFee: 40 }, 9), 40); // the top
        assert.equal(distanceFee({ ...FEE, maxFee: 0 }, 9), 90);  // 0 = no top
        assert.equal(distanceFee(FEE, null), 20);                 // no address yet
        assert.equal(distanceFee({ baseFee: 15 }, 7), 15);        // missing numbers count as 0
    });

    test('the settings accept the new fields and refuse bad ones', () => {
        const ok = validateSettings({
            orders: { deliveryFee: { type: 'distance', baseKm: 2, baseFee: 20, perKmFee: 10, maxFee: 80, freeAbove: 500 } },
            riders: { payPerDelivery: 30.5 },
            app: { minVersion: '1.2.0' },
        });
        assert.equal(ok.ok, true, ok.errors.join('; '));
        assert.equal(ok.clean.orders.deliveryFee.maxFee, 80);
        assert.equal(ok.clean.riders.payPerDelivery, 30.5);
        assert.equal(validateSettings({ app: { minVersion: '' } }).ok, true);
        const bad = (s) => validateSettings(s).ok;
        assert.equal(bad({ orders: { deliveryFee: { type: 'distance', baseKm: -1 } } }), false);
        assert.equal(bad({ orders: { deliveryFee: { type: 'distance', perKmFee: 501 } } }), false);
        assert.equal(bad({ orders: { deliveryFee: { type: 'weird' } } }), false);
        assert.equal(bad({ riders: { payPerDelivery: -5 } }), false);
        assert.equal(bad({ riders: { payPerDelivery: '30' } }), false);
        assert.equal(bad({ app: { minVersion: 'abc' } }), false);
        assert.equal(bad({ app: { minVersion: '1.2.3.4.5' } }), false);
        assert.equal(bad({ app: { other: 1 } }), false);
    });

    test('versions are compared as numbers, and an unreadable version never blocks', () => {
        assert.equal(isOlder('1.9.0', '1.10.0'), true);
        assert.equal(isOlder('1.10.0', '1.9.0'), false);
        assert.equal(isOlder('1.2', '1.2.0'), false);
        assert.equal(isOlder('0.9.9', '1.0.0'), true);
        assert.equal(isOlder('2', '1.9'), false);
        assert.equal(isOlder('1.2.0-beta', '1.2.0'), false);
        assert.equal(isOlder('abc', '1.0.0'), false);
        assert.equal(isOlder(undefined, '1.0.0'), false);
    });

    test('the config shows the shop rating only from 20 ratings, and the minimum version', () => {
        const tenant = (count) => ({ name: 'Shop', stats: { rating: { avg: 4.3, count } }, settings: { app: { minVersion: '1.2.0' } } });
        assert.equal(resolveConfig(tenant(MIN_SHOP_RATINGS - 1)).restaurant.rating, null);
        assert.deepEqual(resolveConfig(tenant(MIN_SHOP_RATINGS)).restaurant.rating, { avg: 4.3, count: 20 });
        assert.equal(resolveConfig({ name: 'Shop' }).restaurant.rating, null);
        assert.equal(resolveConfig(tenant(1)).app.minVersion, '1.2.0');
        assert.equal(resolveConfig({ name: 'Shop' }).app.minVersion, null);
    });
});

describe('H2 in the app', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(() => {
        mock.method(smsChannel, 'send', async () => ({ sent: false }));
        mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
    });
    afterEach(() => mock.restoreAll());

    /* ------------------------------ distance fee ------------------------------ */
    // the shop is in Lucknow; the address is 4.5 km straight north of it
    async function distShop(slug, fee = FEE) {
        const tenant = await makeTenant(slug, {
            settings: { orders: { types: ['delivery'], payments: ['cod'], deliveryFee: fee } },
            delivery: { latitude: 26.8467, longitude: 80.9462, radiusKm: 20 },
        });
        const customer = await makeUser(tenant, 'customer', '9000000030');
        const cat = await Category.create({ tenantId: tenant._id, name: 'Main' });
        const product = await Product.create({ tenantId: tenant._id, categoryId: cat._id, name: 'Dosa', price: 100, isVeg: true });
        const address = await Address.create({
            tenantId: tenant._id, userId: customer.user._id, label: 'Home', name: 'Asha', phone: '9000000030',
            line1: '12 Park Road', city: 'Lucknow', pincode: '226001', latitude: 26.8872, longitude: 80.9462,
        });
        return { tenant, customer, product, address };
    }
    const dbody = (w, o = {}) => ({
        orderType: 'delivery', paymentMethod: 'cod', addressId: String(w.address._id),
        items: [{ productId: String(w.product._id), quantity: 1 }], ...o,
    });
    const quote = (w, o) => request(app).post('/api/orders/quote').set(w.customer.headers).send(dbody(w, o));

    test('the quote works out the fee from the distance to the chosen address', async () => {
        const w = await distShop('h2-dist');
        const q = await quote(w);
        assert.equal(q.status, 200);
        assert.equal(q.body.distanceKm, 4.5);
        assert.equal(q.body.pricing.deliveryFee, 50);
        assert.equal(q.body.pricing.total, 150);
        const noAddress = await quote(w, { addressId: undefined });
        assert.equal(noAddress.body.distanceKm, null);
        assert.equal(noAddress.body.pricing.deliveryFee, 20);           // base fee until an address is chosen
    });

    test('the top fee and "free above" work', async () => {
        const capped = await distShop('h2-dist-cap', { ...FEE, maxFee: 40 });
        assert.equal((await quote(capped)).body.pricing.deliveryFee, 40);
        const free = await distShop('h2-dist-free', { ...FEE, freeAbove: 100 });
        assert.equal((await quote(free)).body.pricing.deliveryFee, 0);   // the cart is Rs 100
    });

    test('the order keeps the fee, and a changed address changes the fee the app was told', async () => {
        const w = await distShop('h2-dist-place');
        const placed = await request(app).post('/api/orders').set(w.customer.headers).send(dbody(w, { expectedTotal: 150 }));
        assert.equal(placed.status, 201);
        assert.equal(placed.body.pricing.deliveryFee, 50);
        assert.equal(placed.body.pricing.total, 150);
        const wrong = await request(app).post('/api/orders').set(w.customer.headers)
            .send(dbody(w, { expectedTotal: 120, items: [{ productId: String(w.product._id), quantity: 2 }] }));
        assert.equal(wrong.status, 409);                                 // 2 x 100 + Rs 50 = 250, not 120
        assert.equal(wrong.body.newTotal, 250);
    });

    /* ------------------------------ minimum app version ------------------------------ */
    test('an app older than the minimum gets 426; the same or a newer one, and no header, do not', async () => {
        const tenant = await makeTenant('h2-version', { settings: { app: { minVersion: '1.10.0' } } });
        const get = (v) => {
            const r = request(app).get('/api/catalog/categories').set('x-tenant-slug', tenant.slug);
            return v === undefined ? r : r.set('x-app-version', v);
        };
        const old = await get('1.9.0');
        assert.equal(old.status, 426);
        assert.equal(old.body.updateRequired, true);
        assert.equal(old.body.minVersion, '1.10.0');
        assert.equal((await get('1.10.0')).status, 200);
        assert.equal((await get('2.0.0')).status, 200);
        assert.equal((await get(undefined)).status, 200);                // an old app that sends no header is allowed
        assert.equal((await get('not-a-version')).status, 200);
    });

    test('a shop without a minimum, and /health, are never blocked', async () => {
        const open = await makeTenant('h2-version-none');
        const r = await request(app).get('/api/catalog/categories').set('x-tenant-slug', open.slug).set('x-app-version', '0.0.1');
        assert.equal(r.status, 200);
        assert.equal((await request(app).get('/health').set('x-app-version', '0.0.1')).status, 200);
    });

    /* ------------------------------ shop rating ------------------------------ */
    async function ratedShop(slug, earlier) {
        const tenant = await makeTenant(slug);
        const customer = await makeUser(tenant, 'customer', '9000000030');
        const oid = () => new mongoose.Types.ObjectId();
        if (earlier) {
            await Review.collection.insertMany(Array.from({ length: earlier }, () => ({
                tenantId: tenant._id, orderId: oid(), productId: oid(), userId: oid(), rating: 4, createdAt: new Date(), updatedAt: new Date(),
            })));
        }
        const o = await makeOrder(tenant, customer.user, { status: 'delivered', deliveredAt: new Date() });
        const pid = oid();
        await Order.collection.updateOne({ _id: o._id }, { $set: { items: [{ productId: pid, name: 'Paneer' }] } });
        const res = await request(app).post(`/api/orders/${o._id}/rating`).set(customer.headers)
            .send({ ratings: [{ productId: String(pid), rating: 2 }] });
        return { tenant, res };
    }

    test('rating a dish updates the shop rating; it shows from 20 ratings', async () => {
        mock.method(center, 'notify', () => { });
        const big = await ratedShop('h2-rating-20', 19);
        assert.equal(big.res.status, 200);
        const t = await Tenant.findById(big.tenant._id).lean();
        assert.deepEqual(t.stats.rating, { avg: 3.9, count: 20 });       // 19 x 4 stars + 1 x 2 stars
        assert.deepEqual(resolveConfig(t).restaurant.rating, { avg: 3.9, count: 20 });

        const small = await ratedShop('h2-rating-2', 1);
        const s = await Tenant.findById(small.tenant._id).lean();
        assert.equal(s.stats.rating.count, 2);
        assert.equal(resolveConfig(s).restaurant.rating, null);
    });

    /* ------------------------------ rider earnings ------------------------------ */
    async function deliverOne(w) {
        const o = await makeOrder(w.tenant, w.customer.user, {
            orderType: 'delivery', status: 'out_for_delivery', payment: { method: 'upi', status: 'paid' },
            delivery: { riderId: w.rider.user._id, status: 'picked_up', pinRequired: false },
        });
        const order = await Order.findById(o._id);
        await orderStatus.change({ order, status: 'delivered', actor: { type: 'rider', id: w.rider.user._id, label: '9000000020' } });
        return Order.findById(o._id).lean();
    }
    async function riderShop(slug, pay) {
        const tenant = await makeTenant(slug, { settings: { riders: pay === undefined ? {} : { payPerDelivery: pay } } });
        const rider = await makeUser(tenant, 'rider', '9000000020');
        const customer = await makeUser(tenant, 'customer', '9000000030');
        return { tenant, rider, customer };
    }

    test('a delivery pays the rider the shop rate, saved on the order; the summary adds it up', async () => {
        const w = await riderShop('h2-earn', 30.5);
        const first = await deliverOne(w);
        assert.equal(first.delivery.earnPaise, 3050);
        await deliverOne(w);
        const sum = await request(app).get('/api/rider/summary').set(w.rider.headers);
        assert.equal(sum.status, 200);
        assert.deepEqual(sum.body.earnings, { todayPaise: 6100, monthPaise: 6100, totalPaise: 6100 });
        assert.equal(sum.body.deliveries.total, 2);

        // a new rate never changes old deliveries
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.riders.payPerDelivery': 50 } });
        const { invalidateTenant } = require('../src/middlewares/tenantRecognizer');
        invalidateTenant(w.tenant.slug);
        const third = await deliverOne(w);
        assert.equal(third.delivery.earnPaise, 5000);
        const after = await request(app).get('/api/rider/summary').set(w.rider.headers);
        assert.equal(after.body.earnings.totalPaise, 11100);
    });

    test('no rate means no earnings, and the customer never sees the rider pay', async () => {
        const w = await riderShop('h2-earn-zero');
        const done = await deliverOne(w);
        assert.equal(done.delivery.earnPaise, 0);
        const sum = await request(app).get('/api/rider/summary').set(w.rider.headers);
        assert.deepEqual(sum.body.earnings, { todayPaise: 0, monthPaise: 0, totalPaise: 0 });

        const paid = await riderShop('h2-earn-hidden', 40);
        const o = await deliverOne(paid);
        const mine = await request(app).get(`/api/orders/${o._id}`).set(paid.customer.headers);
        assert.equal(mine.status, 200);
        assert.equal(mine.body.delivery.earnPaise, undefined);
    });
});