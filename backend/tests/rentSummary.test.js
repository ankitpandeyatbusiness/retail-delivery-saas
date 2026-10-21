require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const rentSummary = require('../src/services/rentSummary');
const { periodOf, nextPeriod } = require('../src/services/subscriptionService');
const { makeTenant, makeUser, makeSuperAdmin } = require('./helpers/factory');

// What the super admin sees on a shop: what it pays next, for which month, or that it is still free. Read-only; the plan itself is the supreme admin's.
const DAY = 86400000;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => { await db.clear(); });

let seq = 700000;
const billableNow = (t, user, n) => Order.insertMany(Array.from({ length: n }, () => ({
    tenantId: t._id, userId: user._id, orderNo: ++seq, status: 'delivered', orderType: 'delivery',
    items: [{ productId: new mongoose.Types.ObjectId(), name: 'Item', quantity: 1, unitPrice: 100, lineTotal: 100 }],
    pricing: { subtotal: 100, total: 100 }, payment: { method: 'cod' }, billing: { billable: true, at: new Date() },
})));
const live = (extra = {}) => ({ billing: { state: 'free', isLive: true, goLiveAt: new Date(Date.now() - 5 * DAY), ...extra } });
const summaryOf = async (t) => (await rentSummary.forShops([await Tenant.findById(t._id).lean()])).get(String(t._id));

describe('rent summary', () => {
    test('a shop that is not live yet is free and nothing is counted', async () => {
        const t = await makeTenant('rent-1');
        const r = await summaryOf(t);
        assert.equal(r.stage, 'not_live');
        assert.match(r.text, /Not live yet/);
        assert.equal(r.custom, false);
    });

    test('in the free period: free orders left, when it ends by, and the first month that will be billed', async () => {
        const t = await makeTenant('rent-2', live());
        const r = await summaryOf(t);
        assert.equal(r.stage, 'free');
        assert.equal(r.free.ordersLeft, 100);
        assert.match(r.text, /Free period: 100 free orders left/);
        assert.match(r.text, /First rent: /);
        assert.match(r.first.period, /^\d{4}-\d{2}$/);
        assert.ok(new Date(r.free.endsAt) > new Date());
    });

    test('a shop with its own plan says so, and its own free orders and months are used', async () => {
        const t = await makeTenant('rent-3', live({ freeOrdersOverride: 20, freeMonthsOverride: 1, fixedFeeOverride: 1500 }));
        const r = await summaryOf(t);
        assert.equal(r.custom, true);
        assert.equal(r.free.freeOrders, 20);
        assert.equal(r.free.freeMonths, 1);
        assert.match(r.plan, /Fixed ₹1,500 a month/);
    });

    test('after the free period: the month being counted, the orders so far, the rent so far and the day it is billed; a fixed fee beats the tiers', async () => {
        const u = await makeUser(await makeTenant('rent-4x'), 'customer', '9000000099');   // a person for the orders
        const t = await makeTenant('rent-4', live({ freeOrdersOverride: 5, billableCount: 6, freeEndedAt: new Date(Date.now() - DAY) }));
        await billableNow(t, u.user, 4);
        let r = await summaryOf(t);
        assert.equal(r.stage, 'paying');
        const now = periodOf(new Date());
        assert.equal(r.next.period, now);
        assert.equal(r.next.orders, 4);
        assert.ok(r.next.fee > 0, 'the platform tiers give a fee for this many orders');
        assert.match(r.text, /rent so far/);
        assert.match(r.text, /Billed on 1 /);
        assert.equal(periodOf(new Date(r.next.billedOn)), nextPeriod(now), 'billed on the 1st of next month');

        await Tenant.updateOne({ _id: t._id }, { $set: { 'billing.fixedFeeOverride': 2000 } });
        r = await summaryOf(t);
        assert.equal(r.next.fee, 2000);
        assert.equal(r.custom, true);
        assert.match(r.plan, /Fixed ₹2,000 a month/);
    });

    test('an unpaid bill shows as grace or paused', async () => {
        const g = await makeTenant('rent-5', live({ state: 'grace' }));
        const p = await makeTenant('rent-6', live({ state: 'paused' }));
        assert.equal((await summaryOf(g)).stage, 'grace');
        assert.match((await summaryOf(p)).text, /Paused/);
    });
});

describe('the shop list and the shop page carry it', () => {
    test('GET /api/admin/tenants has a rent line for every shop; the detail has the numbers', async () => {
        const sa = { headers: { Authorization: 'Bearer ' + (await makeSuperAdmin()).token } };
        await makeTenant('rent-7', live({ freeOrdersOverride: 7 }));
        const list = await request(app).get('/api/admin/tenants').set(sa.headers);
        assert.equal(list.status, 200, JSON.stringify(list.body));
        const row = list.body.items.find((x) => x.slug === 'rent-7');
        assert.equal(row.rent.stage, 'free');
        assert.equal(row.rent.custom, true);
        assert.ok(row.billing.state, 'the rent state is still there');
        assert.equal(row.billing.tiersOverride, undefined, 'the plan details are not in the list');
        const one = await request(app).get(`/api/admin/tenants/${row._id}`).set(sa.headers);
        assert.equal(one.body.rent.free.freeOrders, 7);
    });
});
