require('./helpers/env');
// Stock by weight / volume, the daily quantity that starts every shop day again, and what a customer may see
// (never the real number: only "few left").
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const smsChannel = require('../src/notifications/channels/sms');
const pushChannel = require('../src/notifications/channels/push');
const Category = require('../src/models/Category');
const Product = require('../src/models/Product');
const { makeTenant, makeUser } = require('./helpers/factory');
const { dayKey } = require('../src/services/stockService');

const SETTINGS = { orders: { types: ['delivery', 'pickup', 'dine_in'], payments: ['cod'] } };
let n = 0;

async function shop(productExtra = {}) {
    const tenant = await makeTenant(`daily-stock-${++n}-${Date.now().toString(36)}`, { settings: SETTINGS });
    const owner = await makeUser(tenant, 'admin', '9000000010');
    const customer = await makeUser(tenant, 'customer', '9000000030');
    const cat = await Category.create({ tenantId: tenant._id, name: 'Sweets' });
    const product = await Product.create({
        tenantId: tenant._id, categoryId: cat._id, name: 'Kaju Barfi', price: 800, isVeg: true,
        sellBy: 'weight', measure: { options: [250, 500, 1000], allowManual: true }, ...productExtra,
    });
    return { tenant, owner, customer, product };
}
const stockUrl = (w) => `/api/shop/products/${w.product._id}/stock`;
const setStock = (w, b) => request(app).patch(stockUrl(w)).set(w.owner.headers).send(b);
const orderG = (w, grams) => request(app).post('/api/orders').set(w.customer.headers).send({
    orderType: 'dine_in', tableNo: '5', paymentMethod: 'cod',
    items: [{ productId: String(w.product._id), quantity: 1, measureQty: grams }],
});
const menuItem = async (w) => {
    const r = await request(app).get('/api/catalog/menu').set(w.customer.headers);
    return r.body.categories.flatMap((c) => c.items).find((p) => String(p._id) === String(w.product._id));
};

describe('daily stock', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(async () => {
        await db.clear();
        mock.method(smsChannel, 'send', async () => ({ sent: false }));
        mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
    });
    afterEach(() => mock.restoreAll());

    test('an item sold by weight can have a stock in grams, and orders take from it', async () => {
        const w = await shop();
        const r = await setStock(w, { enabled: true, qty: 10000, dailyQty: 10000 });   // 10 kg
        assert.equal(r.status, 200);
        assert.equal(r.body.stock.qty, 10000);

        assert.equal((await orderG(w, 500)).status, 201);
        assert.equal((await Product.findById(w.product._id)).stock.qty, 9500);

        // only a little left: asking for more is refused, and the message has no real amount in it
        await setStock(w, { qty: 400 });
        const tooMuch = await orderG(w, 500);
        assert.equal(tooMuch.status, 409);
        assert.match(tooMuch.body.error, /not enough/);
        assert.ok(!/\d{3}/.test(tooMuch.body.error), 'the real amount must not be in the message');
        assert.equal((await Product.findById(w.product._id)).stock.qty, 400);
    });

    test('the last grams switch the item off', async () => {
        const w = await shop();
        await setStock(w, { enabled: true, qty: 500 });
        assert.equal((await orderG(w, 500)).status, 201);
        const p = await Product.findById(w.product._id);
        assert.equal(p.stock.qty, 0);
        assert.equal(p.isAvailable, false);
    });

    test('customers see only "few left" and the most they can order, never the stock', async () => {
        const w = await shop();
        await setStock(w, { enabled: true, qty: 8000, dailyQty: 10000 });
        let item = await menuItem(w);
        assert.equal(item.stock, undefined);
        assert.equal(item.fewLeft, false);
        assert.equal(item.maxQty, 8000);

        await setStock(w, { qty: 2000 });   // under a quarter of the day's 10 kg
        item = await menuItem(w);
        assert.equal(item.fewLeft, true);
        assert.equal(item.stock, undefined);

        const one = await request(app).get(`/api/catalog/products/${w.product._id}`).set(w.customer.headers);
        assert.equal(one.body.stock, undefined);
        assert.equal(one.body.fewLeft, true);
    });

    test('a new shop day starts the daily quantity again, once', async () => {
        const w = await shop({
            stock: { enabled: true, qty: 1200, dailyQty: 10000, resetOn: '2000-01-01' },   // old leftovers
            isAvailable: true,
        });
        const item = await menuItem(w);
        assert.equal(item.maxQty, 10000);
        const p = await Product.findById(w.product._id);
        assert.equal(p.stock.qty, 10000);
        assert.equal(p.stock.resetOn, dayKey());
    });

    test('a sold-out day comes back on the next one', async () => {
        const w = await shop({
            stock: { enabled: true, qty: 0, dailyQty: 5000, resetOn: '2000-01-01' },
            isAvailable: false,
        });
        await menuItem(w);
        const p = await Product.findById(w.product._id);
        assert.equal(p.stock.qty, 5000);
        assert.equal(p.isAvailable, true);
    });

    test('with no daily quantity nothing is reset, and an unlimited item shows no hints', async () => {
        const w = await shop({ stock: { enabled: true, qty: 700, resetOn: '2000-01-01' } });
        await menuItem(w);
        assert.equal((await Product.findById(w.product._id)).stock.qty, 700);

        const free = await shop();
        const item = await menuItem(free);
        assert.equal(item.maxQty, undefined);
        assert.equal(item.fewLeft, undefined);
    });

    test('what the owner enters today is not wiped by the daily reset', async () => {
        const w = await shop();
        await setStock(w, { enabled: true, qty: 3000, dailyQty: 10000 });   // only 3 kg today
        await menuItem(w);
        assert.equal((await Product.findById(w.product._id)).stock.qty, 3000);
    });

    test('the stock route checks the amounts', async () => {
        const w = await shop();
        assert.equal((await setStock(w, { qty: 1.5 })).status, 400);
        assert.equal((await setStock(w, { dailyQty: -1 })).status, 400);
        assert.equal((await setStock(w, { qty: 100000001 })).status, 400);
        assert.equal((await setStock(w, { enabled: true, qty: 5000, dailyQty: null })).status, 200);
    });
});
