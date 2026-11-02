require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const Category = require('../src/models/Category');
const Product = require('../src/models/Product');
const pushChannel = require('../src/notifications/channels/push');
const adminAlerts = require('../src/services/adminAlerts');
const bulk = require('../src/services/bulkOrders');

// Phase 3: the customer's Orders list shows bulk orders and "Order again" refills the builder. For that every line of "my bulk orders" carries its choices
// the way the builder wants them: pick = [{ groupId, optionIds }].
describe('bulk order lines carry their choices for Order again', () => {
    test('the choices of a line are grouped by option group', () => {
        const o = {
            _id: '65f000000000000000000001', code: 'B1', status: 'requested', fulfilment: 'pickup', when: new Date(Date.now() + 86400000 * 5), createdAt: new Date(), updatedAt: new Date(),
            lines: [{
                productId: '65f000000000000000000002', name: 'Biryani', quantity: 40,
                selections: [{ groupId: 'size', optionId: 'full', name: 'Full' }, { groupId: 'extra', optionId: 'raita', name: 'Raita' }, { groupId: 'extra', optionId: 'salad', name: 'Salad' }],
            }, { productId: '65f000000000000000000003', name: 'Dal', quantity: 10 }],
        };
        const v = bulk.customerView(o);
        assert.deepEqual(v.lines[0].pick, [{ groupId: 'size', optionIds: ['full'] }, { groupId: 'extra', optionIds: ['raita', 'salad'] }]);
        assert.deepEqual(v.lines[0].options, ['Full', 'Raita', 'Salad']);
        assert.deepEqual(v.lines[1].pick, []);
    });
});

describe('my bulk orders (the list the Orders screen reads)', () => {
    let w; let dish;
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(async () => {
        await db.clear();
        mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
        mock.method(adminAlerts, 'alert', async () => { });
        w = await f.makeWorld(`bulk3-${Date.now()}`);
        const cat = await Category.create({ tenantId: w.tenant._id, name: 'Main', isActive: true });
        dish = await Product.create({ tenantId: w.tenant._id, categoryId: cat._id, name: 'Dal', price: 100, isVeg: true, isActive: true });
        await request(app).put('/api/shop/bulk/settings').set(w.owner.headers).send({ enabled: true, noticeHours: 1 });
    });
    afterEach(() => mock.restoreAll());

    test('a request shows up in /mine with its lines, total and an empty pick for a plain dish', async () => {
        const when = new Date(Date.now() + 5 * 86400000).toISOString();
        const sent = await request(app).post('/api/bulk').set(w.customer.headers).send({ fulfilment: 'pickup', when, items: [{ productId: String(dish._id), quantity: 100 }], contact: { name: 'Raj', phone: '9000000052' } });
        assert.ok([200, 201].includes(sent.status), JSON.stringify(sent.body));
        const r = await request(app).get('/api/bulk/mine').set(w.customer.headers);
        assert.equal(r.status, 200);
        assert.equal(r.body.items.length, 1);
        const o = r.body.items[0];
        assert.equal(o.lines[0].productId, String(dish._id));
        assert.equal(o.lines[0].quantity, 100);
        assert.deepEqual(o.lines[0].pick, []);
        assert.ok(o.pricing?.total > 0 && o.createdAt);
    });
});
