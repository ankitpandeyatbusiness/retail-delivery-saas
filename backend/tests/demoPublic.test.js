require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const demoTenant = require('../src/services/demoTenant');
const demoReset = require('../src/services/demoReset');
const PlatformSettings = require('../src/models/PlatformSettings');
const Session = require('../src/models/Session');
const Order = require('../src/models/Order');

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    require('../src/middlewares/tenantRecognizer').invalidateTenant(demoTenant.SLUG);
    await demoReset.ensureReady();   // the server builds the demo shop when it starts
});
const H = { 'x-tenant-slug': demoTenant.SLUG };

describe('the public demo website (server side)', () => {
    test('one tap opens the demo shop as a demo customer, with no OTP and no login', async () => {
        const r = await request(app).post('/api/demo/enter').set(H).send({});
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.demo, true);
        assert.equal(r.body.slug, demoTenant.SLUG);
        assert.equal(r.body.user.role, 'customer');
        assert.equal(r.body.user.demo, true);
        assert.ok(demoTenant.isFakePhone(r.body.user.phone));
        const me = await request(app).get('/api/me').set({ ...H, Authorization: `Bearer ${r.body.accessToken}` });
        assert.equal(me.status, 200);
        assert.equal(await Session.countDocuments({ demo: true }), 1);
        // the shop was built on first use
        const menu = await request(app).get('/api/catalog/products').set(H);
        assert.ok(JSON.stringify(menu.body).includes('Butter Chicken'));
    });

    test('a REAL shop refuses the one-tap entry', async () => {
        const t = await f.makeTenant(`real-${Date.now()}`);
        const r = await request(app).post('/api/demo/enter').set({ 'x-tenant-slug': t.slug }).send({});
        assert.equal(r.status, 403);
        assert.equal(await Session.countDocuments({}), 0);
        assert.equal((await request(app).get('/api/demo/info').set({ 'x-tenant-slug': t.slug })).status, 404);
    });

    test('the demo visitor can use the panel switcher and play the owner', async () => {
        const r = await request(app).post('/api/demo/enter').set(H).send({});
        const h = { ...H, Authorization: `Bearer ${r.body.accessToken}` };
        const sw = await request(app).post('/api/demo/switch').set(h).send({ panel: 'owner' });
        assert.equal(sw.status, 200);
        assert.equal(sw.body.slug, demoTenant.SLUG);
        assert.equal(sw.body.user.role, 'admin');
        const orders = await request(app).get('/api/shop/orders').set({ ...H, Authorization: `Bearer ${sw.body.accessToken}` });
        assert.equal(orders.status, 200);
    });

    test('the theme says it is a demo and names the company (default text, or the platform business name)', async () => {
        await demoReset.ensureReady();
        let t = await request(app).get('/api/tenants/theme').set(H);
        assert.equal(t.body.demo, true);
        assert.equal(t.body.demoCompany.name, 'Vivyaan Business Systems Pvt. Ltd.');
        await PlatformSettings.updateOne({ _id: 'main' }, { $set: { 'business.legalName': 'Test Company Ltd' } }, { upsert: true });
        t = await request(app).get('/api/demo/info').set(H);
        assert.equal(t.body.company.name, 'Test Company Ltd');
        const real = await f.makeTenant(`real2-${Date.now()}`);
        const rt = await request(app).get('/api/tenants/theme').set({ 'x-tenant-slug': real.slug });
        assert.equal(rt.body.demo, undefined);   // an ordinary shop never carries the demo flag
    });

    test('Terms and Privacy of the demo carry no shop name', async () => {
        await demoReset.ensureReady();
        for (const key of ['customer_terms', 'privacy']) {
            const r = await request(app).get(`/api/legal/public/${key}`).set(H);
            assert.equal(r.status, 200, key);
            assert.ok(!JSON.stringify(r.body).includes('Demo Shop'), `${key} must not name the demo shop`);
        }
    });

    test('a visitor in the demo shop can place an order that stays inside the demo shop', async () => {
        const r = await request(app).post('/api/demo/enter').set(H).send({});
        const h = { ...H, Authorization: `Bearer ${r.body.accessToken}` };
        const Product = require('../src/models/Product');
        const dt = await demoReset.ensureReady();
        const p = await Product.findOne({ tenantId: dt._id, isAvailable: true, optionGroups: { $size: 0 } });
        const a = (await request(app).post('/api/addresses').set(h).send({ label: 'Home', name: 'A', phone: r.body.user.phone, line1: '5 Road', city: 'Kanpur', pincode: '208001', latitude: 26.46, longitude: 80.34 })).body;
        const o = await request(app).post('/api/orders').set(h).send({ orderType: 'delivery', items: [{ productId: String(p._id), quantity: 6 }], paymentMethod: 'cod', addressId: a.id || a._id });
        assert.equal(o.status, 201, JSON.stringify(o.body));
        assert.equal(String((await Order.findById(o.body.id || o.body._id)).tenantId), String(dt._id));
    });

    test('entry is rate limited per IP', async () => {
        let last;
        for (let i = 0; i < 45; i += 1) { last = await request(app).post('/api/demo/enter').set(H).send({}); if (last.status === 429) break; }
        assert.equal(last.status, 429);
    });
});
