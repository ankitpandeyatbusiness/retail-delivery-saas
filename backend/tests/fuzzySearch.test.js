require('./helpers/env');   // must be the first line
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { rank } = require('../src/services/fuzzySearch');

const MENU = [
    'Chicken Biryani', 'Paneer Butter Masala', 'Veg Burger', 'Masala Dosa', 'Cheese Pizza', 'Gobi Manchurian',
    'Chicken Tikka', 'Veg Hakka Noodles', 'Samosa', 'Cold Coffee', 'Chocolate Shake', 'Dal Makhani', 'Butter Naan',
].map((name, i) => ({ _id: String(i), name, description: '' }));

const top = (q) => {
    const r = rank(q, MENU);
    return r.length ? MENU.find((m) => m._id === r[0]._id).name : null;
};
const has = (q, name) => rank(q, MENU).some((r) => MENU.find((m) => m._id === r._id).name === name);

describe('fuzzy dish search', () => {
    test('exact and as-you-type still work', () => {
        assert.equal(top('samosa'), 'Samosa');
        assert.equal(top('pane'), 'Paneer Butter Masala');
        assert.ok(has('butt', 'Butter Naan'));
    });

    test('common misspellings find the dish', () => {
        assert.equal(top('briyani'), 'Chicken Biryani');
        assert.equal(top('biriyani'), 'Chicken Biryani');
        assert.equal(top('panir'), 'Paneer Butter Masala');
        assert.equal(top('chiken'), 'Chicken Biryani');
        assert.equal(top('burgar'), 'Veg Burger');
        assert.equal(top('pizzza'), 'Cheese Pizza');
        assert.equal(top('manchuriyan'), 'Gobi Manchurian');
        assert.equal(top('dosai'), 'Masala Dosa');
        assert.equal(top('cofee'), 'Cold Coffee');
        assert.equal(top('makhni'), 'Dal Makhani');
    });

    test('swapped letters, missing spaces and extra words', () => {
        assert.equal(top('pnaeer'), 'Paneer Butter Masala');
        assert.equal(top('buttermasala'), 'Paneer Butter Masala');
        assert.equal(top('panir butr'), 'Paneer Butter Masala');
        assert.equal(top('chocolate'), 'Chocolate Shake');
    });

    test('short or unrelated words do not match everything', () => {
        assert.equal(rank('xyz', MENU).length, 0);
        assert.equal(rank('zzzz', MENU).length, 0);
        assert.ok(!has('cat', 'Chicken Tikka'));
        assert.ok(!has('dal', 'Veg Burger'));
    });

    test('an exact match outranks a typo match', () => {
        const rows = [{ _id: 'a', name: 'Tikka' }, { _id: 'b', name: 'Tika Masala' }];
        assert.equal(rank('tikka', rows)[0]._id, 'a');
    });
});

/* ---------------------- the customer route (database) ---------------------- */
const { before, after, beforeEach } = require('node:test');
const request = require('supertest');
const db = require('./helpers/db');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Category = require('../src/models/Category');
const Product = require('../src/models/Product');
const { makeTenant, makeUser } = require('./helpers/factory');

describe('customer search route is typo tolerant', () => {
    let w;
    let seq = 0;
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(async () => {
        await db.clear();
        const tenant = await makeTenant(`fuzzy-shop-${++seq}`);
        const customer = await makeUser(tenant, 'customer', '9000000030');
        const cat = await Category.create({ tenantId: tenant._id, name: 'Main' });
        const mk = (name, extra = {}) => Product.create({ tenantId: tenant._id, categoryId: cat._id, name, price: 100, isVeg: true, ...extra });
        await mk('Paneer Butter Masala');
        await mk('Chicken Biryani', { isVeg: false });
        await mk('Masala Dosa');
        w = { customer };
    });
    const get = (q) => request(app).get(`/api/catalog/products?q=${encodeURIComponent(q)}`).set(w.customer.headers);

    test('a misspelt word still finds the dish, best match first', async () => {
        const r = await get('panir');
        assert.equal(r.status, 200);
        assert.equal(r.body.items[0].name, 'Paneer Butter Masala');
        const b = await get('briyani');
        assert.equal(b.body.items[0].name, 'Chicken Biryani');
    });

    test('other filters still apply, and nothing matching returns an empty list', async () => {
        const veg = await request(app).get('/api/catalog/products?q=briyani&veg=true').set(w.customer.headers);
        assert.equal(veg.body.items.length, 0);
        assert.equal((await get('qqqqq')).body.items.length, 0);
        assert.equal((await get('masala')).body.items.length, 2);
    });
});
