require('./helpers/env');
// The owner's costs and profit, and the server settings checklist.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;

let w; let w2;
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('sc1-' + Date.now().toString(36));
    w2 = await f.makeWorld('sc2-' + Date.now().toString(36));
});
const api = (who, m, u, b) => request(app)[m](`/api/shop/costs${u}`).set(who.headers).send(b || {});
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const firstOfMonth = `${today.slice(0, 8)}01`;

describe('shop costs and profit', () => {
    test('add, list, change and delete a cost; "other" must say what it is; another shop never sees it', async () => {
        const bad = await api(w.owner, 'post', '', { date: today, category: 'other', amountPaise: 5000 });
        assert.equal(bad.status, 400);
        assert.equal((await api(w.owner, 'post', '', { date: today, category: 'nonsense', amountPaise: 5000 })).status, 400);
        assert.equal((await api(w.owner, 'post', '', { date: today, category: 'ingredients', amountPaise: 0 })).status, 400);
        const a = await api(w.owner, 'post', '', { date: today, category: 'ingredients', amountPaise: 150000, vendor: 'Mandi', note: 'Vegetables' });
        assert.equal(a.status, 201, JSON.stringify(a.body));
        const o = await api(w.owner, 'post', '', { date: today, category: 'other', otherName: 'Pest control', amountPaise: 20000 });
        assert.equal(o.status, 201);
        const list = (await api(w.owner, 'get', '')).body;
        assert.equal(list.items.length, 2);
        assert.equal(list.totalPaise, 170000);
        assert.equal((await api(w2.owner, 'get', '')).body.items.length, 0);
        assert.equal((await api(w2.owner, 'delete', `/${a.body.id}`)).status, 404);
        const ch = await api(w.owner, 'patch', `/${a.body.id}`, { amountPaise: 100000 });
        assert.equal(ch.body.amountPaise, 100000);
        assert.equal((await api(w.owner, 'delete', `/${o.body.id}`)).status, 200);
        assert.equal((await api(w.owner, 'get', '')).body.items.length, 1);
    });

    test('profit = delivered sales - costs - rent and SMS paid; a monthly cost counts a share for each day', async () => {
        const order = await f.makeOrder(w.tenant, w.customer.user, { status: 'delivered' });
        const Order = require('../src/models/Order');
        await Order.collection.updateOne({ _id: order._id }, { $set: { deliveredAt: new Date() } });
        await api(w.owner, 'post', '', { date: today, category: 'ingredients', amountPaise: 50000 });
        await api(w.owner, 'post', '', { date: firstOfMonth, category: 'salaries', amountPaise: 3000000, repeatMonthly: true });
        const p = (await api(w.owner, 'get', `/profit?from=${today}&to=${today}`)).body;
        assert.equal(p.days, 1);
        assert.ok(p.sales.revenue > 0 && p.sales.orders === 1);
        const salary = p.costs.items.find((i) => i.key === 'salaries');
        assert.ok(salary && salary.amount > 0 && salary.amount < 30000, `one day of a 30,000 salary is about 1,000, got ${salary && salary.amount}`);
        assert.equal(p.costs.items.find((i) => i.key === 'ingredients').amount, 500);
        assert.equal(Math.round(p.profit * 100), Math.round((p.sales.revenue - p.costs.total) * 100));
        // another shop's numbers are its own
        const q = (await api(w2.owner, 'get', `/profit?from=${today}&to=${today}`)).body;
        assert.equal(q.sales.orders, 0);
        assert.equal(q.costs.total, 0);
    });

    test('bad periods are refused, and the owner can download his costs', async () => {
        assert.equal((await api(w.owner, 'get', '/profit?from=x&to=y')).status, 400);
        assert.equal((await api(w.owner, 'get', '/profit?from=2026-11-10&to=2026-11-01')).status, 400);
        await api(w.owner, 'post', '', { date: today, category: 'packaging', amountPaise: 12000 });
        const cat = await request(app).get('/api/shop/exports/catalog').set(w.owner.headers);
        assert.ok(cat.body.items.find((i) => i.key === 'shop_costs'));
        const csv = await request(app).get('/api/shop/exports/shop_costs/download').set(w.owner.headers).query({ level: 'standard', format: 'csv' }).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
        assert.match(csv.body.toString(), /packaging/i);
    });
});

describe('server setup checklist', () => {
    test('shows what is set and what is missing, never a value', async () => {
        const token = (await f.makeSuperAdmin('root@test.com')).token;
        process.env.SENTRY_DSN = 'https://secret-value@example.com/1';
        const r = await request(app).get('/api/admin/ops/setup').set({ Authorization: 'Bearer ' + token });
        assert.equal(r.status, 200);
        const ids = r.body.groups.map((g) => g.id);
        for (const k of ['secrets', 'vault', 'sms', 'payments', 'push', 'images', 'backups', 'email', 'maps']) assert.ok(ids.includes(k), k);
        assert.equal(r.body.groups.find((g) => g.id === 'errors').status, 'ok');
        assert.ok(!JSON.stringify(r.body).includes('secret-value'));
        delete process.env.SENTRY_DSN;
    });
});
