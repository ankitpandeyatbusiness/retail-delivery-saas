require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const Tenant = require('../src/models/Tenant');
const PlatformSettings = require('../src/models/PlatformSettings');
const PlanPayment = require('../src/models/PlanPayment');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const wallet = require('../src/services/partnerWalletService');
const billing = require('../src/services/planBilling');
const payments = require('../src/services/adapters/payments');

// Phase 5 of plans: the owner's quote, payment, upgrade proration, wallet credit, scheduled downgrade, held payments.
let w; let slug; let n = 0;
const DAY = 86400000;
const sign = (o, p) => crypto.createHmac('sha256', 'mock_key_secret').update(`${o}|${p}`).digest('hex');
const setPlan = async (plan) => { await Tenant.updateOne({ _id: w.tenant._id }, { $set: { plan } }); tenantRecognizer.invalidateTenant(slug); };
const owner = (m, p, b) => request(app)[m](`/api/shop/plan${p}`).set(w.owner.headers).send(b);
const tenantNow = async () => Tenant.findById(w.tenant._id).lean();
const withGst = () => PlatformSettings.updateOne({ _id: 'main' }, { $set: { 'business.gstin': '09AAAAA0000A1Z5', 'business.legalName': 'Test Co', 'business.state': 'Uttar Pradesh', 'business.stateCode': '09' } }, { upsert: true });

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    payments._mock.reset();
    slug = `plan-bill-${++n}`;
    w = await f.makeWorld(slug);
});

describe('the quote', () => {
    test('Growth for 3 months: price x 3, 5% off, no GST without a GST number', async () => {
        await setPlan({ id: 'partner' });
        const q = await owner('post', '/quote', { to: 'growth', months: 3 });
        assert.equal(q.status, 200);
        assert.equal(q.body.kind, 'new');
        assert.equal(q.body.totalPaise, 899700 - 44985);
        assert.equal(q.body.gstPaise, 0);
        assert.ok(new Date(q.body.endsAt) > new Date(Date.now() + 80 * DAY));
    });

    test('GST is added on top, once, on the discounted amount', async () => {
        await withGst();
        await setPlan({ id: 'partner' });
        const q = (await owner('post', '/quote', { to: 'pro', months: 1 })).body;
        assert.equal(q.taxablePaise, 499900);
        assert.equal(q.gstPaise, Math.round(499900 * 0.18));
        assert.equal(q.totalPaise, q.taxablePaise + q.gstPaise);
    });

    test('a Partner wallet balance is credited once, GST only on what is left', async () => {
        await withGst();
        await setPlan({ id: 'partner' });
        await wallet.credit({ tenantId: w.tenant._id, amountPaise: 40000, type: 'adjust', note: 'x' });
        const q = (await owner('post', '/quote', { to: 'growth', months: 1 })).body;
        assert.equal(q.walletCreditPaise, 40000);
        assert.equal(q.taxablePaise, 259900);
        assert.equal(q.totalPaise, 259900 + Math.round(259900 * 0.18));
    });

    test('Growth to Pro in a paid term: the difference for the whole days left, no discount', async () => {
        await setPlan({ id: 'growth', startedAt: new Date(), endsAt: new Date(Date.now() + 20.5 * DAY) });
        const q = (await owner('post', '/quote', { to: 'pro' })).body;
        assert.equal(q.kind, 'upgrade');
        assert.equal(q.daysLeft, 20);   // whole days, in the owner's favour
        assert.equal(q.taxablePaise, Math.round((200000 * 20) / 30));
        assert.equal(new Date(q.endsAt).getTime(), new Date((await tenantNow()).plan.endsAt).getTime());   // the end date stays
    });

    test('going down is only at the end of the paid term: nothing to pay', async () => {
        await setPlan({ id: 'pro', startedAt: new Date(), endsAt: new Date(Date.now() + 10 * DAY) });
        const q = (await owner('post', '/quote', { to: 'growth' })).body;
        assert.equal(q.kind, 'downgrade');
        assert.equal(q.totalPaise, 0);
        assert.equal((await owner('post', '/pay/start', { to: 'growth', months: 1 })).status, 409);
        const c = await owner('post', '/choose', { to: 'growth' });
        assert.equal(c.body.scheduled, true);
        assert.equal((await tenantNow()).plan.scheduled.to, 'growth');
        assert.equal((await tenantNow()).plan.id, 'pro');   // still Pro until the term ends
        assert.equal((await owner('delete', '/scheduled')).status, 200);
        assert.equal((await tenantNow()).plan.scheduled, undefined);
    });

    test('renewing in time adds the months after the current end', async () => {
        const end = new Date(Date.now() + 5 * DAY);
        await setPlan({ id: 'growth', startedAt: new Date(), endsAt: end });
        const q = (await owner('post', '/quote', { to: 'growth', months: 2 })).body;
        assert.equal(q.kind, 'renew');
        assert.ok(new Date(q.startsAt) > end);
        assert.ok(new Date(q.endsAt) > new Date(end.getTime() + 55 * DAY));
    });

    test('bad months and bad plans are refused', async () => {
        await setPlan({ id: 'partner' });
        assert.equal((await owner('post', '/quote', { to: 'growth', months: 9 })).status, 400);
        assert.equal((await owner('post', '/quote', { to: 'classic' })).status, 400);
    });
});

describe('paying', () => {
    const start = (b) => owner('post', '/pay/start', b);
    const pay = async (s, id) => {
        payments._mock.setPayment({ id, orderId: s.body.rzpOrderId, status: 'captured', amountPaise: s.body.amountPaise });
        return owner('post', `/pay/${s.body.paymentId}/verify`, { razorpay_order_id: s.body.rzpOrderId, razorpay_payment_id: id, razorpay_signature: sign(s.body.rzpOrderId, id) });
    };

    test('start, pay, the plan is applied once; the same payment again changes nothing', async () => {
        await setPlan({ id: 'partner' });
        const s = await start({ to: 'growth', months: 1 });
        assert.equal(s.status, 201);
        assert.equal(s.body.amountPaise, 299900);
        const r = await pay(s, 'pay_p1');
        assert.equal(r.body.paid, true);
        const t = await tenantNow();
        assert.equal(t.plan.id, 'growth');
        assert.ok(new Date(t.plan.endsAt) > new Date(Date.now() + 27 * DAY));
        const ends = new Date(t.plan.endsAt).getTime();
        assert.equal((await pay(s, 'pay_p1')).body.paid, true);
        await require('../src/services/platformCheckout').onPlatformPayment({ id: 'pay_p1', orderId: s.body.rzpOrderId, status: 'captured', amountPaise: s.body.amountPaise });
        assert.equal(new Date((await tenantNow()).plan.endsAt).getTime(), ends);
        assert.equal(await PlanPayment.countDocuments({ status: 'paid' }), 1);
    });

    test('the wallet credit is used when the plan is bought', async () => {
        await setPlan({ id: 'partner' });
        await wallet.credit({ tenantId: w.tenant._id, amountPaise: 40000, type: 'adjust', note: 'x' });
        const s = await start({ to: 'growth', months: 1 });
        assert.equal(s.body.amountPaise, 259900);
        await pay(s, 'pay_p2');
        assert.equal((await wallet.status(w.tenant._id)).balancePaise, 0);
        assert.equal((await wallet.reconcile(w.tenant._id)).differencePaise, 0);
    });

    test('a wallet that covers the whole price needs no payment, only a confirm', async () => {
        await setPlan({ id: 'partner' });
        await wallet.credit({ tenantId: w.tenant._id, amountPaise: 350000, type: 'adjust', note: 'x' });
        assert.equal((await start({ to: 'growth', months: 1 })).status, 409);
        const c = await owner('post', '/choose', { to: 'growth', months: 1 });
        assert.equal(c.status, 200);
        assert.equal((await tenantNow()).plan.id, 'growth');
        assert.equal((await wallet.status(w.tenant._id)).balancePaise, 350000 - 299900);   // the leftover stays
    });

    test('the wrong amount is held, nothing is applied', async () => {
        await setPlan({ id: 'partner' });
        const s = await start({ to: 'pro', months: 1 });
        payments._mock.setPayment({ id: 'pay_p3', orderId: s.body.rzpOrderId, status: 'captured', amountPaise: 100 });
        const r = await owner('post', `/pay/${s.body.paymentId}/verify`, { razorpay_order_id: s.body.rzpOrderId, razorpay_payment_id: 'pay_p3', razorpay_signature: sign(s.body.rzpOrderId, 'pay_p3') });
        assert.equal(r.status, 409);
        assert.equal((await tenantNow()).plan.id, 'partner');
        assert.equal((await PlanPayment.findById(s.body.paymentId)).status, 'held');
    });

    test('if the plan changed after the owner saw the price, the payment is held', async () => {
        await setPlan({ id: 'partner' });
        const s = await start({ to: 'growth', months: 1 });
        await setPlan({ id: 'pro', endsAt: new Date(Date.now() + 9 * DAY) });   // the supreme admin moved the shop meanwhile
        const r = await pay(s, 'pay_p4');
        assert.equal(r.body.held, true);
        assert.equal((await tenantNow()).plan.id, 'pro');
        assert.equal((await PlanPayment.findById(s.body.paymentId)).status, 'held');
    });

    test('an upgrade pays the difference and keeps the end date', async () => {
        const end = new Date(Date.now() + 20.5 * DAY);
        await setPlan({ id: 'growth', startedAt: new Date(), endsAt: end });
        const s = await start({ to: 'pro' });
        assert.equal(s.body.amountPaise, Math.round((200000 * 20) / 30));
        await pay(s, 'pay_p5');
        const t = await tenantNow();
        assert.equal(t.plan.id, 'pro');
        assert.equal(new Date(t.plan.endsAt).getTime(), end.getTime());
    });

    test('a second start with the same choice reuses the open payment', async () => {
        await setPlan({ id: 'partner' });
        const a = await start({ to: 'growth', months: 2 });
        const b = await start({ to: 'growth', months: 2 });
        assert.equal(a.body.paymentId, b.body.paymentId);
        const c = await start({ to: 'growth', months: 3 });
        assert.notEqual(a.body.paymentId, c.body.paymentId);
        assert.equal(await PlanPayment.countDocuments({ status: 'pending' }), 1);
    });
});

describe('who can pay', () => {
    test('a superadmin cannot choose or pay for an owner, and a shop cannot see another shop', async () => {
        await setPlan({ id: 'partner' });
        const admin = await f.makeSuperAdmin();
        const viaProxy = await request(app).post(`/api/admin/tenants/${w.tenant._id}/shop/plan/pay/start`).set({ Authorization: `Bearer ${admin.token}` }).send({ to: 'growth' });
        assert.ok([403, 404].includes(viaProxy.status));
        const other = await f.makeWorld(`plan-bill-other-${n}`);
        const o = await request(app).get('/api/shop/plan').set(other.owner.headers);
        assert.equal(o.body.current.id ?? null, null);   // the other shop has no plan; this one is partner
    });

    test('overview lists the three plans and never the slab table', async () => {
        await setPlan({ id: 'partner' });
        const o = (await owner('get', '/')).body;
        assert.deepEqual(o.plans.map((p) => p.id), ['partner', 'growth', 'pro']);
        assert.equal(JSON.stringify(o).includes('feeSlabs'), false);
        assert.deepEqual(o.plans[0].feeRange, { minRs: 3, maxRs: 15 });
    });
});

describe('dates', () => {
    test('N months end on the day before, at the end of the India day', () => {
        const end = billing.endAfterMonths(new Date('2026-11-09T05:00:00Z'), 1);
        assert.equal(end.toISOString(), '2026-12-08T18:29:59.999Z');   // 8 Dec 23:59:59.999 IST
        assert.equal(billing.endAfterMonths(new Date('2026-01-31T05:00:00Z'), 1).toISOString(), '2026-02-27T18:29:59.999Z');   // short month: 28 Feb less a day
    });
});

describe('free days left when buying another plan', () => {
    test('free Growth with 10 days left, then Pro for 1 month: the 10 days are added at the end', async () => {
        const freeEnd = new Date(Date.now() + 10 * DAY);
        await setPlan({ id: 'growth', startedAt: new Date(), endsAt: freeEnd, freeUntil: freeEnd });
        const q = (await owner('post', '/quote', { to: 'pro', months: 1 })).body;
        assert.equal(q.kind, 'new');
        assert.equal(q.carryDays, 10);
        const plain = billing.endAfterMonths ? billing.endAfterMonths(new Date(), 1) : null;
        if (plain) assert.equal(Math.round((new Date(q.endsAt) - plain) / DAY), 10);
        assert.ok(q.notes.some((x) => /10 leftover free days/.test(x)));
        assert.equal(q.totalPaise, 499900);   // the price is the same, only the end date moves
    });

    test('the same plan during its free period still starts after the free days (no double count)', async () => {
        const freeEnd = new Date(Date.now() + 10 * DAY);
        await setPlan({ id: 'pro', startedAt: new Date(), endsAt: freeEnd, freeUntil: freeEnd });
        const q = (await owner('post', '/quote', { to: 'pro', months: 1 })).body;
        assert.equal(q.carryDays, undefined);
        assert.ok(new Date(q.startsAt) > freeEnd);
    });
});

describe('a lower plan paid in advance during a free period', () => {
    const start = (b) => owner('post', '/pay/start', b);
    const pay = async (s, id) => {
        payments._mock.setPayment({ id, orderId: s.body.rzpOrderId, status: 'captured', amountPaise: s.body.amountPaise });
        return owner('post', `/pay/${s.body.paymentId}/verify`, { razorpay_order_id: s.body.rzpOrderId, razorpay_payment_id: id, razorpay_signature: sign(s.body.rzpOrderId, id) });
    };
    const freeEnd = () => new Date(Date.now() + 10 * DAY);

    test('free Pro, Growth for 1 month: it is paid now, starts after the free days, nothing changes until then', async () => {
        const end = freeEnd();
        await setPlan({ id: 'pro', startedAt: new Date(), endsAt: end, freeUntil: end });
        const q = (await owner('post', '/quote', { to: 'growth', months: 1 })).body;
        assert.equal(q.kind, 'new');
        assert.equal(q.deferred, true);
        assert.equal(q.totalPaise, 299900);
        assert.deepEqual(q.features, { on: [], off: [] });
        assert.ok(new Date(q.startsAt) > end);
        assert.ok(q.notes.some((x) => /starts on .* when your free time ends/.test(x)));
        const s = await start({ to: 'growth', months: 1 });
        assert.equal(s.status, 201);
        assert.equal((await pay(s, 'pay_def1')).status, 200);
        const t = await tenantNow();
        assert.equal(t.plan.id, 'pro');                                   // still Pro now
        assert.equal(new Date(t.plan.endsAt).getTime(), end.getTime());
        assert.equal(t.plan.scheduled.to, 'growth');
        assert.equal(!!t.plan.scheduled.prepaid, true);
    });

    test('it cannot be cancelled, and nothing else can be bought on top of it', async () => {
        const end = freeEnd();
        await setPlan({ id: 'pro', startedAt: new Date(), endsAt: end, freeUntil: end });
        await pay(await start({ to: 'growth', months: 1 }), 'pay_def2');
        assert.equal((await owner('delete', '/scheduled')).status, 409);
        assert.equal((await owner('post', '/quote', { to: 'pro', months: 1 })).status, 409);
        assert.equal((await owner('post', '/quote', { to: 'growth', months: 1 })).status, 409);
    });

    test('when the free days end, Growth starts at once for the paid time (no pause, no second payment)', async () => {
        const end = freeEnd();
        await setPlan({ id: 'pro', startedAt: new Date(), endsAt: end, freeUntil: end });
        await pay(await start({ to: 'growth', months: 1 }), 'pay_def3');
        await require('../src/services/planLifecycle').sweep(new Date(end.getTime() + 60000));
        const t = await tenantNow();
        assert.equal(t.plan.id, 'growth');
        assert.equal(t.plan.freeUntil, undefined);
        assert.ok(new Date(t.plan.endsAt) > new Date(end.getTime() + 25 * DAY));
        assert.equal(t.plan.paused, undefined);
        assert.equal(require('../src/services/planService').viewOf(t, new Date(end.getTime() + 60000)).status, 'active');
    });

    test('a PAID Pro still cannot buy Growth in advance (the lower plan waits, nothing is paid)', async () => {
        await setPlan({ id: 'pro', startedAt: new Date(), endsAt: new Date(Date.now() + 20 * DAY) });
        const q = (await owner('post', '/quote', { to: 'growth', months: 1 })).body;
        assert.equal(q.kind, 'downgrade');
        assert.equal(q.deferred, undefined);
    });
});

describe('the most prepaid time', () => {
    test('12 months in total: the part that fits is named, and nothing more can be added at the limit', async () => {
        await setPlan({ id: 'pro', startedAt: new Date(), endsAt: billing.endAfterMonths(new Date(), 11) });
        const r3 = await owner('post', '/quote', { to: 'pro', months: 3 });
        assert.equal(r3.status, 400);
        assert.match(r3.body.error, /up to 12 months in total.*1 more month/);
        assert.equal((await owner('post', '/quote', { to: 'pro', months: 1 })).status, 200);
        await setPlan({ id: 'pro', startedAt: new Date(), endsAt: billing.endAfterMonths(new Date(), 12) });
        const r1 = await owner('post', '/quote', { to: 'pro', months: 1 });
        assert.equal(r1.status, 400);
        assert.match(r1.body.error, /already runs for the most prepaid time/);
    });
    test('a normal first purchase of 6 months is fine', async () => {
        await setPlan({ id: 'partner' });
        assert.equal((await owner('post', '/quote', { to: 'growth', months: 6 })).status, 200);
    });
});

describe('notes in the preview', () => {
    test('moving to Partner at the end tells the owner to add wallet money; an upgrade says the month discounts do not apply to it', async () => {
        await setPlan({ id: 'pro', startedAt: new Date(), endsAt: new Date(Date.now() + 20 * DAY) });
        const down = (await owner('post', '/quote', { to: 'partner', months: 1 })).body;
        assert.ok(down.notes.some((x) => /Add money to your wallet before then/.test(x)));
        await setPlan({ id: 'growth', startedAt: new Date(), endsAt: new Date(Date.now() + 20 * DAY) });
        const up = (await owner('post', '/quote', { to: 'pro', months: 1 })).body;
        assert.equal(up.kind, 'upgrade');
        assert.ok(up.notes.some((x) => /month discounts and coupons are for new purchases/.test(x)));
    });
});
