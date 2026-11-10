require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const Tenant = require('../src/models/Tenant');
const PlanPayment = require('../src/models/PlanPayment');
const PartnerTopup = require('../src/models/PartnerTopup');
const PartnerWallet = require('../src/models/PartnerWallet');
const PlatformRefund = require('../src/models/PlatformRefund');
const PlatformDispute = require('../src/models/PlatformDispute');
const PlatformSettings = require('../src/models/PlatformSettings');
const payments = require('../src/services/adapters/payments');
const adminAlerts = require('../src/services/adminAlerts');
const wallet = require('../src/services/partnerWalletService');
const sales = require('../src/services/platformSales');
const planService = require('../src/services/planService');
const disputeService = require('../src/services/disputeService');

// Bank disputes on what a shop paid the platform (plan, wallet, SMS): told once, no double refund while open, taken back when lost.
let w; let supreme; let n = 0; let alerts; let asked;
const DAY = 86400000;
const call = (a, m, p, b) => request(app)[m](`/api/admin${p}`).set({ Authorization: `Bearer ${a.token}` }).send(b);
const event = (name, extra = {}) => disputeService.onDisputeEvent({ account: 'platform', name, entity: { id: 'disp_1', payment_id: 'pay_top1', amount: 59000, reason_code: 'fraudulent', ...extra } });
const topup = async () => {
    await PartnerTopup.create({ tenantId: w.tenant._id, amountPaise: 50000, gstPercent: 18, gstPaise: 9000, payablePaise: 59000, status: 'paid', paymentId: 'pay_top1', paidAt: new Date() });
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { plan: { id: 'partner' } } });
    await wallet.credit({ tenantId: w.tenant._id, amountPaise: 50000, type: 'topup', paymentId: 'pay_top1' });
};
const balance = async () => (await PartnerWallet.findOne({ tenantId: w.tenant._id }).lean()).balancePaise;
const biz = () => PlatformSettings.updateOne({ _id: 'main' }, { $set: { 'business.gstin': '09AAAAA0000A1Z5', 'business.legalName': 'Test Co', 'business.state': 'Uttar Pradesh', 'business.address': 'Lucknow' } }, { upsert: true });

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld(`disp-${++n}`);
    supreme = await f.makeSuperAdmin();
    alerts = []; asked = [];
    mock.method(adminAlerts, 'alert', async (key, p) => { alerts.push({ key, ...p }); return null; });
    mock.method(payments, 'refund', async (a) => { asked.push(a); return { refundId: `rfnd_${asked.length}`, status: 'processed', amountPaise: a.amountPaise }; });
});
afterEach(() => mock.restoreAll());

describe('a dispute on a wallet top-up', () => {
    test('it is recorded and told once; a repeat of the same event does nothing', async () => {
        await topup();
        assert.deepEqual(await event('payment.dispute.created'), { dispute: 'created' });
        assert.equal(alerts.filter((a) => a.key === 'admin_platform_dispute').length, 1);
        assert.match(alerts[0].vars.summary, /wallet top-up of Rs 590\.00/);
        assert.equal((await event('payment.dispute.created')).duplicate, true);
        assert.equal(alerts.length, 1);
        assert.equal((await PlatformDispute.findOne().lean()).status, 'created');
    });

    test('while it is open, an emergency refund of the same top-up is refused', async () => {
        await topup();
        await event('payment.dispute.created');
        const r = await call(supreme, 'post', `/tenants/${w.tenant._id}/refunds`, { kind: 'wallet', amountPaise: 20000, requestId: 'req-dispute-1', reason: 'owner asked' });
        assert.equal(r.status, 409);
        assert.match(r.body.error, /in a dispute with the bank/);
        assert.equal(asked.length, 0);
        assert.equal(await balance(), 50000);
    });

    test('LOST: the wallet money comes out (the wallet may go below zero), a credit note and a minus row are made, and a repeat does nothing', async () => {
        await biz();
        await topup();
        await wallet.manualDebit({ tenantId: w.tenant._id, amountPaise: 30000, note: 'spent' });   // the shop already used part of it
        await event('payment.dispute.created');
        await event('payment.dispute.lost');
        assert.equal(await balance(), 20000 - 50000);                       // 500 of wallet money taken back from what is left
        const r = await PlatformRefund.findOne({ key: 'dispute:disp_1' }).lean();
        assert.equal(r.status, 'processed');
        assert.equal(r.cashPaise, 59000);
        assert.equal(r.walletPaise, 50000);
        assert.match(r.creditNote.invoiceNo, /\//);
        const neg = (await sales.paid({ tenantId: w.tenant._id })).find((x) => x.refund);
        assert.equal(neg.total, -590);
        assert.equal((await PlatformDispute.findOne().lean()).clawedBack, true);
        assert.equal((await event('payment.dispute.lost')).duplicate, true);
        assert.equal(await balance(), -30000);                              // not taken twice
        assert.equal(alerts.filter((a) => /LOST/.test(a.vars?.summary || '')).length, 1);
    });

    test('WON: nothing is taken, and a refund of the top-up is possible again afterwards', async () => {
        await topup();
        await event('payment.dispute.created');
        await event('payment.dispute.won');
        assert.equal(await balance(), 50000);
        assert.equal(await PlatformRefund.countDocuments(), 0);
        const r = await call(supreme, 'post', `/tenants/${w.tenant._id}/refunds`, { kind: 'wallet', amountPaise: 20000, requestId: 'req-dispute-2', reason: 'owner asked' });
        assert.equal(r.status, 201);
    });

    test('a dispute on a payment we do not know only alerts the superadmin', async () => {
        await topup();
        const r = await event('payment.dispute.created', { payment_id: 'pay_unknown' });
        assert.equal(r.ignored, 'unknown_payment');
        assert.equal(alerts.length, 1);
        assert.equal(await PlatformDispute.countDocuments(), 0);
    });
});

describe('a dispute on a plan payment', () => {
    test('LOST: the plan that payment bought ends at once, and money is netted', async () => {
        await biz();
        const startsAt = new Date(Date.now() - 5 * DAY); const endsAt = new Date(Date.now() + 25 * DAY);
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { plan: { id: 'pro', startedAt: startsAt, endsAt } } });
        await PlanPayment.create({ tenantId: w.tenant._id, kind: 'new', from: 'partner', to: 'pro', months: 1, status: 'paid', paymentId: 'pay_top1', paidAt: startsAt, payablePaise: 59000, quote: { startsAt, endsAt, taxablePaise: 50000, gstPaise: 9000, gstPercent: 18, totalPaise: 59000 } });
        await event('payment.dispute.lost');
        assert.equal(planService.viewOf(await Tenant.findById(w.tenant._id).lean()).status, 'ended');
        const neg = (await sales.paid({ tenantId: w.tenant._id })).find((x) => x.refund);
        assert.equal(neg.total, -590);
        assert.equal(neg.kind, 'plan');
    });

    test('the dispute of an OLD payment does not end the plan now running', async () => {
        const startsAt = new Date(Date.now() - 50 * DAY);
        const now = new Date(Date.now() + 25 * DAY);
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { plan: { id: 'pro', startedAt: new Date(), endsAt: now } } });
        await PlanPayment.create({ tenantId: w.tenant._id, kind: 'new', from: 'partner', to: 'pro', months: 1, status: 'paid', paymentId: 'pay_top1', paidAt: startsAt, payablePaise: 59000, quote: { startsAt, endsAt: new Date(startsAt.getTime() + 30 * DAY), taxablePaise: 50000, gstPaise: 9000, gstPercent: 18 } });
        await event('payment.dispute.lost');
        assert.equal(planService.viewOf(await Tenant.findById(w.tenant._id).lean()).status, 'active');
    });
});
