require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeWorld, makeSuperAdmin } = require('./helpers/factory');
const Order = require('../src/models/Order');
const SmsTransaction = require('../src/models/SmsTransaction');
const SubscriptionInvoice = require('../src/models/SubscriptionInvoice');
const payments = require('../src/services/adapters/payments');
const paymentService = require('../src/services/paymentService');
const orderService = require('../src/services/orderService');

let seq = 5000;
let inv = 0;
const oid = () => new mongoose.Types.ObjectId();
const sign = (rzpOrderId, rzpPaymentId) => crypto.createHmac('sha256', paymentService.MOCK_SECRET).update(`${rzpOrderId}|${rzpPaymentId}`).digest('hex');
const mk = (w) => Order.create({
    tenantId: w.tenant._id, userId: w.customer.user._id, orderNo: ++seq, orderType: 'pickup',
    items: [{ productId: oid(), name: 'Dal', quantity: 1, unitPrice: 100, lineTotal: 100 }],
    pricing: { subtotal: 100, total: 100 }, payment: { method: 'upi', status: 'pending' },
});
async function paidOrder(w) {
    const order = await mk(w);
    const start = await paymentService.startForOrder({ order });
    const payId = `pay_${order.orderNo}`;
    payments._mock.setPayment({ id: payId, orderId: start.rzpOrderId, status: 'captured', amountPaise: 10000, capturedPaise: 10000, refundedPaise: 0, method: 'upi', notes: {} });
    await paymentService.verifyFromApp({ order, rzpOrderId: start.rzpOrderId, rzpPaymentId: payId, signature: sign(start.rzpOrderId, payId) });
    return order;
}
const topup = (w, paise, at, over = {}) => SmsTransaction.create({
    tenantId: w.tenant._id, type: 'topup', amountPaise: paise, balanceAfter: paise, paymentId: `topup:${oid()}`, note: 'SMS top-up', createdAt: at, ...over,
});
const invoice = (w, over = {}) => SubscriptionInvoice.create({
    tenantId: w.tenant._id, kind: 'custom', invoiceNo: `SUB/T/${++inv}`, issueDate: new Date('2026-10-01T05:00:00Z'), dueDate: new Date('2026-10-10T05:00:00Z'),
    baseAmount: 3000, total: 3540, status: 'pending', ...over,
});
const shopGet = (w, q = '') => request(app).get(`/api/shop/payments/transactions${q}`).set(w.owner.headers);

describe('J4: money ledger (owner and superadmin)', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    beforeEach(async () => { await db.clear(); payments._mock.reset(); });
    afterEach(() => mock.restoreAll());

    test('owner: received, refunded, top-ups and bills in one list, newest first, with right totals', async () => {
        const w = await makeWorld('j4-owner');
        const a = await paidOrder(w);
        const b = await paidOrder(w);
        await orderService.cancelByCustomer({ tenant: w.tenant, userId: w.customer.user._id, orderId: b._id });   // Rs 100 back
        await topup(w, 20000, new Date('2026-10-05T06:00:00Z'));
        await invoice(w, { status: 'paid', paidAt: new Date('2026-10-06T06:00:00Z'), paymentMode: 'upi', paymentRef: 'UTR123', total: 3540 });
        await invoice(w, { status: 'pending' });
        await invoice(w, { status: 'void', voidedAt: new Date() });   // never shown

        const r = await shopGet(w);
        assert.equal(r.status, 200);
        const cats = r.body.items.map((i) => i.category).sort();
        assert.deepEqual(cats, ['customer_payment', 'customer_payment', 'customer_refund', 'rent', 'rent', 'sms_topup']);
        const times = r.body.items.map((i) => new Date(i.at).getTime());
        assert.deepEqual(times, [...times].sort((x, y) => y - x));   // newest first

        const t = r.body.totals;
        assert.equal(t.inPaise, 20000);                       // two payments of Rs 100
        assert.equal(t.outPaise, 10000 + 20000 + 354000);     // refund + top-up + paid bill
        assert.equal(t.netPaise, t.inPaise - t.outPaise);
        assert.equal(t.pending.count, 1);
        assert.equal(t.pending.paise, 354000);                // pending is shown but never counted as paid
        assert.equal(r.body.total, 6);

        const pay = r.body.items.find((i) => i.category === 'customer_payment' && i.orderNo === a.orderNo);
        assert.equal(pay.direction, 'in');
        assert.equal(pay.amountPaise, 10000);
        assert.equal(pay.ref, `pay_${a.orderNo}`);
        const rent = r.body.items.find((i) => i.category === 'rent' && i.status === 'done');
        assert.equal(rent.amountPaise, 354000);
        assert.equal(rent.direction, 'out');
        assert.equal(rent.meta.paymentRef, 'UTR123');
        assert.equal(r.body.items.find((i) => i.category === 'customer_refund').amountPaise, 10000);
    });

    test('owner: filters, paging, bad input, only his shop, owner only', async () => {
        const w = await makeWorld('j4-filter');
        const other = await makeWorld('j4-filter-other');
        await topup(w, 10000, new Date('2026-09-30T20:00:00Z'));   // 1 Oct 01:30 in India
        await topup(w, 30000, new Date('2026-10-15T06:00:00Z'));
        await invoice(w, { status: 'pending' });
        await topup(other, 99900, new Date('2026-10-15T06:00:00Z'));

        const all = await shopGet(w);
        assert.equal(all.body.total, 3);
        assert.equal(all.body.totals.outPaise, 40000);   // nothing of the other shop

        const oct = await shopGet(w, '?from=2026-10-01&to=2026-10-14&category=sms_topup');
        assert.equal(oct.body.items.length, 1);          // the first one is 1 Oct in India
        assert.equal(oct.body.items[0].amountPaise, 10000);

        const pend = await shopGet(w, '?status=pending');
        assert.equal(pend.body.items.length, 1);
        assert.equal(pend.body.items[0].category, 'rent');
        assert.equal((await shopGet(w, '?status=done')).body.items.length, 2);

        const p1 = await shopGet(w, '?limit=2&page=1');
        const p2 = await shopGet(w, '?limit=2&page=2');
        assert.equal(p1.body.items.length, 2);
        assert.equal(p2.body.items.length, 1);
        assert.equal(p1.body.total, 3);

        for (const q of ['?from=nope', '?from=2026-10-31&to=2026-10-01', '?category=hack', '?status=x']) {
            assert.equal((await shopGet(w, q)).status, 400, q);
        }
        assert.ok([401, 403].includes((await request(app).get('/api/shop/payments/transactions').set(w.customer.headers)).status));
        assert.equal((await shopGet(other)).body.total, 1);
    });

    test('superadmin platform view: SMS top-ups and bills of all shops, paid and pending, with shop names', async () => {
        const w1 = await makeWorld('j4-admin-1');
        const w2 = await makeWorld('j4-admin-2');
        await paidOrder(w1);   // customer money is NOT platform income
        await topup(w1, 10000, new Date('2026-10-05T06:00:00Z'));
        await topup(w2, 25000, new Date('2026-10-06T06:00:00Z'));
        await invoice(w1, { status: 'paid', paidAt: new Date('2026-10-07T06:00:00Z'), paymentMode: 'bank_transfer', paymentRef: 'NEFT9' });
        await invoice(w2, { status: 'pending' });
        await SmsTransaction.create({ tenantId: w1.tenant._id, type: 'adjust', amountPaise: 5000, balanceAfter: 5000, note: 'free credit' });   // not money

        const { token } = await makeSuperAdmin();
        const auth = { Authorization: `Bearer ${token}` };
        const r = await request(app).get('/api/admin/ledger').set(auth);
        assert.equal(r.status, 200);
        assert.equal(r.body.total, 4);
        assert.ok(r.body.items.every((i) => ['sms_topup', 'rent'].includes(i.category) && i.direction === 'in'));
        assert.equal(r.body.totals.inPaise, 10000 + 25000 + 354000);
        assert.equal(r.body.totals.pending.paise, 354000);
        assert.equal(r.body.totals.byCategory.find((c) => c.category === 'sms_topup').paise, 35000);
        assert.ok(r.body.items.every((i) => i.shop && i.shop.slug));
        const paid = r.body.items.find((i) => i.category === 'rent' && i.status === 'done');
        assert.equal(paid.shop.slug, 'j4-admin-1');
        assert.equal(paid.ref.startsWith('SUB/T/'), true);

        const one = await request(app).get(`/api/admin/ledger?tenantId=${w2.tenant._id}`).set(auth);
        assert.equal(one.body.total, 2);
        assert.equal((await request(app).get('/api/admin/ledger?status=pending').set(auth)).body.items.length, 1);
        assert.equal((await request(app).get('/api/admin/ledger?category=customer_payment').set(auth)).status, 400);   // not a platform category
        assert.equal((await request(app).get('/api/admin/ledger?tenantId=zzz').set(auth)).status, 400);
        assert.ok([401, 403].includes((await request(app).get('/api/admin/ledger').set(w1.owner.headers)).status));
        assert.equal((await request(app).get('/api/admin/ledger')).status, 401);
    });

    test('superadmin shop view shows what that shop received from customers too, and exports a safe CSV', async () => {
        const w = await makeWorld('j4-shopview');
        await paidOrder(w);
        await topup(w, 10000, new Date('2026-10-05T06:00:00Z'), { note: '=HYPERLINK("http://x")', actor: { type: 'superadmin', label: 'admin@x.com' } });
        const { token } = await makeSuperAdmin();
        const auth = { Authorization: `Bearer ${token}` };

        const r = await request(app).get(`/api/admin/tenants/${w.tenant._id}/ledger`).set(auth);
        assert.equal(r.status, 200);
        assert.equal(r.body.total, 2);
        assert.equal(r.body.totals.inPaise, 10000);
        assert.ok(r.body.items.some((i) => i.category === 'customer_payment'));

        const csv = await request(app).get(`/api/admin/tenants/${w.tenant._id}/ledger/export`).set(auth);
        assert.equal(csv.status, 200);
        assert.match(csv.headers['content-type'], /text\/csv/);
        const lines = csv.text.trim().split('\r\n');
        assert.equal(lines.length, 3);   // header + 2 rows
        assert.match(lines[0], /Amount \(Rs\)/);
        assert.ok(csv.text.includes('100.00'));
        assert.ok(!csv.text.includes('"=HYPERLINK'));   // a formula never starts a cell

        const plat = await request(app).get('/api/admin/ledger/export').set(auth);
        assert.equal(plat.status, 200);
        assert.match(plat.text.split('\r\n')[0], /Shop/);
        assert.equal((await request(app).get(`/api/admin/tenants/${w.tenant._id}/ledger/export`).set(w.owner.headers)).status === 200, false);
    });
})