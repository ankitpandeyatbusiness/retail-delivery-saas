require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const PlatformSettings = require('../src/models/PlatformSettings');
const SettlementEntry = require('../src/models/SettlementEntry');
const Notification = require('../src/models/Notification');
const Tenant = require('../src/models/Tenant');
const topups = require('../src/services/smsTopupService');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');

// The common settlement sheet: a row appears by itself when a shop pays, the split follows who brought the shop, shared costs
// are 50/50, the partner can only say "I have paid", the supreme admin confirms, and rows can be set off against each other.
let w; let boss; let vivek;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });

const AUTH = (t) => ({ Authorization: `Bearer ${t.token}` });
const api = (m, url, who, body) => request(app)[m](`/api/admin${url}`).set(AUTH(who)).send(body);

beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('set-shop');
    tenantRecognizer.invalidateTenant('set-shop');
    boss = await f.makeSuperAdmin('boss@example.com');                                         // the supreme admin
    vivek = await f.makeSuperAdmin('vivek@example.com', { phones: ['9876543210'] });           // the partner
    await PlatformSettings.findByIdAndUpdate('main', {
        $set: { 'business.legalName': 'Operator Pvt Ltd', 'business.gstin': '09AAAAA0000A1Z5', 'business.state': 'Uttar Pradesh', 'business.stateCode': '09', 'settlement.ownerName': 'Ankit', 'settlement.partnerName': 'Vivek' },
    }, { upsert: true });
});

const pay = async (rate = 1000, body = { paymentMode: 'bank_transfer' }) => {
    const inv = (await api('post', `/tenants/${w.tenant._id}/invoices/custom`, boss, { lineItems: [{ description: 'Rent', qty: 1, rate }] })).body;
    const r = await api('patch', `/subscriptions/invoices/${inv._id}/status`, boss, { status: 'paid', ...body });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await f.waitFor(async () => (await SettlementEntry.countDocuments({ invoiceId: inv._id })) === 1);
    return { inv, row: await SettlementEntry.findOne({ invoiceId: inv._id }).lean() };
};
const mark = (by) => api('put', `/settlement/shops/${w.tenant._id}/brought-by`, boss, { broughtBy: by });

describe('a shop pays', () => {
    test('a row appears by itself: shares of the amount BEFORE GST, who owes whom, the 15-day due date and the timeline', async () => {
        await mark('partner');
        const { row } = await pay(1000);                       // + 18% GST = 1180 received
        assert.equal(row.kind, 'receipt');
        assert.equal(row.category, 'setup');
        assert.equal(row.baseAmount, 1000);
        assert.equal(row.totalAmount, 1180);
        assert.deepEqual([row.ratio.ownerPct, row.ownerShare, row.partnerShare], [50, 500, 500]);
        assert.equal(row.receivedBy, 'partner');
        assert.deepEqual([row.owes, row.dueAmount, row.status], ['partner', 500, 'pending']);
        assert.equal(Math.round((new Date(row.dueAt) - new Date(row.date)) / 86400000), 15);
        assert.equal(row.events[0].action, 'created');
        assert.equal(row.no, 1);
    });

    test('a shop the owner brought is 70 / 30; an unmarked shop uses the partner ratio and says so', async () => {
        const first = await pay(1000);                                     // not marked yet
        assert.equal(first.row.broughtBy, null);
        assert.equal(first.row.ownerShare, 500);
        await mark('owner');
        const second = await pay(1000);
        assert.deepEqual([second.row.ratio.ownerPct, second.row.ownerShare, second.row.dueAmount], [70, 700, 700]);
        const alert = await Notification.findOne({ type: 'admin_settlement_due' }).sort({ createdAt: 1 }).lean();
        assert.match(alert.body, /not marked/);
        assert.equal(alert.supremeOnly, true);
    });

    test('marking a shop later fixes the open rows, and never rewrites a row that money was already settled on', async () => {
        const a = await pay(1000);
        const b = await pay(1000);
        await api('post', `/settlement/entries/${b.row._id}/paid`, boss, { amount: 100, ref: 'UPI1' });
        const r = await mark('owner');
        assert.equal(r.body.rowsChanged, 1);
        assert.equal(r.body.rowsLocked, 1);
        assert.equal((await SettlementEntry.findById(a.row._id).lean()).ownerShare, 700);
        assert.equal((await SettlementEntry.findById(b.row._id).lean()).ownerShare, 500);
    });

    test('an SMS top-up is a row too, on its amount before GST', async () => {
        await mark('owner');
        const t = await topups.create({ tenantId: w.tenant._id, amountPaise: 20000, actor: { type: 'owner' } });
        await topups.complete({ topupId: t._id, paymentId: 'pay_1', actor: { type: 'system' } });
        await f.waitFor(async () => (await SettlementEntry.countDocuments({ category: 'topup' })) === 1);
        const row = await SettlementEntry.findOne({ category: 'topup' }).lean();
        assert.deepEqual([row.baseAmount, row.gstAmount, row.totalAmount, row.ownerShare, row.dueAmount], [200, 36, 236, 140, 140]);
        await topups.complete({ topupId: t._id, paymentId: 'pay_1', actor: { type: 'system' } });   // again
        assert.equal(await SettlementEntry.countDocuments({ category: 'topup' }), 1);
    });

    test('money received by the owner himself: the owner owes the partner his share', async () => {
        await mark('owner');
        const { row } = await pay(1000, { paymentMode: 'cash', receivedBy: 'owner' });
        assert.deepEqual([row.receivedBy, row.owes, row.dueAmount], ['owner', 'owner', 300]);
        assert.equal((await api('patch', `/subscriptions/invoices/${(await SettlementEntry.findById(row._id)).invoiceId}/status`, boss, { status: 'paid', receivedBy: 'nobody' })).status, 400);
    });

    test('undoing the payment cancels the row; paying again brings it back; it is the same row', async () => {
        const { inv, row } = await pay(1000);
        await api('patch', `/subscriptions/invoices/${inv._id}/status`, boss, { status: 'pending' });
        assert.equal((await SettlementEntry.findById(row._id).lean()).voided, true);
        assert.equal((await api('get', '/settlement/summary', vivek)).body.partnerOwesOwner, 0);
        await api('patch', `/subscriptions/invoices/${inv._id}/status`, boss, { status: 'paid', paymentMode: 'upi' });
        await f.waitFor(async () => !(await SettlementEntry.findById(row._id).lean()).voided);
        assert.equal(await SettlementEntry.countDocuments({}), 1);
        assert.equal((await api('get', '/settlement/summary', vivek)).body.partnerOwesOwner, 500);
    });

    test('in owner_only mode (after the switch) everything is the owner\'s and nobody owes', async () => {
        await api('put', '/settlement/config', boss, { mode: 'owner_only' });
        const { row } = await pay(1000);
        assert.deepEqual([row.ownerShare, row.partnerShare, row.owes, row.dueAmount, row.status, row.receivedBy], [1000, 0, null, 0, 'paid', 'owner']);
    });
});

describe('shared costs', () => {
    test('a cost is split 50 / 50 and the other partner owes his half', async () => {
        const a = await api('post', '/settlement/costs', boss, { category: 'sms_recharge', title: 'SMS recharge', amount: 5000, paidBy: 'partner' });
        assert.equal(a.status, 201, JSON.stringify(a.body));
        assert.deepEqual([a.body.owes, a.body.dueAmount, a.body.ownerShare, a.body.partnerShare], ['owner', 2500, 2500, 2500]);
        const b = await api('post', '/settlement/costs', boss, { category: 'server', amount: 3001, paidBy: 'owner', date: '2026-10-01' });
        assert.deepEqual([b.body.owes, b.body.dueAmount], ['partner', 1500.5]);
        for (const bad of [{ category: 'lunch', amount: 10, paidBy: 'owner' }, { category: 'api', amount: 0, paidBy: 'owner' }, { category: 'api', amount: 5, paidBy: 'me' }]) {
            assert.equal((await api('post', '/settlement/costs', boss, bad)).status, 400);
        }
    });
});

describe('paying and the "I have paid" note', () => {
    test('partial then full payment, with the timeline; too much is refused', async () => {
        const { row } = await pay(1000);                                    // partner owes 500
        const p1 = await api('post', `/settlement/entries/${row._id}/paid`, boss, { amount: 200, date: '2026-10-05', ref: 'UPI123', note: 'first part' });
        assert.equal(p1.status, 200, JSON.stringify(p1.body));
        assert.deepEqual([p1.body.paidAmount, p1.body.status], [200, 'partial']);
        assert.equal((await api('post', `/settlement/entries/${row._id}/paid`, boss, { amount: 301 })).status, 400);
        const p2 = await api('post', `/settlement/entries/${row._id}/paid`, boss, { amount: 300 });
        assert.deepEqual([p2.body.paidAmount, p2.body.status], [500, 'paid']);
        const e = (await api('get', `/settlement/entries/${row._id}`, vivek)).body;
        assert.deepEqual(e.events.map((x) => x.action), ['created', 'paid', 'paid']);
        assert.equal(e.events[1].ref, 'UPI123');
        assert.equal(e.events[1].by.name, 'Boss');
    });

    test('the partner can only add a note; the supreme admin confirms or rejects it', async () => {
        const { row } = await pay(1000);
        for (const url of [`/settlement/entries/${row._id}/paid`, `/settlement/entries/${row._id}/claim/confirm`, '/settlement/costs']) {
            assert.equal((await api('post', url, vivek, { amount: 500, category: 'api', paidBy: 'owner' })).status, 403);
        }
        assert.equal((await api('put', '/settlement/config', vivek, { payDays: 3 })).status, 403);
        assert.equal((await api('put', `/settlement/shops/${w.tenant._id}/brought-by`, vivek, { broughtBy: 'partner' })).status, 403);

        const c = await api('post', `/settlement/entries/${row._id}/claim`, vivek, { amount: 500, ref: 'NEFT9', note: 'sent today' });
        assert.equal(c.status, 200, JSON.stringify(c.body));
        assert.equal(c.body.claim.state, 'open');
        assert.equal(c.body.paidAmount, 0);                                  // only a note
        assert.equal((await api('get', '/settlement/summary', boss)).body.claims, 1);
        const ok = await api('post', `/settlement/entries/${row._id}/claim/confirm`, boss);
        assert.deepEqual([ok.body.status, ok.body.paidAmount, ok.body.claim.state], ['paid', 500, 'confirmed']);

        const other = await pay(1000);
        await api('post', `/settlement/entries/${other.row._id}/claim`, vivek, { amount: 100 });
        const no = await api('post', `/settlement/entries/${other.row._id}/claim/reject`, boss, { note: 'not received' });
        assert.deepEqual([no.body.claim.state, no.body.paidAmount], ['rejected', 0]);
        assert.equal((await api('post', `/settlement/entries/${other.row._id}/claim/confirm`, boss)).status, 409);
    });
});

describe('set-off', () => {
    test('your example: Rs 5,000 recharge paid by the partner against Rs 4,000 rent from the owner\'s shop leaves Rs 300', async () => {
        await mark('owner');
        const cost = (await api('post', '/settlement/costs', boss, { category: 'sms_recharge', amount: 5000, paidBy: 'partner' })).body;   // owner owes 2500
        const rent = await pay(4000);                                                                                                       // partner owes 70% = 2800
        assert.equal(rent.row.dueAmount, 2800);
        assert.equal((await api('post', '/settlement/setoff', boss, { fromPartnerId: rent.row._id, fromOwnerId: cost._id, amount: 2500 })).status, 400);   // a reason is needed
        const r = await api('post', '/settlement/setoff', boss, { fromPartnerId: rent.row._id, fromOwnerId: cost._id, amount: 2500, reason: 'Recharge of 12 Oct against rent' });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.amount, 2500);
        const [c, t] = await Promise.all([SettlementEntry.findById(cost._id).lean(), SettlementEntry.findById(rent.row._id).lean()]);
        assert.deepEqual([c.status, c.paidAmount], ['paid', 2500]);
        assert.deepEqual([t.status, t.paidAmount], ['partial', 2500]);
        assert.equal(t.events.at(-1).action, 'setoff');
        assert.equal(t.events.at(-1).note, 'Recharge of 12 Oct against rent');
        const s = (await api('get', '/settlement/summary', vivek)).body;
        assert.equal(s.partnerOwesOwner, 300);
        assert.equal(s.ownerOwesPartner, 0);
        assert.deepEqual(s.netOwed, { from: 'partner', to: 'owner', amount: 300 });

        const rows = [rent.row, cost];                                                                                                     // wrong directions are refused
        assert.equal((await api('post', '/settlement/setoff', boss, { fromPartnerId: cost._id, fromOwnerId: rent.row._id, amount: 10, reason: 'x' })).status, 400);
        assert.equal(rows.length, 2);
        assert.equal((await api('post', '/settlement/setoff', boss, { fromPartnerId: rent.row._id, fromOwnerId: cost._id, amount: 10, reason: 'x' })).status, 400);   // nothing left on the cost row
    });
});

describe('reading the sheet', () => {
    test('filters, late rows, the net, an Excel file; everybody can read; the supreme admin\'s alerts are his alone', async () => {
        await mark('partner');
        const a = await pay(1000);
        await SettlementEntry.updateOne({ _id: a.row._id }, { $set: { dueAt: new Date(Date.now() - 3 * 86400000) } });
        await pay(2000);
        await api('post', '/settlement/costs', boss, { category: 'server', amount: 1000, paidBy: 'owner' });

        const late = await api('get', '/settlement/entries?status=late', vivek);
        assert.equal(late.body.items.length, 1);
        assert.equal(late.body.items[0].late, true);
        assert.equal((await api('get', '/settlement/entries?kind=cost', vivek)).body.items.length, 1);
        assert.equal((await api('get', '/settlement/entries?status=paid', vivek)).body.items.length, 0);
        const s = (await api('get', '/settlement/summary', vivek)).body;
        assert.equal(s.partnerOwesOwner, 500 + 1000 + 500);                    // two rents + his half of the server cost
        assert.equal(s.lateRows, 1);
        assert.equal(s.config.partnerName, 'Vivek');

        const x = await request(app).get('/api/admin/settlement/export').set(AUTH(vivek)).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
        assert.equal(x.status, 200);
        assert.equal(x.body.slice(0, 2).toString(), 'PK');
        assert.equal((await api('get', '/settlement/summary?month=2026-13', vivek)).status, 400);

        // the alerts: the supreme admin sees them, the other superadmin does not, and cannot clear them
        const mine = (await api('get', '/notifications', boss)).body.items.filter((n) => n.type === 'admin_settlement_due');
        const his = (await api('get', '/notifications', vivek)).body.items.filter((n) => n.type === 'admin_settlement_due');
        assert.equal(mine.length, 2);
        assert.equal(his.length, 0);
        await api('delete', '/notifications', vivek);
        assert.equal((await api('get', '/notifications', boss)).body.items.filter((n) => n.type === 'admin_settlement_due').length, 2);
    });

    test('the names and the ratios are settings only the supreme admin changes, and they are checked', async () => {
        const ok = await api('put', '/settlement/config', boss, { ownerName: 'Ankit', partnerName: 'Vivek', payDays: 10, ownerPctOwnerBrought: 80 });
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
        assert.deepEqual([ok.body.payDays, ok.body.ownerPctOwnerBrought, ok.body.ownerPctPartnerBrought], [10, 80, 50]);
        for (const bad of [{ payDays: 100 }, { ownerPctOwnerBrought: 101 }, { mode: 'half' }, { partnerName: '' }, {}]) {
            assert.equal((await api('put', '/settlement/config', boss, bad)).status, 400, JSON.stringify(bad));
        }
        const t = await api('post', '/tenants', boss, { slug: 'new-one', name: 'New One', broughtBy: 'owner' });
        assert.equal(t.status, 201, JSON.stringify(t.body));
        assert.equal((await Tenant.findOne({ slug: 'new-one' }).lean()).broughtBy, 'owner');
        const t2 = await api('post', '/tenants', vivek, { slug: 'new-two', name: 'New Two', broughtBy: 'owner' });
        assert.equal(t2.status, 201, JSON.stringify(t2.body));
        assert.equal((await Tenant.findOne({ slug: 'new-two' }).lean()).broughtBy, undefined);   // only the supreme admin marks it
    });
});
