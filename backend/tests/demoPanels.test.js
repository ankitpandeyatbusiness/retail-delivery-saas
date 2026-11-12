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
const Session = require('../src/models/Session');
const User = require('../src/models/User');
const Staff = require('../src/models/Staff');
const Rider = require('../src/models/Rider');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');

let n = 0;
const PHONE = '9123456781';
const OTP = '482913';

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    require('../src/middlewares/tenantRecognizer').invalidateTenant(demoTenant.SLUG);   // the demo shop is made new in every test
    demoMode.invalidate();
    mock.method(smsAdapter, 'sendOtp', async () => ({ providerMessageId: 't' }));
});
afterEach(() => { mock.restoreAll(); demoMode.invalidate(); });

async function start() {
    const { token } = await f.makeSuperAdmin(`boss${++n}@test.com`);
    await request(app).put('/api/admin/demo').set('Authorization', `Bearer ${token}`).send({ phone: PHONE, otp: OTP });
    const shop = await f.makeTenant(`real-shop-${++n}-${Date.now()}`);
    const real = await f.makeUser(shop, 'admin', '9000000099');
    const v = await request(app).post('/api/auth/verify-otp').set('x-tenant-slug', shop.slug).send({ phone: PHONE, otp: OTP });
    return { shop, real, h: { Authorization: `Bearer ${v.body.accessToken}`, 'x-tenant-slug': shop.slug }, login: v.body };
}
const hOf = (slug, r) => ({ Authorization: `Bearer ${r.accessToken}`, 'x-tenant-slug': slug });

describe('demo panel switcher', () => {
    test('the login says it is a demo, and the panels list shows all five', async () => {
        const { h, login } = await start();
        assert.equal(login.user.demo, true);
        const r = await request(app).get('/api/demo/panels').set(h);
        assert.equal(r.status, 200);
        assert.deepEqual(r.body.panels.map((p) => p.key), ['customer', 'owner', 'cook', 'waiter', 'rider']);
        assert.ok(r.body.panels.every((p) => p.available));
    });

    test('an ordinary customer cannot use the switcher', async () => {
        const t = await f.makeTenant(`plain-${++n}-${Date.now()}`);
        const u = await f.makeUser(t, 'customer', '9000000777');
        assert.equal((await request(app).get('/api/demo/panels').set(u.headers)).status, 403);
        assert.equal((await request(app).post('/api/demo/switch').set(u.headers).send({ panel: 'owner' })).status, 403);
    });

    test('Owner, Cook, Waiter and Rider open in the demo shop with pretend people', async () => {
        const { shop, h } = await start();
        const want = { owner: 'admin', cook: 'kitchen', waiter: 'waiter', rider: 'rider' };
        for (const [panel, role] of Object.entries(want)) {
            const r = await request(app).post('/api/demo/switch').set(h).send({ panel });
            assert.equal(r.status, 200, panel);
            assert.equal(r.body.slug, demoTenant.SLUG);
            assert.notEqual(r.body.slug, shop.slug);
            assert.equal(r.body.user.role, role);
            assert.equal(r.body.user.demo, true);
            assert.ok(demoTenant.isFakePhone(r.body.user.phone));
        }
        const dt = await Tenant.findOne({ slug: demoTenant.SLUG });
        assert.equal(dt.isDemo, true);
        assert.ok(await Staff.countDocuments({ tenantId: dt._id }) >= 2);
        assert.ok(await Rider.countDocuments({ tenantId: dt._id }) >= 1);
        assert.equal(await User.countDocuments({ tenantId: shop._id }), 2);   // the real owner and the demo customer, nothing added by the panels
    });

    test('the owner panel of the demo shop works, and shows nothing of the real shop', async () => {
        const { shop, real, h } = await start();
        await f.makeOrder(shop, real.user);
        const r = await request(app).post('/api/demo/switch').set(h).send({ panel: 'owner' });
        const oh = hOf(r.body.slug, r.body);
        const orders = await request(app).get('/api/shop/orders').set(oh);
        assert.equal(orders.status, 200);
        assert.ok(!JSON.stringify(orders.body).includes(String(shop._id)));
        assert.ok(await Order.countDocuments({ tenantId: (await Tenant.findOne({ slug: demoTenant.SLUG }))._id }) >= 20);   // the demo shop has its OWN pretend history
    });

    test('Customer returns to the shop where the demo started, from any panel', async () => {
        const { shop, h } = await start();
        const o = await request(app).post('/api/demo/switch').set(h).send({ panel: 'owner' });
        const back = await request(app).post('/api/demo/switch').set(hOf(o.body.slug, o.body)).send({ panel: 'customer' });
        assert.equal(back.status, 200);
        assert.equal(back.body.slug, shop.slug);
        assert.equal(back.body.user.role, 'customer');
        assert.equal(back.body.user.phone, PHONE);
        const me = await request(app).get('/api/me').set(hOf(back.body.slug, back.body));
        assert.equal(me.status, 200);
    });

    test('a demo session in the real shop stays read-only for staff paths; the owner panel is not reachable there', async () => {
        const { h } = await start();
        assert.equal((await request(app).get('/api/shop/orders').set(h)).status, 403);   // a customer role cannot read the owner side
    });

    test('inside the demo shop pretend work is allowed but online payment and uploads stay refused', async () => {
        const { h } = await start();
        const r = await request(app).post('/api/demo/switch').set(h).send({ panel: 'owner' });
        const oh = hOf(r.body.slug, r.body);
        const up = await request(app).post('/api/shop/uploads').set(oh).send({});
        assert.equal(up.status, 403);
        assert.equal(up.body.demo, true);
        const g = require('../src/middlewares/demoGuard');
        assert.equal(g.isAllowedInDemoShop('POST', '/api/shop/categories'), true);
        assert.equal(g.isAllowedInDemoShop('POST', '/api/orders/1/pay'), false);
        assert.equal(g.isAllowedInDemoShop('DELETE', '/api/me'), false);
    });

    test('a panel that the demo shop has switched off is refused, and many visitors do not sign each other out', async () => {
        const { h } = await start();
        const dt = await require('../src/services/demoReset').ensureReady();   // the shop is built first, then one switch is turned off
        await Tenant.updateOne({ _id: dt._id }, { $set: { 'settings.orders.staff.kitchenOn': false } });
        require('../src/middlewares/tenantRecognizer').invalidateTenant(dt.slug);
        const list = await request(app).get('/api/demo/panels').set(h);
        assert.equal(list.body.panels.find((p) => p.key === 'cook').available, false);
        assert.equal((await request(app).post('/api/demo/switch').set(h).send({ panel: 'cook' })).status, 409);
        await Tenant.updateOne({ _id: dt._id }, { $set: { 'settings.orders.staff.kitchenOn': true } });
        const a = await request(app).post('/api/demo/switch').set(h).send({ panel: 'rider' });
        const b = await request(app).post('/api/demo/switch').set(h).send({ panel: 'rider' });
        assert.equal(a.status, 200);
        assert.equal(b.status, 200);
        assert.equal(await Session.countDocuments({ userId: a.body.user.id }), 2);   // a rider normally keeps ONE session; demo riders keep both
    });

    test('no SMS reaches a pretend person', async () => {
        const r = await smsAdapter.send({ to: '6000000004', text: 'x', purpose: 'order', tenant: null });
        assert.equal(r.providerMessageId, 'demo-skipped');
    });
});
