require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const Category = require('../src/models/Category');
const Product = require('../src/models/Product');
const pushChannel = require('../src/notifications/channels/push');
const adminAlerts = require('../src/services/adminAlerts');

// The least a person must order in a bulk order: set on each CHOICE (Half, Full) or on a dish with no choices. Add-ons (extra cheese) never have one.
const days = (k) => new Date(Date.now() + k * 86400000).toISOString();

describe('the least a person must order in a bulk order', () => {
    let w; let tikka; let plain; let cat;
    const owner = (m, p, b) => request(app)[m](`/api/shop/bulk${p}`).set(w.owner.headers).send(b);
    const cust = (m, p, b) => request(app)[m](`/api/bulk${p}`).set(w.customer.headers).send(b);
    const est = (items) => cust('post', '/estimate', { fulfilment: 'pickup', when: days(5), items });
    const codes = (r) => r.body.problems.map((p) => p.code);
    const half = (n, extra = []) => ({ productId: String(tikka._id), quantity: n, selections: [{ groupId: 'size', optionIds: ['half'] }, ...extra] });
    const full = (n) => ({ productId: String(tikka._id), quantity: n, selections: [{ groupId: 'size', optionIds: ['full'] }] });

    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(async () => {
        await db.clear();
        mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
        mock.method(adminAlerts, 'alert', async () => { });
        w = await f.makeWorld(`bulkmin-${Date.now()}`);
        cat = await Category.create({ tenantId: w.tenant._id, name: 'Main', isActive: true });
        tikka = await Product.create({
            tenantId: w.tenant._id, categoryId: cat._id, name: 'Paneer Tikka', price: 150, isVeg: true, isActive: true,
            optionGroups: [
                { id: 'size', name: 'Choose size', kind: 'choice', min: 1, max: 1, options: [{ id: 'half', name: 'Half', price: 0, bulkMin: 20 }, { id: 'full', name: 'Full', price: 130, bulkMin: 10 }] },
                { id: 'extras', name: 'Add-ons', kind: 'addon', min: 0, max: 2, options: [{ id: 'mint', name: 'Mint chutney', price: 10 }, { id: 'cheese', name: 'Extra cheese', price: 30 }] },
            ],
        });
        plain = await Product.create({ tenantId: w.tenant._id, categoryId: cat._id, name: 'Dal', price: 100, isVeg: true, isActive: true, bulkMin: 30 });
        await owner('put', '/settings', { enabled: true, noticeHours: 1 });
    });
    afterEach(() => mock.restoreAll());

    test('each choice has its own minimum; below it the request is refused with the number, at it the request is fine', async () => {
        const a = await est([half(15)]);
        assert.equal(a.status, 200, JSON.stringify(a.body));
        assert.deepEqual(codes(a), ['min_qty']);
        assert.match(a.body.problems[0].message, /Paneer Tikka \(Half\): at least 20 pieces \(you have 15\)/);
        assert.deepEqual(codes(await est([half(20)])), []);
        assert.deepEqual(codes(await est([full(10)])), []);          // Full has its own minimum of 10
        assert.deepEqual(codes(await est([full(9)])), ['min_qty']);
        assert.deepEqual(codes(await est([half(20), full(5)])), ['min_qty']);   // only Full is short
    });

    test('add-ons never have a minimum, and the pieces of one choice count together whatever add-ons they carry', async () => {
        const mint = [{ groupId: 'extras', optionIds: ['mint'] }];
        const cheese = [{ groupId: 'extras', optionIds: ['cheese'] }];
        assert.deepEqual(codes(await est([half(12, mint), half(10, cheese)])), [], '12 + 10 Half = 22, enough');
        assert.deepEqual(codes(await est([half(12, mint), half(5, cheese)])), ['min_qty'], '17 Half is not enough');
    });

    test('a dish with no choices has one minimum for the whole dish', async () => {
        const dal = (n) => ({ productId: String(plain._id), quantity: n });
        assert.deepEqual(codes(await est([dal(25)])), ['min_qty']);
        assert.deepEqual(codes(await est([dal(30)])), []);
    });

    test('the bulk menu tells the app the minimums and which groups are choices and which are add-ons', async () => {
        const m = await cust('get', '/menu');
        assert.equal(m.status, 200);
        const items = m.body.categories.flatMap((c) => c.items);
        const t = items.find((i) => i.name === 'Paneer Tikka');
        assert.deepEqual(t.optionGroups.map((g) => g.kind), ['choice', 'addon']);
        assert.deepEqual(t.optionGroups[0].options.map((o) => o.bulkMin), [20, 10]);
        assert.equal(items.find((i) => i.name === 'Dal').bulkMin, 30);
    });

    test('a minimum on an add-on is refused (it belongs on a choice)', async () => {
        await assert.rejects(() => Product.create({
            tenantId: w.tenant._id, categoryId: cat._id, name: 'Bad', price: 10, isVeg: true,
            optionGroups: [{ id: 'extras', name: 'Add-ons', kind: 'addon', min: 0, max: 1, options: [{ id: 'cheese', name: 'Extra cheese', bulkMin: 5 }] }],
        }), (e) => /belongs on a choice/.test(JSON.stringify(e.errors || {}) + e.message));
    });

    test('an older group (no kind) is a choice when you must pick from it and an add-on when you need not', async () => {
        const { groupKind } = require('../src/services/optionGroups');
        assert.equal(groupKind({ min: 1, max: 1 }), 'choice');
        assert.equal(groupKind({ min: 0, max: 3 }), 'addon');
        assert.equal(groupKind({ min: 0, max: 1, kind: 'choice' }), 'choice');
    });
});
