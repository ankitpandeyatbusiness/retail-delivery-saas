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

// Pause = "temporarily stopped": the service is still shown, but a new request is refused with a clear sentence. What is already in progress carries on.
const SORRY = 'Sorry, this service is temporarily unavailable.';
const days = (k) => new Date(Date.now() + k * 86400000).toISOString();

describe('pausing Bulk orders', () => {
    let w; let dish; let admin;
    const owner = (m, p, b) => request(app)[m](`/api/shop/bulk${p}`).set(w.owner.headers).send(b);
    const cust = (m, p, b) => request(app)[m](`/api/bulk${p}`).set(w.customer.headers).send(b);
    const ask = (q = 100) => cust('post', '/', { fulfilment: 'pickup', when: days(5), items: [{ productId: String(dish._id), quantity: q }], contact: { name: 'Raj', phone: '9000000051' } });

    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(async () => {
        await db.clear();
        mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
        mock.method(adminAlerts, 'alert', async () => { });
        w = await f.makeWorld(`pause-bulk-${Date.now()}`);
        admin = await f.makeSuperAdmin();
        const cat = await Category.create({ tenantId: w.tenant._id, name: 'Main', isActive: true });
        dish = await Product.create({ tenantId: w.tenant._id, categoryId: cat._id, name: 'Dal', price: 100, isVeg: true, isActive: true });
        await owner('put', '/settings', { enabled: true, noticeHours: 1 });
    });
    afterEach(() => mock.restoreAll());

    test('while paused the customer still sees Bulk order (marked paused) but cannot get the menu, a price or send a request', async () => {
        assert.equal((await owner('put', '/settings', { paused: true })).body.paused, true);
        const c = await cust('get', '/config');
        assert.deepEqual([c.status, c.body.enabled, c.body.paused], [200, true, true]);
        for (const r of [await cust('get', '/menu'), await cust('post', '/estimate', { fulfilment: 'pickup', when: days(5), items: [{ productId: String(dish._id), quantity: 50 }] }), await ask()]) {
            assert.equal(r.status, 409);
            assert.equal(r.body.error, SORRY);
        }
    });

    test('an order already taken carries on while paused: the customer sees and pays it, the owner quotes and finishes it', async () => {
        const first = await ask(); const second = await ask(120);
        const a = first.body.id; const b = second.body.id;
        const o = (await owner('get', `/${a}`)).body;
        assert.equal((await owner('post', `/${a}/quote`, { lines: o.lines.map((l) => ({ id: l.id, unitPrice: l.unitPrice })) })).status, 200);

        await owner('put', '/settings', { paused: true });

        assert.equal((await cust('get', `/${a}`)).status, 200);
        assert.equal((await cust('post', `/${a}/pay`)).status, 200, 'he can still pay a quote he was given');
        const o2 = (await owner('get', `/${b}`)).body;
        assert.equal((await owner('post', `/${b}/quote`, { lines: o2.lines.map((l) => ({ id: l.id, unitPrice: l.unitPrice })) })).status, 200, 'the owner still quotes a request that was already sent');
    });

    test('resuming takes requests again; the owner\'s other settings are not touched', async () => {
        await owner('put', '/settings', { advancePercent: 40 });
        await owner('put', '/settings', { paused: true });
        assert.equal((await ask()).status, 409);
        const back = await owner('put', '/settings', { paused: false });
        assert.deepEqual([back.body.paused, back.body.advancePercent, back.body.enabled], [false, 40, true]);
        assert.equal((await ask()).status, 201);
        assert.equal((await owner('put', '/settings', { paused: 'yes' })).status, 400);
    });

    test('the super admin can pause a shop\'s bulk orders too, and pause is separate from the owner\'s on/off switch', async () => {
        const p = await request(app).put(`/api/admin/tenants/${w.tenant._id}/shop/bulk/settings`).set({ Authorization: `Bearer ${admin.token}` }).send({ paused: true });
        assert.equal(p.status, 200, JSON.stringify(p.body));
        assert.equal(p.body.paused, true);
        assert.equal((await ask()).status, 409);
        await owner('put', '/settings', { paused: false, enabled: false });
        const off = await ask();
        assert.equal(off.status, 404, 'switched off is "not available", not "paused"');
    });
});

describe('pausing a service (Tiffin, Party / venue booking, his own)', () => {
    let w; let service;
    const owner = (m, p, b) => request(app)[m](`/api/shop/services${p}`).set(w.owner.headers).send(b);
    const cust = (m, p, b) => request(app)[m](`/api/services${p}`).set(w.customer.headers).send(b);
    const inquire = () => cust('post', `/${service._id}/inquiries`, { name: 'Anil', phone: '9000000030', answers: { date: '2030-01-01', guests: 20, occasion: 'Birthday' } });

    before(async () => { await db.connect(); });
    after(() => db.disconnect());
    beforeEach(async () => {
        await db.clear();
        mock.method(pushChannel, 'send', async () => ({ sent: 0, tokens: 0 }));
        w = await f.makeWorld(`pause-svc-${Date.now()}`);
        service = (await owner('post', '', { kind: 'party', price: 500 })).body;
    });
    afterEach(() => mock.restoreAll());

    test('a paused service is still listed, marked paused, and takes no new inquiry', async () => {
        assert.equal((await cust('get', '')).body.items[0].paused, false);
        const p = await owner('patch', `/${service._id}`, { paused: true });
        assert.equal(p.body.paused, true);
        const list = (await cust('get', '')).body.items;
        assert.equal(list.length, 1, 'still shown');
        assert.equal(list[0].paused, true);
        const r = await inquire();
        assert.equal(r.status, 409);
        assert.equal(r.body.error, SORRY);
    });

    test('talking on an inquiry that was already sent carries on while paused, and resuming takes new ones', async () => {
        const sent = await inquire();
        assert.equal(sent.status, 201, JSON.stringify(sent.body));
        await owner('patch', `/${service._id}`, { paused: true });
        const msg = await cust('post', `/inquiries/${sent.body.id}/messages`, { text: 'Any update?' });
        assert.equal(msg.status, 200, JSON.stringify(msg.body));
        await owner('patch', `/${service._id}`, { paused: false });
        const again = await inquire();
        assert.ok([200, 201].includes(again.status), `a new inquiry is taken again (a repeat within a minute is the double-tap guard): ${again.status}`);
        assert.notEqual(again.status, 409);
    });

    test('paused is not the same as switched off: a switched-off service is hidden, a paused one is shown', async () => {
        await owner('patch', `/${service._id}`, { paused: true });
        assert.equal((await cust('get', '')).body.items.length, 1);
        await owner('patch', `/${service._id}`, { isActive: false });
        assert.equal((await cust('get', '')).body.items.length, 0);
    });
});
