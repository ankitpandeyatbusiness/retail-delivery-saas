require('./helpers/env');
// The customer's place search: nearest first, with distance, and whether the shop delivers there.
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const { makeTenant } = require('./helpers/factory');

// Photon answers for "sharma sweets": same name in three cities, plus one with a typo-free different name
const PHOTON = {
    features: [
        { geometry: { coordinates: [77.2090, 28.6139] }, properties: { name: 'Sharma Sweets', city: 'Delhi', state: 'Delhi', countrycode: 'IN' } },
        { geometry: { coordinates: [80.3319, 26.4499] }, properties: { name: 'Sharma Sweets', city: 'Kanpur', state: 'Uttar Pradesh', countrycode: 'IN' } },
        { geometry: { coordinates: [80.3500, 26.4600] }, properties: { name: 'Sharma Sweets', street: 'Mall Road', city: 'Kanpur', state: 'Uttar Pradesh', countrycode: 'IN' } },
    ],
};

describe('customer place search', () => {
    let tenant;
    let n = 0;
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(async () => {
        await db.clear();
        // a shop in Kanpur that delivers 10 km around itself
        tenant = await makeTenant(`geo-shop-${++n}`, { delivery: { latitude: 26.4499, longitude: 80.3319, radiusKm: 10 } });
        mock.method(global, 'fetch', async (url) => {
            const u = String(url);
            if (u.includes('photon')) return { ok: true, json: async () => PHOTON };
            return { ok: true, json: async () => [] };   // nominatim: nothing
        });
    });
    afterEach(() => mock.restoreAll());
    const get = (qs) => request(app).get(`/api/geo/suggest?${qs}`).set('x-tenant-slug', tenant.slug);

    test('places near the customer come first, with distance and a delivery flag', async () => {
        const r = await get('q=sharma%20sweets&lat=26.4550&lng=80.3400');
        assert.equal(r.status, 200);
        assert.equal(r.body.from, 'you');
        const cities = r.body.items.map((i) => i.city);
        // both Kanpur results before Delhi, which is far away
        assert.equal(cities.indexOf('Delhi'), cities.length - 1);
        const first = r.body.items[0];
        assert.ok(first.distanceKm < 5);
        assert.equal(first.deliverable, true);
        const delhi = r.body.items.find((i) => i.city === 'Delhi');
        assert.ok(delhi.distanceKm > 300);
        assert.equal(delhi.deliverable, false);
    });

    test('without the customer position it measures from the shop', async () => {
        const r = await get('q=sharma%20sweets');
        assert.equal(r.body.from, 'shop');
        assert.ok(r.body.items[0].distanceKm < 5);
    });

    test('a very short or missing search is refused', async () => {
        assert.equal((await get('q=a')).status, 400);
        assert.equal((await get('')).status, 400);
    });
});
