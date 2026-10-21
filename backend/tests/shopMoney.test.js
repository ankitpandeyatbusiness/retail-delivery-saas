require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const db = require('./helpers/db');
const app = require('../src/server/app');
const f = require('./helpers/factory');
const OnlinePayment = require('../src/models/OnlinePayment');
const OnlineRefund = require('../src/models/OnlineRefund');
const TableSession = require('../src/models/TableSession');
const Complaint = require('../src/models/Complaint');

// The Transactions tab: every rupee in and out, online and offline, with who, what, how and when; filters; the totals add up.
let w; let seq = 0;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => { await db.clear(); w = await f.makeWorld('money-shop-' + (++seq)); });

const get = (qs = '') => request(app).get(`/api/shop/payments/all${qs}`).set(w.owner.headers);
const at = (iso) => new Date(iso);
const paise = (n) => Math.round(n * 100);

async function seed() {
    // online: Rs 540 paid on 20 Oct, Rs 100 of it refunded on 21 Oct
    const online = await f.makeOrder(w.tenant, w.customer.user, { status: 'delivered', pricing: { total: 540 }, payment: { method: 'upi', status: 'paid', paidAt: at('2026-10-20T08:00:00Z') } });
    const op = await OnlinePayment.create({ tenantId: w.tenant._id, orderId: online._id, rzpOrderId: 'order_1', rzpPaymentId: 'pay_1', amountPaise: paise(540), capturedPaise: paise(540), status: 'captured', capturedAt: at('2026-10-20T08:00:00Z'), method: 'upi' });
    await OnlineRefund.create({ tenantId: w.tenant._id, orderId: online._id, paymentId: op._id, rzpPaymentId: 'pay_1', rzpRefundId: 'rfnd_1', amountPaise: paise(100), status: 'processed', processedAt: at('2026-10-21T08:00:00Z'), reason: 'complaint', key: 'k1' });
    // cash on delivery, Rs 300, delivered 21 Oct
    const cod = await f.makeOrder(w.tenant, w.customer.user, { status: 'delivered', pricing: { total: 300, tip: 20 }, deliveredAt: at('2026-10-21T10:00:00Z'), payment: { method: 'cod', status: 'paid' } });
    // pickup paid at the counter, Rs 150, 22 Oct
    const pick = await f.makeOrder(w.tenant, w.customer.user, { status: 'delivered', orderType: 'pickup', pricing: { total: 150 }, deliveredAt: at('2026-10-22T10:00:00Z'), payment: { method: 'cod', status: 'paid', paidAt: at('2026-10-22T10:00:00Z') } });
    // a table bill of Rs 800 settled by the waiter in cash on 22 Oct, and its rounds must not be counted again
    const sess = await TableSession.create({ tenantId: w.tenant._id, table: '4', status: 'closed', customers: [w.customer.user._id], closedAt: at('2026-10-22T14:00:00Z'), closedBy: 'staff', closedByName: 'Suresh', paidVia: 'cash', paidPaise: paise(800) });
    await f.makeOrder(w.tenant, w.customer.user, { status: 'delivered', orderType: 'dine_in', tableNo: '4', tableSessionId: sess._id, pricing: { total: 800 }, payment: { method: 'cod', status: 'paid', settledAt: at('2026-10-22T14:00:00Z'), settledVia: 'cash' } });
    // a refund given in cash for a complaint, Rs 50, 23 Oct
    await Complaint.create({ tenantId: w.tenant._id, orderId: cod._id, orderNo: cod.orderNo, userId: w.customer.user._id, type: 'quality', text: 'cold food', status: 'resolved', resolution: 'refund_partial', refundPaise: paise(50), refundStatus: 'noted', decidedAt: at('2026-10-23T09:00:00Z') });
    return { online, cod, pick, sess };
}

describe('the Transactions tab', () => {
    test('online and offline money in, refunds out, each with who and how; the table bill is counted once; totals add up', async () => {
        const s = await seed();
        const r = await get();
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const by = (c) => r.body.items.filter((x) => x.category === c);
        assert.equal(r.body.total, 6, 'online, refund, cod, pickup, table bill, cash refund: the dine in round is not listed again');

        const on = by('online')[0];
        assert.equal(on.amountPaise, paise(540)); assert.equal(on.how, 'online'); assert.equal(on.ref, 'pay_1'); assert.equal(on.orderNo, s.online.orderNo);
        assert.equal(on.direction, 'in'); assert.ok(on.customer);

        const door = by('cash_delivery')[0];
        assert.equal(door.amountPaise, paise(300)); assert.equal(door.how, 'cash'); assert.match(door.by, /Rider/); assert.equal(door.meta.tipPaise, paise(20));

        const pick = by('cash_pickup')[0];
        assert.equal(pick.amountPaise, paise(150)); assert.equal(pick.orderType, 'pickup'); assert.match(pick.by, /counter/);

        const bill = by('table_bill')[0];
        assert.equal(bill.amountPaise, paise(800)); assert.equal(bill.how, 'cash'); assert.equal(bill.by, 'Waiter Suresh'); assert.equal(bill.table, '4');

        assert.equal(by('refund_online')[0].amountPaise, paise(100));
        const cashBack = by('refund_cash')[0];
        assert.equal(cashBack.direction, 'out'); assert.equal(cashBack.amountPaise, paise(50)); assert.equal(cashBack.orderNo, s.cod.orderNo);

        assert.equal(r.body.totals.inPaise, paise(540 + 300 + 150 + 800));
        assert.equal(r.body.totals.outPaise, paise(100 + 50));
        assert.equal(r.body.totals.netPaise, paise(540 + 300 + 150 + 800 - 150));
        const how = Object.fromEntries(r.body.totals.byHow.map((h) => [h.how, h.paise]));
        assert.equal(how.online, paise(540)); assert.equal(how.cash, paise(300 + 150 + 800));
        assert.ok(new Date(r.body.items[0].at) >= new Date(r.body.items[r.body.items.length - 1].at), 'newest first');
    });

    test('filters: one day, a month, a date range, in or out, how, a type and an order number', async () => {
        const s = await seed();
        assert.equal((await get('?date=2026-10-21')).body.total, 2, 'the refund and the cash on delivery');
        assert.equal((await get('?month=2026-10')).body.total, 6);
        assert.equal((await get('?month=2026-09')).body.total, 0);
        assert.equal((await get('?from=2026-10-22&to=2026-10-23')).body.total, 3);
        const out = await get('?direction=out');
        assert.equal(out.body.total, 2); assert.ok(out.body.items.every((x) => x.direction === 'out'));
        const cash = await get('?how=cash&direction=in');
        assert.equal(cash.body.total, 3);
        assert.equal((await get('?category=table_bill')).body.total, 1);
        const q = await get(`?q=${s.cod.orderNo}`);
        assert.ok(q.body.items.length >= 2 && q.body.items.every((x) => x.orderNo === s.cod.orderNo), 'the door payment and the cash refund of that order');
        assert.equal((await get('?month=2026-13')).status, 400);
        assert.equal((await get('?from=2026-10-23&to=2026-10-01')).status, 400);
        assert.equal((await get('?category=nope')).status, 400);
        assert.equal((await get('?how=nope')).status, 400);
        assert.equal((await get('?q=abc')).status, 400);
    });

    test('pages, a spreadsheet, and another shop\'s money is never in the list', async () => {
        await seed();
        const p1 = await get('?limit=4');
        assert.equal(p1.body.items.length, 4); assert.equal(p1.body.total, 6);
        const p2 = await get('?limit=4&page=2');
        assert.equal(p2.body.items.length, 2);
        const csv = await get('?format=csv');
        assert.equal(csv.status, 200);
        assert.match(csv.headers['content-type'], /text\/csv/);
        assert.equal(csv.text.trim().split('\r\n').length, 7, 'a header and six rows');
        assert.match(csv.text, /Waiter Suresh/);

        const other = await f.makeWorld('money-other-' + (++seq));
        await f.makeOrder(other.tenant, other.customer.user, { status: 'delivered', pricing: { total: 999 }, deliveredAt: at('2026-10-21T10:00:00Z'), payment: { method: 'cod', status: 'paid' } });
        assert.equal((await get()).body.total, 6);
        assert.equal((await request(app).get('/api/shop/payments/all').set({ 'x-tenant-slug': w.tenant.slug })).status >= 400, true);
    });
});
