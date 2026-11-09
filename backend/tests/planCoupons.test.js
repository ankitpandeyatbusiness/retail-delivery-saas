require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const Tenant = require('../src/models/Tenant');
const PlatformCoupon = require('../src/models/PlatformCoupon');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const center = require('../src/notifications/center');
const payments = require('../src/services/adapters/payments');
const coupons = require('../src/services/platformCoupons');

// Platform coupons for plan payments: the better of coupon and term discount, eligibility, one use per shop, the push.
let w; let supreme; let plain; let slug; let sent; let n = 0;
const DAY = 86400000;
const sign = (o, p) => crypto.createHmac('sha256', 'mock_key_secret').update(`${o}|${p}`).digest('hex');
const setPlan = async (plan) => { await Tenant.updateOne({ _id: w.tenant._id }, { $set: { plan } }); tenantRecognizer.invalidateTenant(slug); };
const owner = (m, p, b) => request(app)[m](`/api/shop/plan${p}`).set(w.owner.headers).send(b);
const admin = (a, m, p, b) => request(app)[m](`/api/admin${p}`).set({ Authorization: `Bearer ${a.token}` }).send(b);
const ymd = (d) => new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
const make = (extra = {}) => PlatformCoupon.create({ code: 'PRO6', pct: 20, plans: ['growth', 'pro'], months: [], startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + 10 * DAY), ...extra });

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    payments._mock.reset();
    slug = `coupon-${++n}`;
    w = await f.makeWorld(slug);
    supreme = await f.makeSuperAdmin();
    plain = await f.makeSuperAdmin('plain@example.com', { phones: [] });
    sent = [];
    mock.method(center, 'notify', (type, p) => { sent.push({ type, ...p }); return Promise.resolve(); });
});
afterEach(() => mock.restoreAll());

describe('the discount rules', () => {
    test('3 months gives 5%, 6 months 10%, nothing for 1, 2, 4 or 5 months', async () => {
        await setPlan({ id: 'partner' });
        const pct = async (m) => { const q = (await owner('post', '/quote', { to: 'growth', months: m })).body; return Math.round((1 - q.taxablePaise / (299900 * m)) * 100); };
        assert.deepEqual([await pct(1), await pct(2), await pct(3), await pct(4), await pct(5), await pct(6)], [0, 0, 5, 0, 0, 10]);
    });

    test('a coupon bigger than the term discount wins and is not added to it', async () => {
        await setPlan({ id: 'partner' });
        await make();
        const q = (await owner('post', '/quote', { to: 'pro', months: 6, coupon: 'pro6' })).body;   // code is not case sensitive
        assert.equal(q.taxablePaise, 499900 * 6 - Math.round(499900 * 6 * 0.2));   // 20%, not 30%
        assert.equal(q.coupon.code, 'PRO6');
        assert.ok(q.lines.some((l) => /Coupon PRO6 20% off/.test(l.label)));
    });

    test('a coupon smaller than the term discount is not used, and not counted', async () => {
        await setPlan({ id: 'partner' });
        await make({ pct: 8 });
        const q = (await owner('post', '/quote', { to: 'pro', months: 6, coupon: 'PRO6' })).body;
        assert.equal(q.taxablePaise, 499900 * 6 - Math.round(499900 * 6 * 0.1));
        assert.equal(q.coupon, undefined);
    });

    test('a coupon for 6 months only is refused on 3 months; a Pro coupon is refused on Growth', async () => {
        await setPlan({ id: 'partner' });
        await make({ months: [6], plans: ['pro'] });
        assert.equal((await owner('post', '/quote', { to: 'pro', months: 3, coupon: 'PRO6' })).status, 400);
        assert.equal((await owner('post', '/quote', { to: 'growth', months: 6, coupon: 'PRO6' })).status, 400);
        assert.equal((await owner('post', '/quote', { to: 'pro', months: 6, coupon: 'PRO6' })).status, 200);
    });

    test('a wrong code, an expired code, a switched-off code are refused', async () => {
        await setPlan({ id: 'partner' });
        await make({ endsAt: new Date(Date.now() - 1000) });
        assert.equal((await owner('post', '/quote', { to: 'pro', months: 6, coupon: 'NOPE' })).status, 400);
        assert.equal((await owner('post', '/quote', { to: 'pro', months: 6, coupon: 'PRO6' })).status, 400);
        await PlatformCoupon.updateOne({ code: 'PRO6' }, { $set: { endsAt: new Date(Date.now() + DAY), active: false } });
        assert.equal((await owner('post', '/quote', { to: 'pro', months: 6, coupon: 'PRO6' })).status, 400);
    });
});

describe('who can use a coupon', () => {
    test('free, ended and Partner shops can; a paid shop whose plan runs past the coupon cannot; one that ends inside the window can', async () => {
        const c = await make();   // ends in 10 days
        const t = (plan) => ({ _id: w.tenant._id, plan });
        assert.equal(coupons.eligible(c.toObject(), t({ id: 'partner' })), true);
        assert.equal(coupons.eligible(c.toObject(), t({ id: 'growth', endsAt: new Date(Date.now() - DAY) })), true);
        assert.equal(coupons.eligible(c.toObject(), t({ id: 'growth', endsAt: new Date(Date.now() + 5 * DAY), startedAt: new Date() })), true);
        assert.equal(coupons.eligible(c.toObject(), t({ id: 'growth', endsAt: new Date(Date.now() + 40 * DAY), startedAt: new Date() })), false);
        assert.equal(coupons.eligible(c.toObject(), { _id: w.tenant._id }), true);   // no plan yet
    });

    test('a coupon for chosen shops is hidden from the others; the Plan screen lists the cards', async () => {
        const other = await f.makeWorld(`coupon-other-${n}`);
        await setPlan({ id: 'partner' });
        await make({ shops: [other.tenant._id] });
        assert.equal((await owner('get', '', undefined)).body.coupons.length, 0);
        await PlatformCoupon.updateOne({ code: 'PRO6' }, { $set: { shops: [w.tenant._id] } });
        const cards = (await owner('get', '', undefined)).body.coupons;
        assert.equal(cards.length, 1);
        assert.equal(cards[0].code, 'PRO6');
    });
});

describe('using it', () => {
    const pay = async (body) => {
        const s = await owner('post', '/pay/start', body);
        assert.equal(s.status, 201);
        payments._mock.setPayment({ id: 'pay_c1', orderId: s.body.rzpOrderId, status: 'captured', amountPaise: s.body.amountPaise });
        return owner('post', `/pay/${s.body.paymentId}/verify`, { razorpay_order_id: s.body.rzpOrderId, razorpay_payment_id: 'pay_c1', razorpay_signature: sign(s.body.rzpOrderId, 'pay_c1') });
    };

    test('paying with the coupon charges the discounted amount, counts one use, and the shop cannot use it twice', async () => {
        await setPlan({ id: 'partner' });
        await make();
        const s = await owner('post', '/pay/start', { to: 'pro', months: 6, coupon: 'PRO6' });
        assert.equal(s.body.amountPaise, 499900 * 6 - Math.round(499900 * 6 * 0.2));
        const r = await pay({ to: 'pro', months: 6, coupon: 'PRO6' });
        assert.equal(r.status, 200);
        const c = await PlatformCoupon.findOne({ code: 'PRO6' }).lean();
        assert.equal(c.usedCount, 1);
        assert.equal(String(c.usedBy[0].tenantId), String(w.tenant._id));
        await setPlan({ id: 'pro', endsAt: new Date(Date.now() - DAY) });   // the term ended: the same shop tries again
        assert.equal((await owner('post', '/quote', { to: 'pro', months: 6, coupon: 'PRO6' })).status, 400);
    });

    test('the use limit stops a coupon after its last use', async () => {
        await setPlan({ id: 'partner' });
        await make({ maxUses: 1, usedCount: 1 });
        assert.equal((await owner('post', '/quote', { to: 'pro', months: 6, coupon: 'PRO6' })).status, 400);
    });

    test('an upgrade difference never takes a coupon', async () => {
        await setPlan({ id: 'growth', startedAt: new Date(), endsAt: new Date(Date.now() + 5 * DAY) });
        await make();
        const q = (await owner('post', '/quote', { to: 'pro', months: 1, coupon: 'PRO6' })).body;
        assert.equal(q.kind, 'upgrade');
        assert.equal(q.coupon, undefined);
    });
});

describe('the superadmin side', () => {
    const body = () => ({ code: 'pro 6', pct: 20, plans: ['pro'], months: [6], startsOn: ymd(new Date()), endsOn: ymd(new Date(Date.now() + 10 * DAY)) });

    test('only the supreme admin makes, changes or sends a coupon; any admin can read', async () => {
        assert.equal((await admin(plain, 'post', '/plan-coupons', body())).status, 403);
        const made = await admin(supreme, 'post', '/plan-coupons', body());
        assert.equal(made.status, 201);
        assert.equal(made.body.code, 'PRO6');
        assert.equal((await admin(plain, 'get', '/plan-coupons')).status, 200);
        assert.equal((await admin(plain, 'put', `/plan-coupons/${made.body.id}`, { active: false })).status, 403);
        assert.equal((await admin(plain, 'post', `/plan-coupons/${made.body.id}/notify`, { title: 'a', body: 'b' })).status, 403);
    });

    test('bad input is refused; a code is unique', async () => {
        assert.equal((await admin(supreme, 'post', '/plan-coupons', { ...body(), pct: 95 })).status, 400);
        assert.equal((await admin(supreme, 'post', '/plan-coupons', { ...body(), code: 'x' })).status, 400);
        assert.equal((await admin(supreme, 'post', '/plan-coupons', { ...body(), endsOn: ymd(new Date(Date.now() - 5 * DAY)) })).status, 400);
        assert.equal((await admin(supreme, 'post', '/plan-coupons', body())).status, 201);
        assert.equal((await admin(supreme, 'post', '/plan-coupons', body())).status, 409);
    });

    test('ready-made texts name the code, the percent, the plan, the term and the date', async () => {
        const made = (await admin(supreme, 'post', '/plan-coupons', body())).body;
        const { texts } = (await admin(supreme, 'get', `/plan-coupons/${made.id}/texts`)).body;
        assert.ok(texts.length >= 3);
        for (const t of texts) assert.ok(t.body.includes('PRO6') && t.body.includes('20%'));
        assert.ok(texts[0].body.includes('Pro') && texts[0].body.includes('6 months'));
    });

    test('the push goes only to shops that can use it, once each, and names the coupon', async () => {
        await setPlan({ id: 'partner' });
        const paid = await f.makeWorld(`coupon-paid-${n}`);
        await Tenant.updateOne({ _id: paid.tenant._id }, { $set: { plan: { id: 'pro', startedAt: new Date(), endsAt: new Date(Date.now() + 60 * DAY) } } });   // runs well past the coupon
        const made = (await admin(supreme, 'post', '/plan-coupons', body())).body;
        const r = await admin(supreme, 'post', `/plan-coupons/${made.id}/notify`, { title: '20% off Pro', body: 'Use PRO6' });
        assert.equal(r.status, 200);
        const offers = sent.filter((x) => x.type === 'plan_offer');
        assert.ok(offers.some((x) => String(x.tenantId) === String(w.tenant._id)));
        assert.ok(!offers.some((x) => String(x.tenantId) === String(paid.tenant._id)));
        assert.equal(offers[0].data.coupon, 'PRO6');
        assert.equal(r.body.sent, offers.length);
    });
});
