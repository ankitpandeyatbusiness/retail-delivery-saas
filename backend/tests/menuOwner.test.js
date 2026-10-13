require('./helpers/env');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const db = require('./helpers/db');
const factory = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;

before(db.connect);
after(db.disconnect);
beforeEach(db.clear);

const as = (slug, u) => ({ ...u.headers, 'x-tenant-slug': slug });

test('owner manages categories, products, stock, banners and coupons of his own shop', async () => {
    const tenant = await factory.makeTenant('menu-a');
    const owner = await factory.makeUser(tenant, 'admin', '9000000601');
    const h = as('menu-a', owner);

    const cat = await request(app).post('/api/shop/categories').set(h).send({ name: 'Sweets' });
    assert.strictEqual(cat.status, 201, JSON.stringify(cat.body));

    const prod = await request(app).post('/api/shop/products').set(h)
        .send({ categoryId: cat.body._id, name: 'Rasgulla', price: 120, isVeg: true });
    assert.strictEqual(prod.status, 201, JSON.stringify(prod.body));

    const edit = await request(app).patch(`/api/shop/products/${prod.body._id}`).set(h)
        .send({ categoryId: cat.body._id, name: 'Rasgulla', price: 150, isVeg: true });
    assert.strictEqual(edit.status, 200, JSON.stringify(edit.body));
    assert.strictEqual(edit.body.price, 150);

    const stock = await request(app).patch(`/api/shop/products/${prod.body._id}/stock`).set(h)
        .send({ enabled: true, qty: 0 });
    assert.strictEqual(stock.status, 200, JSON.stringify(stock.body));
    assert.strictEqual(stock.body.isAvailable, false);

    const banner = await request(app).post('/api/shop/banners').set(h).send({ title: 'Diwali offer' });
    assert.strictEqual(banner.status, 201, JSON.stringify(banner.body));

    const coupon = await request(app).post('/api/shop/coupons').set(h)
        .send({ code: 'DIWALI10', discountType: 'percent', discountValue: 10 });
    assert.strictEqual(coupon.status, 201, JSON.stringify(coupon.body));

    const del = await request(app).delete(`/api/shop/products/${prod.body._id}`).set(h);
    assert.strictEqual(del.status, 200);
    assert.strictEqual(del.body.softDeleted, true);
});

test('an owner cannot see or change another shop\'s menu', async () => {
    const a = await factory.makeTenant('menu-b1');
    const b = await factory.makeTenant('menu-b2');
    const ownerA = await factory.makeUser(a, 'admin', '9000000611');
    const ownerB = await factory.makeUser(b, 'admin', '9000000612');

    const cat = await request(app).post('/api/shop/categories').set(as('menu-b1', ownerA)).send({ name: 'Snacks' });
    assert.strictEqual(cat.status, 201, JSON.stringify(cat.body));

    // owner B, in his own shop, cannot touch the category of shop A
    const read = await request(app).get(`/api/shop/categories/${cat.body._id}`).set(as('menu-b2', ownerB));
    assert.strictEqual(read.status, 404);
    const edit = await request(app).patch(`/api/shop/categories/${cat.body._id}`).set(as('menu-b2', ownerB)).send({ name: 'Hacked' });
    assert.strictEqual(edit.status, 404);

    // owner B's token does not work on shop A at all
    const cross = await request(app).post('/api/shop/categories').set(as('menu-b1', ownerB)).send({ name: 'X' });
    assert.ok([401, 403].includes(cross.status), `got ${cross.status}`);
});

test('customers and riders cannot change the menu', async () => {
    const tenant = await factory.makeTenant('menu-c');
    const customer = await factory.makeUser(tenant, 'customer', '9000000621');
    const rider = await factory.makeUser(tenant, 'rider', '9000000622');
    for (const u of [customer, rider]) {
        const r = await request(app).post('/api/shop/categories').set(as('menu-c', u)).send({ name: 'Nope' });
        assert.ok([401, 403].includes(r.status), `got ${r.status}`);
    }
});