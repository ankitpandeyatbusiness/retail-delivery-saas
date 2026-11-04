require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeTenant, makeUser, makeSuperAdmin } = require('./helpers/factory');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const Brand = require('../src/models/Brand');
const SubscriptionInvoice = require('../src/models/SubscriptionInvoice');
const PlatformSettings = require('../src/models/PlatformSettings');
const SmsWallet = require('../src/models/SmsWallet');
const SmsLog = require('../src/models/SmsLog');
const wallet = require('../src/services/smsWalletService');
const { generateForPeriod } = require('../src/services/subscriptionService');

let supreme;
let plain;
const as = (t) => ({ Authorization: `Bearer ${t}` });
const post = (url, body, t = supreme) => request(app).post(url).set(as(t)).send(body);
const put = (url, body, t = supreme) => request(app).put(url).set(as(t)).send(body);

before(async () => { await db.connect(); });
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    wallet.refreshPlatform();
    wallet.forgetHolders();
    process.env.SMS_WALLET_IN_MOCK = 'true';
    supreme = (await makeSuperAdmin('boss@example.com')).token;
    plain = (await makeSuperAdmin('other@example.com', { phones: ['9000000077'] })).token;
});

let seq = 700000;
const bulk = (t, user, n, at) => Order.insertMany(Array.from({ length: n }, () => ({
    tenantId: t._id, userId: user._id, orderNo: ++seq, status: 'delivered', orderType: 'delivery',
    items: [{ productId: new mongoose.Types.ObjectId(), name: 'Item', quantity: 1, unitPrice: 100, lineTotal: 100 }],
    pricing: { subtotal: 100, total: 100 }, payment: { method: 'cod' }, billing: { billable: true, at },
})));

// a brand of three LIVE branches that are past the free period, each with 306 orders in June 2025 (tier 6000)
async function brandOfThree() {
    const brand = (await post('/api/admin/brands', { name: 'Savera' })).body.brand;
    const out = [];
    for (const c of ['delhi', 'mumbai', 'goa']) {
        const r = await post(`/api/admin/brands/${brand._id}/branches`, { name: `Savera ${c}`, slug: `savera-${c}`, city: c });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        await Tenant.updateOne({ _id: r.body.branch.id }, { $set: { billing: { isLive: true, state: 'active', goLiveAt: new Date('2025-01-10T00:00:00Z'), billableCount: 500 } } });
        const t = await Tenant.findById(r.body.branch.id);
        const cust = await makeUser(t, 'customer', `9${100000000 + out.length}`);
        await bulk(t, cust.user, 306, new Date('2025-06-15T10:00:00Z'));
        out.push(r.body.branch);
        await new Promise((ok) => setTimeout(ok, 15));   // branches get distinct creation times
    }
    await PlatformSettings.findByIdAndUpdate('main', { $set: { 'business.legalName': 'Acme Pvt Ltd' } }, { upsert: true });
    return { brand, out };
}

describe('multi-branch discount', () => {
    test('the 2nd branch onward gets the brand discount on the rent, shown as its own line; the first branch pays full', async () => {
        const { brand, out } = await brandOfThree();
        assert.equal((await put(`/api/admin/brands/${brand._id}`, { discountPercent: 10 })).status, 200);
        const r = await generateForPeriod({ period: '2025-06' });
        assert.equal(r.created, 3, JSON.stringify(r));

        const inv = async (b) => SubscriptionInvoice.findOne({ tenantId: b.id, period: '2025-06' }).lean();
        const [a, b, c] = [await inv(out[0]), await inv(out[1]), await inv(out[2])];
        assert.deepEqual([a.baseAmount, a.lineItems.length], [6000, 1]);                 // main branch: no discount
        assert.deepEqual([b.baseAmount, b.total], [5400, 5400]);                           // 6000 - 10%
        assert.equal(b.lineItems.length, 2);
        assert.equal(b.lineItems[1].amount, -600);
        assert.match(b.lineItems[1].description, /Multi-branch discount 10%/);
        assert.equal(c.baseAmount, 5400);
    });

    test('a discount can never go above the platform cap; the supreme admin can change the cap and the suggestion; others cannot', async () => {
        const { brand } = await brandOfThree();
        assert.deepEqual((await request(app).get('/api/admin/brands/settings').set(as(plain))).body, { defaultDiscountPercent: 10, maxDiscountPercent: 15 });
        assert.equal((await put(`/api/admin/brands/${brand._id}`, { discountPercent: 20 })).status, 400);
        assert.equal((await put('/api/admin/brands/settings', { maxDiscountPercent: 20 }, plain)).status, 403);
        assert.equal((await put('/api/admin/brands/settings', { maxDiscountPercent: 20, defaultDiscountPercent: 12 })).status, 200);
        assert.equal((await put(`/api/admin/brands/${brand._id}`, { discountPercent: 20 })).status, 200);
        assert.equal((await put('/api/admin/brands/settings', { maxDiscountPercent: 5 })).status, 400);   // the suggestion (12) would be above it
        assert.equal((await put(`/api/admin/brands/${brand._id}`, { discountPercent: 0 })).status, 200);     // 0 = off
        assert.equal((await put(`/api/admin/brands/${brand._id}`, { discountPercent: 'x' })).status, 400);
    });

    test('with the discount off, or for a shop that is not a branch, the bill is the plain tier fee', async () => {
        const { out } = await brandOfThree();
        await generateForPeriod({ period: '2025-06' });
        assert.equal((await SubscriptionInvoice.findOne({ tenantId: out[1].id, period: '2025-06' })).baseAmount, 6000);

        const solo = await makeTenant('solo-bill', { billing: { isLive: true, state: 'active', goLiveAt: new Date('2025-01-10T00:00:00Z'), billableCount: 500 } });
        const cust = await makeUser(solo, 'customer', '9300000001');
        await bulk(solo, cust.user, 306, new Date('2025-06-15T10:00:00Z'));
        await generateForPeriod({ period: '2025-06', tenantId: solo._id });
        assert.equal((await SubscriptionInvoice.findOne({ tenantId: solo._id, period: '2025-06' })).baseAmount, 6000);
    });
});

describe('the brand statement', () => {
    test('a line per branch, the discount, totals, unpaid and the SMS used per branch', async () => {
        const { brand, out } = await brandOfThree();
        await put(`/api/admin/brands/${brand._id}`, { discountPercent: 10 });
        await generateForPeriod({ period: '2025-06' });
        await SubscriptionInvoice.updateOne({ tenantId: out[0].id, period: '2025-06' }, { $set: { status: 'paid' } });
        // two SMS sent for Mumbai in June 2025
        const june = new Date('2025-06-20T10:00:00Z');
        for (let i = 0; i < 2; i += 1) await SmsLog.collection.insertOne({ tenantId: new mongoose.Types.ObjectId(out[1].id), purpose: 'otp', status: 'sent', chargedPaise: 30, createdAt: june });

        const res = await request(app).get(`/api/admin/brands/${brand._id}/statement?period=2025-06`).set(as(plain));
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const s = res.body;
        assert.equal(s.branches.length, 3);
        assert.deepEqual([s.totals.invoices, s.totals.rent, s.totals.discount, s.totals.total], [3, 18000, 1200, 16800]);
        assert.deepEqual([s.totals.unpaidCount, s.totals.unpaid], [2, 10800]);
        assert.equal(s.branches[1].invoice.discount, 600);
        assert.equal(s.branches[1].sms.count, 2);
        assert.equal(s.totals.smsCount, 2);
        assert.equal((await request(app).get(`/api/admin/brands/${brand._id}/statement?period=nope`).set(as(plain))).status, 400);
    });
});

describe('one SMS wallet for the whole brand', () => {
    test('every branch uses the same wallet: a top-up at one shows at all, a debit at one lowers all, and the ledger balances', async () => {
        const { brand, out } = await brandOfThree();
        const [a, b, c] = out.map((x) => x.id);
        await wallet.credit({ tenantId: b, amountPaise: 10000, type: 'adjust', note: 'test', actor: { type: 'system' } });
        for (const id of [a, b, c]) assert.equal((await wallet.status(id)).balancePaise, 10000);

        const d = await wallet.debitForSms(c, { purpose: 'otp' });
        assert.equal(d.ok, true);
        for (const id of [a, b, c]) assert.equal((await wallet.status(id)).balancePaise, 10000 - d.chargedPaise);
        assert.equal(await SmsWallet.countDocuments({}), 1);                          // one wallet document, not three
        for (const id of [a, b, c]) assert.equal((await wallet.reconcileWallet(id)).differencePaise, 0);

        await wallet.refund(d.txnId);
        assert.equal((await wallet.status(a)).balancePaise, 10000);
        assert.equal((await wallet.reconcileWallet(a)).differencePaise, 0);

        // a shop that is not a branch keeps its own wallet
        const solo = await makeTenant('solo-wallet');
        await wallet.credit({ tenantId: solo._id, amountPaise: 500, type: 'adjust', actor: { type: 'system' } });
        assert.equal((await wallet.status(solo._id)).balancePaise, 500);
        assert.equal((await wallet.status(a)).balancePaise, 10000);
        assert.equal((await Brand.findById(brand._id)).smsWalletTenantId.toString(), String(a));   // the oldest branch holds it
    });

    test('a shop that joins brings its money into the brand wallet; the wallet branch leaving hands the money on', async () => {
        const { brand, out } = await brandOfThree();
        await wallet.credit({ tenantId: out[0].id, amountPaise: 8000, type: 'adjust', actor: { type: 'system' } });

        const old = await makeTenant('old-shop');
        await wallet.credit({ tenantId: old._id, amountPaise: 2500, type: 'adjust', actor: { type: 'system' } });
        const j = await post(`/api/admin/brands/${brand._id}/branches`, { tenantId: String(old._id), city: 'Pune' });
        assert.equal(j.status, 201, JSON.stringify(j.body));
        wallet.forgetHolders();
        assert.equal((await wallet.status(out[0].id)).balancePaise, 10500);              // 8000 + 2500
        assert.equal((await SmsWallet.findOne({ tenantId: old._id })).balancePaise, 0);
        for (const id of [out[0].id, String(old._id)]) assert.equal((await wallet.reconcileWallet(id)).differencePaise, 0);

        // the wallet branch (the oldest) leaves: the next branch holds the money
        const gone = await request(app).delete(`/api/admin/brands/${brand._id}/branches/${out[0].id}`).set(as(supreme));
        assert.equal(gone.status, 200);
        wallet.forgetHolders();
        assert.equal((await wallet.status(out[1].id)).balancePaise, 10500);
        assert.equal((await wallet.status(out[0].id)).balancePaise, 0);                  // it is a normal shop again with an empty wallet
        for (const id of [out[0].id, out[1].id]) assert.equal((await wallet.reconcileWallet(id)).differencePaise, 0);
    });
});
