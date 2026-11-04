require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeTenant, makeUser, makeOrder, makeSuperAdmin } = require('./helpers/factory');
const User = require('../src/models/User');
const Session = require('../src/models/Session');
const Order = require('../src/models/Order');
const tokenService = require('../src/services/tokenService');
const panel = require('../src/services/brandPanel');

const OWNER = '9855555555';
let supreme;
const post = (url, body) => request(app).post(url).set({ Authorization: `Bearer ${supreme}` }).send(body);

before(async () => { await db.connect(); });
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    supreme = (await makeSuperAdmin('boss@example.com')).token;
});

async function login(tenantId, phone) {
    const user = await User.findOne({ tenantId, phone });
    const sid = new mongoose.Types.ObjectId();
    const { accessToken } = tokenService.generateTokens({ userId: user._id, tenantId, sessionId: sid });
    await Session.create({ _id: sid, userId: user._id, tenantId, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600000) });
    return accessToken;
}

async function setup() {
    const brand = (await post('/api/admin/brands', { name: 'Savera' })).body.brand;
    const out = [];
    for (const c of ['delhi', 'mumbai']) {
        out.push((await post(`/api/admin/brands/${brand._id}/branches`, { name: `Savera ${c}`, slug: `savera-${c}`, city: c })).body.branch);
    }
    await post(`/api/admin/brands/${brand._id}/owners`, { phone: OWNER });
    const api = async (path, slug = out[0].slug) => request(app).get(`/api/brand${path}`).set('x-tenant-slug', slug)
        .set('Authorization', `Bearer ${await login(out.find((b) => b.slug === slug).id, OWNER)}`);
    return { brand, out, api };
}

let seq = 0;
async function orderAt(branch, { status = 'delivered', total = 100, daysAgo = 0 } = {}) {
    const tenant = await require('../src/models/Tenant').findById(branch.id);
    const cust = await makeUser(tenant, 'customer', `9${String(100000000 + ++seq)}`);
    const o = await makeOrder(tenant, cust.user, { status, pricing: { subtotal: total, total } });
    if (daysAgo) await Order.collection.updateOne({ _id: o._id }, { $set: { createdAt: new Date(Date.now() - daysAgo * 86400000) } });   // raw: createdAt is locked in Mongoose
    return o;
}

describe('the All branches panel', () => {
    test('overview: one row per branch and the brand totals', async () => {
        const { out, api } = await setup();
        await orderAt(out[0], { total: 200 });
        await orderAt(out[0], { total: 300 });
        await orderAt(out[0], { status: 'cancelled', total: 999 });
        await orderAt(out[1], { total: 500 });
        await orderAt(out[1], { status: 'preparing', total: 150 });
        await orderAt(out[1], { total: 700, daysAgo: 3 });   // outside "today"

        const today = await api('/overview?range=today');
        assert.equal(today.status, 200, JSON.stringify(today.body));
        const [delhi, mumbai] = today.body.branches;
        assert.equal(delhi.slug, 'savera-delhi');
        assert.deepEqual([delhi.orders, delhi.delivered, delhi.cancelled, delhi.sales, delhi.avgOrder], [3, 2, 1, 500, 250]);
        assert.deepEqual([mumbai.orders, mumbai.delivered, mumbai.activeNow, mumbai.sales], [2, 1, 1, 500]);
        assert.deepEqual([today.body.totals.orders, today.body.totals.sales, today.body.totals.activeNow], [5, 1000, 1]);

        const week = await api('/overview?range=7');
        assert.equal(week.body.totals.sales, 1700);   // the 3-day-old sale is inside 7 days
        assert.equal((await api('/overview?range=nope')).status, 400);
    });

    test('orders: every branch labelled, or one branch, with a status filter', async () => {
        const { out, api } = await setup();
        await orderAt(out[0]);
        await orderAt(out[1]);
        await orderAt(out[1], { status: 'cancelled' });

        const all = await api('/orders');
        assert.equal(all.status, 200, JSON.stringify(all.body));
        assert.equal(all.body.items.length, 3);
        assert.deepEqual([...new Set(all.body.items.map((i) => i.branch.slug))].sort(), ['savera-delhi', 'savera-mumbai']);

        const one = await api('/orders?branch=savera-mumbai&status=delivered');
        assert.equal(one.body.items.length, 1);
        assert.equal(one.body.items[0].branch.name, 'Savera mumbai');
        assert.equal((await api('/orders?branch=elsewhere')).status, 404);
        assert.equal((await api('/orders?status=weird')).status, 400);
    });

    test('a manager who is not a brand owner cannot read the combined panel; a normal shop has no panel', async () => {
        const { out } = await setup();
        await post(`/api/admin/tenants/${out[0].id}/owners`, { phone: '9888888888' });
        const t = await login(out[0].id, '9888888888');
        const get = (slug, tok, p) => request(app).get(`/api/brand${p}`).set('x-tenant-slug', slug).set('Authorization', `Bearer ${tok}`);
        assert.equal((await get(out[0].slug, t, '/overview')).status, 403);
        assert.equal((await get(out[0].slug, t, '/orders')).status, 403);
        const solo = await makeTenant('solo-panel');
        await makeUser(solo, 'admin', '9777777777');
        assert.equal((await get(solo.slug, await login(solo._id, '9777777777'), '/overview')).status, 403);
    });

    test('range helper: today and a month are cut at India midnight', () => {
        const r = panel.rangeOf('2026-10', new Date('2026-10-15T10:00:00Z'));
        assert.equal(r.from.toISOString(), '2026-09-30T18:30:00.000Z');
        assert.equal(r.to.toISOString(), '2026-10-31T18:30:00.000Z');
        const t = panel.rangeOf('today', new Date('2026-10-15T20:00:00Z'));   // already 16 Oct 01:30 in India
        assert.equal(t.from.toISOString(), '2026-10-15T18:30:00.000Z');
    });
});
