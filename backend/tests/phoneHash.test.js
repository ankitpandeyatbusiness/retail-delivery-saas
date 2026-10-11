require('./helpers/env');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { hashPhone, maskPhone } = require('../src/utils/phoneHash');
const { backfill } = require('../scripts/backfillPhoneHash');
const User = require('../src/models/User');
const Order = require('../src/models/Order');
const Address = require('../src/models/Address');
const Category = require('../src/models/Category');
const Product = require('../src/models/Product');
const Coupon = require('../src/models/Coupon');
const CustomerRisk = require('../src/models/CustomerRisk');
const { makeTenant, makeUser, makeOrder, makeSuperAdmin, plantOtp } = require('./helpers/factory');

async function shopWithMenu(slug) {
    const tenant = await makeTenant(slug);
    const cat = await Category.create({ tenantId: tenant._id, name: 'Main' });
    const product = await Product.create({ tenantId: tenant._id, categoryId: cat._id, name: 'Dosa', price: 100, isVeg: true });
    await Coupon.create({
        tenantId: tenant._id, code: 'FIRST10', discountType: 'flat', discountValue: 10, firstOrderOnly: true, usageLimitPerUser: 1,
    });
    return { tenant, product };
}
const placeBody = (product, address) => ({
    orderType: 'delivery', items: [{ productId: String(product._id), quantity: 1 }],
    addressId: String(address._id), paymentMethod: 'cod', couponCode: 'FIRST10',
});

describe('phone hash', () => {
    const flow = {};   // shared between the tests that follow each other
    before(() => db.connect());
    after(() => db.disconnect());

    test('hashPhone: same input gives the same hash, another shop or phone gives another', () => {
        const a = new mongoose.Types.ObjectId();
        const b = new mongoose.Types.ObjectId();
        const h = hashPhone(a, '9000000001');
        assert.match(h, /^[0-9a-f]{64}$/);
        assert.equal(h, hashPhone(a, '9000000001'));
        assert.equal(h, hashPhone(String(a), '9000000001'));
        assert.notEqual(h, hashPhone(b, '9000000001'));
        assert.notEqual(h, hashPhone(a, '9000000002'));
    });

    test('hashPhone refuses bad input (a null hash could match every old order)', () => {
        const a = new mongoose.Types.ObjectId();
        assert.throws(() => hashPhone(null, '9000000001'));
        assert.throws(() => hashPhone(a, '123'));
        assert.throws(() => hashPhone(a));
    });

    test('maskPhone hides the middle', () => {
        assert.equal(maskPhone('9000000070'), '90XXXXXX70');
        assert.equal(maskPhone('abc'), null);
        assert.equal(maskPhone(undefined), null);
    });

    test('a new user gets his phoneHash on create', async () => {
        const t = await makeTenant('hash-create-shop');
        const u = await makeUser(t, 'customer', '9000000080');
        assert.equal(u.user.phoneHash, hashPhone(t._id, '9000000080'));
    });

    test('login fills the phoneHash of an old user who has none', async () => {
        const t = await makeTenant('old-user-shop');
        const phone = '9000000081';
        await User.collection.insertOne({
            tenantId: t._id, phone, role: 'customer', isBlocked: false, createdAt: new Date(), updatedAt: new Date(),
        });
        await plantOtp(t, phone, '654321');
        const res = await request(app).post('/api/auth/verify-otp').set('x-tenant-slug', t.slug).send({ phone, otp: '654321' });
        assert.equal(res.status, 200);
        assert.equal((await User.findOne({ tenantId: t._id, phone })).phoneHash, hashPhone(t._id, phone));
    });

    test('a deleted customer who registers again cannot reuse a first-order coupon', async () => {
        const { tenant, product } = await shopWithMenu('coupon-shop');
        const phone = '9000000070';
        flow.tenant = tenant;
        const c = await makeUser(tenant, 'customer', phone);
        const address = await Address.create({ tenantId: tenant._id, userId: c.user._id, line1: '12 Test Street', city: 'Lucknow', pincode: '226001' });

        const placed = await request(app).post('/api/orders').set(c.headers).send(placeBody(product, address));
        assert.equal(placed.status, 201);
        assert.equal(placed.body.pricing.discount, 10);
        const order = await Order.findById(placed.body.id);
        assert.equal(order.customer.phoneHash, hashPhone(tenant._id, phone));
        flow.orderId = order._id;

        await Order.updateOne({ _id: order._id }, { $set: { status: 'delivered', deliveredAt: new Date() } });
        const del = await request(app).delete('/api/me').set(c.headers).send({ confirm: true });
        assert.equal(del.status, 200);
        assert.equal(await User.countDocuments({ _id: c.user._id }), 0);
        const risk = await CustomerRisk.findOne({ tenantId: tenant._id, phoneHash: hashPhone(tenant._id, phone) });
        assert.ok(risk.deletedAt);
        assert.equal((await Order.findById(order._id)).customer.deleted, true);

        // he comes back with the same phone
        await plantOtp(tenant, phone, '654321');
        const back = await request(app).post('/api/auth/verify-otp').set('x-tenant-slug', tenant.slug).send({ phone, otp: '654321' });
        assert.equal(back.status, 200);
        const headers = { Authorization: `Bearer ${back.body.accessToken}`, 'x-tenant-slug': tenant.slug };
        const address2 = await Address.create({ tenantId: tenant._id, userId: back.body.user.id, line1: '12 Test Street' });
        const again = await request(app).post('/api/orders').set(headers).send(placeBody(product, address2));
        assert.equal(again.status, 400);
        assert.match(again.body.error, /first order/);
        assert.equal(await Order.countDocuments({ tenantId: tenant._id }), 1);
    });

    test('owner and superadmin see "Deleted customer" and a masked phone, the invoice data stays', async () => {
        const owner = await makeUser(flow.tenant, 'admin', '9000000071');
        const { token } = await makeSuperAdmin('masker@example.com');
        const asOwner = await request(app).get(`/api/shop/orders/${flow.orderId}`).set(owner.headers);
        const asAdmin = await request(app).get(`/api/admin/orders/${flow.orderId}`).set('Authorization', `Bearer ${token}`);
        assert.equal(asOwner.status, 200);
        assert.equal(asAdmin.status, 200);
        for (const body of [asOwner.body, asAdmin.body]) {
            assert.equal(body.customer.name, 'Deleted customer');
            assert.equal(body.customer.phone, '90XXXXXX70');
            assert.equal(body.customer.phoneHash, undefined);
            assert.equal(body.address.name, 'Deleted customer');
            assert.equal(body.address.phone, '90XXXXXX70');
        }
        const doc = await Order.findById(flow.orderId);
        assert.equal(doc.customer.phone, '9000000070');   // the document (used for the invoice PDF) keeps the real phone
        const pdf = await request(app).get(`/api/shop/orders/${flow.orderId}/invoice`).set(owner.headers);
        assert.equal(pdf.status, 200);
    });

    test('a normal customer never gets his phoneHash in the order JSON', async () => {
        const t = await makeTenant('plain-json-shop');
        const c = await makeUser(t, 'customer', '9000000082');
        const order = await makeOrder(t, c.user);
        const res = await request(app).get(`/api/orders/${order._id}`).set(c.headers);
        assert.equal(res.status, 200);
        assert.equal(res.body.customer.phoneHash, undefined);
        assert.equal(res.body.customer.phone, '9000000082');
    });

    test('a rider who accepted an order does not get the phoneHash', async () => {
        const t = await makeTenant('rider-json-shop');
        const c = await makeUser(t, 'customer', '9000000083');
        const r = await makeUser(t, 'rider', '9000000084');
        const order = await makeOrder(t, c.user, {
            status: 'preparing',
            delivery: { riderId: r.user._id, status: 'accepted' },
        });
        const res = await request(app).get(`/api/rider/orders/${order._id}`).set(r.headers);
        assert.equal(res.status, 200);
        assert.equal(res.body.customer.phone, '9000000083');
        assert.equal(res.body.customer.phoneHash, undefined);
    });

    test('backfill adds the hash to old users and orders, and is safe to run twice', async () => {
        const t = await makeTenant('backfill-shop');
        const phone = '9000000095';
        const userId = new mongoose.Types.ObjectId();
        await User.collection.insertOne({ _id: userId, tenantId: t._id, phone, role: 'customer', isBlocked: false });
        await Order.collection.insertOne({ tenantId: t._id, userId, orderNo: 5, status: 'delivered', customer: { name: 'Old', phone } });

        const dry = await backfill({ apply: false });
        assert.ok(dry.users >= 1 && dry.orders >= 1);
        assert.equal((await User.findById(userId)).phoneHash, undefined);   // a dry run changes nothing

        await backfill({ apply: true });
        assert.equal((await User.findById(userId)).phoneHash, hashPhone(t._id, phone));
        assert.equal((await Order.findOne({ tenantId: t._id, orderNo: 5 })).customer.phoneHash, hashPhone(t._id, phone));

        const again = await backfill({ apply: false });
        assert.equal(again.users, 0);
        assert.equal(again.orders, 0);
    });
});