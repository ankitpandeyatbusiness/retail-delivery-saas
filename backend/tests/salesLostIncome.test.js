require('./helpers/env');
// Sales report: money lost (cancelled, not delivered, refunded) by who caused it, and the platform's own income.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const Order = require('../src/models/Order');
const OnlineRefund = require('../src/models/OnlineRefund');

let token;
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); token = (await f.makeSuperAdmin('root@test.com')).token; });
const auth = () => ({ Authorization: 'Bearer ' + token });
const range = () => ({ from: new Date(Date.now() - 5 * 86400000).toISOString(), to: new Date(Date.now() + 60000).toISOString() });

describe('sales lost and income', () => {
    test('lost sales are split by who caused them, with refunds', async () => {
        const w = await f.makeWorld('sl-' + Date.now().toString(36));
        const mk = async (patch) => { const o = await f.makeOrder(w.tenant, w.customer.user, {}); await Order.collection.updateOne({ _id: o._id }, { $set: { 'pricing.total': 200, ...patch } }); return o; };
        const a = await mk({ status: 'cancelled', cancelledBy: 'shop' });
        await mk({ status: 'cancelled', cancelledBy: 'customer', 'cancel.keptPaise': 5000 });
        await mk({ status: 'undelivered', 'undelivered.reasonCode': 'customer' });
        await mk({ status: 'delivered' });
        await OnlineRefund.create({ tenantId: w.tenant._id, orderId: a._id, paymentId: new mongoose.Types.ObjectId(), rzpPaymentId: 'pay_x', amountPaise: 20000, key: 'k-lost', status: 'processed', reason: 'shop_reject', processedAt: new Date() });

        const r = await request(app).get('/api/admin/reports/lost').query(range()).set(auth());
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.orders, 4);
        assert.equal(r.body.lost.count, 3);
        assert.equal(r.body.lost.value, 600);
        assert.equal(r.body.lost.sharePct, 75);
        assert.equal(r.body.shopCaused.count, 1);
        assert.equal(r.body.customerCaused.count, 2, 'a customer cancel and a customer not at home');
        assert.equal(r.body.shops[0].count, 3);
        assert.equal(r.body.refunds.count, 1);
        assert.equal(r.body.refunds.paise, 20000);
        assert.equal(r.body.refunds.byReason[0].reason, 'shop_reject');

        const one = await request(app).get('/api/admin/reports/lost').query({ ...range(), tenantId: String(w.tenant._id) }).set(auth());
        assert.equal(one.body.lost.count, 3);
        assert.equal((await request(app).get('/api/admin/reports/lost').query({ tenantId: 'x' }).set(auth())).status, 400);
    });

    test('income: plans collected this month', async () => {
        const w = await f.makeWorld('si-' + Date.now().toString(36));
        await require('./helpers/planPay').paidPlan(w.tenant._id, { baseRs: 1000 });
        const r = await request(app).get('/api/admin/reports/income').set(auth());
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.billedPaise, 118000);
        assert.equal(r.body.collectedPaise, 118000);
        assert.equal(r.body.rentIncomePaise, 100000);
        assert.equal(r.body.owedPaise, 0);
    });
});
