require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeSuperAdmin } = require('./helpers/factory');
const SubscriptionInvoice = require('../src/models/SubscriptionInvoice');
const User = require('../src/models/User');
const Session = require('../src/models/Session');
const tokenService = require('../src/services/tokenService');

let supreme;
let plain;
const as = (t) => ({ Authorization: `Bearer ${t}` });
const post = (url, body) => request(app).post(url).set(as(supreme)).send(body);
// supertest: collect the PDF bytes
const binary = (req) => req.buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });

before(async () => { await db.connect(); });
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    supreme = (await makeSuperAdmin('boss@example.com')).token;
    plain = (await makeSuperAdmin('other@example.com', { phones: ['9000000077'] })).token;
});

let n = 0;
async function setup() {
    const brand = (await post('/api/admin/brands', { name: 'Savera', branchLimit: 4 })).body.brand;
    const out = [];
    for (const c of ['delhi', 'mumbai']) out.push((await post(`/api/admin/brands/${brand._id}/branches`, { name: `Savera ${c}`, slug: `savera-${c}`, city: c })).body.branch);
    const bill = (b, base, discount) => SubscriptionInvoice.create({
        tenantId: b.id, kind: 'monthly', period: '2025-06', invoiceNo: `SUB/2025-26/${String(++n).padStart(4, '0')}`,
        issueDate: new Date(), dueDate: new Date(Date.now() + 7 * 86400000), graceEndsAt: new Date(Date.now() + 5 * 86400000),
        lineItems: [{ description: 'Rent', qty: 1, rate: 6000, amount: 6000 }, ...(discount ? [{ description: 'Multi-branch discount 10%', qty: 1, rate: -discount, amount: -discount }] : [])],
        orderCount: 306, baseAmount: base, gstPercent: 18, gstAmount: Math.round(base * 0.18 * 100) / 100, total: Math.round(base * 1.18 * 100) / 100,
        seller: { legalName: 'Acme Pvt Ltd' }, buyer: { legalName: 'Savera' },
    });
    await bill(out[0], 6000, 0);
    await bill(out[1], 5400, 600);
    await post(`/api/admin/brands/${brand._id}/owners`, { phone: '9855555555' });
    return { brand, out };
}

describe('the brand statement as a PDF', () => {
    test('the superadmin and the brand owner get a real PDF; the file is named after the brand and the month', async () => {
        const w = await setup();
        const a = await binary(request(app).get(`/api/admin/brands/${w.brand._id}/statement.pdf?period=2025-06`).set(as(plain)));
        assert.equal(a.status, 200);
        assert.match(a.headers['content-type'], /application\/pdf/);
        assert.match(a.headers['content-disposition'], /attachment; filename="Statement-Savera-2025-06\.pdf"/);
        assert.equal(a.body.slice(0, 5).toString(), '%PDF-');
        assert.ok(a.body.length > 1500);

        const owner = await User.findOne({ tenantId: w.out[0].id, phone: '9855555555' });
        const sid = new mongoose.Types.ObjectId();
        const { accessToken } = tokenService.generateTokens({ userId: owner._id, tenantId: w.out[0].id, sessionId: sid });
        await Session.create({ _id: sid, userId: owner._id, tenantId: w.out[0].id, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600000) });
        const b = await binary(request(app).get('/api/brand/statement.pdf?period=2025-06&view=1').set('x-tenant-slug', 'savera-delhi').set('Authorization', `Bearer ${accessToken}`));
        assert.equal(b.status, 200);
        assert.match(b.headers['content-disposition'], /^inline;/);
        assert.equal(b.body.slice(0, 5).toString(), '%PDF-');
    });

    test('a month without bills still gives a PDF; a bad month is refused; a branch manager and a stranger are refused', async () => {
        const w = await setup();
        const empty = await binary(request(app).get(`/api/admin/brands/${w.brand._id}/statement.pdf?period=2024-01`).set(as(plain)));
        assert.equal(empty.status, 200);
        assert.equal(empty.body.slice(0, 5).toString(), '%PDF-');
        assert.equal((await request(app).get(`/api/admin/brands/${w.brand._id}/statement.pdf?period=nope`).set(as(plain))).status, 400);

        await post(`/api/admin/tenants/${w.out[0].id}/owners`, { phone: '9866666666' });
        const mgr = await User.findOne({ tenantId: w.out[0].id, phone: '9866666666' });
        const sid = new mongoose.Types.ObjectId();
        const { accessToken } = tokenService.generateTokens({ userId: mgr._id, tenantId: w.out[0].id, sessionId: sid });
        await Session.create({ _id: sid, userId: mgr._id, tenantId: w.out[0].id, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600000) });
        assert.equal((await request(app).get('/api/brand/statement.pdf?period=2025-06').set('x-tenant-slug', 'savera-delhi').set('Authorization', `Bearer ${accessToken}`)).status, 403);
        assert.equal((await request(app).get(`/api/admin/brands/${w.brand._id}/statement.pdf?period=2025-06`)).status, 401);
    });
});
