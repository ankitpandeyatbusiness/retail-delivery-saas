require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Order = require('../src/models/Order');
const SmsLog = require('../src/models/SmsLog');
const Tenant = require('../src/models/Tenant');
const SubscriptionInvoice = require('../src/models/SubscriptionInvoice');
const Counter = require('../src/models/Counter');
const PlatformSettings = require('../src/models/PlatformSettings');

// Platform health: one read-only answer, every card with a level (good / warn / bad) and a plain line.
let w; let boss; let vivyaan;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });

const AUTH = (t) => ({ Authorization: `Bearer ${t.token}` });
const health = (who = boss) => request(app).get('/api/admin/platform/health').set(AUTH(who));
const DAY = 86400000;
const ym = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);

beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('health-shop');
    boss = await f.makeSuperAdmin('boss@example.com');
    vivyaan = await f.makeSuperAdmin('vivyaan@example.com', { phones: ['9876543210'] });
});

const sms = (n, { status = 'sent', charged = 50, cost = 20, ago = 0 } = {}) => SmsLog.insertMany(Array.from({ length: n }, () => ({
    tenantId: w.tenant._id, purpose: 'otp', status, chargedPaise: charged, costPaise: cost, createdAt: new Date(Date.now() - ago),
})));

describe('the numbers', () => {
    test('SMS: last 7 days, what we paid, what we charged, the profit; old SMS are not counted; anybody with a login may look', async () => {
        await sms(10);                                         // 0.20 cost, 0.50 charged each
        await sms(5, { ago: 9 * DAY });                        // too old
        const r = await health(vivyaan);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const s = r.body.sms;
        assert.deepEqual([s.sent, s.cost, s.revenue, s.profit, s.costPerSms, s.chargedPerSms], [10, 2, 5, 3, 0.2, 0.5]);
        assert.equal(s.level, 'good');
    });

    test('SMS: three failures in 10 minutes make the platform red; a loss is red too', async () => {
        await sms(3, { status: 'failed' });
        let r = (await health()).body;
        assert.deepEqual([r.sms.failing, r.sms.level, r.overall.level], [true, 'bad', 'bad']);
        assert.match(r.overall.headline, /failing/);
        await SmsLog.deleteMany({});
        await sms(4, { charged: 10, cost: 30 });
        r = (await health()).body;
        assert.deepEqual([r.sms.profit < 0, r.sms.level], [true, 'bad']);
    });

    test('orders: today, 7 days, last month; a big fall is amber or red; cancelled orders are counted apart', async () => {
        const user = w.customer.user;
        const make = (n, ago, extra = {}) => Promise.all(Array.from({ length: n }, () => f.makeOrder(w.tenant, user, { createdAt: new Date(Date.now() - ago), ...extra })));
        await make(2, 60000);                    // today
        await make(3, 3 * DAY);                  // inside 7 days
        await make(10, 10 * DAY);                // the 7 days before
        await make(1, 60000, { status: 'cancelled' });
        const r = (await health()).body.orders;
        assert.equal(r.today, 2);
        assert.equal(r.last7, 5);
        assert.equal(r.prev7, 10);
        assert.equal(r.changePercent, -50);
        assert.equal(r.level, 'bad');
        assert.equal(r.cancelled7, 1);
    });

    test('rent: this month\'s bills paid and to collect, the money, and overdue ones turn it red', async () => {
        const base = { tenantId: w.tenant._id, kind: 'monthly', period: '2026-01', baseAmount: 1000, total: 1180, issueDate: new Date(), dueDate: new Date(Date.now() + 5 * DAY), lineItems: [] };
        const mk = (o) => SubscriptionInvoice.collection.insertOne({ ...base, ...o, invoiceNo: `T/${Math.random()}` });
        const second = await f.makeWorld('health-shop-2');
        await mk({ status: 'paid', paidAt: new Date() });
        await mk({ tenantId: second.tenant._id, status: 'pending' });
        let r = (await health()).body.rent;
        assert.deepEqual([r.billed, r.paidShops, r.collected, r.unpaidShops, r.toCollect, r.percentPaid, r.overdueBills], [2, 1, 1180, 1, 1180, 50, 0]);
        assert.equal(r.level, 'warn');                                                      // under 80% paid
        await SubscriptionInvoice.updateMany({ status: 'pending' }, { $set: { dueDate: new Date(Date.now() - 2 * DAY) } });
        r = (await health()).body.rent;
        assert.deepEqual([r.overdueBills, r.overdueAmount, r.level], [1, 1180, 'warn']);   // one late bill: look
        for (const period of ['2026-02', '2026-03']) await mk({ period, status: 'pending', dueDate: new Date(Date.now() - DAY) });
        r = (await health()).body.rent;
        assert.deepEqual([r.overdueBills, r.level], [3, 'bad']);                           // three late bills: act
    });

    test('Google: each call type apart, with its allowance; 60% amber, 90% red; the worst one decides', async () => {
        await PlatformSettings.findByIdAndUpdate('main', { $set: { 'tracking.routeProCap': 100, 'tracking.textSearchCap': 100 } }, { upsert: true });
        await require('../src/services/trackingGuard').loadedSettings?.();
        await Counter.findOneAndUpdate({ _id: `g:route_pro:${ym()}` }, { $set: { seq: 65 } }, { upsert: true });
        await Counter.findOneAndUpdate({ _id: `g:text_search:${ym()}` }, { $set: { seq: 95 } }, { upsert: true });
        const g = (await health()).body.google;
        const by = Object.fromEntries(g.apis.map((a) => [a.key, a]));
        assert.ok(by.route_pro && by.route_ess && by.text_search && by.autocomplete && by.details);
        assert.ok(['good', 'warn', 'bad'].includes(g.level));
        assert.ok(g.notMetered.length > 0);
    });

    test('shops: free and paid counts; quiet live shops; support waiting', async () => {
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'billing.isLive': true, 'billing.state': 'paying' } });
        const r = (await health()).body;
        assert.deepEqual([r.shops.total, r.shops.paying, r.shops.paid, r.shops.free], [1, 1, 1, 0]);
        assert.deepEqual([r.quiet.live, r.quiet.quiet], [1, 1]);                          // a live shop with no order for 14 days
        assert.equal(r.quiet.level, 'bad');
        assert.equal(r.support.open, 0);
        assert.ok(r.needsYou.some((x) => x.key === 'quiet'));
        assert.ok(Array.isArray(r.notTracked));
    });
});
