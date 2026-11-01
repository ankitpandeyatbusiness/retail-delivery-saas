require('./helpers/env');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const Category = require('../src/models/Category');
const Product = require('../src/models/Product');

// New services start switched OFF in the owner's editor; the Party / venue starter; the super admin's bulk price goes through the same checks.
describe('service starters and the super admin\'s bulk price', () => {
    let w; let admin; let dish;
    const owner = (m, p, b) => request(app)[m](`/api/shop/services${p}`).set(w.owner.headers).send(b);
    const auth = () => ({ Authorization: `Bearer ${admin.token}` });
    before(async () => {
        await db.connect();
        w = await f.makeWorld('starters-shop');
        admin = await f.makeSuperAdmin();
        const cat = await Category.create({ tenantId: w.tenant._id, name: 'Main', isActive: true });
        dish = await Product.create({ tenantId: w.tenant._id, categoryId: cat._id, name: 'Dal', price: 100, isVeg: true, isActive: true });
    });
    after(() => db.disconnect());

    test('a starter opened in the editor starts switched off, for every kind', async () => {
        for (const kind of ['tiffin', 'party', 'other', 'custom']) {
            const r = await owner('get', `/new/${kind}`);
            assert.equal(r.status, 200, JSON.stringify(r.body));
            assert.equal(r.body.isActive, false, `${kind} should start off`);
        }
    });

    test('saving it from the editor keeps it off; the customer sees it only after the owner switches it on', async () => {
        const blank = (await owner('get', '/new/tiffin')).body;
        const made = await owner('post', '', { ...blank, kind: 'tiffin', price: 3000 });
        assert.equal(made.status, 201, JSON.stringify(made.body));
        assert.equal(made.body.isActive, false);
        const seen = () => request(app).get('/api/services').set(w.customer.headers);
        assert.equal((await seen()).body.items.length, 0);
        const on = await owner('patch', `/${made.body._id}`, { isActive: true });
        assert.equal(on.body.isActive, true);
        assert.equal((await seen()).body.items.length, 1);
    });

    test('Party / venue booking: its own name, its questions for a function at the restaurant, no payment', async () => {
        const party = (await owner('get', '/new/party')).body;
        assert.equal(party.name, 'Party / Venue Booking');
        assert.equal(party.priceType, 'quote');
        const ids = party.questions.map((q) => q.id);
        for (const id of ['occasion', 'date', 'time', 'hours', 'guests', 'seating', 'diet', 'menu', 'extras', 'budget', 'reach', 'note']) assert.ok(ids.includes(id), `missing question ${id}`);
        const required = party.questions.filter((q) => q.required).map((q) => q.id).sort();
        assert.deepEqual(required, ['date', 'guests', 'occasion']);
        assert.ok(party.questions.find((q) => q.id === 'occasion').options.includes('Wedding'));
        assert.equal(party.minGuests, 10);
        const list = (await owner('get', '/templates')).body.items.map((t) => t.name);
        assert.ok(list.includes('Party / Venue Booking'));
        assert.ok(!list.includes('Restaurant Booking'));
    });

    test('the super admin\'s dish editor checks a bulk price like the owner\'s does', async () => {
        const url = `/api/admin/tenants/${w.tenant._id}/products/${dish._id}`;
        const bad = await request(app).patch(url).set(auth()).send({ bulk: { minQty: 1, percentOff: 10 } });
        assert.equal(bad.status, 400, JSON.stringify(bad.body));
        assert.equal((await request(app).patch(url).set(auth()).send({ bulk: { minQty: 20, percentOff: 95 } })).status, 400);
        const ok = await request(app).patch(url).set(auth()).send({ bulk: { minQty: 30, percentOff: 10 } });
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
        assert.deepEqual([ok.body.bulk.minQty, ok.body.bulk.percentOff], [30, 10]);
        const cleared = await request(app).patch(url).set(auth()).send({ bulk: null });
        assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
        assert.ok(!cleared.body.bulk?.minQty);
    });
});
