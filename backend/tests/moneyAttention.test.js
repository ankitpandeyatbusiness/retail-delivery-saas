require('./helpers/env');
// Money tab: what needs attention today, and the checks that the money adds up.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const SubscriptionInvoice = require('../src/models/SubscriptionInvoice');
const PaymentWebhookEvent = require('../src/models/PaymentWebhookEvent');
const OnlineRefund = require('../src/models/OnlineRefund');
const SmsWallet = require('../src/models/SmsWallet');
const SmsTopup = require('../src/models/SmsTopup');
const SmsTransaction = require('../src/models/SmsTransaction');

let token;
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); token = (await f.makeSuperAdmin('root@test.com')).token; });
const auth = () => ({ Authorization: 'Bearer ' + token });
const get = async () => (await request(app).get('/api/admin/finance/attention').set(auth())).body;

describe('money attention', () => {
    test('a quiet platform has nothing to look at', async () => {
        const b = await get();
        assert.deepEqual(b.items, []);
        assert.equal(b.counts.total, 0);
    });

    test('lists overdue bills, failed refunds and events, low wallets and a paid top-up that was never credited', async () => {
        const w = await f.makeWorld('ma-' + Date.now().toString(36));
        await SubscriptionInvoice.create({ tenantId: w.tenant._id, kind: 'custom', invoiceNo: 'MA/1', issueDate: new Date(Date.now() - 10 * 86400000), dueDate: new Date(Date.now() - 3 * 86400000), baseAmount: 1000, gstPercent: 18, gstAmount: 180, total: 1180, status: 'pending' });
        await SubscriptionInvoice.create({ tenantId: w.tenant._id, kind: 'custom', invoiceNo: 'MA/2', issueDate: new Date(), dueDate: new Date(Date.now() + 5 * 86400000), baseAmount: 100, gstPercent: 18, gstAmount: 18, total: 118, status: 'pending' });
        const o = await f.makeOrder(w.tenant, w.customer.user, {});
        await OnlineRefund.create({ tenantId: w.tenant._id, orderId: o._id, paymentId: new mongoose.Types.ObjectId(), rzpPaymentId: 'pay_1', amountPaise: 25000, key: 'ma-k1', status: 'failed' });
        await PaymentWebhookEvent.create({ account: 'platform', eventId: 'evt_1', event: 'payment.captured', status: 'failed', error: 'signature did not match' });
        await SmsWallet.create({ tenantId: w.tenant._id, balancePaise: 100 });
        const paid = await SmsTopup.create({ tenantId: w.tenant._id, amountPaise: 10000, status: 'paid', paidAt: new Date(), paymentId: 'pay_topup_1' });
        const okTop = await SmsTopup.create({ tenantId: w.tenant._id, amountPaise: 5000, status: 'paid', paidAt: new Date(), paymentId: 'pay_topup_2' });
        await SmsTransaction.create({ tenantId: w.tenant._id, type: 'topup', amountPaise: 5000, paymentId: 'pay_topup_2' });
        assert.ok(paid && okTop);

        const b = await get();
        const by = Object.fromEntries(b.items.map((i) => [i.key, i]));
        assert.equal(by.overdue.count, 1);
        assert.equal(by.overdue.paise, 118000);
        assert.equal(by.refunds_failed.count, 1);
        assert.equal(by.refunds_failed.paise, 25000);
        assert.equal(by.webhook_failed.count, 1);
        assert.match(by.webhook_failed.hint, /signature/);
        assert.equal(by.sms_low.count, 1);
        assert.equal(by.topup_uncredited.count, 1, 'only the top-up with no credit row');
        assert.equal(b.items[0].level, 'bad', 'the red ones come first');
        assert.equal(b.counts.total, b.items.length);
    });
});
