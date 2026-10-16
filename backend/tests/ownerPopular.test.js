require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');

// The owner's "Popular items": the sales report can list up to 50 best sellers, most sold first.
let w;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('pop-shop');
    tenantRecognizer.invalidateTenant('pop-shop');
});

test('best sellers: 12 different items, asked for 5 and for all', async () => {
    for (let i = 0; i < 12; i += 1) {
        await f.makeOrder(w.tenant, w.customer.user, {
            status: 'delivered', deliveredAt: new Date(),
            items: [{ productId: new mongoose.Types.ObjectId(), name: `Item ${i}`, quantity: i + 1, unitPrice: 10, lineTotal: 10 * (i + 1) }],
        });
    }
    const get = (q) => request(app).get(`/api/shop/reports/sales${q}`).set(w.owner.headers);
    const def = await get('');
    assert.equal(def.body.topItems.length, 10, 'ten by default');
    assert.equal(def.body.topItems[0].name, 'Item 11');
    assert.equal(def.body.topItems[0].quantity, 12);
    assert.equal((await get('?topLimit=5')).body.topItems.length, 5);
    assert.equal((await get('?topLimit=30')).body.topItems.length, 12);
    assert.equal((await get('?topLimit=999')).body.topItems.length, 12, 'capped at 50');
});
