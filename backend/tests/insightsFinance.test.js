require('./helpers/env');
process.env.SECRETS_KEY = process.env.SECRETS_KEY || require('crypto').randomBytes(32).toString('base64');
// Search, shop health, readiness, system, exports, expenses, profit and loss, receivables.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const SubscriptionInvoice = require('../src/models/SubscriptionInvoice');
const SmsLog = require('../src/models/SmsLog');
const PlatformSmsCost = require('../src/models/PlatformSmsCost');
const Notification = require('../src/models/Notification');

let token;
let n = 0;
const auth = () => ({ Authorization: `Bearer ${token}` });
const get = (u) => request(app).get(u).set(auth());
const post = (u, b) => request(app).post(u).set(auth()).send(b);
const patch = (u, b) => request(app).patch(u).set(auth()).send(b);
const del = (u) => request(app).delete(u).set(auth());

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    token = (await f.makeSuperAdmin('root@test.com')).token;
});

const day = 86400000;
async function invoice(tenant, o = {}) {
    n += 1;
    const base = o.base ?? 1000;
    return SubscriptionInvoice.create({
        tenantId: tenant._id, kind: 'custom', invoiceNo: `T/${n}`, issueDate: o.issueDate || new Date(Date.now() - 10 * day),
        dueDate: o.dueDate || new Date(Date.now() - 3 * day), baseAmount: base, gstPercent: 18, gstAmount: base * 0.18, total: base * 1.18,
        status: o.status || 'pending', paidAt: o.paidAt,
    });
}

describe('search and exports', () => {
    test('finds shops, orders by number and phone (masked), invoices; short text is refused', async () => {
        const w = await f.makeWorld(`ins-${Date.now().toString(36)}`);
        const o = await f.makeOrder(w.tenant, w.customer.user, {});
        assert.equal((await get('/api/admin/search?q=a')).status, 400);
        const byShop = await get(`/api/admin/search?q=${encodeURIComponent(w.tenant.name.slice(0, 3))}`);
        assert.ok(byShop.body.shops.length >= 1);
        const byNo = await get(`/api/admin/search?q=${o.orderNo}`);
        assert.ok(byNo.body.orders.some((x) => String(x.id) === String(o._id)));
        const byPhone = await get(`/api/admin/search?q=${w.customer.user.phone}`);
        assert.ok(byPhone.body.people.length >= 1);
        assert.match(byPhone.body.people[0].phone, /^\d\dXXXXXX\d\d$/);
        const inv = await invoice(w.tenant);
        const byInv = await get(`/api/admin/search?q=${encodeURIComponent(inv.invoiceNo)}`);
        assert.equal(byInv.body.invoices.length, 1);
    });

    test('CSV exports are formula-safe and need a superadmin', async () => {
        const w = await f.makeWorld(`exp-${Date.now().toString(36)}`);
        await f.makeOrder(w.tenant, w.customer.user, { customer: { name: '=HYPERLINK("x")', phone: w.customer.user.phone } });
        const r = await get('/api/admin/export/orders?format=csv');
        assert.equal(r.status, 200);
        assert.ok(String(r.headers['content-type']).includes('text/csv'));
        assert.ok(r.text.includes("\"'=HYPERLINK"));
        assert.equal((await get('/api/admin/export/customers?format=csv')).status, 200);
        assert.equal((await request(app).get('/api/admin/export/orders')).status, 401);
    });

    test('Excel exports are coloured, sized and text-only', async () => {
        const ExcelJS = require('exceljs');
        const w = await f.makeWorld(`xl-${Date.now().toString(36)}`);
        await f.makeOrder(w.tenant, w.customer.user, { customer: { name: '=HYPERLINK("x")', phone: w.customer.user.phone } });
        await invoice(w.tenant, { status: 'paid', paidAt: new Date(), base: 1000 });
        await invoice(w.tenant, { status: 'pending', base: 500 });

        const res = await get('/api/admin/export/orders').buffer(true).parse((rs, cb) => { const d = []; rs.on('data', (c) => d.push(c)); rs.on('end', () => cb(null, Buffer.concat(d))); });
        assert.equal(res.status, 200);
        assert.match(res.headers['content-type'], /spreadsheetml/);
        assert.ok(String(res.headers['content-disposition']).includes('orders.xlsx'));
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(res.body);
        const ws = wb.worksheets[0];
        assert.equal(ws.getCell(1, 1).value, 'Orders');                   // title banner
        assert.equal(ws.getCell(4, 4).value, 'Status');                   // header row
        assert.equal(ws.getCell(4, 4).fill.fgColor.argb, 'FF7C5CFF');     // coloured header
        assert.ok(ws.getColumn(1).width >= 16);                           // dates are not squeezed
        const name = ws.getCell(5, 9).value;                              // customer cell is plain text, never a formula
        assert.equal(typeof name, 'string');
        assert.equal(name, '=HYPERLINK("x")');

        const inv = await get('/api/admin/export/invoices').buffer(true).parse((rs, cb) => { const d = []; rs.on('data', (c) => d.push(c)); rs.on('end', () => cb(null, Buffer.concat(d))); });
        const wb2 = new ExcelJS.Workbook();
        await wb2.xlsx.load(inv.body);
        const sh = wb2.worksheets[0];
        const statusCells = [5, 6].map((r) => sh.getCell(r, 9));
        const paid = statusCells.find((c) => c.value === 'Paid');
        const pending = statusCells.find((c) => c.value === 'Pending');
        assert.equal(paid.fill.fgColor.argb, 'FFDCFCE7');                 // green
        assert.equal(pending.fill.fgColor.argb, 'FFFEF3C7');              // amber
        assert.equal(sh.getCell(7, 1).value, 'Total');                    // totals line
});
});

describe('health, readiness, system, backups', () => {
    test('health lists every shop with a score and reasons; an empty shop is not perfect', async () => {
        const w = await f.makeWorld(`hl-${Date.now().toString(36)}`);
        const r = await get('/api/admin/insights/health?days=30');
        assert.equal(r.status, 200);
        const mine = r.body.shops.find((s) => String(s.id) === String(w.tenant._id));
        assert.ok(mine.score < 100);
        assert.ok(mine.reasons.length > 0);
        assert.equal(r.body.platform.shops, 1);
    });

    test('readiness shows what is missing', async () => {
        const w = await f.makeWorld(`rd-${Date.now().toString(36)}`);
        const r = await get(`/api/admin/tenants/${w.tenant._id}/readiness`);
        assert.equal(r.status, 200);
        assert.ok(r.body.checks.find((c) => c.key === 'owner').ok);
        assert.ok(r.body.checks.find((c) => c.key === 'rider').ok);
        assert.equal(r.body.checks.find((c) => c.key === 'live').ok, false);
    });

    test('system and backups answer; a backup can be run', async () => {
        process.env.STORAGE_MOCK = 'true';
        const dir = require('path').join(process.cwd(), '.mock-backups');
        await require('fs/promises').rm(dir, { recursive: true, force: true });   // a clean store: no backup yet
        const s = await get('/api/admin/ops/system');
        assert.equal(s.status, 200);
        assert.equal(s.body.database.ok, true);
        assert.equal(s.body.jobs.length, 2);
        const b0 = await get('/api/admin/ops/backups');
        assert.equal(b0.status, 200);
        assert.equal(b0.body.stale, true);
        const run = await post('/api/admin/ops/backup', {});
        assert.equal(run.status, 200, JSON.stringify(run.body));
        const b1 = await get('/api/admin/ops/backups');
        assert.equal(b1.body.daily.length, 1);
        assert.equal(b1.body.stale, false);
        await require('fs/promises').rm(dir, { recursive: true, force: true });
    });
});

describe('profit and loss, receivables, expenses', () => {
    test('expense add, change, delete; bad input refused', async () => {
        const a = await post('/api/admin/finance/expenses', { date: new Date().toISOString(), category: 'hosting', amountPaise: 50000, vendor: 'Render' });
        assert.equal(a.status, 201, JSON.stringify(a.body));
        assert.equal((await post('/api/admin/finance/expenses', { date: new Date(), category: 'nope', amountPaise: 100 })).status, 400);
        assert.equal((await post('/api/admin/finance/expenses', { date: new Date(), category: 'tools', amountPaise: 10.5 })).status, 400);
        const p = await patch(`/api/admin/finance/expenses/${a.body.id}`, { amountPaise: 60000 });
        assert.equal(p.body.amountPaise, 60000);
        assert.equal((await get('/api/admin/finance/expenses')).body.items.length, 1);
        assert.equal((await del(`/api/admin/finance/expenses/${a.body.id}`)).status, 200);
        assert.equal((await del(`/api/admin/finance/expenses/${a.body.id}`)).status, 404);
    });

    test('profit and loss adds income, takes costs, explains a loss, and GST is not income', async () => {
        const w = await f.makeWorld(`pl-${Date.now().toString(36)}`);
        await invoice(w.tenant, { status: 'paid', paidAt: new Date(), base: 1000 });
        await invoice(w.tenant, { status: 'pending', base: 500, dueDate: new Date(Date.now() - 40 * day) });
        await SmsLog.create({ tenantId: w.tenant._id, purpose: 'otp', status: 'sent', chargedPaise: 3000, costPaise: 1000 });
        await PlatformSmsCost.create({ eventKey: 'x', tenantId: w.tenant._id, costPaise: 500 });
        await post('/api/admin/finance/expenses', { date: new Date().toISOString(), category: 'hosting', amountPaise: 400000, repeatMonthly: true });

        const r = await get('/api/admin/finance/summary?months=6');
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const t = r.body.totals;
        assert.equal(t.rentIncomePaise, 100000);
        assert.equal(t.gstPaise, 18000);
        assert.equal(t.smsMarginPaise, 2000);
        assert.equal(t.incomePaise, 102000);
        assert.equal(t.expensesPaise, 400000);
        assert.equal(t.netPaise, 102000 - 400000 - 500);
        assert.equal(r.body.verdict, 'loss');
        const codes = r.body.reasons.map((x) => x.code);
        assert.ok(codes.includes('costs_above_income'));
        assert.ok(codes.includes('unpaid_rent'));
    });

    test('receivables: aging buckets, never paid vs paying late', async () => {
        const a = await f.makeWorld(`rc1-${Date.now().toString(36)}`);
        const b = await f.makeWorld(`rc2-${Date.now().toString(36)}`);
        await invoice(a.tenant, { status: 'pending', base: 1000, dueDate: new Date(Date.now() - 45 * day) });
        await invoice(b.tenant, { status: 'paid', paidAt: new Date(Date.now() - 5 * day), dueDate: new Date(Date.now() - 10 * day) });
        await invoice(b.tenant, { status: 'pending', base: 200, dueDate: new Date(Date.now() - 2 * day) });
        const r = await get('/api/admin/finance/receivables');
        assert.equal(r.status, 200);
        assert.equal(r.body.totals.owingShops, 2);
        assert.equal(r.body.totals.neverPaid, 1);
        const sa = r.body.shops.find((s) => String(s.tenantId) === String(a.tenant._id));
        assert.equal(sa.behaviour, 'not_paying');
        const sb = r.body.shops.find((s) => String(s.tenantId) === String(b.tenant._id));
        assert.equal(sb.behaviour, 'late_now');
        assert.equal(r.body.behaviour[0].avgDaysLate, 5);
        const bk = Object.fromEntries(r.body.totals.buckets.map((x) => [x.key, x.paise]));
        assert.equal(bk.d31_60, 118000);
        assert.equal(bk.d1_7, 23600);
    });
});

describe('alerts inbox: clear', () => {
    test('one alert can be deleted, then all of them', async () => {
        await Notification.create([{ role: 'superadmin', type: 'x', title: 'a' }, { role: 'superadmin', type: 'x', title: 'b' }, { role: 'superadmin', type: 'x', title: 'c' }]);
        const list = await get('/api/admin/notifications');
        assert.equal(list.body.items.length, 3);
        assert.equal((await del('/api/admin/notifications/' + list.body.items[0].id)).status, 200);
        assert.equal((await del('/api/admin/notifications/' + list.body.items[0].id)).status, 404);
        const all = await del('/api/admin/notifications');
        assert.equal(all.body.deleted, 2);
        assert.equal((await get('/api/admin/notifications')).body.items.length, 0);
    });
});

describe('map place search', () => {
    test('search and reverse use the provider and need at least 3 letters', async () => {
        const real = global.fetch;
        global.fetch = async (url) => ({
            ok: true,
            json: async () => (String(url).includes('/reverse')
                ? { lat: '26.45', lon: '80.33', display_name: 'Kanpur', address: { city: 'Kanpur', postcode: '208001' } }
                : [{ lat: '26.4499', lon: '80.3319', display_name: 'Kanpur, Uttar Pradesh', address: { city: 'Kanpur', postcode: '208001' } }]),
        });
        try {
            assert.equal((await get('/api/admin/geo/search?q=ab')).status, 400);
            const r = await get('/api/admin/geo/search?q=Kanpur');
            assert.equal(r.status, 200);
            assert.equal(r.body.items[0].latitude, 26.4499);
            assert.equal(r.body.items[0].pincode, '208001');
            const v = await get('/api/admin/geo/reverse?lat=26.45&lng=80.33');
            assert.equal(v.body.place.city, 'Kanpur');
            assert.equal((await get('/api/admin/geo/reverse?lat=999&lng=1')).status, 400);
        } finally { global.fetch = real; }
    });
});

describe('place search ranking', () => {
    const { relevance, search } = require('../src/services/placeSearch');

    test('a typo and a missing word still rank the right shop first; other countries are dropped', async () => {
        const good = { title: 'City Fashion', subtitle: 'Civil Lines, Sultanpur, Uttar Pradesh', name: 'City Fashion, Civil Lines, Sultanpur' };
        const other = { title: 'City Mart', subtitle: 'Lucknow, Uttar Pradesh', name: 'City Mart, Lucknow' };
        assert.ok(relevance('city fashon sultanpur', good) > relevance('city fashon sultanpur', other));
        assert.ok(relevance('cty fashion sultnpur', good) > 0.8);
        assert.ok(relevance('xyz zzz', good) < 0.35);

        const real = global.fetch;
        global.fetch = async (url) => ({
            ok: true,
            json: async () => (String(url).includes('photon')
                ? { features: [
                    { properties: { name: 'City Mart', city: 'Lucknow', state: 'Uttar Pradesh', countrycode: 'IN' }, geometry: { coordinates: [80.94, 26.84] } },
                    { properties: { name: 'City Fashion', district: 'Civil Lines', city: 'Sultanpur', state: 'Uttar Pradesh', countrycode: 'IN' }, geometry: { coordinates: [82.07, 26.26] } },
                    { properties: { name: 'City Fashion', city: 'Dhaka', countrycode: 'BD' }, geometry: { coordinates: [90.4, 23.8] } },
                ] }
                : []),
        });
        try {
            const items = await search('city fashon sultanpur', null);
            assert.equal(items[0].title, 'City Fashion');
            assert.equal(items[0].city, 'Sultanpur');
            assert.ok(!items.some((i) => i.city === 'Dhaka'));
        } finally { global.fetch = real; }
    });
});

describe('superadmin profile picture', () => {
    const sharp = require('sharp');
    const storage = require('../src/services/adapters/storage');
    const SuperAdmin = require('../src/models/SuperAdmin');

    test('sign, upload, confirm shows it in /me; another admin cannot use my key; it can be removed', async () => {
        process.env.STORAGE_MOCK = 'true';
        const orig = storage.presignPut;
        storage.presignPut = async () => 'https://r2.test/upload';
        try {
            const buf = await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg().toBuffer();
            const s = await post('/api/admin/me/photo/sign', { contentType: 'image/jpeg', bytes: buf.length });
            assert.equal(s.status, 200, JSON.stringify(s.body));
            assert.equal((await post('/api/admin/me/photo/sign', { contentType: 'application/pdf', bytes: 10 })).status, 400);
            await storage.put({ key: s.body.key, buffer: buf, contentType: 'image/jpeg' });
            assert.equal((await post('/api/admin/me/photo', { key: 'platform/admins/someoneelse/tmp/x.jpg' })).status, 400);
            const c = await post('/api/admin/me/photo', { key: s.body.key });
            assert.equal(c.status, 201, JSON.stringify(c.body));
            assert.match(c.body.photo, /platform\/admins\/[a-f0-9]{24}\/photo\.webp/);
            assert.equal((await get('/api/admin/me')).body.photo, c.body.photo);
            assert.equal((await del('/api/admin/me/photo')).status, 200);
            assert.equal((await get('/api/admin/me')).body.photo, null);
            assert.equal((await del('/api/admin/me/photo')).status, 404);
            void SuperAdmin;
        } finally { storage.presignPut = orig; }
    });
});

