require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Tenant = require('../src/models/Tenant');
const { resolveConfig } = require('../src/services/tenantConfigService');
const keepOwnerPause = require('../src/utils/keepOwnerPause');
const closingReport = require('../src/services/closingReport');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');

// Phase 6 of the owner panel: fee editing, busy mode, the closing report, and the settings the owner can read.
let w;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('set-shop');
    tenantRecognizer.invalidateTenant('set-shop');
});
const call = (m, path, body, headers = w.owner.headers) => request(app)[m](`/api/shop${path}`).set(headers).send(body);
const cfg = async () => resolveConfig(await Tenant.findById(w.tenant._id).lean());

describe('owner fees (#1)', () => {
    test('the owner sets the delivery fee, packaging, tips and minimum order', async () => {
        const r = await call('put', '/settings', {
            orders: {
                deliveryFee: { type: 'flat', amount: 35, freeAbove: 500 }, packagingCharge: 12, tipOptions: [10, 20], minOrder: 150, prepTimeMin: 25,
            },
        });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const c = await cfg();
        assert.deepEqual({ ...c.orders.deliveryFee }, { type: 'flat', amount: 35, freeAbove: 500 });
        assert.equal(c.orders.packagingCharge, 12);
        assert.deepEqual(c.orders.tipOptions, [10, 20]);
        assert.equal(c.orders.minOrder, 150);
        assert.equal(c.orders.prepTimeMin, 25);
    });

    test('a distance fee can be set and one field can change alone', async () => {
        await call('put', '/settings', { orders: { deliveryFee: { type: 'distance', baseKm: 2, baseFee: 20, perKmFee: 8, maxFee: 80 } } });
        await call('put', '/settings', { orders: { deliveryFee: { perKmFee: 10 } } });
        const fee = (await cfg()).orders.deliveryFee;
        assert.equal(fee.type, 'distance');
        assert.equal(fee.perKmFee, 10);
        assert.equal(fee.baseFee, 20);
    });

    test('GST, payment methods and order types stay with the platform, and bad numbers are refused', async () => {
        assert.equal((await call('put', '/settings', { orders: { gst: { mode: 'inclusive', percent: 5 } } })).status, 400);
        assert.equal((await call('put', '/settings', { orders: { payments: ['upi'] } })).status, 400);
        assert.equal((await call('put', '/settings', { orders: { types: ['pickup'] } })).status, 400);
        assert.equal((await call('put', '/settings', { orders: { deliveryFee: { amount: -5 } } })).status, 400);
        assert.equal((await call('put', '/settings', { orders: { tipOptions: [1, 2, 3, 4, 5, 6] } })).status, 400);
    });

    test('GET /settings shows what he can change, GST read-only', async () => {
        await call('put', '/settings', { orders: { packagingCharge: 7 } });
        const r = await call('get', '/settings');
        assert.equal(r.status, 200);
        assert.equal(r.body.orders.packagingCharge, 7);
        assert.ok(r.body.orders.deliveryFee);
        assert.ok(r.body.orders.gst);
        assert.ok('weekly' in r.body.hours);
        assert.ok(r.body.riders);
    });
});

describe('busy mode (#5)', () => {
    test('adds waiting time while it lasts and stops by itself', async () => {
        const base = (await cfg()).orders.prepTimeMin;
        const r = await call('put', '/busy', { extraMin: 20, minutes: 60 });
        assert.equal(r.status, 200);
        const t = await Tenant.findById(w.tenant._id).lean();
        assert.equal(resolveConfig(t).orders.prepTimeMin, base + 20);
        assert.equal(resolveConfig(t).orders.busy.extraMin, 20);
        const later = resolveConfig(t, new Date(Date.now() + 61 * 60000));
        assert.equal(later.orders.prepTimeMin, base, 'back to normal with nothing running');
        assert.equal(later.orders.busy, undefined);
    });

    test('switching it off, bad input, and the superadmin form not wiping it', async () => {
        await call('put', '/busy', { extraMin: 15, untilMorning: true });
        assert.equal((await call('put', '/busy', { extraMin: 3, minutes: 60 })).status, 400);
        assert.equal((await call('put', '/busy', { extraMin: 15 })).status, 400);
        const t = await Tenant.findById(w.tenant._id).lean();
        const kept = keepOwnerPause(t.settings, { orders: { prepTimeMin: 30 } });
        assert.ok(kept.orders.busy, 'busy mode survives a save from the platform panel');
        assert.equal((await call('put', '/busy', { off: true })).body.busy, null);
        assert.equal((await cfg()).orders.busy, undefined);
    });
});

describe('closing report (#6)', () => {
    test('counts the day: sales, payment split, cancellations, top item', async () => {
        const now = new Date();
        await f.makeOrder(w.tenant, w.customer.user, { status: 'delivered', deliveredAt: now, pricing: { subtotal: 200, discount: 20, packagingCharge: 10, tip: 5, deliveryFee: 30, total: 225 }, payment: { method: 'cod' } });
        await f.makeOrder(w.tenant, w.customer.user, { status: 'delivered', deliveredAt: now, pricing: { subtotal: 100, total: 100 }, payment: { method: 'cod' } });
        await f.makeOrder(w.tenant, w.customer.user, { status: 'cancelled', cancelledBy: 'customer' });
        const r = await call('get', '/closing-report');
        assert.equal(r.status, 200);
        assert.equal(r.body.sales.orders, 2);
        assert.equal(r.body.sales.revenue, 290);
        assert.equal(r.body.sales.tips, 5);
        assert.equal(r.body.orders.delivered, 2);
        assert.equal(r.body.orders.cancelled, 1);
        assert.equal(r.body.orders.cancelledBy.customer, 1);
        assert.equal(r.body.payments[0].method, 'cod');
        assert.equal(r.body.topItems[0].name, 'Test item');
        assert.equal(r.body.isToday, true);
    });

    test('another day, bad dates, the future, and a customer is refused', async () => {
        assert.equal((await call('get', '/closing-report?date=2020-01-01')).body.sales.orders, 0);
        assert.equal((await call('get', '/closing-report?date=nope')).status, 400);
        assert.equal((await call('get', '/closing-report?date=2999-01-01')).status, 400);
        assert.ok([401, 403].includes((await call('get', '/closing-report', undefined, w.customer.headers)).status));
        assert.equal((await closingReport.build({ tenantId: w.tenant._id })).orders.placed, 0);
    });
});

describe('shop logo', () => {
    test('a shop without its own logo shows its app icon from the media storage', async () => {
        const old = process.env.MEDIA_CDN_URL;
        process.env.MEDIA_CDN_URL = 'https://cdn.example.com/';
        try {
            const t = await Tenant.findById(w.tenant._id).lean();
            assert.equal(resolveConfig(t).restaurant.logo, 'https://cdn.example.com/tenants/set-shop/branding/icon.png');
            assert.equal(resolveConfig({ ...t, logo: 'https://x.test/own.png' }).restaurant.logo, 'https://x.test/own.png', 'its own logo wins');
        } finally {
            if (old === undefined) delete process.env.MEDIA_CDN_URL; else process.env.MEDIA_CDN_URL = old;
        }
    });
});
