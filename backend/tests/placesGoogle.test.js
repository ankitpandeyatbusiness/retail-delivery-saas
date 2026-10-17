require('./helpers/env');
// Place search through Google Places API (New): the right endpoints and fields, the monthly allowance with a free
// fallback, the cache, and the superadmin's searches giving way first. Google is replaced by a fake (no real calls).
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const db = require('./helpers/db');
const PlatformSettings = require('../src/models/PlatformSettings');
const guard = require('../src/services/trackingGuard');
const places = require('../src/services/placeSearch');
const budget = require('../src/services/googleBudget');

let calls;
const KANPUR = { lat: 26.4499, lng: 80.3319 };

const fakeFetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init, body: init.body ? JSON.parse(init.body) : null });
    const ok = (json) => ({ ok: true, json: async () => json });
    if (u.endsWith('places:searchText')) {
        return ok({ places: [{ id: 'ChIJshop_search_1', displayName: { text: 'City Fashion' }, formattedAddress: 'Civil Lines, Kanpur, Uttar Pradesh, India', location: { latitude: 26.45, longitude: 80.33 } }] });
    }
    if (u.endsWith('places:autocomplete')) {
        return ok({ suggestions: [{ placePrediction: { placeId: 'ChIJauto_place_0001', text: { text: 'City Fashion Corner, Kanpur' }, structuredFormat: { mainText: { text: 'City Fashion Corner' }, secondaryText: { text: 'Kanpur, Uttar Pradesh' } } } }] });
    }
    if (u.includes('/places/ChIJauto_place_0001')) {
        return ok({ formattedAddress: 'City Fashion Corner, Kanpur 208001', location: { latitude: 26.451, longitude: 80.331 }, addressComponents: [{ longText: 'Kanpur', types: ['locality'] }, { longText: '208001', types: ['postal_code'] }] });
    }
    return ok(u.includes('photon') ? { features: [] } : []);   // the free sources: nothing
};

const setCaps = async (caps) => {
    await PlatformSettings.findByIdAndUpdate('main', { $set: Object.fromEntries(Object.entries(caps).map(([k, v]) => [`tracking.${k}`, v])) }, { upsert: true });
    await guard.refresh();
};
const googleCalls = (name) => calls.filter((c) => c.url.includes('places.googleapis.com') && c.url.includes(name));

before(() => db.connect());
after(async () => { guard.stop(); await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    process.env.GOOGLE_PLACES_SERVER_KEY = 'test-places-key';
    places.googleCache.clear();
    calls = [];
    mock.method(global, 'fetch', fakeFetch);
    await PlatformSettings.updateOne({ _id: 'main' }, { $unset: { tracking: 1 } }, { upsert: true });
    await guard.refresh();
});
afterEach(() => { mock.restoreAll(); delete process.env.GOOGLE_PLACES_SERVER_KEY; });

describe('place search with Google Places API (New)', () => {
    test('asks the new endpoints with the key and a field mask, and reads the answers', async () => {
        const items = await places.search('city fashion', KANPUR, { limit: 5 });
        const t = googleCalls('places:searchText')[0];
        assert.equal(t.init.headers['X-Goog-Api-Key'], 'test-places-key');
        assert.match(t.init.headers['X-Goog-FieldMask'], /places\.displayName/);
        assert.equal(t.body.textQuery, 'city fashion');
        assert.equal(t.body.regionCode, 'IN');
        const a = googleCalls('places:autocomplete')[0];
        assert.deepEqual(a.body.includedRegionCodes, ['in']);
        assert.ok(items.some((i) => i.title === 'City Fashion' && i.latitude === 26.45));
        assert.ok(items.some((i) => i.placeId === 'ChIJauto_place_0001'));
    });

    test('the picked place: only the cheap fields are asked, and city and pincode come back', async () => {
        const p = await places.placeDetails('ChIJauto_place_0001');
        assert.equal(p.city, 'Kanpur');
        assert.equal(p.pincode, '208001');
        assert.equal(p.latitude, 26.451);
        const d = calls.find((c) => c.url.includes('/places/ChIJauto_place_0001'));
        assert.equal(d.init.headers['X-Goog-FieldMask'], 'formattedAddress,location,addressComponents');
    });

    test('best stage first, then economical: with the text-search allowance used up only autocomplete is asked', async () => {
        await setCaps({ textSearchCap: 1 });
        await places.search('city fashion', KANPUR);
        places.googleCache.clear();
        await places.search('city fashion', KANPUR);
        assert.equal(googleCalls('places:searchText').length, 1);       // the second search had no allowance
        assert.ok(googleCalls('places:autocomplete').length >= 2);      // but still got suggestions
    });

    test('no allowance at all: Google is not called and the free sources answer', async () => {
        await setCaps({ textSearchCap: 0, autocompleteCap: 0, detailsCap: 0 });
        await places.search('city fashion', KANPUR);
        assert.equal(calls.filter((c) => c.url.includes('places.googleapis.com')).length, 0);
        assert.equal(await places.placeDetails('ChIJauto_place_0001'), null);
    });

    test('a Google suggestion without a point is left out when the picked-place allowance is gone', async () => {
        await setCaps({ detailsCap: 0, textSearchCap: 0 });
        const items = await places.search('city fashion', KANPUR);
        assert.ok(!items.some((i) => i.placeId === 'ChIJauto_place_0001'));
    });

    test('the same search again within minutes comes from the cache: no new Google call, no allowance used', async () => {
        await places.search('city fashion', KANPUR);
        const before = calls.filter((c) => c.url.includes('places.googleapis.com')).length;
        const used = (await budget.usage()).text_search.used;
        await places.search('City  Fashion', { lat: 26.4501, lng: 80.3322 });   // same words, nearly the same spot
        assert.equal(calls.filter((c) => c.url.includes('places.googleapis.com')).length, before);
        assert.equal((await budget.usage()).text_search.used, used);
    });

    test('the superadmin uses at most half of the monthly allowance', async () => {
        await setCaps({ textSearchCap: 4 });
        for (let i = 0; i < 4; i += 1) { places.googleCache.clear(); await places.search(`shop ${i}x`, KANPUR, { share: 0.5 }); }
        assert.equal(googleCalls('places:searchText').length, 2);
        assert.equal((await budget.usage()).text_search.used, 2);
    });

    test('the monthly count never passes the cap, even with parallel searches', async () => {
        await setCaps({ detailsCap: 3 });
        const got = await Promise.all(Array.from({ length: 10 }, () => budget.take('details')));
        assert.equal(got.filter(Boolean).length, 3);
        assert.equal((await budget.usage()).details.used, 3);
    });
});
