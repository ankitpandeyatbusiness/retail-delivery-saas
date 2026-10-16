require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Product = require('../src/models/Product');
const Category = require('../src/models/Category');
const Review = require('../src/models/Review');
const SubscriptionInvoice = require('../src/models/SubscriptionInvoice');
const PlatformSettings = require('../src/models/PlatformSettings');
const { buildTips, quoteFor } = require('../src/services/businessTips');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');

// The shop's progress report: numbers, comparison with the period before, customers, food, riders, the app's value, tips.
let w; let cat; let paneer; let laddu;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('rep-shop');
    tenantRecognizer.invalidateTenant('rep-shop');
    cat = await Category.create({ tenantId: w.tenant._id, name: 'Food' });
    paneer = await Product.create({ tenantId: w.tenant._id, categoryId: cat._id, name: 'Paneer Tikka', price: 200, isVeg: true });
    laddu = await Product.create({ tenantId: w.tenant._id, categoryId: cat._id, name: 'Laddu', price: 50, isVeg: true, createdAt: new Date(Date.now() - 200 * 86400000) });
});

const daysAgo = (n, hour = 20) => { const d = new Date(Date.now() - n * 86400000); d.setHours(hour, 0, 0, 0); return d; };
const sale = (user, p, qty, when, extra = {}) => f.makeOrder(w.tenant, user, {
    status: 'delivered', deliveredAt: when, createdAt: when, userId: user._id,
    items: [{ productId: p._id, name: p.name, quantity: qty, unitPrice: p.price, lineTotal: p.price * qty }],
    pricing: { subtotal: p.price * qty, total: p.price * qty }, ...extra,
});
const get = (q = '') => request(app).get(`/api/shop/business-report${q}`).set(w.owner.headers);

describe('the report', () => {
    test('an empty shop gets a calm report and one gentle tip', async () => {
        const r = await get();
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.totals.orders, 0);
        assert.equal(r.body.series.points.length, 30);
        assert.equal(r.body.tips.length, 1);
        assert.equal(r.body.tips[0].id, 'no-sales');
        assert.ok(r.body.quote.length > 10);
    });

    test('sales, the comparison with the period before, and the chart', async () => {
        const c1 = w.customer.user;
        await sale(c1, paneer, 2, daysAgo(1));       // 400 this week
        await sale(c1, paneer, 1, daysAgo(3));       // 200
        await sale(c1, laddu, 4, daysAgo(10));       // 200, in the week before
        const r = await get('?range=7');
        assert.equal(r.body.totals.orders, 2);
        assert.equal(r.body.totals.revenue, 600);
        assert.equal(r.body.totals.avgOrder, 300);
        assert.equal(r.body.previous.orders, 1);
        assert.equal(r.body.previous.revenue, 200);
        assert.equal(r.body.change.revenue, 200);
        assert.equal(r.body.series.kind, 'day');
        assert.equal(r.body.series.points.length, 7);
        assert.equal(r.body.series.points.reduce((a, p) => a + p.revenue, 0), 600);
        assert.equal(r.body.food.top[0].name, 'Paneer Tikka');
        assert.equal(r.body.food.top[0].quantity, 3);
        assert.equal(r.body.busiest.hour, 20);
        assert.equal(r.body.busiest.hourLabel, '8 PM');
    });

    test('90 days is drawn by week, and a month by its number', async () => {
        assert.equal((await get('?range=90')).body.series.kind, 'week');
        const m = new Date().toISOString().slice(0, 7);
        const r = await get(`?range=${m}`);
        assert.equal(r.status, 200);
        assert.ok(r.body.range.label.length > 4);
        assert.equal((await get('?range=5')).status, 400);
        assert.equal((await get('?range=2026-13')).status, 400);
    });

    test('customers: new and returning, repeat rate, the best customers', async () => {
        const second = await f.makeUser(w.tenant, 'customer', '9000000031');
        await sale(w.customer.user, paneer, 1, daysAgo(40));   // came before this week
        await sale(w.customer.user, paneer, 1, daysAgo(2));    // comes back
        await sale(second.user, paneer, 3, daysAgo(2));        // brand new
        const r = await get('?range=7');
        assert.equal(r.body.customers.unique, 2);
        assert.equal(r.body.customers.newCount, 1);
        assert.equal(r.body.customers.returning, 1);
        assert.equal(r.body.customers.repeatPct, 50);
        assert.equal(r.body.customers.top[0].spent, 600);
    });

    test('food: loved, needs attention, and what did not sell', async () => {
        const buyer = w.customer.user;
        const o = await sale(buyer, paneer, 1, daysAgo(1));
        const other = await f.makeUser(w.tenant, 'customer', '9000000032');
        const o2 = await sale(other.user, paneer, 1, daysAgo(1));
        const bad = await Product.create({ tenantId: w.tenant._id, categoryId: cat._id, name: 'Soup', price: 80, isVeg: true, createdAt: new Date(Date.now() - 100 * 86400000) });
        const o3 = await sale(buyer, bad, 1, daysAgo(1));
        const o4 = await sale(other.user, bad, 1, daysAgo(1));
        for (const [order, user, p, rating] of [[o, buyer, paneer, 5], [o2, other.user, paneer, 5], [o3, buyer, bad, 2], [o4, other.user, bad, 3]]) {
            await Review.create({ tenantId: w.tenant._id, userId: user._id, orderId: order._id, productId: p._id, rating });
        }
        const r = await get('?range=7');
        assert.equal(r.body.food.loved[0].name, 'Paneer Tikka');
        assert.equal(r.body.food.loved[0].avg, 5);
        assert.equal(r.body.food.attention[0].name, 'Soup');
        assert.deepEqual(r.body.food.slow.map((x) => x.name), ['Laddu'], 'the item nobody ordered');
    });

    test('the app\'s value uses the platform commission and what the shop was billed', async () => {
        await sale(w.customer.user, paneer, 5, daysAgo(2));   // 1000
        await SubscriptionInvoice.create({ tenantId: w.tenant._id, kind: 'custom', invoiceNo: 'SUB/REP/1', issueDate: daysAgo(1), dueDate: daysAgo(-5), baseAmount: 100, total: 100, status: 'paid' });
        let v = (await get('?range=7')).body.value;
        assert.equal(v.commissionPct, 25);
        assert.equal(v.marketplaceCost, 250);
        assert.equal(v.feeBilled, 100);
        assert.equal(v.netGain, 150);
        assert.equal(v.roi, 10);
        assert.equal(v.lifetime.orders, 1);
        await PlatformSettings.findByIdAndUpdate('main', { $set: { 'insights.showMarketplaceCompare': false } }, { upsert: true });
        v = (await get('?range=7')).body.value;
        assert.equal(v.show, false);
        assert.equal(v.marketplaceCost, null);
    });

    test('a milestone is told once, when it is crossed', async () => {
        for (let i = 0; i < 10; i += 1) await sale(w.customer.user, paneer, 1, daysAgo(1 + (i % 3)));
        const r = await get('?range=7');
        assert.ok(r.body.milestones.some((m) => /10 delivered orders/.test(m)));
        assert.equal((await get('?range=90')).body.milestones.length >= 1, true);
    });

    test('another shop\'s sales never show, and a customer cannot open it', async () => {
        const other = await f.makeWorld('rep-other');
        await f.makeOrder(other.tenant, other.customer.user, { status: 'delivered', deliveredAt: daysAgo(1), pricing: { subtotal: 999, total: 999 } });
        assert.equal((await get('?range=7')).body.totals.orders, 0);
        assert.ok([401, 403].includes((await request(app).get('/api/shop/business-report').set(w.customer.headers)).status));
    });
});

describe('platform presentation settings', () => {
    test('the superadmin reads and changes the commission, and can reset it', async () => {
        const auth = { Authorization: `Bearer ${(await f.makeSuperAdmin('rep@example.com')).token}` };
        const g = await request(app).get('/api/admin/platform/insights').set(auth);
        assert.equal(g.body.marketplaceCommissionPct, 25);
        const p = await request(app).put('/api/admin/platform/insights').set(auth).send({ marketplaceCommissionPct: 18, monthlyReportEmail: false });
        assert.equal(p.body.marketplaceCommissionPct, 18);
        assert.equal(p.body.monthlyReportEmail, false);
        assert.equal((await request(app).put('/api/admin/platform/insights').set(auth).send({ marketplaceCommissionPct: 99 })).status, 400);
        const back = await request(app).put('/api/admin/platform/insights').set(auth).send({ reset: true });
        assert.equal(back.body.marketplaceCommissionPct, 25);
        assert.equal(back.body.monthlyReportEmail, true);
        // the same shop route the owner uses works for the superadmin
        const shop = await request(app).get(`/api/admin/tenants/${w.tenant._id}/shop/business-report?range=7`).set(auth);
        assert.equal(shop.status, 200, JSON.stringify(shop.body));
    });
});

describe('tips', () => {
    const base = () => ({
        totals: { orders: 50, revenue: 20000, avgOrder: 400, placed: 60, cancelled: 3, cancelRate: 5, cancelledLost: 0 }, previous: { orders: 40, revenue: 10000 },
        change: { revenue: 100 }, busiest: { hour: 20, hourLabel: '8 PM', weekday: 'Fri' },
        customers: { unique: 30, newCount: 8, repeatPct: 45 }, food: { top: [{ name: 'Paneer', quantity: 40 }], loved: [], attention: [], slow: [] },
        delivery: { best: null, riders: [], rating: { avg: null, count: 0 }, cashWithRidersPaise: 0 },
    });

    test('good news comes first, and there are never more than 5 tips or 2 worries', () => {
        const r = base();
        r.food.attention = [{ name: 'Soup', avg: 2.5, count: 4 }];
        r.totals.cancelRate = 15; r.totals.cancelledLost = 900;
        r.delivery.cashWithRidersPaise = 500000;
        r.delivery.rating = { avg: 3.2, count: 9 };
        const tips = buildTips(r);
        assert.ok(tips.length <= 5);
        assert.ok(tips.filter((x) => x.tone === 'watch').length <= 2);
        assert.equal(tips.some((x) => x.tone === 'good'), true);
    });

    test('a drop in sales and many cancellations point to the right screens', () => {
        const r = base();
        r.change.revenue = -30; r.previous.orders = 40; r.totals.cancelRate = 12;
        const tips = buildTips(r);
        assert.equal(tips.find((x) => x.id === 'drop').action.screen, 'OwnerMessages');
        assert.equal(tips.find((x) => x.id === 'cancel').action.screen, 'Busy');
    });

    test('a quote is the same for the same shop and period, and always something', () => {
        assert.equal(quoteFor('a:30:2026-10-01'), quoteFor('a:30:2026-10-01'));
        assert.ok(quoteFor('b').length > 10);
    });
});

describe('the monthly report', () => {
    const { runMonthlyReports, lastMonth } = require('../src/jobs/monthlyReports');
    const Notification = require('../src/models/Notification');
    const EmailJob = require('../src/models/EmailJob');
    const Tenant = require('../src/models/Tenant');

    const lastMonthDay = () => { const d = new Date(); d.setUTCDate(1); d.setUTCDate(0); d.setUTCHours(9, 0, 0, 0); return d; };   // the last day of last month

    test('every shop with orders gets one report: in the app, and by email with the PDF; never twice', async () => {
        await db.clear();
        const shop = await f.makeWorld('rep-mail');
        tenantRecognizer.invalidateTenant('rep-mail');
        const when = lastMonthDay();
        await f.makeOrder(shop.tenant, shop.customer.user, { status: 'delivered', deliveredAt: when, createdAt: when, pricing: { subtotal: 500, total: 500 } });
        await shop.owner.user.updateOne({ $set: { email: 'owner@example.com' } });

        const r = await runMonthlyReports({ force: true });
        assert.equal(r.sent, 1);
        assert.equal(r.period, lastMonth(new Date()));
        const note = await Notification.findOne({ tenantId: shop.tenant._id, type: 'monthly_report' }).lean();
        assert.ok(note);
        assert.equal(note.data.kind, 'business_report');
        assert.match(note.title, /report is ready/);
        for (let i = 0; i < 40 && !(await EmailJob.countDocuments({ kind: 'monthly_report' })); i += 1) await f.sleep(100);
        const mail = await EmailJob.findOne({ kind: 'monthly_report' }).lean();
        assert.ok(mail, 'the email is queued');
        assert.equal(mail.to, 'owner@example.com');
        assert.match(mail.subject, /report/);
        assert.equal(mail.attachments.length, 1);
        assert.match(mail.attachments[0].name, /\.pdf$/);
        assert.equal(Buffer.from(mail.attachments[0].content, 'base64').slice(0, 4).toString(), '%PDF', 'a real PDF');

        assert.equal((await runMonthlyReports({ force: true })).sent, 0, 'the second run sends nothing');
    });

    test('a shop that switched it off, a shop with no orders, and the platform switch send nothing', async () => {
        await db.clear();
        const off = await f.makeWorld('rep-off');
        const quiet = await f.makeWorld('rep-quiet');
        tenantRecognizer.invalidateTenant('rep-off'); tenantRecognizer.invalidateTenant('rep-quiet');
        const when = lastMonthDay();
        await f.makeOrder(off.tenant, off.customer.user, { status: 'delivered', deliveredAt: when, createdAt: when });
        await Tenant.updateOne({ _id: off.tenant._id }, { $set: { 'settings.notifications.monthlyReport': false } });
        const r = await runMonthlyReports({ force: true });
        assert.equal(r.sent, 0);
        assert.equal(await Notification.countDocuments({ type: 'monthly_report' }), 0);

        await PlatformSettings.findByIdAndUpdate('main', { $set: { 'insights.monthlyReportEmail': false } }, { upsert: true });
        await Tenant.updateOne({ _id: off.tenant._id }, { $unset: { 'settings.notifications.monthlyReport': 1 } });
        await require('mongoose').model('MonthlyReportLog').deleteMany({});
        assert.equal((await runMonthlyReports({ force: true })).off, true);
    });

    test('before 9 AM or after the 5th nothing is sent unless forced', async () => {
        const day10 = new Date(Date.UTC(2026, 5, 10, 8, 0, 0));
        assert.equal((await runMonthlyReports({ now: day10 })).sent, 0);
    });
});
