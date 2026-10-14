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
const SubscriptionInvoice = require('../src/models/SubscriptionInvoice');
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

    test('billing rules and tiers: whole numbers only, tiers must grow and end open', async () => {
        const ok = await put('/api/admin/platform/billing', { dueDays: 10, graceDays: 4, freeOrders: 50, freeMonths: 1 });
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
        assert.equal((await put('/api/admin/platform/billing', { dueDays: 99 })).status, 400);

        const tiers = [{ upTo: 100, fee: 2000 }, { upTo: 500, fee: 5000 }, { upTo: null, fee: 9000 }];
        const t = await put('/api/admin/platform/billing/tiers', { tiers });
        assert.equal(t.status, 200, JSON.stringify(t.body));
        assert.equal(t.body.tiers.length, 3);
        assert.equal((await put('/api/admin/platform/billing/tiers', { tiers: [{ upTo: 100, fee: 1 }] })).status, 400);   // last tier must be open
        assert.equal((await put('/api/admin/platform/billing/tiers', { tiers: [{ upTo: 500, fee: 1 }, { upTo: 100, fee: 2 }, { upTo: null, fee: 3 }] })).status, 400);

        const p = await get('/api/admin/platform');
        assert.equal(p.body.billing.dueDays, 10);
        assert.equal(p.body.billing.tiers[2].upTo, null);
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

describe('one shop: billing', () => {
    test('go live, again needs force; overrides and reset; preview', async () => {
        const shop = await f.makeTenant(`money-${++n}`);
        const base = `/api/admin/tenants/${shop._id}`;

        let r = await post(`${base}/billing/go-live`, {});
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.billing.isLive, true);
        assert.equal(r.body.billing.billableCount, 0);

        r = await post(`${base}/billing/go-live`, {});
        assert.equal(r.status, 409);
        r = await post(`${base}/billing/go-live`, { force: true });
        assert.equal(r.status, 200);

        const sent = {
            freeOrdersOverride: 20, freeMonthsOverride: 1, fixedFeeOverride: 1500,
            tiersOverride: [{ upTo: 50, fee: 500 }, { upTo: null, fee: 900 }], goLiveAt: '2026-10-01T00:00:00+05:30',
        };
        r = await put(`${base}/billing`, sent);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.billing.fixedFeeOverride, 1500);
        assert.equal(r.body.billing.tiersOverride.length, 2);

        // empty boxes in the app are sent as null: back to the platform value
        r = await put(`${base}/billing`, { freeOrdersOverride: null, freeMonthsOverride: null, fixedFeeOverride: null, tiersOverride: null, goLiveAt: null });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.billing.freeOrdersOverride, null);

        assert.equal((await put(`${base}/billing`, { freeOrdersOverride: -1 })).status, 400);
        assert.equal((await put(`${base}/billing`, { reset: true })).status, 200);

        const prev = await get(`${base}/billing/preview?period=2026-09`);
        assert.equal(prev.status, 200);
        assert.equal(prev.body.period, '2026-09');
        assert.equal(typeof prev.body.total, 'number');
        assert.equal((await get(`${base}/billing/preview?period=bad`)).status, 400);

        // the owner-style status the screen reads
        const st = await get(`${base}/shop/billing/status`);
        assert.equal(st.status, 200);
        assert.ok(st.body.free);
    });

    test('unpause is refused for a shop that is not paused', async () => {
        const shop = await f.makeTenant(`money-${++n}`);
        assert.equal((await post(`/api/admin/tenants/${shop._id}/billing/unpause`, { days: 3 })).status, 409);
    });
});

describe('rent invoices', () => {
    test('custom invoice needs business details; then paid, undo, extend grace, void', async () => {
        const shop = await f.makeTenant(`money-${++n}`);
        const base = `/api/admin/tenants/${shop._id}`;
        const body = { lineItems: [{ description: 'Set-up', qty: 1, rate: 2000 }, { description: 'Training', qty: 2, rate: 500 }], gstPercent: 18, dueDays: 7, graceDays: 5, blocksShop: true, note: 'Thanks' };

        assert.equal((await post(`${base}/invoices/custom`, body)).status, 400);   // no business details yet
        await put('/api/admin/platform/business', businessBody);

        const c = await post(`${base}/invoices/custom`, body);
        assert.equal(c.status, 201, JSON.stringify(c.body));
        assert.equal(c.body.baseAmount, 3000);
        assert.equal(c.body.gstAmount, 540);
        assert.equal(c.body.total, 3540);
        assert.equal(c.body.status, 'pending');
        const id = c.body._id;

        const list = await get(`/api/admin/subscriptions/invoices?tenantId=${shop._id}&status=pending`);
        assert.equal(list.body.items.length, 1);
        assert.equal(list.body.items[0].shopName, shop.name);

        const grace = await patch(`/api/admin/subscriptions/invoices/${id}/extend-grace`, { days: 3 });
        assert.equal(grace.status, 200);
        assert.equal((await patch(`/api/admin/subscriptions/invoices/${id}/extend-grace`, { days: 0 })).status, 400);

        const paid = await patch(`/api/admin/subscriptions/invoices/${id}/status`, { status: 'paid', paymentMode: 'upi', paymentRef: 'UTR1', note: 'Phone call' });
        assert.equal(paid.status, 200, JSON.stringify(paid.body));
        assert.equal(paid.body.status, 'paid');
        assert.equal(paid.body.paymentMode, 'upi');
        assert.equal((await patch(`/api/admin/subscriptions/invoices/${id}/status`, { status: 'paid', paymentMode: 'barter' })).status, 400);

        // a paid invoice cannot be voided, but can be set back to pending
        assert.equal((await patch(`/api/admin/subscriptions/invoices/${id}/void`, { reason: 'x' })).status, 409);
        const undo = await patch(`/api/admin/subscriptions/invoices/${id}/status`, { status: 'pending' });
        assert.equal(undo.body.status, 'pending');

        const one = await get(`/api/admin/subscriptions/invoices/${id}`);
        assert.equal(one.body.invoiceNo, c.body.invoiceNo);

        const voided = await patch(`/api/admin/subscriptions/invoices/${id}/void`, { reason: 'Made by mistake' });
        assert.equal(voided.status, 200);
        assert.equal(voided.body.status, 'void');
        assert.equal((await patch(`/api/admin/subscriptions/invoices/${id}/status`, { status: 'paid' })).status, 409);   // void is final
    });

    test('waive; resend notice only for a pending invoice; generate refuses an unfinished month', async () => {
        const shop = await f.makeTenant(`money-${++n}`);
        await put('/api/admin/platform/business', businessBody);
        const c = await post(`/api/admin/tenants/${shop._id}/invoices/custom`, { lineItems: [{ description: 'Fee', qty: 1, rate: 100 }] });
        const id = c.body._id;

        const resend = await post(`/api/admin/subscriptions/invoices/${id}/resend`, {});
        assert.equal(resend.status, 200, JSON.stringify(resend.body));

        const w = await patch(`/api/admin/subscriptions/invoices/${id}/waive`, { reason: 'Goodwill' });
        assert.equal(w.status, 200);
        assert.equal(w.body.status, 'void');
        assert.equal((await post(`/api/admin/subscriptions/invoices/${id}/resend`, {})).status, 409);

        const thisMonth = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
        assert.equal((await post('/api/admin/subscriptions/invoices/generate', { period: thisMonth })).status, 400);
        const ok = await post('/api/admin/subscriptions/invoices/generate', { period: '2026-01' });
        assert.equal(ok.status, 201, JSON.stringify(ok.body));
        assert.ok('created' in ok.body);
    });

    test('the rent invoice PDF downloads with the login', async () => {
        const shop = await f.makeTenant(`money-${++n}`);
        await put('/api/admin/platform/business', businessBody);
        const c = await post(`/api/admin/tenants/${shop._id}/invoices/custom`, { lineItems: [{ description: 'Fee', qty: 1, rate: 100 }] });
        const pdf = await get(`/api/admin/subscriptions/invoices/${c.body._id}/pdf`);
        assert.equal(pdf.status, 200);
        assert.match(String(pdf.headers['content-type']), /pdf/);
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
        const day = new Date().toISOString().slice(0, 10);
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
    test('credit, debit with a reason, prices with null = platform value, wallet and history', async () => {
        const shop = await f.makeTenant(`money-${++n}`);
        const base = `/api/admin/tenants/${shop._id}`;

        assert.equal((await post(`${base}/sms/credit`, { amountPaise: 5000 })).status, 400);   // reason needed
        const c = await post(`${base}/sms/credit`, { amountPaise: 5000, note: 'Paid by cash' });
        assert.equal(c.status, 201, JSON.stringify(c.body));

        const w = await get(`${base}/shop/sms/wallet`);
        assert.equal(w.body.balancePaise, 5000);

        const d = await post(`${base}/sms/debit`, { amountPaise: 1000, note: 'Wrong credit' });
        assert.equal(d.status, 201, JSON.stringify(d.body));
        assert.equal((await post(`${base}/sms/debit`, { amountPaise: 999999, note: 'Too much' })).status >= 400, true);

        const st = await put(`${base}/sms/settings`, { ratePerSmsPaise: 50, costPerSmsPaise: null, lowBalancePaise: null, blockAtZero: true });
        assert.equal(st.status, 200, JSON.stringify(st.body));
        assert.equal(st.body.ratePerSmsPaise, 50);
        assert.equal(st.body.blockAtZero, true);

        const tx = await get(`${base}/shop/sms/transactions?limit=20`);
        assert.equal(tx.status, 200);
        assert.equal(tx.body.items.length, 2);
        assert.equal((await get(`${base}/shop/sms/transactions?type=adjust`)).body.items.length, 2);   // a manual credit and a manual debit are both "adjust"
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
        await put('/api/admin/platform/business', businessBody);
        await post(`/api/admin/tenants/${shop._id}/invoices/custom`, { lineItems: [{ description: 'Fee', qty: 1, rate: 100 }] });

        const day = new Date().toISOString().slice(0, 10);
        const plat = await get(`/api/admin/ledger?from=${day}&to=${day}&limit=20`);
        assert.equal(plat.status, 200);
        assert.equal(plat.body.items.length, 1);
        assert.equal(plat.body.items[0].category, 'rent');
        assert.equal(plat.body.items[0].status, 'pending');
        assert.equal(plat.body.totals.pending.count, 1);

        assert.equal((await get('/api/admin/ledger?category=customer_payment')).status, 400);   // not a platform category
        const shopView = await get(`/api/admin/tenants/${shop._id}/ledger?category=rent&status=pending`);
        assert.equal(shopView.body.items.length, 1);

        const csv = await get(`/api/admin/tenants/${shop._id}/ledger/export`);
        assert.equal(csv.status, 200);
        assert.match(String(csv.headers['content-type']), /csv/);
        assert.match(csv.text, /Monthly bill/);
    });
});
