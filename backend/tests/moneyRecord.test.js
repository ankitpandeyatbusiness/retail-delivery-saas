require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Tenant = require('../src/models/Tenant');
const PlatformSettings = require('../src/models/PlatformSettings');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const Brand = require('../src/models/Brand');
const topups = require('../src/services/smsTopupService');

// The monthly money record: what each shop paid, grouped under its brand, the developer's part (50% of a shop Vivyaan brought, 70% of one he brought),
// and his yes / no per shop and month. Only a record: nothing is owed, nothing is due.
let a; let b; let boss; let vivyaan;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });

const AUTH = (t) => ({ Authorization: `Bearer ${t.token}` });
const api = (m, url, who, body) => request(app)[m](`/api/admin${url}`).set(AUTH(who)).send(body);
const thisMonth = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);

beforeEach(async () => {
    await db.clear();
    a = await f.makeWorld('mr-shop-a');
    b = await f.makeWorld('mr-shop-b');
    tenantRecognizer.invalidateTenant('mr-shop-a'); tenantRecognizer.invalidateTenant('mr-shop-b');
    boss = await f.makeSuperAdmin('boss@example.com');                                          // the supreme admin (the developer)
    vivyaan = await f.makeSuperAdmin('vivyaan@example.com', { phones: ['9876543210'] });       // Vivyaan's login: reads only
    await PlatformSettings.findByIdAndUpdate('main', { $set: { 'business.legalName': 'Operator Pvt Ltd', 'business.gstin': '09AAAAA0000A1Z5', 'business.state': 'Uttar Pradesh', 'business.stateCode': '09' } }, { upsert: true });
});

const paid = async (w, rate) => {
    const inv = (await api('post', `/tenants/${w.tenant._id}/invoices/custom`, boss, { lineItems: [{ description: 'Rent', qty: 1, rate }] })).body;
    const r = await api('patch', `/subscriptions/invoices/${inv._id}/status`, boss, { status: 'paid', paymentMode: 'bank_transfer' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
};
const find = (view, tid) => view.groups.flatMap((g) => g.shops).find((s) => s.tenantId === String(tid));

describe('the month', () => {
    test('shops are listed under their brand, a single shop by itself; rent and SMS top-ups are lines; the part follows who brought the shop', async () => {
        const brand = await Brand.create({ name: 'Savera' });
        await Tenant.updateOne({ _id: a.tenant._id }, { $set: { brandId: brand._id, branchCity: 'Delhi', broughtBy: 'owner' } });   // the developer brought it: 70%
        await paid(a, 3000);
        const t = await topups.create({ tenantId: a.tenant._id, amountPaise: 20000, actor: { type: 'owner' } });
        await topups.complete({ topupId: t._id, paymentId: 'pay_mr_1', actor: { type: 'system' } });
        await paid(b, 1000);                                                                 // no brand, nobody marked: Vivyaan's, 50%

        const v = (await api('get', `/money-record?month=${thisMonth()}`, vivyaan)).body;   // Vivyaan's login can read
        assert.equal(v.groups.length, 2);
        const savera = v.groups.find((g) => g.name === 'Savera');
        assert.equal(savera.shops.length, 1);
        const sa = savera.shops[0];
        assert.deepEqual([sa.base, sa.pct, sa.yourPart, sa.state], [3200, 70, 2240, 'open']);   // 3000 + 200 top-up, before GST
        assert.deepEqual(sa.lines.map((l) => l.kind).sort(), ['other', 'topup']);
        const alone = find(v, b.tenant._id);
        assert.deepEqual([alone.base, alone.pct, alone.yourPart], [1000, 50, 500]);
        assert.deepEqual([v.totals.base, v.totals.yourPart, v.totals.shops, v.totals.open], [4200, 2740, 2, 2]);

        assert.equal((await api('get', '/money-record?month=2026-13', vivyaan)).status, 400);
        const empty = (await api('get', '/money-record?month=2001-01', vivyaan)).body;
        assert.deepEqual([empty.groups.length, empty.totals.shops], [0, 0]);
    });
});

describe('did you get your part?', () => {
    test('yes settles it; no needs a reason; only the supreme admin answers', async () => {
        await paid(a, 1000);
        await paid(b, 2000);
        const body = { month: thisMonth(), tenantId: String(a.tenant._id), got: true };
        assert.equal((await api('put', '/money-record/check', vivyaan, body)).status, 403);
        const yes = await api('put', '/money-record/check', boss, body);
        assert.equal(yes.status, 200, JSON.stringify(yes.body));
        assert.deepEqual([yes.body.state, yes.body.check.got], ['yes', true]);

        assert.equal((await api('put', '/money-record/check', boss, { month: thisMonth(), tenantId: String(b.tenant._id), got: false })).status, 400);   // a reason is needed
        const no = await api('put', '/money-record/check', boss, { month: thisMonth(), tenantId: String(b.tenant._id), got: false, reason: 'Vivyaan will send it on the 20th' });
        assert.deepEqual([no.body.state, no.body.check.reason], ['no', 'Vivyaan will send it on the 20th']);

        const v = (await api('get', `/money-record?month=${thisMonth()}`, vivyaan)).body;
        assert.deepEqual([v.totals.yes, v.totals.no, v.totals.open], [1, 1, 0]);
        assert.equal((await api('put', '/money-record/check', boss, { month: thisMonth(), tenantId: String(a.tenant._id), got: 'yes' })).status, 400);
        assert.equal((await api('put', '/money-record/check', boss, { month: '2001-01', tenantId: String(a.tenant._id), got: true })).status, 409);   // paid nothing then
    });

    test('a later payment, or a changed "brought by", asks again', async () => {
        await paid(a, 1000);
        await api('put', '/money-record/check', boss, { month: thisMonth(), tenantId: String(a.tenant._id), got: true });
        await paid(a, 500);
        assert.equal(find((await api('get', `/money-record?month=${thisMonth()}`, vivyaan)).body, a.tenant._id).state, 'again');
        await api('put', '/money-record/check', boss, { month: thisMonth(), tenantId: String(a.tenant._id), got: true });
        assert.equal(find((await api('get', `/money-record?month=${thisMonth()}`, vivyaan)).body, a.tenant._id).state, 'yes');

        assert.equal((await api('put', `/money-record/shops/${a.tenant._id}/brought-by`, vivyaan, { broughtBy: 'owner' })).status, 403);
        const r = await api('put', `/money-record/shops/${a.tenant._id}/brought-by`, boss, { broughtBy: 'owner' });
        assert.deepEqual([r.status, r.body.pct], [200, 70]);
        const s = find((await api('get', `/money-record?month=${thisMonth()}`, vivyaan)).body, a.tenant._id);
        assert.deepEqual([s.state, s.pct, s.yourPart], ['again', 70, 1050]);
        assert.equal((await api('put', `/money-record/shops/${a.tenant._id}/brought-by`, boss, { broughtBy: 'me' })).status, 400);
    });
});
