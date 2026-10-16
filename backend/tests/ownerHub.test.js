require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Review = require('../src/models/Review');
const Product = require('../src/models/Product');
const Category = require('../src/models/Category');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');

// Phase 5 of the owner panel: what customers say about the dishes and the delivery.
let w;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('hub-shop');
    tenantRecognizer.invalidateTenant('hub-shop');
});
const api = (path, headers = w.owner.headers) => request(app).get(`/api/shop${path}`).set(headers);

async function dishReview(rating, comment) {
    const cat = await Category.create({ tenantId: w.tenant._id, name: 'Sweets' });
    const p = await Product.create({ tenantId: w.tenant._id, categoryId: cat._id, name: 'Laddu', price: 50, isVeg: true });
    const o = await f.makeOrder(w.tenant, w.customer.user, { status: 'delivered' });
    await Review.create({ tenantId: w.tenant._id, userId: w.customer.user._id, orderId: o._id, productId: p._id, rating, comment });
    return o;
}

describe('GET /reviews', () => {
    test('dish reviews with the item, the customer and a summary', async () => {
        await dishReview(5, 'Very fresh');
        const r = await api('/reviews');
        assert.equal(r.status, 200);
        assert.equal(r.body.kind, 'dish');
        assert.equal(r.body.items.length, 1);
        assert.equal(r.body.items[0].item, 'Laddu');
        assert.equal(r.body.items[0].comment, 'Very fresh');
        assert.equal(r.body.summary.dish.count, 1);
        assert.equal(r.body.summary.dish.avg, 5);
        assert.equal(r.body.summary.dish.stars[5], 1);
        assert.equal(r.body.summary.delivery.count, 0);
    });

    test('delivery ratings come from the order, and the star filter works', async () => {
        await f.makeOrder(w.tenant, w.customer.user, { status: 'delivered', deliveryRating: { rating: 2, comment: 'Cold', tags: ['late'], ratedAt: new Date() } });
        await f.makeOrder(w.tenant, w.customer.user, { status: 'delivered', deliveryRating: { rating: 5, ratedAt: new Date() } });
        const all = await api('/reviews?kind=delivery');
        assert.equal(all.body.items.length, 2);
        assert.equal(all.body.summary.delivery.avg, 3.5);
        const low = await api('/reviews?kind=delivery&rating=2');
        assert.equal(low.body.items.length, 1);
        assert.equal(low.body.items[0].comment, 'Cold');
        assert.equal((await api('/reviews?rating=9')).status, 400);
    });

    test('another shop\'s reviews are never shown, and a customer cannot read them', async () => {
        const other = await f.makeWorld('hub-other');
        await f.makeOrder(other.tenant, other.customer.user, { status: 'delivered', deliveryRating: { rating: 1, ratedAt: new Date() } });
        assert.equal((await api('/reviews?kind=delivery')).body.items.length, 0);
        assert.ok([401, 403].includes((await api('/reviews', w.customer.headers)).status));
    });
});
