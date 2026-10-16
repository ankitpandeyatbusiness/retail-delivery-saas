require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const PlatformSettings = require('../src/models/PlatformSettings');
const Tenant = require('../src/models/Tenant');
const SubscriptionInvoice = require('../src/models/SubscriptionInvoice');
const CreditNote = require('../src/models/CreditNote');
const SmsTopup = require('../src/models/SmsTopup');
const User = require('../src/models/User');
const EmailJob = require('../src/models/EmailJob');
const topups = require('../src/services/smsTopupService');
const gst = require('../src/services/gstSplit');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');

// What the platform issues to a shop: tax invoices with CGST/SGST or IGST, place of supply, the numbering with a prefix you
// type, SMS top-up invoices, credit notes, the GST register, and "only the supreme admin changes money".
let w; let boss; let other;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });

const AUTH = (t) => ({ Authorization: `Bearer ${t.token}` });
const business = (extra = {}) => PlatformSettings.findByIdAndUpdate('main', {
    $set: {
        'business.legalName': 'Operator Pvt Ltd', 'business.address': '1 Main Road, Lucknow', 'business.gstin': '09AAAAA0000A1Z5',
        'business.pan': 'AAAAA0000A', 'business.state': 'Uttar Pradesh', 'business.stateCode': '09', 'business.sacCode': '998314',
        ...extra,
    },
}, { upsert: true });
const custom = (token, body = {}) => request(app).post(`/api/admin/tenants/${w.tenant._id}/invoices/custom`).set(AUTH(token))
    .send({ lineItems: [{ description: 'Setup fee', qty: 1, rate: 1000 }], ...body });

beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('inv-shop');
    tenantRecognizer.invalidateTenant('inv-shop');
    boss = await f.makeSuperAdmin('boss@example.com');                        // the supreme admin
    other = await f.makeSuperAdmin('vivek@example.com', { phones: ['9876543210'] });
    await business();
});

describe('GST heads', () => {
    test('one state is CGST + SGST, two states are IGST, an unknown buyer state counts as the seller\'s', () => {
        const same = gst.split({ seller: { stateCode: '09' }, buyer: { gstin: '09BBBBB1111B1Z5' }, gstAmount: 180 });
        assert.deepEqual([same.intraState, same.cgst, same.sgst, same.igst], [true, 90, 90, 0]);
        const far = gst.split({ seller: { stateCode: '09' }, buyer: { state: 'Maharashtra' }, gstAmount: 180 });
        assert.deepEqual([far.intraState, far.cgst, far.sgst, far.igst, far.placeOfSupply.code], [false, 0, 0, 180, '27']);
        const unknown = gst.split({ seller: { stateCode: '09' }, buyer: {}, gstAmount: 18 });
        assert.equal(unknown.intraState, true);
        assert.equal(unknown.placeOfSupply.code, '09');
        const odd = gst.split({ seller: { stateCode: '09' }, buyer: { state: 'Uttar Pradesh' }, gstAmount: 0.01 });
        assert.equal(odd.cgst + odd.sgst, 0.01);   // an odd paisa is never lost
    });
});

describe('the state', () => {
    test('a state is checked and written in full: the shop address, the business, and the code follows', async () => {
        const bad = await request(app).put('/api/shop/settings').set(w.owner.headers).send({ address: { state: 'Mars' } });
        assert.equal(bad.status, 400);
        const ok = await request(app).put('/api/shop/settings').set(w.owner.headers).send({ address: { state: 'uttar pradesh' } });
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
        assert.equal((await Tenant.findById(w.tenant._id).lean()).address.state, 'Uttar Pradesh');

        assert.equal((await request(app).put('/api/admin/platform/business').set(AUTH(boss)).send({ state: 'Atlantis' })).status, 400);
        const b = await request(app).put('/api/admin/platform/business').set(AUTH(boss)).send({ state: 'karnataka', stateCode: '' });
        assert.equal(b.status, 200, JSON.stringify(b.body));
        assert.deepEqual([b.body.state, b.body.stateCode], ['Karnataka', '29']);
        assert.equal((await request(app).put('/api/admin/platform/business').set(AUTH(boss)).send({ pan: 'bad' })).status, 400);
    });
});

describe('only the supreme admin changes money', () => {
    test('an ordinary superadmin can read but not change the business, bills, fees, SMS prices, keys or the shop fee plan', async () => {
        const me = await request(app).get('/api/admin/me').set(AUTH(other));
        assert.equal(me.body.supreme, false);
        assert.equal((await request(app).get('/api/admin/me').set(AUTH(boss))).body.supreme, true);

        const base = `/api/admin/tenants/${w.tenant._id}`;
        const tries = [
            ['put', '/api/admin/platform/business', { legalName: 'Changed' }],
            ['put', '/api/admin/platform/billing', { dueDays: 3 }],
            ['put', '/api/admin/platform/sms', { ratePerSmsPaise: 50 }],
            ['put', '/api/admin/platform/tax', { gstPercent: 5 }],
            ['put', '/api/admin/platform/payments/keys', { keyId: 'x', keySecret: 'y' }],
            ['post', `${base}/invoices/custom`, { lineItems: [{ description: 'x', rate: 10 }] }],
            ['put', `${base}/billing`, {}],
            ['post', `${base}/billing/go-live`, {}],
            ['post', '/api/admin/subscriptions/invoices/generate', {}],
            ['put', base, { subscription: { fixedFee: 1 } }],
        ];
        for (const [m, url, body] of tries) {
            const r = await request(app)[m](url).set(AUTH(other)).send(body);
            assert.equal(r.status, 403, `${m} ${url} -> ${r.status}`);
            assert.equal(r.body.supremeOnly, true);
        }
        assert.equal((await request(app).get('/api/admin/platform').set(AUTH(other))).status, 200);   // reading stays open
        assert.equal((await request(app).put('/api/admin/platform/business').set(AUTH(boss)).send({ poweredBy: 'Acme' })).status, 200);
        assert.equal((await custom(boss)).status, 201);
    });
});

describe('the bill', () => {
    test('a bill inside one state carries CGST + SGST, outside it IGST, with the place of supply', async () => {
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'address.state': 'Uttar Pradesh' } });
        const a = (await custom(boss)).body;
        assert.equal(a.gstAmount, 180);
        assert.deepEqual([a.taxSplit.cgst, a.taxSplit.sgst, a.taxSplit.igst], [90, 90, 0]);
        assert.equal(a.placeOfSupply.code, '09');
        assert.equal(a.seller.pan, 'AAAAA0000A');
        assert.equal(a.reverseCharge, false);

        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'address.state': 'Karnataka' } });
        const b = (await custom(boss)).body;
        assert.deepEqual([b.taxSplit.cgst, b.taxSplit.sgst, b.taxSplit.igst, b.placeOfSupply.code], [0, 0, 180, '29']);
    });

    test('the PDF is made for both and says CGST/SGST or IGST and the place of supply', async () => {
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'address.state': 'Karnataka' } });
        const inv = (await custom(boss)).body;
        const r = await request(app).get(`/api/admin/subscriptions/invoices/${inv._id}/pdf`).set(AUTH(other)).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
        assert.equal(r.status, 200);
        assert.match(r.headers['content-type'], /pdf/);
        assert.equal(r.body.slice(0, 4).toString(), '%PDF');
    });

    test('the number follows the prefix you type, and a new prefix starts again from 0001', async () => {
        const fy = require('../src/services/platformInvoicing').financialYearOf();
        assert.equal((await custom(boss)).body.invoiceNo, `SUB/${fy}/0001`);
        assert.equal((await custom(boss)).body.invoiceNo, `SUB/${fy}/0002`);
        await request(app).put('/api/admin/platform/business').set(AUTH(boss)).send({ invoicePrefix: 'abc' });
        const short = `${fy.slice(2, 4)}-${fy.slice(5)}`;
        assert.equal((await custom(boss)).body.invoiceNo, `BABC/${short}/0001`);
        assert.equal((await custom(boss)).body.invoiceNo, `BABC/${short}/0002`);
        await request(app).put('/api/admin/platform/business').set(AUTH(boss)).send({ invoicePrefix: 'new' });
        const last = (await custom(boss)).body.invoiceNo;
        assert.equal(last, `BNEW/${short}/0001`);
        assert.ok(last.length <= 16 && /^[A-Z0-9/-]+$/.test(last), 'GST: at most 16 characters');
        assert.ok(`SUB/${fy}/0001`.length <= 16 && `BABCD/${short}/0001`.length <= 16);
        assert.equal((await request(app).put('/api/admin/platform/business').set(AUTH(boss)).send({ invoicePrefix: 'TOOLONG' })).status, 400);
        assert.equal((await request(app).put('/api/admin/platform/business').set(AUTH(boss)).send({ invoicePrefix: 'bad prefix!' })).status, 400);
    });
});

describe('credit notes', () => {
    test('voiding an issued bill issues one numbered credit note, the owner and the admin can open it', async () => {
        const inv = (await custom(boss)).body;
        const v = await request(app).patch(`/api/admin/subscriptions/invoices/${inv._id}/void`).set(AUTH(boss)).send({ reason: 'Raised by mistake' });
        assert.equal(v.status, 200, JSON.stringify(v.body));
        assert.ok(v.body.creditNoteId);
        const notes = await CreditNote.find({}).lean();
        assert.equal(notes.length, 1);
        assert.match(notes[0].invoiceNo, /^CN\/\d{4}-\d{2}\/0001$/);
        assert.equal(notes[0].originalInvoiceNo, inv.invoiceNo);
        assert.equal(notes[0].total, 1180);
        assert.equal(notes[0].reason, 'Raised by mistake');

        const pdf = (url, headers) => request(app).get(url).set(headers).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
        const a = await pdf(`/api/admin/subscriptions/credit-notes/${notes[0]._id}/pdf`, AUTH(other));
        assert.equal(a.status, 200);
        assert.equal(a.body.slice(0, 4).toString(), '%PDF');
        const o = await pdf(`/api/shop/subscription/credit-notes/${notes[0]._id}/pdf`, w.owner.headers);
        assert.equal(o.status, 200);
        const second = await f.makeWorld('inv-other');
        tenantRecognizer.invalidateTenant('inv-other');
        assert.equal((await pdf(`/api/shop/subscription/credit-notes/${notes[0]._id}/pdf`, second.owner.headers)).status, 404);   // not another shop's
    });
});

describe('SMS top-up invoice', () => {
    const paid = async (amountPaise = 20000) => {
        const t = await topups.create({ tenantId: w.tenant._id, amountPaise, actor: { type: 'owner' } });
        await topups.complete({ topupId: t._id, paymentId: 'pay_1', actor: { type: 'system' } });
        return SmsTopup.findById(t._id).lean();
    };

    test('a paid top-up gets a numbered tax invoice with GST on top, saved once, and the receipt mail carries the PDF', async () => {
        await User.updateOne({ _id: w.owner.user._id }, { $set: { email: 'owner@shop.test' } });
        const t = await paid();
        assert.match(t.invoice.invoiceNo, /^TOP\/\d{4}-\d{2}\/0001$/);
        assert.equal(t.invoice.baseAmount, 200);
        assert.equal(t.invoice.gstAmount, 36);
        assert.equal(t.invoice.total, 236);
        assert.equal(t.invoice.taxSplit.cgst + t.invoice.taxSplit.sgst, 36);
        assert.equal(t.invoice.status, 'paid');
        assert.equal((await topups.ensureInvoice(t._id)).invoiceNo, t.invoice.invoiceNo);   // not numbered twice

        await f.waitFor(async () => (await EmailJob.countDocuments({ kind: 'sms_topup_receipt' })) >= 1);
        const mail = await EmailJob.findOne({ kind: 'sms_topup_receipt' }).lean();
        assert.equal(mail.attachments.length, 1);
        assert.match(mail.attachments[0].name, /\.pdf$/);

        const r = await request(app).get(`/api/shop/sms/topups/${t._id}/invoice`).set(w.owner.headers).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
        assert.equal(r.status, 200);
        assert.equal(r.body.slice(0, 4).toString(), '%PDF');
        const list = await request(app).get('/api/shop/sms/transactions?type=topup').set(w.owner.headers);
        assert.equal(list.body.items[0].topupId, String(t._id));
        assert.equal(list.body.items[0].paymentId, undefined);
    });

    test('without a GST number on the business the top-up is a receipt with no tax; an unpaid one has no invoice', async () => {
        await PlatformSettings.updateOne({ _id: 'main' }, { $unset: { 'business.gstin': '' } });
        const t = await paid();
        assert.equal(t.gstPaise, 0);
        assert.equal(t.invoice.gstAmount, 0);
        assert.equal(t.invoice.total, 200);

        const open = await topups.create({ tenantId: w.tenant._id, amountPaise: 10000, actor: { type: 'owner' } });
        assert.equal((await request(app).get(`/api/shop/sms/topups/${open._id}/invoice`).set(w.owner.headers)).status, 409);
        assert.equal((await request(app).get('/api/shop/sms/topups/000000000000000000000000/invoice').set(w.owner.headers)).status, 404);
    });

    test('with no business name saved the invoice waits, then is made the first time it is asked for', async () => {
        await PlatformSettings.updateOne({ _id: 'main' }, { $unset: { 'business.legalName': '' } });
        const t = await paid();
        assert.equal(t.invoice, undefined);
        assert.equal((await request(app).get(`/api/shop/sms/topups/${t._id}/invoice`).set(w.owner.headers)).status, 409);
        await business();
        assert.equal((await request(app).get(`/api/shop/sms/topups/${t._id}/invoice`).set(w.owner.headers)).status, 200);
        assert.ok((await SmsTopup.findById(t._id).lean()).invoice.invoiceNo);
    });
});

describe('the GST register', () => {
    test('a month lists the bills, top-up invoices and credit notes, nets them, and exports to Excel; everyone can read it', async () => {
        const bill = (await custom(boss)).body;                         // 1000 + 180
        const topup = await topups.create({ tenantId: w.tenant._id, amountPaise: 10000, actor: { type: 'owner' } });
        await topups.complete({ topupId: topup._id, paymentId: 'pay_9', actor: { type: 'system' } });   // 100 + 18
        const b2 = (await custom(boss)).body;                           // another 1000 + 180, then cancelled
        await request(app).patch(`/api/admin/subscriptions/invoices/${b2._id}/void`).set(AUTH(boss)).send({});

        const month = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
        const r = await request(app).get(`/api/admin/platform/gst-register?month=${month}`).set(AUTH(other));
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.rows.length, 4);                            // 2 bills, 1 top-up, 1 credit note
        const note = r.body.rows.find((x) => x.type === 'Credit note');
        assert.equal(note.taxable, -1000);
        assert.equal(note.gst, -180);
        assert.equal(note.against, b2.invoiceNo);
        assert.equal(r.body.summary.taxable, 1100);                     // 1000 + 100 + 1000 - 1000
        assert.equal(r.body.summary.gst, 198);
        assert.equal(r.body.summary.cgst + r.body.summary.sgst + r.body.summary.igst, 198);
        assert.equal(r.body.summary.gstOnUnpaidBills, 180);             // the one live pending bill
        assert.equal(r.body.summary.unpaidBills, 1);
    });

    test('the Excel file, a bad month, and an empty month', async () => {
        await custom(boss);
        const month = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
        const x = await request(app).get(`/api/admin/platform/gst-register?month=${month}&format=xlsx`).set(AUTH(other)).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
        assert.equal(x.status, 200);
        assert.match(x.headers['content-type'], /spreadsheetml/);
        assert.equal(x.body.slice(0, 2).toString(), 'PK');
        assert.equal((await request(app).get('/api/admin/platform/gst-register?month=2026-13').set(AUTH(boss))).status, 400);
        const empty = await request(app).get('/api/admin/platform/gst-register?month=2020-01').set(AUTH(boss));
        assert.equal(empty.body.rows.length, 0);
        assert.equal(empty.body.summary.gst, 0);
    });
});
