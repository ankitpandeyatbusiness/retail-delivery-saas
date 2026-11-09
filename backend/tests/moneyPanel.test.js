require('./helpers/env');
process.env.SECRETS_KEY = process.env.SECRETS_KEY || require('crypto').randomBytes(32).toString('base64');   // keys are stored encrypted
// The superadmin app handles rent, payments, SMS and the ledger through /api/admin. These tests send the same
// requests the Money screens send (rupees typed by a person are turned into paise by the app first).
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const PaymentDispute = require('../src/models/PaymentDispute');
const { paidPlan } = require('./helpers/planPay');
const Tenant = require('../src/models/Tenant');
const mongoose = require('mongoose');

let token;
let n = 0;
const auth = () => ({ Authorization: `Bearer ${token}` });
const get = (u) => request(app).get(u).set(auth());
const post = (u, b) => request(app).post(u).set(auth()).send(b);
const put = (u, b) => request(app).put(u).set(auth()).send(b);
const patch = (u, b) => request(app).patch(u).set(auth()).send(b);

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    token = (await f.makeSuperAdmin('root@test.com')).token;
});

const businessBody = { legalName: 'Retail Control Pvt Ltd', address: 'Pune', gstin: '27AAAAA0000A1Z5', email: 'bill@rc.test', phone: '9876543210', sacCode: '998314', paymentInstructions: 'UPI rc@bank' };

describe('platform: business, billing rules, tiers, SMS prices', () => {
    test('business details save and read back; a bad GST number is refused', async () => {
        const ok = await put('/api/admin/platform/business', businessBody);
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
        const r = await get('/api/admin/platform');
        assert.equal(r.body.business.legalName, 'Retail Control Pvt Ltd');
        const bad = await put('/api/admin/platform/business', { ...businessBody, gstin: '123' });
        assert.ok(bad.status >= 400 && bad.status < 500);
    });

    test('SMS prices in paise, packs, and min above max refused; profit report answers', async () => {
        const ok = await put('/api/admin/platform/sms', { ratePerSmsPaise: 40, costPerSmsPaise: 25, lowBalancePaise: 8000, minTopupPaise: 10000, maxTopupPaise: 500000, packs: [10000, 25000] });
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
        assert.equal((await get('/api/admin/platform/sms')).body.sms.ratePerSmsPaise, 40);
        assert.equal((await put('/api/admin/platform/sms', { minTopupPaise: 900000, maxTopupPaise: 200 })).status, 400);
        assert.equal((await put('/api/admin/platform/sms', { packs: [] })).status, 400);

        const profit = await get('/api/admin/sms/profit');
        assert.equal(profit.status, 200);
        assert.ok(profit.body.totals);
    });
});

describe('payments (Razorpay) of one shop', () => {
    test('checklist, key rules, webhook secret shown once, enable needs all steps', async () => {
        const shop = await f.makeTenant(`money-${++n}`);
        const base = `/api/admin/tenants/${shop._id}/payments`;

        let r = await get(base);
        assert.equal(r.status, 200);
        assert.equal(r.body.enabled, false);
        assert.equal(r.body.checklist.length, 5);
        assert.ok(!('keySecret' in r.body));

        assert.equal((await put(`${base}/keys`, { keyId: 'bad', keySecret: 'short' })).status, 400);
        r = await put(`${base}/keys`, { keyId: 'rzp_test_AbCdEf123456', keySecret: 'secretsecret123456' });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.hasKeySecret, true);
        assert.equal(r.body.keyMode, 'test');

        // cannot switch on before the test and the secret
        assert.equal((await put(`${base}/enabled`, { enabled: true })).status, 409);

        const secret = await post(`${base}/webhook-secret`, {});
        assert.equal(secret.status, 200);
        assert.ok(secret.body.secret && secret.body.webhookUrl);
        const again = await get(base);
        assert.equal(again.body.hasWebhookSecret, true);
        assert.ok(!JSON.stringify(again.body).includes(secret.body.secret));   // never read back

        assert.equal((await put(`${base}/enabled`, { enabled: 'yes' })).status, 400);
    });

    test('report and refunds lists answer; dispute notes are saved', async () => {
        const w = await f.makeWorld(`money-${++n}`);
        const day = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);   // the Indian day, as the server counts it
        const rep = await get(`/api/admin/tenants/${w.tenant._id}/shop/payments/report?from=${day}&to=${day}`);
        assert.equal(rep.status, 200);
        assert.ok(rep.body.captured && rep.body.refunded);
        assert.equal((await get(`/api/admin/tenants/${w.tenant._id}/shop/payments/refunds`)).status, 200);

        const o = await f.makeOrder(w.tenant, w.customer.user, { orderType: 'pickup' });
        const d = await PaymentDispute.create({
            tenantId: w.tenant._id, orderId: o._id, paymentId: new mongoose.Types.ObjectId(), rzpPaymentId: 'pay_1', rzpDisputeId: 'disp_1', status: 'created', amountPaise: 10000,
        });
        const list = await get(`/api/admin/tenants/${w.tenant._id}/disputes`);
        assert.equal(list.body.items.length, 1);
        assert.equal(list.body.items[0].orderNo, o.orderNo);
        const note = await post(`/api/admin/tenants/${w.tenant._id}/disputes/${d._id}/notes`, { text: 'Delivered with PIN 4321' });
        assert.equal(note.status, 201);
        assert.equal(note.body.notes.length, 1);
        assert.equal((await post(`/api/admin/tenants/${w.tenant._id}/disputes/${d._id}/notes`, { text: '' })).status, 400);
    });
});

describe('SMS wallet and sender of one shop', () => {
    test('no manual credit or debit; prices with null = platform value, wallet and history', async () => {
        const shop = await f.makeTenant(`money-${++n}`);
        const base = `/api/admin/tenants/${shop._id}`;

        // the superadmin cannot move wallet money by hand: the owner tops up by paying
        assert.equal((await post(`${base}/sms/credit`, { amountPaise: 5000, note: 'x' })).status, 404);
        assert.equal((await post(`${base}/sms/debit`, { amountPaise: 1000, note: 'x' })).status, 404);

        const st = await put(`${base}/sms/settings`, { ratePerSmsPaise: 50, costPerSmsPaise: null, lowBalancePaise: null, blockAtZero: true });
        assert.equal(st.status, 200, JSON.stringify(st.body));
        assert.equal(st.body.ratePerSmsPaise, 50);
        assert.equal(st.body.blockAtZero, true);

        const tx = await get(`${base}/shop/sms/transactions?limit=20`);
        assert.equal(tx.status, 200);
        assert.equal(tx.body.items.length, 0);
        assert.equal((await get(`${base}/shop/sms/transactions?type=adjust`)).body.items.length, 0);
        assert.equal((await get(`${base}/shop/sms/transactions?type=nonsense`)).status, 400);
        assert.equal((await get(`${base}/shop/sms/topups`)).status, 200);
    });

    test('own sender: keys are write-only, switching on needs everything', async () => {
        const shop = await f.makeTenant(`money-${++n}`);
        const url = `/api/admin/tenants/${shop._id}/sms-provider`;

        const early = await put(url, { own: { enabled: true } });
        assert.equal(early.status, 400);

        const saved = await put(url, {
            templateId: '1007123456789012345',
            own: { senderId: 'RETAIL', entityId: '1101123456789012345', templateIds: { otp: '1107123456789012345' }, authKey: 'provider-secret-key' },
        });
        assert.equal(saved.status, 200, JSON.stringify(saved.body));
        assert.equal(saved.body.own.hasKeys, true);
        assert.equal(saved.body.own.senderId, 'RETAIL');
        assert.ok(!JSON.stringify(saved.body).includes('provider-secret-key'));

        const on = await put(url, { own: { enabled: true } });
        assert.equal(on.status, 200, JSON.stringify(on.body));
        assert.equal(on.body.own.enabled, true);
        assert.equal((await put(url, { own: { senderId: 'TOOLONGSENDER' } })).status, 400);
    });
});

describe('ledger', () => {
    test('platform and shop views, filters, and a CSV export', async () => {
        const shop = await f.makeTenant(`money-${++n}`);
        await paidPlan(shop._id, { baseRs: 100 });

        const day = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);   // the Indian day, as the server counts it
        const plat = await get(`/api/admin/ledger?from=${day}&to=${day}&limit=20`);
        assert.equal(plat.status, 200);
        assert.equal(plat.body.items.length, 1);
        assert.equal(plat.body.items[0].category, 'plan');
        assert.equal(plat.body.items[0].status, 'done');
        assert.equal(plat.body.totals.pending.count, 0);

        assert.equal((await get('/api/admin/ledger?category=customer_payment')).status, 400);   // not a platform category
        const shopView = await get(`/api/admin/tenants/${shop._id}/ledger?category=plan&status=done`);
        assert.equal(shopView.body.items.length, 1);

        const sheet = await require('./helpers/sheet').readSheet(get(`/api/admin/tenants/${shop._id}/ledger/export`));   // an Excel file now
        assert.equal(sheet.res.status, 200);
        assert.match(String(sheet.res.headers['content-type']), /spreadsheetml/);
    });
});
