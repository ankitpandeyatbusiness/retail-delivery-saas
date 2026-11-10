require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const realtime = require('../src/services/realtime');
const tokenService = require('../src/services/tokenService');
const Cart = require('../src/models/Cart');
const { makeWorld, makeUser, makeTenant } = require('./helpers/factory');
const { shouldTell, areaOf } = require('../src/middlewares/syncNotify');

const sidOf = (headers) => String(tokenService.verifyAccessToken(headers.Authorization.split(' ')[1]).sid);
const line = (n = 1, extra = {}) => ({ key: `p${n}##`, productId: `prod${n}`, name: `Dish ${n}`, price: 120, quantity: 2, selections: [], optionsText: '', ...extra });

let told;
beforeEach(() => {
    told = [];
    mock.method(realtime, 'toUser', (t, u, ev, p) => told.push({ to: 'user', user: String(u), ev, p }));
    mock.method(realtime, 'toOwner', (t, ev, p) => told.push({ to: 'owner', ev, p }));
});
afterEach(() => mock.restoreAll());
const syncs = () => told.filter((x) => x.ev === 'sync:changed');

describe('sync: which changes are announced, and under which area', () => {
    test('only changes (not reads), and not the things that have their own message or happen all the time', () => {
        assert.equal(shouldTell('GET', '/api/addresses'), false);
        assert.equal(shouldTell('POST', '/api/addresses'), true);
        assert.equal(shouldTell('PUT', '/api/cart'), true);
        for (const u of ['/api/auth/logout', '/api/notifications/read-all', '/api/chat/bulk/5/read', '/api/rider/location', '/api/rider/ping', '/api/admin/tenants', '/api/me/uploads/sign', '/api/shop/uploads/sign', '/api/webhooks/razorpay']) {
            assert.equal(shouldTell('POST', u), false, u);
        }
        assert.equal(shouldTell('POST', '/health'), false);
    });

    test('the area is the first part of the address', () => {
        assert.equal(areaOf('/api/addresses/5?x=1'), 'addresses');
        assert.equal(areaOf('/api/cart'), 'cart');
        assert.equal(areaOf('/api/me'), 'me');
        assert.equal(areaOf('/api/me/alerts'), 'me/alerts');
        assert.equal(areaOf('/api/shop/products/12'), 'shop:products');
        assert.equal(areaOf('/api/rider/orders/9/status'), 'rider');
        assert.equal(areaOf('/api/orders'), 'orders');
    });
});

describe('sync: the other devices are told', () => {
    before(() => db.connect());
    after(() => db.disconnect());

    test('a change by one device is announced to the person with the session that made it; a read and a refused change say nothing', async () => {
        const w = await makeWorld('sync-mw');
        const h = w.customer.headers;
        assert.equal((await request(app).put('/api/cart').set(h).send({ lines: [line(1)] })).status, 200);
        const e = syncs();
        assert.equal(e.length, 1);
        assert.equal(e[0].user, String(w.customer.user._id));
        assert.equal(e[0].p.area, 'cart');
        assert.equal(e[0].p.sid, sidOf(h), 'so that device can ignore its own change');
        assert.ok(e[0].p.at > 0);

        told.length = 0;
        assert.equal((await request(app).get('/api/cart').set(h)).status, 200);
        assert.equal((await request(app).put('/api/cart').set(h).send({ lines: 'nope' })).status, 400);
        assert.equal(syncs().length, 0, 'a read and a refused change announce nothing');
    });

    test('an owner change on the shop side also reaches every owner device of the shop', async () => {
        const w = await makeWorld('sync-owner');
        const r = await request(app).post('/api/shop/notifications/read-all').set(w.owner.headers);
        assert.equal(r.status, 200);
        const e = syncs();
        assert.ok(e.some((x) => x.to === 'user' && x.p.area === 'shop:notifications'));
        assert.ok(e.some((x) => x.to === 'owner' && x.p.area === 'shop:notifications'));
        // a customer's change is never sent to the owners
        told.length = 0;
        await request(app).put('/api/cart').set(w.customer.headers).send({ lines: [line(1)] });
        assert.equal(syncs().filter((x) => x.to === 'owner').length, 0);
    });

    test('a person without a login announces nothing', async () => {
        const w = await makeWorld('sync-anon');
        const r = await request(app).put('/api/cart').set('x-tenant-slug', w.tenant.slug).send({ lines: [] });
        assert.equal(r.status, 401);
        assert.equal(syncs().length, 0);
    });
});

describe('the server cart', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    const put = (h, lines) => request(app).put('/api/cart').set(h).send({ lines });

    test('empty at first; what one device saves the other reads; the last change wins; delete empties it', async () => {
        const w = await makeWorld('cart-basic');
        const h = w.customer.headers;
        let r = await request(app).get('/api/cart').set(h);
        assert.deepEqual(r.body, { lines: [], updatedAt: null });

        r = await put(h, [line(1), line(2, { selections: [{ name: 'Extra cheese', price: 20 }], optionsText: 'Extra cheese', note: 'less spicy' })]);
        assert.equal(r.status, 200);
        assert.equal(r.body.lines.length, 2);
        assert.ok(r.body.updatedAt);
        r = await request(app).get('/api/cart').set(h);
        assert.equal(r.body.lines[1].note, 'less spicy');
        assert.deepEqual(r.body.lines[1].selections, [{ name: 'Extra cheese', price: 20 }]);

        r = await put(h, [line(3)]);   // replaces everything
        assert.deepEqual((await request(app).get('/api/cart').set(h)).body.lines.map((l) => l.productId), ['prod3']);
        r = await request(app).delete('/api/cart').set(h);
        assert.deepEqual(r.body.lines, []);
        assert.equal(await Cart.countDocuments({ userId: w.customer.user._id }), 0);
        assert.equal((await put(h, [])).status, 200, 'an empty cart can be saved');
    });

    test('carts are private: per person and per shop', async () => {
        const w = await makeWorld('cart-private');
        const other = await makeUser(w.tenant, 'customer', '9000000088');
        const t2 = await makeTenant('cart-private-2');
        const sameNumberElsewhere = await makeUser(t2, 'customer', '9000000030');
        await put(w.customer.headers, [line(1)]);
        assert.deepEqual((await request(app).get('/api/cart').set(other.headers)).body.lines, []);
        assert.deepEqual((await request(app).get('/api/cart').set(sameNumberElsewhere.headers)).body.lines, []);
        await put(other.headers, [line(9)]);
        assert.deepEqual((await request(app).get('/api/cart').set(w.customer.headers)).body.lines.map((l) => l.productId), ['prod1']);
        assert.equal((await request(app).get('/api/cart').set('x-tenant-slug', w.tenant.slug)).status, 401);
    });

    test('bad carts are refused', async () => {
        const w = await makeWorld('cart-bad');
        const h = w.customer.headers;
        const bad = [
            'nope', [null], [{}], [line(1, { quantity: 0 })], [line(1, { quantity: 21 })], [line(1, { quantity: 'x' })], [line(1, { price: -1 })], [line(1, { key: '' })],
            [line(1, { productId: 5 })], [line(1, { $set: { x: 1 } })], [line(1, { selections: [{ 'a.b': 1 }] })], [line(1, { note: 'x'.repeat(4000) })],
            Array.from({ length: 61 }, (_, i) => line(i + 1)),
        ];
        for (const lines of bad) assert.equal((await put(h, lines)).status, 400, JSON.stringify(lines).slice(0, 60));
        assert.deepEqual((await request(app).get('/api/cart').set(h)).body.lines, [], 'nothing was saved');
        assert.equal((await put(h, Array.from({ length: 60 }, (_, i) => line(i + 1)))).status, 200, '60 lines are fine');
    });
});
