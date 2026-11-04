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
const User = require('../src/models/User');
const Session = require('../src/models/Session');
const PlatformSettings = require('../src/models/PlatformSettings');
const tokenService = require('../src/services/tokenService');
const rentSummary = require('../src/services/rentSummary');

let supreme;
const as = (t) => ({ Authorization: `Bearer ${t}` });
const post = (url, body) => request(app).post(url).set(as(supreme)).send(body);

before(async () => { await db.connect(); });
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    supreme = (await makeSuperAdmin('boss@example.com')).token;
});

let seq = 800000;
const bulk = (t, user, n) => Order.insertMany(Array.from({ length: n }, () => ({
    tenantId: t._id, userId: user._id, orderNo: ++seq, status: 'delivered', orderType: 'delivery',
    items: [{ productId: new mongoose.Types.ObjectId(), name: 'Item', quantity: 1, unitPrice: 100, lineTotal: 100 }],
    pricing: { subtotal: 100, total: 100 }, payment: { method: 'cod' }, billing: { billable: true, at: new Date() },
})));

// two live branches past the free period, 306 orders each this month (tier Rs 6000), a 10% brand discount
async function setup() {
    const brand = (await post('/api/admin/brands', { name: 'Savera' })).body.brand;
    const out = [];
    for (const c of ['delhi', 'mumbai']) {
        const b = (await post(`/api/admin/brands/${brand._id}/branches`, { name: `Savera ${c}`, slug: `savera-${c}`, city: c })).body.branch;
        await Tenant.updateOne({ _id: b.id }, { $set: { billing: { isLive: true, state: 'active', goLiveAt: new Date('2025-01-10T00:00:00Z'), billableCount: 500 } } });
        const t = await Tenant.findById(b.id);
        const cust = await makeUser(t, 'customer', `9${100000000 + out.length}`);
        await bulk(t, cust.user, 306);
        out.push(b);
        await new Promise((ok) => setTimeout(ok, 15));
    }
    await post(`/api/admin/brands/${brand._id}`, {}).catch(() => null);
    await request(app).put(`/api/admin/brands/${brand._id}`).set(as(supreme)).send({ discountPercent: 10 });
    await PlatformSettings.findByIdAndUpdate('main', { $set: { 'business.legalName': 'Acme Pvt Ltd', 'business.gstin': '22AAAAA0000A1Z5' } }, { upsert: true });
    return { brand, out };
}
async function ownerToken(tenantId, phone) {
    await post(`/api/admin/tenants/${tenantId}/owners`, { phone });
    const user = await User.findOne({ tenantId, phone });
    const sid = new mongoose.Types.ObjectId();
    const { accessToken } = tokenService.generateTokens({ userId: user._id, tenantId, sessionId: sid });
    await Session.create({ _id: sid, userId: user._id, tenantId, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600000) });
    return accessToken;
}

describe('the rent preview shows the multi-branch discount', () => {
    test('the superadmin preview: the 2nd branch shows the discount and GST on the lower amount; the first branch does not', async () => {
        const { out } = await setup();
        const shops = await Tenant.find({ _id: { $in: out.map((b) => b.id) } }).sort({ createdAt: 1 }).lean();
        const rents = await rentSummary.forShops(shops);
        const first = rents.get(String(shops[0]._id)).next;
        const second = rents.get(String(shops[1]._id)).next;
        assert.deepEqual([first.fee, first.discount.amount, first.gst, first.total], [6000, 0, 1080, 7080]);
        assert.deepEqual([second.fee, second.discount.amount, second.discount.percent, second.gst, second.total], [6000, 600, 10, 972, 6372]);   // (6000 - 600) + 18% GST
        assert.match(rents.get(String(shops[1]._id)).text, /10% multi-branch discount/);
        assert.doesNotMatch(rents.get(String(shops[0]._id)).text, /discount/);

        // the same numbers the superadmin's shop list and shop page return
        const list = await request(app).get('/api/admin/tenants').set(as(supreme));
        const row = list.body.items.find((i) => i._id === String(shops[1]._id));
        assert.equal(row.rent.next.discount.amount, 600);
        const one = await request(app).get(`/api/admin/tenants/${shops[1]._id}`).set(as(supreme));
        assert.equal(one.body.rent.next.total, 6372);
    });

    test('the owner screen: this month and next bill show the discount; the first branch and a normal shop show none', async () => {
        const { out } = await setup();
        const get = (slug, tok) => request(app).get('/api/shop/billing/status').set('x-tenant-slug', slug).set('Authorization', `Bearer ${tok}`);
        const mumbai = (await get('savera-mumbai', await ownerToken(out[1].id, '9866666666'))).body;
        assert.equal(mumbai.thisMonth.fee, 6000);
        assert.deepEqual([mumbai.thisMonth.discount, mumbai.thisMonth.discountPercent, mumbai.thisMonth.feeAfterDiscount], [600, 10, 5400]);
        const delhi = (await get('savera-delhi', await ownerToken(out[0].id, '9877777777'))).body;
        assert.deepEqual([delhi.thisMonth.discount, delhi.thisMonth.feeAfterDiscount], [0, 6000]);

        const solo = await makeTenant('solo-preview', { billing: { isLive: true, state: 'active', goLiveAt: new Date('2025-01-10T00:00:00Z'), billableCount: 500 } });
        const o = await makeUser(solo, 'admin', '9855555551');
        const s = (await get('solo-preview', o.accessToken)).body;
        assert.deepEqual([s.thisMonth.discount, s.thisMonth.feeAfterDiscount], [0, s.thisMonth.fee]);
    });

    test('the preview matches the real bill: the same discount and the same total once the month is invoiced', async () => {
        const { out } = await setup();
        const { generateForPeriod } = require('../src/services/subscriptionService');
        const SubscriptionInvoice = require('../src/models/SubscriptionInvoice');
        // bills are made for finished months: move this month's orders to a past month and bill it
        await Order.collection.updateMany({}, { $set: { 'billing.at': new Date('2025-06-15T10:00:00Z') } });
        await generateForPeriod({ period: '2025-06' });
        const inv = await SubscriptionInvoice.findOne({ tenantId: out[1].id, period: '2025-06' }).lean();
        assert.equal(inv.baseAmount, 5400);
        assert.equal(inv.total, 6372);   // what the preview said: 5400 + 972 GST
    });
});
