require('./helpers/env');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeWorld } = require('./helpers/factory');

// Bulk orders have their own flow, so the old "Bulk Order Booking" starter is no longer offered to a new service.
describe('the old bulk starter service', () => {
    let w;
    before(async () => { await db.connect(); w = await makeWorld('bulk-starter'); });
    after(() => db.disconnect());

    test('it is not in the list of starters, the others still are', async () => {
        const r = await request(app).get('/api/shop/services/templates').set(w.owner.headers);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const kinds = r.body.items.map((x) => x.kind);
        assert.ok(!kinds.includes('bulk'));
        assert.ok(['tiffin', 'party', 'other'].every((k) => kinds.includes(k)), kinds.join(','));
    });

    test('a shop that already has it keeps it (and it can still be made by the API)', async () => {
        const a = await request(app).post('/api/shop/services').set(w.owner.headers).send({ kind: 'bulk', price: 1000 });
        assert.equal(a.status, 201, JSON.stringify(a.body));
        const list = await request(app).get('/api/shop/services').set(w.owner.headers);
        assert.ok(list.body.items.some((s) => s.kind === 'bulk'));
    });
});
