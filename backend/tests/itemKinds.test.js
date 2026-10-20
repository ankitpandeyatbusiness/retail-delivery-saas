require('./helpers/env');
// Items by kind and by weight: sweets sold per kg, drinks per litre, the kind decides the category,
// and the customer picks an amount (quick size or typed) instead of a quantity.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Category = require('../src/models/Category');
const Product = require('../src/models/Product');
const Order = require('../src/models/Order');
const { applyAutoHide, invalidateAvailability, getAvailability } = require('../src/services/availability');
const { resolveConfig } = require('../src/services/tenantConfigService');
const { labelOf } = require('../src/services/itemMeasure');

let token;
let n = 0;
const auth = () => ({ Authorization: `Bearer ${token}` });
const slug = (p) => `${p}-${++n}-${Date.now().toString(36)}`;

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    token = (await f.makeSuperAdmin('root@test.com')).token;
});

async function shop() {
    const tenant = await f.makeTenant(slug('kind'), { settings: { orders: { types: ['delivery', 'pickup', 'dine_in'], payments: ['cod'], dineIn: { enabled: true, tabLimitNew: 0, tabLimitTrusted: 0 }, mixRules: { exposureOn: false } } } });
    const customer = await f.makeUser(tenant, 'customer', '9000000030');
    return { tenant, customer };
}
const adminPost = (w, body) => request(app).post(`/api/admin/tenants/${w.tenant._id}/products`).set(auth()).send(body);
const order = (w, items) => request(app).post('/api/orders').set(w.customer.headers)
    .send({ orderType: 'dine_in', tableNo: '5', paymentMethod: 'cod', items });

describe('item kind and weight', () => {
    test('a sweet with no category is filed under "Sweets" (created once) and is sold by weight', async () => {
        const w = await shop();
        const a = await adminPost(w, { name: 'Gajar halwa', price: 600, isVeg: true, itemKind: 'sweet' });
        assert.equal(a.status, 201, JSON.stringify(a.body));
        assert.equal(a.body.sellBy, 'weight');
        const cat = await Category.findById(a.body.categoryId).lean();
        assert.equal(cat.name, 'Sweets');
        const b = await adminPost(w, { name: 'Rasgulla', price: 400, isVeg: true, itemKind: 'sweet' });
        assert.equal(String(b.body.categoryId), String(a.body.categoryId));
        assert.equal(await Category.countDocuments({ tenantId: w.tenant._id, name: 'Sweets' }), 1);
    });

    test('unknown kinds and bad measures are refused; weight items drop serves, sizes and stock', async () => {
        const w = await shop();
        assert.equal((await adminPost(w, { name: 'X', price: 10, isVeg: true, itemKind: 'gadget' })).status, 400);
        assert.equal((await adminPost(w, { name: 'X', price: 10, isVeg: true, itemKind: 'sweet', measure: { min: 5 } })).status, 400);
        assert.equal((await adminPost(w, { name: 'X', price: 10, isVeg: true, itemKind: 'sweet', measure: { min: 1000, max: 500 } })).status, 400);
        const ok = await adminPost(w, { name: 'Barfi', price: 700, isVeg: true, itemKind: 'sweet', serves: 4, sizes: [{ label: 'big', price: 1 }], stock: { enabled: true, qty: 5 } });
        assert.equal(ok.status, 201, JSON.stringify(ok.body));
        assert.equal(ok.body.serves, undefined);
        assert.equal(ok.body.sizes.length, 0);
        assert.equal(ok.body.stock.enabled, false);
    });

    test('price is per kg: 250 g costs a quarter, a typed 750 g is accepted, quantity is not', async () => {
        const w = await shop();
        const p = (await adminPost(w, { name: 'Kaju katli', price: 1000, isVeg: true, itemKind: 'sweet' })).body;

        const a = await order(w, [{ productId: p._id, quantity: 1, measureQty: 250 }]);
        assert.equal(a.status, 201, JSON.stringify(a.body));
        const o = await Order.findById(a.body._id || a.body.id || a.body.order?._id).lean();
        assert.equal(o.items[0].unitPrice, 250);
        assert.equal(o.items[0].measure.label, '250 g');

        const typed = await order(w, [{ productId: p._id, quantity: 1, measureQty: 750 }]);
        assert.equal(typed.status, 201, JSON.stringify(typed.body));
        const t = await Order.findById(typed.body._id || typed.body.id || typed.body.order?._id).lean();
        assert.equal(t.items[0].lineTotal, 750);
        assert.equal(t.items[0].measure.label, '750 g');

        assert.equal((await order(w, [{ productId: p._id, quantity: 2, measureQty: 250 }])).status, 400);   // no quantity
        assert.equal((await order(w, [{ productId: p._id, quantity: 1 }])).status, 400);                    // amount missing
        assert.equal((await order(w, [{ productId: p._id, quantity: 1, measureQty: 5 }])).status, 400);     // below the smallest
        assert.equal((await order(w, [{ productId: p._id, quantity: 1, measureQty: 123 }])).status, 400);   // not on the step
    });

    test('when typing is switched off only the listed sizes work; a piece item refuses an amount', async () => {
        const w = await shop();
        const p = (await adminPost(w, { name: 'Peda', price: 800, isVeg: true, itemKind: 'sweet', measure: { options: [250, 500], allowManual: false } })).body;
        assert.equal((await order(w, [{ productId: p._id, quantity: 1, measureQty: 500 }])).status, 201);
        assert.equal((await order(w, [{ productId: p._id, quantity: 1, measureQty: 300 }])).status, 400);
        const dosa = (await adminPost(w, { name: 'Dosa', price: 100, isVeg: true, itemKind: 'food' })).body;
        assert.equal(dosa.sellBy, 'piece');
        assert.equal((await order(w, [{ productId: dosa._id, quantity: 1, measureQty: 250 }])).status, 400);
        assert.equal((await order(w, [{ productId: dosa._id, quantity: 2 }])).status, 201);
    });

    test('the "weight" filter appears only when something is sold by weight', async () => {
        const w = await shop();
        const cfg = () => applyAutoHide(resolveConfig(w.tenant), {}).config;
        const cat = await Category.create({ tenantId: w.tenant._id, name: 'M' });
        await Product.create({ tenantId: w.tenant._id, categoryId: cat._id, name: 'Dosa', price: 100, isVeg: true });
        invalidateAvailability(w.tenant._id);
        let a = await getAvailability(w.tenant._id);
        assert.equal(applyAutoHide(resolveConfig(w.tenant), a).config.home.filters.includes('weight'), false);
        await Product.create({ tenantId: w.tenant._id, categoryId: cat._id, name: 'Halwa', price: 600, isVeg: true, sellBy: 'weight' });
        invalidateAvailability(w.tenant._id);
        a = await getAvailability(w.tenant._id);
        assert.equal(applyAutoHide(resolveConfig(w.tenant), a).config.home.filters.includes('weight'), true);
        void cfg;
    });

    test('labels read naturally, and only restaurants can be created today', () => {
        assert.equal(labelOf('weight', 500), '500 g');
        assert.equal(labelOf('weight', 1000), '1 kg');
        assert.equal(labelOf('weight', 1500), '1.5 kg');
        assert.equal(labelOf('volume', 250), '250 ml');
        assert.equal(labelOf('volume', 2000), '2 L');
    });

    test('creating a shop of a business type that is not open yet is refused', async () => {
        const r = await request(app).post('/api/admin/tenants').set(auth()).send({ slug: slug('gs'), name: 'General', businessType: 'general_store' });
        assert.equal(r.status, 400);
        const ok = await request(app).post('/api/admin/tenants').set(auth()).send({ slug: slug('rs'), name: 'Resto', businessType: 'restaurant' });
        assert.equal(ok.status, 201);
        assert.equal(ok.body.tenant.businessType, 'restaurant');
        const opts = await request(app).get('/api/admin/options').set(auth());
        assert.equal(opts.body.businessTypes.restaurant.itemKinds.length, 7);
        assert.equal(opts.body.businessTypes.garments.status, 'planned');
    });
});
