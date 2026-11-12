require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const smsAdapter = require('../src/services/adapters/sms');
const demoMode = require('../src/services/demoMode');
const demoTenant = require('../src/services/demoTenant');
const demoReset = require('../src/services/demoReset');
const engine = require('../src/services/demoEngine');
const liveTracking = require('../src/services/liveTracking');
const Order = require('../src/models/Order');
const Tenant = require('../src/models/Tenant');
const Product = require('../src/models/Product');
const Media = require('../src/models/Media');
const Rider = require('../src/models/Rider');
const User = require('../src/models/User');

const PHONE = '9123456782';
const OTP = '482913';
let n = 0;

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    require('../src/middlewares/tenantRecognizer').invalidateTenant(demoTenant.SLUG);
    demoMode.invalidate();
    mock.method(smsAdapter, 'sendOtp', async () => ({ providerMessageId: 't' }));
});
afterEach(() => { mock.restoreAll(); demoMode.invalidate(); liveTracking.reset(); });

// a demo person in the DEMO shop, as the Customer panel
async function customerInDemoShop() {
    const { token } = await f.makeSuperAdmin(`boss${++n}@test.com`);
    await request(app).put('/api/admin/demo').set('Authorization', `Bearer ${token}`).send({ phone: PHONE, otp: OTP });
    const dt = await demoReset.ensureReady();
    const v = await request(app).post('/api/auth/verify-otp').set('x-tenant-slug', dt.slug).send({ phone: PHONE, otp: OTP });
    const sw = await request(app).post('/api/demo/switch').set({ Authorization: `Bearer ${v.body.accessToken}`, 'x-tenant-slug': dt.slug }).send({ panel: 'customer' });
    return { dt, h: { Authorization: `Bearer ${sw.body.accessToken}`, 'x-tenant-slug': dt.slug }, user: sw.body.user };
}

async function placeOrder({ dt, h, user }, orderType = 'delivery') {
    const p = await Product.findOne({ tenantId: dt._id, isAvailable: true, optionGroups: { $size: 0 } });
    const addr = (await request(app).post('/api/addresses').set(h).send({ label: 'Home', name: 'Aarav', phone: user.phone, line1: '5 Test Road', city: 'Kanpur', pincode: '208001', latitude: 26.46, longitude: 80.34 })).body;
    const slots = orderType === 'pickup' ? (await request(app).get('/api/orders/pickup-slots').set(h)).body : null;
    const slot = slots && (slots.slots || slots.days?.[0]?.slots || slots)[0];
    const body = { orderType, items: [{ productId: String(p._id), quantity: 6 }], paymentMethod: 'cod', ...(orderType === 'delivery' ? { addressId: addr.id || addr._id } : {}), ...(slot ? { pickupSlot: slot.from } : {}) };
    const r = await request(app).post('/api/orders').set(h).send(body);
    return r;
}

describe('the demo shop plays the other people', () => {
    test('a delivery order moves by itself: accepted, cooked, picked up by the demo rider, pin moves, delivered', async () => {
        const ctx = await customerInDemoShop();
        const r = await placeOrder(ctx);
        assert.equal(r.status, 201, JSON.stringify(r.body));
        const id = r.body.id || r.body._id;
        const t0 = Date.now();
        const at = (s) => new Date(t0 + s * 1000);
        await engine.tick(at(1));
        assert.equal((await Order.findById(id)).status, 'placed');   // nothing moves before the order has waited
        await engine.tick(at(25));
        assert.equal((await Order.findById(id)).status, 'accepted');
        await engine.tick(at(40));
        assert.equal((await Order.findById(id)).status, 'preparing');
        await engine.tick(at(60));
        const o = await Order.findById(id);
        assert.equal(o.status, 'out_for_delivery');
        assert.equal(String(o.delivery.riderId), String((await User.findOne({ tenantId: ctx.dt._id, phone: demoTenant.PEOPLE.rider.phone }))._id));
        assert.equal(o.delivery.status, 'picked_up');
        // the pin: two moments of the journey give two different places
        const pu = +new Date(o.delivery.pickedUpAt);
        await engine.tick(new Date(pu + 10000));
        const p1 = liveTracking.latestFor(o.delivery.riderId);
        await engine.tick(new Date(pu + 30000));
        const p2 = liveTracking.latestFor(o.delivery.riderId);
        assert.ok(p1 && p2 && (p1.lat !== p2.lat || p1.lng !== p2.lng), 'the rider pin moves');
        await engine.tick(new Date(pu + 60000));
        const done = await Order.findById(id);
        assert.equal(done.status, 'delivered');
        assert.equal(done.delivery.status, 'delivered');
        assert.equal((await Rider.findOne({ tenantId: ctx.dt._id, userId: o.delivery.riderId })).activeOrderCount, 0);
    });

    test('a pickup order becomes ready and is handed over', async () => {
        const ctx = await customerInDemoShop();
        const r = await placeOrder(ctx, 'pickup');
        assert.equal(r.status, 201, JSON.stringify(r.body));
        const id = r.body.id || r.body._id;
        const t0 = Date.now();
        for (const s of [25, 40, 60, 100]) await engine.tick(new Date(t0 + s * 1000));
        assert.equal((await Order.findById(id)).status, 'delivered');
    });

    test('an order of a REAL shop is never touched', async () => {
        const shop = await f.makeTenant(`real-${++n}-${Date.now()}`);
        const u = await f.makeUser(shop, 'customer', '9000000888');
        const o = await f.makeOrder(shop, u.user, { status: 'placed' });
        await Tenant.updateOne({ slug: demoTenant.SLUG }, { $set: { isDemo: true } }).catch(() => { });
        await engine.tick(new Date(Date.now() + 3600 * 1000));
        assert.equal((await Order.findById(o._id)).status, 'placed');
    });

    test('Reset rebuilds the shop, deletes the visitors files and is limited to once a minute', async () => {
        const ctx = await customerInDemoShop();
        await placeOrder(ctx);
        await Media.create({ tenantId: ctx.dt._id, key: `tenants/${ctx.dt.slug}/complaint/x.jpg`, url: 'https://x/x.jpg', kind: 'complaint', refType: 'complaint', bytes: 10, uploadedBy: { type: 'customer', id: 'x', label: '' } }).catch(() => { });
        const before = await Order.countDocuments({ tenantId: ctx.dt._id });
        const r = await request(app).post('/api/demo/reset').set(ctx.h);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.ok(r.body.ok);
        assert.ok((await Order.countDocuments({ tenantId: ctx.dt._id, status: 'placed' })) === 0 && before > 0);
        assert.equal(await Media.countDocuments({ tenantId: ctx.dt._id }), 0);
        const again = await request(app).post('/api/demo/reset').set(ctx.h);
        assert.equal(again.status, 429);
        // the visitor stays signed in
        assert.equal((await request(app).get('/api/me').set(ctx.h)).status, 200);
    });

    test('a complaint photo can be uploaded in the demo shop (small only), but not in a real shop', async () => {
        const ctx = await customerInDemoShop();
        const big = await request(app).post('/api/me/uploads/sign').set(ctx.h).send({ kind: 'complaint', refId: '507f1f77bcf86cd799439011', contentType: 'image/jpeg', bytes: 4 * 1024 * 1024 });
        assert.equal(big.status, 400);
        const small = await request(app).post('/api/me/uploads/sign').set(ctx.h).send({ kind: 'complaint', refId: '507f1f77bcf86cd799439011', contentType: 'image/jpeg', bytes: 200 * 1024 });
        assert.notEqual(small.status, 403);
    });
});
