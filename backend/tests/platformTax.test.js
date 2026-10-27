require('./helpers/env');
// ONE GST for every shop, set only by the superadmin; charged only for a shop whose GST number the superadmin saved.
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
const Tenant = require('../src/models/Tenant');
const platformTax = require('../src/services/platformTax');
const { resolveConfig } = require('../src/services/tenantConfigService');

let token;
let n = 0;
const auth = () => ({ Authorization: `Bearer ${token}` });
const slug = () => `tax-${++n}-${Date.now().toString(36)}`;
const GSTIN = '27AAAAA0000A1Z5';

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    token = (await f.makeSuperAdmin('root@test.com')).token;
    await platformTax.load();
});

async function shop({ gstin, settings = {}, gstRate } = {}) {
    const tenant = await f.makeTenant(slug(), {
        ...(gstin ? { business: { legalName: 'Shop', gstin } } : {}),
        settings: { orders: { types: ['dine_in'], payments: ['cod'], dineIn: { enabled: true, tabLimitNew: 0, tabLimitTrusted: 0 }, mixRules: { exposureOn: false }, ...settings.orders } },
    });
    const owner = await f.makeUser(tenant, 'admin', '9000000010');
    const customer = await f.makeUser(tenant, 'customer', '9000000030');
    const cat = await Category.create({ tenantId: tenant._id, name: 'Main' });
    const product = await Product.create({ tenantId: tenant._id, categoryId: cat._id, name: 'Thali', price: 100, isVeg: true, ...(gstRate ? { gstRate } : {}) });
    return { tenant, owner, customer, product };
}
const place = (w, table = '4', qty = 1) => request(app).post('/api/orders').set(w.customer.headers)
    .send({ orderType: 'dine_in', tableNo: table, paymentMethod: 'cod', items: [{ productId: String(w.product._id), quantity: qty }] });
const idOf = (r) => r.body._id || r.body.id || r.body.order?._id;
const setTax = (b) => request(app).put('/api/admin/platform/tax').set(auth()).send(b);

describe('one GST for every shop', () => {
    test('only the superadmin sets it, with limits', async () => {
        assert.equal((await request(app).put('/api/admin/platform/tax').send({ gstPercent: 5 })).status, 401);
        assert.equal((await setTax({ gstPercent: 40 })).status, 400);
        assert.equal((await setTax({ gstPercent: -1 })).status, 400);
        assert.equal((await setTax({ gstMode: 'weird' })).status, 400);
        assert.equal((await setTax({})).status, 400);
        const ok = await setTax({ gstPercent: 5, gstMode: 'exclusive' });
        assert.equal(ok.status, 200);
        assert.deepEqual(ok.body, { gstPercent: 5, gstMode: 'exclusive' });
        const got = await request(app).get('/api/admin/platform/tax').set(auth());
        assert.equal(got.body.gstPercent, 5);
    });

    test('a shop WITH a GST number charges the global rate; one without charges none', async () => {
        await setTax({ gstPercent: 5, gstMode: 'exclusive' });
        const withNo = await shop({ gstin: GSTIN });
        const without = await shop({});

        const a = await place(withNo);
        assert.equal(a.status, 201, JSON.stringify(a.body));
        const oa = await Order.findById(a.body._id || a.body.id || a.body.order?._id).lean();
        assert.equal(oa.pricing.taxPercent, 5);
        assert.equal(oa.pricing.tax, 5);
        assert.equal(oa.pricing.total, 105);

        const b = await place(without);
        assert.equal(b.status, 201, JSON.stringify(b.body));
        const ob = await Order.findById(b.body._id || b.body.id || b.body.order?._id).lean();
        assert.equal(ob.pricing.tax, 0);
        assert.equal(ob.pricing.total, 100);
    });

    test('included GST is carved out of the price; changing the rate changes every shop at once', async () => {
        await setTax({ gstPercent: 12, gstMode: 'inclusive' });
        const w = await shop({ gstin: GSTIN });
        const first = await Order.findById(idOf(await place(w))).lean();
        assert.equal(first.pricing.total, 100);
        assert.equal(first.pricing.tax, 10.71);

        await setTax({ gstPercent: 18 });
        const r2 = await place(w, '4', 2);   // the same table: a guest has one open table at a time
        assert.equal(r2.status, 201, JSON.stringify(r2.body));
        const second = await Order.findById(idOf(r2)).lean();
        assert.equal(second.pricing.tax, 30.51);   // 2 x 100 with 18% included
    });

    test("a shop's own GST settings and an item's own rate are ignored", async () => {
        await setTax({ gstPercent: 5, gstMode: 'exclusive' });
        const w = await shop({ gstin: GSTIN, settings: { orders: { gst: { mode: 'inclusive', percent: 28 } } }, gstRate: 28 });
        const cfg = resolveConfig(await Tenant.findById(w.tenant._id).lean());
        assert.deepEqual(cfg.orders.gst, { mode: 'exclusive', percent: 5 });
        const o = await Order.findById(idOf(await place(w))).lean();
        assert.equal(o.pricing.taxPercent, 5);
        assert.equal(o.items[0].gstRate, 5);
    });

    test('an owner cannot save a GST number or any GST setting', async () => {
        await setTax({ gstPercent: 5, gstMode: 'exclusive' });
        const w = await shop({});
        const put = (body) => request(app).put('/api/shop/settings').set(w.owner.headers).send(body);
        assert.equal((await put({ orders: { gst: { mode: 'inclusive', percent: 18 } } })).status, 400);
        assert.equal((await put({ business: { gstin: GSTIN } })).status, 400);
        assert.equal((await Tenant.findById(w.tenant._id).lean()).business?.gstin ?? null, null);

        // the superadmin saves it, and then the shop starts charging
        const r = await request(app).put(`/api/admin/tenants/${w.tenant._id}`).set(auth()).send({ business: { legalName: 'Shop', gstin: GSTIN, fssai: '' } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const o = await Order.findById(idOf(await place(w))).lean();
        assert.equal(o.pricing.tax, 5);
    });
});

describe('GST inclusive switch on each dish', () => {
    const dish = (w, extra) => Product.create({ tenantId: w.tenant._id, categoryId: w.product.categoryId, name: 'Dish', price: 100, isVeg: true, ...extra });
    const order = (w, products, table = '4') => request(app).post('/api/orders').set(w.customer.headers)
        .send({ orderType: 'dine_in', tableNo: table, paymentMethod: 'cod', items: products.map((p) => ({ productId: String(p._id), quantity: 1 })) });

    test('switch ON (or never set) keeps GST inside the price; switch OFF adds it on top, for that dish only', async () => {
        await setTax({ gstPercent: 18, gstMode: 'inclusive' });
        const w = await shop({ gstin: GSTIN });
        const on = await dish(w, { gstInclusive: true });
        const off = await dish(w, { gstInclusive: false });

        const a = await order(w, [on]);
        assert.equal(a.status, 201, JSON.stringify(a.body));
        const oa = await Order.findById(idOf(a)).lean();
        assert.equal(oa.pricing.total, 100);
        assert.equal(oa.pricing.taxIncluded, 15.25);
        assert.equal(oa.pricing.taxOnTop, 0);
        assert.equal(oa.pricing.taxMode, 'inclusive');

        const b = await order(w, [off]);
        const ob = await Order.findById(idOf(b)).lean();
        assert.equal(ob.pricing.total, 118);
        assert.equal(ob.pricing.taxOnTop, 18);
        assert.equal(ob.pricing.taxMode, 'exclusive');
        assert.equal(ob.items[0].gstInclusive, false);
    });

    test('a cart with both: only the switched-off dish adds GST, the total is exact', async () => {
        await setTax({ gstPercent: 18, gstMode: 'inclusive' });
        const w = await shop({ gstin: GSTIN });
        const on = await dish(w, { gstInclusive: true });
        const off = await dish(w, { gstInclusive: false });
        const r = await order(w, [on, off]);
        assert.equal(r.status, 201, JSON.stringify(r.body));
        const o = await Order.findById(idOf(r)).lean();
        assert.equal(o.pricing.taxMode, 'mixed');
        assert.equal(o.pricing.taxOnTop, 18);
        assert.equal(o.pricing.taxIncluded, 15.25);
        assert.equal(o.pricing.tax, 33.25);
        assert.equal(o.pricing.total, 218);   // 100 + 100 + 18 on top
    });

    test('a dish with no switch (older dishes) follows the platform setting; a shop with no GST number charges nothing', async () => {
        await setTax({ gstPercent: 18, gstMode: 'exclusive' });
        const w = await shop({ gstin: GSTIN });
        const old = await dish(w, {});
        const o1 = await Order.findById(idOf(await order(w, [old]))).lean();
        assert.equal(o1.pricing.total, 118);

        const plain = await shop({});
        const off = await dish(plain, { gstInclusive: false });
        const o2 = await Order.findById(idOf(await order(plain, [off]))).lean();
        assert.equal(o2.pricing.total, 100);
        assert.equal(o2.pricing.tax, 0);
    });
});
