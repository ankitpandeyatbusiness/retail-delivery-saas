require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Product = require('../src/models/Product');
const Category = require('../src/models/Category');
const stockSvc = require('../src/services/stockService');
const { nextMorning } = require('../src/utils/nextMorning');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');

// Phase 2 of the owner panel: the menu in one call, "sold out until ...", and drag-to-reorder.
let w, cat;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('menu-shop');
    tenantRecognizer.invalidateTenant('menu-shop');
    cat = await Category.create({ tenantId: w.tenant._id, name: 'Sweets', sortOrder: 0 });
});

const mk = (name, extra = {}) => Product.create({ tenantId: w.tenant._id, categoryId: cat._id, name, price: 100, isVeg: true, ...extra });
const api = (m, path, body) => request(app)[m](`/api/shop${path}`).set(w.owner.headers).send(body);

describe('nextMorning', () => {
    test('is always the next 4 AM India time', () => {
        // 2026-01-10 10:00 IST = 04:30 UTC  -> tomorrow 4 AM IST = 2026-01-10 22:30 UTC
        assert.equal(nextMorning(new Date('2026-01-10T04:30:00Z')).toISOString(), '2026-01-10T22:30:00.000Z');
        // 2026-01-10 01:00 IST (still the old shop day) -> today 4 AM IST = 2026-01-09 22:30 UTC
        assert.equal(nextMorning(new Date('2026-01-09T19:30:00Z')).toISOString(), '2026-01-09T22:30:00.000Z');
    });
});

describe('GET /menu', () => {
    test('lists hidden categories too, with item counts', async () => {
        const hidden = await Category.create({ tenantId: w.tenant._id, name: 'Old', isActive: false, sortOrder: 1 });
        await mk('Laddu');
        await mk('Barfi');
        await mk('Gone', { isActive: false });
        const r = await api('get', '/menu');
        assert.equal(r.status, 200);
        assert.equal(r.body.categories.length, 2);
        assert.equal(r.body.categories.find((c) => String(c._id) === String(cat._id)).itemCount, 2);
        assert.equal(r.body.categories.find((c) => String(c._id) === String(hidden._id)).itemCount, 0);
        assert.equal(r.body.products.length, 2, 'removed items are not listed');
    });
});

describe('sold out until...', () => {
    test('off with no time stays off until the owner switches it on', async () => {
        const p = await mk('Jalebi');
        const r = await api('patch', `/products/${p._id}/availability`, { available: false });
        assert.equal(r.status, 200);
        assert.equal(r.body.isAvailable, false);
        assert.equal(r.body.unavailableUntil, null);
        const on = await api('patch', `/products/${p._id}/availability`, { available: true });
        assert.equal(on.body.isAvailable, true);
    });

    test('for some minutes, then it comes back by itself', async () => {
        const p = await mk('Samosa');
        const r = await api('patch', `/products/${p._id}/availability`, { available: false, minutes: 60 });
        assert.ok(Math.abs(new Date(r.body.unavailableUntil).getTime() - (Date.now() + 3600000)) < 5000);
        // not yet
        await stockSvc.sweepSoldOut(w.tenant._id, new Date(Date.now() + 30 * 60000), { force: true });
        assert.equal((await Product.findById(p._id).lean()).isAvailable, false);
        // later
        await stockSvc.sweepSoldOut(w.tenant._id, new Date(Date.now() + 61 * 60000), { force: true });
        const after1 = await Product.findById(p._id).lean();
        assert.equal(after1.isAvailable, true);
        assert.equal(after1.unavailableUntil, undefined);
    });

    test('until tomorrow morning', async () => {
        const p = await mk('Kachori');
        const r = await api('patch', `/products/${p._id}/availability`, { available: false, untilMorning: true });
        assert.equal(new Date(r.body.unavailableUntil).getTime(), nextMorning().getTime());
    });

    test('an item whose stock ran out stays off after the time, and cannot be switched on by hand', async () => {
        const p = await mk('Rasgulla');
        await api('patch', `/products/${p._id}/stock`, { enabled: true, qty: 0 });
        const on = await api('patch', `/products/${p._id}/availability`, { available: true });
        assert.equal(on.status, 409);
        await Product.updateOne({ _id: p._id }, { $set: { isAvailable: false, unavailableUntil: new Date(Date.now() - 1000) } });
        await stockSvc.sweepSoldOut(w.tenant._id, new Date(), { force: true });
        const now = await Product.findById(p._id).lean();
        assert.equal(now.isAvailable, false);
        assert.equal(now.unavailableUntil, undefined);
    });

    test('bad input and other shops are refused', async () => {
        const p = await mk('Peda');
        assert.equal((await api('patch', `/products/${p._id}/availability`, { available: 'no' })).status, 400);
        assert.equal((await api('patch', `/products/${p._id}/availability`, { available: false, minutes: 0 })).status, 400);
        assert.equal((await api('patch', '/products/not-an-id/availability', { available: false })).status, 404);
        assert.equal((await api('patch', `/products/${new (require('mongoose').Types.ObjectId)()}/availability`, { available: false })).status, 404);
    });

    test('stock changes clear an older "sold out until"', async () => {
        const p = await mk('Mathri');
        await api('patch', `/products/${p._id}/availability`, { available: false, minutes: 120 });
        await api('patch', `/products/${p._id}/stock`, { enabled: true, qty: 5 });
        const now = await Product.findById(p._id).lean();
        assert.equal(now.isAvailable, true);
        assert.equal(now.unavailableUntil, undefined);
    });
});

describe('reorder', () => {
    test('categories and items take the order sent', async () => {
        const c2 = await Category.create({ tenantId: w.tenant._id, name: 'Snacks', sortOrder: 1 });
        const r = await api('put', '/categories/order', { ids: [String(c2._id), String(cat._id)] });
        assert.equal(r.status, 200);
        assert.equal((await Category.findById(c2._id).lean()).sortOrder, 0);
        assert.equal((await Category.findById(cat._id).lean()).sortOrder, 1);

        const a = await mk('A'); const b = await mk('B');
        await api('put', '/products/order', { ids: [String(b._id), String(a._id)] });
        assert.equal((await Product.findById(b._id).lean()).sortOrder, 0);
        assert.equal((await Product.findById(a._id).lean()).sortOrder, 1);
    });

    test('refuses repeated, invalid and foreign ids', async () => {
        const a = await mk('A');
        assert.equal((await api('put', '/products/order', { ids: [] })).status, 400);
        assert.equal((await api('put', '/products/order', { ids: [String(a._id), String(a._id)] })).status, 400);
        assert.equal((await api('put', '/products/order', { ids: ['x'] })).status, 400);
        assert.equal((await api('put', '/products/order', { ids: [String(new (require('mongoose').Types.ObjectId)())] })).status, 400);
    });
});
