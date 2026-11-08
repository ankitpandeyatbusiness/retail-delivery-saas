require('./helpers/env');
// A dish can be switched off for bulk orders (on by default): it leaves the bulk menu and a bulk request with it is refused.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeWorld } = require('./helpers/factory');
const Category = require('../src/models/Category');
const Product = require('../src/models/Product');

describe('a dish can be switched off for bulk orders', () => {
    let w; let dal; let rice;
    const owner = (m, p, b) => request(app)[m](`/api/shop/bulk${p}`).set(w.owner.headers).send(b);
    const cust = (m, p, b) => request(app)[m](`/api/bulk${p}`).set(w.customer.headers).send(b);
    const days = (n) => new Date(Date.now() + n * 86400000).toISOString();
    const body = (ids) => ({ fulfilment: 'pickup', when: days(5), items: ids.map((id) => ({ productId: String(id), quantity: 20 })), contact: { name: 'Meera', phone: '9000000041' }, packaging: 'any' });
    const names = async () => (await cust('get', '/menu')).body.categories.flatMap((c) => c.items.map((i) => i.name)).sort();
    const setBulk = (id, bulkAllowed) => request(app).patch(`/api/shop/products/${id}`).set(w.owner.headers).send({ bulkAllowed });

    before(async () => {
        await db.connect();
        w = await makeWorld('bulk-switch');
        const cat = await Category.create({ tenantId: w.tenant._id, name: 'Main', isActive: true });
        dal = await Product.create({ tenantId: w.tenant._id, categoryId: cat._id, name: 'Dal', price: 100, isVeg: true, isActive: true });
        rice = await Product.create({ tenantId: w.tenant._id, categoryId: cat._id, name: 'Rice', price: 80, isVeg: true, isActive: true });
        const ok = await owner('put', '/settings', { enabled: true, minOrderAmount: 0, noticeHours: 1 });
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
    });
    after(() => db.disconnect());

    test('a new dish is on for bulk orders without anyone doing anything', async () => {
        assert.equal(dal.bulkAllowed, true);
        assert.deepEqual(await names(), ['Dal', 'Rice']);
    });

    test('the owner switches one dish off: it leaves the bulk menu, and a request with it is refused', async () => {
        const r = await setBulk(dal._id, false);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.bulkAllowed, false);
        assert.deepEqual(await names(), ['Rice'], 'only the other dish is on the bulk menu');
        const est = await cust('post', '/estimate', body([dal._id, rice._id]));
        assert.equal(est.status, 200, JSON.stringify(est.body));
        assert.ok(est.body.problems.some((p) => p.code === 'not_bulk' && /Dal is not available in bulk orders/.test(p.message)), JSON.stringify(est.body.problems));
        const sent = await cust('post', '/', body([dal._id, rice._id]));
        assert.ok(sent.status >= 400, 'the request is not taken: ' + sent.status);
        const fine = await cust('post', '/estimate', body([rice._id]));
        assert.equal(fine.body.problems.filter((p) => p.code === 'not_bulk').length, 0, 'the other dish is fine');
        // the normal menu is not touched: the dish is still sold in a normal order
        assert.equal((await Product.findById(dal._id).lean()).isActive, true);
    });

    test('switched on again, it is back on the bulk menu', async () => {
        assert.equal((await setBulk(dal._id, true)).status, 200);
        assert.deepEqual(await names(), ['Dal', 'Rice']);
        const est = await cust('post', '/estimate', body([dal._id]));
        assert.equal(est.body.problems.filter((p) => p.code === 'not_bulk').length, 0);
    });

    test('a dish saved before the switch existed (no value) counts as on', async () => {
        await Product.collection.updateOne({ _id: rice._id }, { $unset: { bulkAllowed: 1 } });
        assert.deepEqual(await names(), ['Dal', 'Rice']);
    });
});
