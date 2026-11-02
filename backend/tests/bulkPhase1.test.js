require('./helpers/env');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const BulkOrder = require('../src/models/BulkOrder');

// Phase 1 of the bulk orders changes: the defaults (notice 24 h, full refund 18 h), the "Recommended settings" numbers, and the chips of the owner's list.
describe('bulk orders: defaults, recommended settings and list chips', () => {
    let w;
    const owner = (m, p, b) => request(app)[m](`/api/shop/bulk${p}`).set(w.owner.headers).send(b);
    before(async () => { await db.connect(); w = await f.makeWorld('bulk-p1'); });
    after(() => db.disconnect());

    test('a shop that never saved anything gets 24 hours notice and an 18 hour full refund', async () => {
        const s = (await owner('get', '/settings')).body;
        assert.equal(s.noticeHours, 24);
        assert.equal(s.fullRefundHours, 18);
        assert.equal(s.advancePercent, 50);
    });

    test('the server sends the recommended numbers; they leave the on/off switch alone and pass the same checks as anything the owner types', async () => {
        const s = (await owner('get', '/settings')).body;
        const r = s.recommended;
        assert.ok(r, 'recommended is sent');
        assert.deepEqual(
            [r.noticeHours, r.fullRefundHours, r.advancePercent, r.quoteValidHours, r.minOrderAmount, r.deliveryFee.type, r.deliveryFee.amount, r.deliveryFee.freeAbove],
            [24, 18, 50, 24, 3000, 'free_above', 200, 10000],
        );
        assert.equal(r.enabled, undefined, 'it never switches bulk on or off');
        const saved = await owner('put', '/settings', r);
        assert.equal(saved.status, 200, JSON.stringify(saved.body));
        assert.deepEqual([saved.body.minOrderAmount, saved.body.deliveryFee.freeAbove, saved.body.fullRefundHours], [3000, 10000, 18]);
        assert.equal(saved.body.enabled, false, 'still off until the owner switches it on');
    });

    test('each chip of the list shows the right orders', async () => {
        const base = { tenantId: w.tenant._id, userId: w.customer.user._id, fulfilment: 'pickup', when: new Date(Date.now() + 5 * 86400000), lines: [] };
        const statuses = ['requested', 'quoted', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'completed', 'cancelled', 'declined', 'expired'];
        for (const [i, status] of statuses.entries()) await BulkOrder.create({ ...base, code: `CHIP${i}`, status });
        const names = async (q) => (await owner('get', q)).body.items.map((x) => x.status).sort();
        const sorted = (a) => [...a].sort();

        assert.deepEqual(await names(''), sorted(statuses), 'All');
        assert.deepEqual(await names('?status=open'), sorted(['requested', 'quoted', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered']), 'Active');
        assert.deepEqual(await names('?status=requested'), ['requested'], 'Needs a quote');
        assert.deepEqual(await names('?status=quoted'), ['quoted'], 'Quote sent');
        assert.deepEqual(await names('?status=delivered'), sorted(['delivered', 'completed']), 'Delivered');
        assert.deepEqual(await names('?status=cancelled'), sorted(['cancelled', 'declined', 'expired']), 'Cancelled');
        assert.deepEqual(await names('?status=paid'), ['confirmed'], 'Advance paid');
    });
});
