require('./helpers/env');
// Typing a new category in the item form, and the category picture that falls back to its first dish.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Category = require('../src/models/Category');
const { titleCase } = require('../src/services/itemRules');

let token;
let shop;
let customer;
let n = 0;
const auth = () => ({ Authorization: `Bearer ${token}` });
const url = (r = '') => `/api/admin/tenants/${shop._id}/shop/${r}`;
const post = (r, b) => request(app).post(url(r)).set(auth()).send(b);
const patch = (r, b) => request(app).patch(url(r)).set(auth()).send(b);
const item = (over = {}) => ({ name: 'Veg Pulao', description: '', image: '', price: 120, isVeg: true, ...over });

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    token = (await f.makeSuperAdmin('root@test.com')).token;
    shop = await f.makeTenant(`typed-cat-${++n}`);
    customer = await f.makeUser(shop, 'customer', '9000000030');
});

describe('title case', () => {
    test('words are capitalised, spaces tidied, short capitals kept', () => {
        assert.equal(titleCase('rice'), 'Rice');
        assert.equal(titleCase('  south   INDIAN  '), 'South Indian');
        assert.equal(titleCase('bbq'), 'Bbq');
        assert.equal(titleCase('BBQ items'), 'BBQ Items');
    });
});

describe('typing a new category in the item form', () => {
    test('"rice" creates the category "Rice" and files the item in it', async () => {
        const r = await post('products', item({ categoryName: 'rice' }));
        assert.equal(r.status, 201);
        const cat = await Category.findOne({ tenantId: shop._id });
        assert.equal(cat.name, 'Rice');
        assert.equal(String(r.body.categoryId), String(cat._id));
    });

    test('typing the same name again, in any case, reuses it', async () => {
        await post('products', item({ categoryName: 'rice' }));
        const r = await post('products', item({ name: 'Jeera Rice', categoryName: 'RICE' }));
        assert.equal(r.status, 201);
        assert.equal(await Category.countDocuments({ tenantId: shop._id }), 1);
    });

    test('an existing category is matched, not duplicated', async () => {
        const c = (await post('categories', { name: 'Main Course' })).body;
        const r = await post('products', item({ categoryName: 'main  course' }));
        assert.equal(String(r.body.categoryId), String(c._id));
        assert.equal(await Category.countDocuments({ tenantId: shop._id }), 1);
    });

    test('a removed category comes back when its name is typed again', async () => {
        const first = await post('products', item({ categoryName: 'rice' }));
        await request(app).delete(url(`categories/${first.body.categoryId}`)).set(auth());
        assert.equal((await Category.findById(first.body.categoryId)).isActive, false);
        const again = await post('products', item({ name: 'Fried Rice', categoryName: 'rice' }));
        assert.equal(String(again.body.categoryId), String(first.body.categoryId));
        assert.equal((await Category.findById(first.body.categoryId)).isActive, true);
    });

    test('editing an item can move it to a typed category', async () => {
        const a = (await post('categories', { name: 'Starters' })).body;
        const p = (await post('products', item({ categoryId: a._id }))).body;
        const r = await patch(`products/${p._id}`, { categoryName: 'combos' });
        assert.equal(r.status, 200);
        const cat = await Category.findOne({ tenantId: shop._id, name: 'Combos' });
        assert.equal(String(r.body.categoryId), String(cat._id));
    });

    test('a one-letter name is refused, and another shop is never touched', async () => {
        assert.equal((await post('products', item({ categoryName: 'x' }))).status, 400);
        const other = await f.makeTenant(`typed-cat-other-${n}`);
        await Category.create({ tenantId: other._id, name: 'Rice' });
        await post('products', item({ categoryName: 'rice' }));
        assert.equal(await Category.countDocuments({ tenantId: shop._id }), 1);
        assert.equal(await Category.countDocuments({ tenantId: other._id }), 1);
    });
});

describe('category picture fallback (customer app)', () => {
    const cats = () => request(app).get('/api/catalog/categories').set(customer.headers);

    test('no picture of its own: the first dish picture is used', async () => {
        const c = (await post('categories', { name: 'Rice' })).body;
        await post('products', item({ categoryId: c._id, name: 'No photo' }));
        await post('products', item({ categoryId: c._id, name: 'First', image: 'https://img/first.jpg' }));
        await post('products', item({ categoryId: c._id, name: 'Second', image: 'https://img/second.jpg' }));
        const r = await cats();
        assert.equal(r.body.items[0].image, 'https://img/first.jpg');
    });

    test('its own picture always wins, and a category with no pictures stays empty', async () => {
        const a = (await post('categories', { name: 'Own', image: 'https://img/own.jpg' })).body;
        const b = (await post('categories', { name: 'Bare' })).body;
        await post('products', item({ categoryId: a._id, image: 'https://img/dish.jpg' }));
        await post('products', item({ categoryId: b._id, name: 'Plain' }));
        const r = await cats();
        const by = Object.fromEntries(r.body.items.map((c) => [c.name, c.image]));
        assert.equal(by.Own, 'https://img/own.jpg');
        assert.ok(!by.Bare);
    });
});
