require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const Tenant = require('../src/models/Tenant');
const Category = require('../src/models/Category');
const Product = require('../src/models/Product');
const BulkOrder = require('../src/models/BulkOrder');
const pushChannel = require('../src/notifications/channels/push');
const adminAlerts = require('../src/services/adminAlerts');

// The super admin's per-shop "Bulk orders" switch (App features). Off: no new request, the owner cannot set bulk rules or bulk prices (he can
// still switch bulk OFF). On: the owner sets the rules and prices and can switch bulk ordering off himself. Orders already taken always finish.
let w; let admin; let dish; let slug; let n = 0;
const days = (k) => new Date(Date.now() + k * 86400000).toISOString();
const auth = () => ({ Authorization: `Bearer ${admin.token}` });
const owner = (m, p, b) => request(app)[m](`/api/shop/bulk${p}`).set(w.owner.headers).send(b);
const cust = (m, p, b) => request(app)[m](`/api/bulk${p}`).set(w.customer.headers).send(b);
const flip = async (on) => { await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.features.bulkOrders': on } }); tenantRecognizer.invalidateTenant(slug); };
const ask = (over = {}) => cust('post', '/', { fulfilment: 'pickup', when: days(5), items: [{ productId: String(dish._id), quantity: 100 }], contact: { name: 'Raj', phone: '9000000051' }, ...over });

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
    mock.method(adminAlerts, 'alert', async () => { });
    slug = `bulk-switch-${++n}`;
    w = await f.makeWorld(slug);
    admin = await f.makeSuperAdmin();
    const cat = await Category.create({ tenantId: w.tenant._id, name: 'Main', isActive: true });
    dish = await Product.create({ tenantId: w.tenant._id, categoryId: cat._id, name: 'Dal', price: 100, isVeg: true, isActive: true });
});
afterEach(() => mock.restoreAll());

describe('Bulk orders switch: off', () => {
    beforeEach(async () => { await owner('put', '/settings', { enabled: true, noticeHours: 1 }); await flip(false); });

    test('the shop shows no bulk ordering to customers, and takes no new request', async () => {
        const c = await cust('get', '/config');
        assert.deepEqual([c.status, c.body.enabled], [200, false]);
        assert.equal((await cust('get', '/menu')).status, 404);
        assert.equal((await cust('post', '/estimate', { fulfilment: 'pickup', when: days(5), items: [{ productId: String(dish._id), quantity: 50 }] })).status, 404);
        assert.equal((await ask()).status, 404);
        assert.equal(await BulkOrder.countDocuments({}), 0);
    });

    test('the owner app is told the switch is off', async () => {
        const s = await request(app).get('/api/shop/settings').set(w.owner.headers);
        assert.equal(s.body.addons.bulkOrders, false);
        assert.equal((await owner('get', '/settings')).body.featureOn, false);
    });

    test('the owner cannot change the rules or switch bulk on, but he can switch it off', async () => {
        const rules = await owner('put', '/settings', { advancePercent: 30 });
        assert.equal(rules.status, 403);
        assert.match(rules.body.error, /not switched on/);
        assert.equal((await owner('put', '/settings', { enabled: true })).status, 403);
        const off = await owner('put', '/settings', { enabled: false });
        assert.equal(off.status, 200, JSON.stringify(off.body));
        assert.equal(off.body.enabled, false);
        assert.notEqual((await owner('get', '/settings')).body.advancePercent, 30);
    });

    test('the owner cannot set a bulk price on a dish, but can clear one, and saving the dish without it works', async () => {
        const set = await request(app).patch(`/api/shop/products/${dish._id}`).set(w.owner.headers).send({ bulk: { minQty: 30, percentOff: 10 } });
        assert.equal(set.status, 403, JSON.stringify(set.body));
        assert.match(set.body.error, /not switched on/);
        assert.equal((await request(app).patch(`/api/shop/products/${dish._id}`).set(w.owner.headers).send({ price: 110 })).status, 200);
        await Product.updateOne({ _id: dish._id }, { $set: { bulk: { minQty: 30, percentOff: 10 } } });
        const clear = await request(app).patch(`/api/shop/products/${dish._id}`).set(w.owner.headers).send({ bulk: null });
        assert.equal(clear.status, 200, JSON.stringify(clear.body));
    });

    test('the super admin can still set the rules and the bulk prices of that shop', async () => {
        const rules = await request(app).put(`/api/admin/tenants/${w.tenant._id}/shop/bulk/settings`).set(auth()).send({ advancePercent: 40 });
        assert.equal(rules.status, 200, JSON.stringify(rules.body));
        assert.equal(rules.body.advancePercent, 40);
        const price = await request(app).patch(`/api/admin/tenants/${w.tenant._id}/shop/products/${dish._id}`).set(auth()).send({ bulk: { minQty: 30, percentOff: 10 } });
        assert.equal(price.status, 200, JSON.stringify(price.body));
    });
});

describe('Bulk orders switch: on (by the super admin)', () => {
    beforeEach(async () => { await flip(false); });

    test('the super admin switches it on in the shop\'s App features, and then the owner can work', async () => {
        assert.equal((await owner('put', '/settings', { advancePercent: 30 })).status, 403);
        const s = await request(app).put(`/api/admin/tenants/${w.tenant._id}`).set(auth()).send({ settings: { features: { bulkOrders: true } } });
        assert.equal(s.status, 200, JSON.stringify(s.body));
        tenantRecognizer.invalidateTenant(slug);

        assert.equal((await request(app).get('/api/shop/settings').set(w.owner.headers)).body.addons.bulkOrders, true);
        const rules = await owner('put', '/settings', { enabled: true, noticeHours: 1, advancePercent: 30 });
        assert.equal(rules.status, 200, JSON.stringify(rules.body));
        const price = await request(app).patch(`/api/shop/products/${dish._id}`).set(w.owner.headers).send({ bulk: { minQty: 30, percentOff: 10 } });
        assert.equal(price.status, 200, JSON.stringify(price.body));
        assert.equal((await cust('get', '/config')).body.enabled, true);
        assert.equal((await ask()).status, 201);
    });

    test('with the switch on the owner can still turn bulk ordering off and on by himself', async () => {
        await flip(true);
        await owner('put', '/settings', { enabled: true, noticeHours: 1 });
        assert.equal((await cust('get', '/config')).body.enabled, true);
        await owner('put', '/settings', { enabled: false });
        const c = await cust('get', '/config');
        assert.equal(c.body.enabled, false);
        assert.equal((await ask()).status, 404, 'the owner\'s own off switch stops new requests');
        await owner('put', '/settings', { enabled: true });
        assert.equal((await ask()).status, 201);
    });

    test('a shop that was never switched on has bulk off by default', async () => {
        const fresh = await f.makeTenant(`bulk-default-${++n}`, { settings: { features: {} } });
        const cfg = require('../src/services/tenantConfigService').resolveConfig(fresh);
        assert.equal(cfg.features.bulkOrders, false);
    });
});

describe('Bulk orders switch: orders already taken always finish', () => {
    test('after the super admin switches it off the customer and the owner still see, quote, pay, cancel and read the order', async () => {
        await flip(true);
        await owner('put', '/settings', { enabled: true, noticeHours: 1 });
        const first = await ask();
        assert.equal(first.status, 201);
        const second = await ask({ items: [{ productId: String(dish._id), quantity: 120 }] });
        const [a, b] = [first.body.id, second.body.id];
        const o = (await owner('get', `/${a}`)).body;
        const q = await owner('post', `/${a}/quote`, { lines: o.lines.map((l) => ({ id: l.id, unitPrice: l.unitPrice })) });
        assert.equal(q.status, 200, JSON.stringify(q.body));

        await flip(false);                                                       // the super admin switches the shop's bulk off

        assert.equal((await cust('get', `/${a}`)).status, 200, 'the customer still sees it');
        assert.equal((await cust('get', '/mine')).body.items.length, 2);
        assert.equal((await cust('post', `/${a}/pay`)).status, 200, 'and can still pay the advance of a quote he was given');
        assert.equal((await owner('get', `/${b}`)).status, 200, 'the owner still opens it');
        const o2 = (await owner('get', `/${b}`)).body;
        const q2 = await owner('post', `/${b}/quote`, { lines: o2.lines.map((l) => ({ id: l.id, unitPrice: l.unitPrice })) });
        assert.equal(q2.status, 200, 'and quotes it');
        assert.equal((await owner('post', `/${b}/decline`, { reason: 'Closed' })).status, 200, 'or declines it');
        assert.equal((await cust('post', `/${a}/cancel`)).status, 200, 'the customer can cancel');
    });
});
