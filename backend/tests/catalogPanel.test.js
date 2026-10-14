require('./helpers/env');
// The superadmin app edits a shop's catalog through /api/admin/tenants/:tid/shop/*.
// These tests send the same shapes the app sends (cleared fields as null / '', generated option ids, dates as ISO).
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;

let token;
let shop;
let n = 0;
const auth = () => ({ Authorization: `Bearer ${token}` });
const url = (r = '') => `/api/admin/tenants/${shop._id}/shop/${r}`;
const post = (r, b) => request(app).post(url(r)).set(auth()).send(b);
const patch = (r, b) => request(app).patch(url(r)).set(auth()).send(b);
const get = (r) => request(app).get(url(r)).set(auth());

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    token = (await f.makeSuperAdmin('root@test.com')).token;
    shop = await f.makeTenant(`catalog-shop-${++n}`);
});

const category = async (body = {}) => (await post('categories', { name: 'Starters', ...body })).body;
const productBody = (categoryId, over = {}) => ({
    categoryId, name: 'Paneer Tikka', description: '', image: '', price: 220, mrp: null, isVeg: true,
    isEggless: false, isSugarFree: false, isJain: false, spiceLevel: 'mild', isBestseller: false, isNewArrival: false, isGiftPack: false,
    serves: null, calories: null, prepTimeMin: null, gstRate: null, optionGroups: [], isAvailable: true, isActive: true, sortOrder: 0, ...over,
});

describe('categories', () => {
    test('create with timings, then clear picture and timings', async () => {
        const res = await post('categories', {
            name: 'Breakfast', image: '', sortOrder: 0, isActive: true,
            timings: [{ open: '07:00', close: '11:00', days: ['mon', 'tue'] }, { open: '08:00', close: '12:00' }],
        });
        assert.equal(res.status, 201);
        assert.equal(res.body.timings.length, 2);

        const upd = await patch(`categories/${res.body._id}`, { name: 'Breakfast', image: '', timings: [], isActive: true, sortOrder: 2 });
        assert.equal(upd.status, 200);
        assert.deepEqual(upd.body.timings, []);
        assert.equal(upd.body.sortOrder, 2);
    });

    test('a bad time slot is refused with a readable message', async () => {
        const res = await post('categories', { name: 'X', timings: [{ open: '09:00', close: '09:00' }] });
        assert.equal(res.status, 400);
        assert.match(res.body.error, /cannot be the same/);
    });

    test('"remove" only switches it off', async () => {
        const c = await category();
        const del = await request(app).delete(url(`categories/${c._id}`)).set(auth());
        assert.equal(del.body.softDeleted, true);
        assert.equal((await get(`categories/${c._id}`)).body.isActive, false);
    });
});

describe('products', () => {
    test('create the way the app sends it, with generated option ids', async () => {
        const c = await category();
        const res = await post('products', productBody(c._id, {
            mrp: 250, gstRate: 5, serves: 2,
            optionGroups: [
                { id: 'size', name: 'Choose size', min: 1, max: 1, options: [
                    { id: 'half', name: 'Half', price: 0, isDefault: true, isAvailable: true },
                    { id: 'full', name: 'Full', price: 80, isDefault: false, isAvailable: true },
                ] },
            ],
        }));
        assert.equal(res.status, 201, JSON.stringify(res.body));
        assert.equal(res.body.optionGroups[0].options.length, 2);
        assert.equal(res.body.gstRate, 5);

        // later the owner clears MRP, serves and the GST rate (the app sends null)
        const upd = await patch(`products/${res.body._id}`, productBody(c._id, { mrp: null, serves: null, gstRate: null, optionGroups: [] }));
        assert.equal(upd.status, 200, JSON.stringify(upd.body));
        assert.equal(upd.body.mrp ?? null, null);
        assert.equal(upd.body.gstRate ?? null, null);
        assert.equal(upd.body.optionGroups.length, 0);
    });

    test('a veg-only shop refuses a non-veg item with the reason', async () => {
        const veg = await f.makeTenant(`catalog-veg-${++n}`, { settings: { home: { foodMode: 'veg' } } });
        const c = (await request(app).post(`/api/admin/tenants/${veg._id}/shop/categories`).set(auth()).send({ name: 'Mains' })).body;
        const res = await request(app).post(`/api/admin/tenants/${veg._id}/shop/products`).set(auth()).send(productBody(c._id, { isVeg: false }));
        assert.equal(res.status, 400);
        assert.match(res.body.error, /veg-only/);
    });

    test('a category of another shop is refused; bad option groups are refused', async () => {
        const other = await f.makeTenant(`catalog-other-${++n}`);
        const foreign = (await request(app).post(`/api/admin/tenants/${other._id}/shop/categories`).set(auth()).send({ name: 'Theirs' })).body;
        assert.equal((await post('products', productBody(foreign._id))).status, 400);

        const c = await category();
        const bad = await post('products', productBody(c._id, { optionGroups: [{ id: 'size', name: 'Size', min: 0, max: 1, options: [] }] }));
        assert.equal(bad.status, 400);
    });

    test('stock: count 0 takes the item off sale, a count puts it back', async () => {
        const c = await category();
        const p = (await post('products', productBody(c._id))).body;
        let r = await patch(`products/${p._id}/stock`, { enabled: true, qty: 0 });
        assert.equal(r.body.isAvailable, false);
        r = await patch(`products/${p._id}/stock`, { enabled: true, qty: 5 });
        assert.equal(r.body.isAvailable, true);
        assert.equal(r.body.stock.qty, 5);
        r = await patch(`products/${p._id}/stock`, { enabled: false });
        assert.equal(r.body.isAvailable, true);
    });

    test('the list can be filtered by category and searched, and pages', async () => {
        const a = await category({ name: 'A' });
        const b = await category({ name: 'B' });
        await post('products', productBody(a._id, { name: 'Alpha' }));
        await post('products', productBody(b._id, { name: 'Beta' }));
        const byCat = await get(`products?categoryId=${a._id}`);
        assert.equal(byCat.body.items.length, 1);
        assert.equal(byCat.body.items[0].name, 'Alpha');
        const search = await get('products?q=bet');
        assert.equal(search.body.total, 1);
        const paged = await get('products?limit=1&page=2');
        assert.equal(paged.body.items.length, 1);
        assert.equal(paged.body.total, 2);
    });
});

describe('import', () => {
    test('preview shows what will be created, errors block everything, save creates', async () => {
        const rows = [
            { name: 'Gulab Jamun', category: 'Sweets', price: '120', type: 'veg' },
            { name: 'Chicken Roll', category: 'Snacks', price: '90', type: 'nonveg', mrp: '100' },
        ];
        const prev = await request(app).post(`/api/admin/tenants/${shop._id}/products/import?dryRun=true`).set(auth()).send({ rows });
        assert.equal(prev.status, 200);
        assert.equal(prev.body.willCreate, 2);
        assert.deepEqual(prev.body.newCategories.sort(), ['Snacks', 'Sweets']);

        const badRows = [{ name: 'No price', category: 'Sweets', price: 'abc', type: 'veg' }];
        const bad = await request(app).post(`/api/admin/tenants/${shop._id}/products/import?dryRun=true`).set(auth()).send({ rows: badRows });
        assert.equal(bad.status, 400);
        assert.equal(bad.body.errors[0].row, 1);

        const saved = await request(app).post(`/api/admin/tenants/${shop._id}/products/import?dryRun=false`).set(auth()).send({ rows });
        assert.equal(saved.status, 201);
        assert.equal(saved.body.created, 2);
        assert.equal((await get('products')).body.total, 2);

        const again = await request(app).post(`/api/admin/tenants/${shop._id}/products/import?dryRun=true`).set(auth()).send({ rows });
        assert.equal(again.status, 400);   // already there
    });
});

describe('collections, banners, coupons', () => {
    test('collection: dates can be cleared with null, foreign items refused', async () => {
        const c = await category();
        const p = (await post('products', productBody(c._id))).body;
        const ok = await post('collections', {
            kind: 'festival', title: 'Diwali Boxes', subtitle: '', image: '', productIds: [p._id],
            startsAt: '2026-11-01T00:00:00+05:30', endsAt: '2026-11-05T23:59:59+05:30', sortOrder: 0, isActive: true,
        });
        assert.equal(ok.status, 201, JSON.stringify(ok.body));

        const cleared = await patch(`collections/${ok.body._id}`, { startsAt: null, endsAt: null, productIds: [] });
        assert.equal(cleared.status, 200);
        assert.equal(cleared.body.startsAt ?? null, null);

        const other = await f.makeTenant(`catalog-other-${++n}`);
        const oc = (await request(app).post(`/api/admin/tenants/${other._id}/shop/categories`).set(auth()).send({ name: 'O' })).body;
        const op = (await request(app).post(`/api/admin/tenants/${other._id}/shop/products`).set(auth()).send(productBody(oc._id))).body;
        const bad = await post('collections', { kind: 'combo', title: 'Mix', productIds: [op._id] });
        assert.equal(bad.status, 400);
    });

    test('banner: create, end before start refused, hard delete', async () => {
        const ok = await post('banners', { title: 'Flat 20% off', subtitle: '', image: '', couponCode: 'FIRST50', firstOrderOnly: true, startsAt: null, endsAt: null, sortOrder: 0, isActive: true });
        assert.equal(ok.status, 201);
        const bad = await post('banners', { title: 'x', startsAt: '2026-11-05T00:00:00+05:30', endsAt: '2026-11-01T00:00:00+05:30' });
        assert.equal(bad.status, 400);
        const del = await request(app).delete(url(`banners/${ok.body._id}`)).set(auth());
        assert.equal(del.body.softDeleted, false);
        assert.equal((await get('banners')).body.total, 0);
    });

    test('coupon: percent over 100 refused, duplicate active code refused, code reusable after switching off', async () => {
        const body = { code: 'SAVE10', description: '', discountType: 'percent', discountValue: 10, maxDiscount: null, minOrder: 0, firstOrderOnly: false, usageLimitPerUser: 1, totalUsageLimit: null, isPublic: true, startsAt: null, endsAt: null, isActive: true };
        const ok = await post('coupons', body);
        assert.equal(ok.status, 201, JSON.stringify(ok.body));

        assert.equal((await post('coupons', { ...body, code: 'BIG', discountValue: 150 })).status, 400);
        assert.equal((await post('coupons', body)).status, 409);

        await request(app).delete(url(`coupons/${ok.body._id}`)).set(auth());
        assert.equal((await post('coupons', body)).status, 201);

        const flat = await post('coupons', { ...body, code: 'FLAT50', discountType: 'flat', discountValue: 50, maxDiscount: null });
        assert.equal(flat.status, 201);
    });
});

describe('availability explanation', () => {
    test('a shop with no data lists what is hidden and why', async () => {
        await shop.updateOne({ $set: { settings: { home: { blocks: [{ type: 'banner', enabled: true }, { type: 'items', enabled: true }], filters: ['jain'] } } } });
        const res = await request(app).get(`/api/admin/tenants/${shop._id}/availability`).set(auth());
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.body.hidden));
        assert.ok(res.body.hidden.some((h) => h.type === 'filter' && h.id === 'jain' && h.reason));
    });
});
