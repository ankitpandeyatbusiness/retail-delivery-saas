require('./helpers/env');
// How riders are paid (plans), what a delivery earns, the optional record of payments to a rider, and the cash limit.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const riderPay = require('../src/services/riderPay');
const assignment = require('../src/services/assignmentService');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const Rider = require('../src/models/Rider');
const CodSettlement = require('../src/models/CodSettlement');
const RiderPayout = require('../src/models/RiderPayout');
const orderStatus = require('../src/services/orderStatusService');

const SHOP = { latitude: 26.4499, longitude: 80.3319 };
const HOME = { latitude: 26.4599, longitude: 80.3319 };   // about 1.1 km from the shop
let w; let n = 0;
const owner = (m, path, body) => request(app)[m](`/api/shop${path}`).set(w.owner.headers).send(body);
const rider = (m, path, body) => request(app)[m](`/api/rider${path}`).set(w.rider.headers).send(body);
const setPlan = (pay, extra = {}) => owner('put', '/settings', { riders: { pay, ...extra } });
const trip = (o = {}) => f.makeOrder(w.tenant, w.customer.user, {
    status: 'out_for_delivery', address: { line1: 'x', city: 'Kanpur', ...HOME }, pricing: { subtotal: 250, total: 250 },
    delivery: { riderId: w.rider.user._id, status: 'picked_up', pickedUpAt: new Date(), pinRequired: false, proof: { url: 'https://x/p.jpg', at: new Date() } },
    ...o,
});
// a delivery the rider could not finish: he reported a problem more than 15 minutes ago, so the owner may mark it not delivered
const stuck = () => ({
    riderId: w.rider.user._id, status: 'picked_up', pickedUpAt: new Date(), pinRequired: false, problems: [{ at: new Date(Date.now() - 20 * 60000), reason: 'cannot_reach' }],
});
const deliver = async (o) => {
    const r = await rider('post', `/orders/${o._id}/deliver`, { lat: HOME.latitude, lng: HOME.longitude });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return (await Order.findById(o._id).lean()).delivery.earnPaise;
};

before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld(`pay-${++n}`);
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { delivery: { ...SHOP, radiusKm: 10 } } });
    tenantRecognizer.invalidateTenant(w.tenant.slug);
    await Rider.updateOne({ tenantId: w.tenant._id, userId: w.rider.user._id }, { $set: { isActive: true, isOnline: true, activeOrderCount: 1 } });
});

describe('the plans (no database)', () => {
    test('each plan works out one delivery', () => {
        const at = (plan, o = {}) => riderPay.earnPaise(plan, { totalRupees: 250, distanceKm: 1.1, ...o });
        assert.equal(at({ type: 'none' }), 0);
        assert.equal(at({ type: 'salary', salary: 12000, salaryEvery: 'month' }), 0);
        assert.equal(at({ type: 'per_delivery', perDelivery: 30 }), 3000);
        assert.equal(at({ type: 'percent', percent: 10 }), 2500);
        assert.equal(at({ type: 'salary_plus', salary: 9000, salaryEvery: 'week', perDelivery: 10 }), 1000);
        assert.equal(at({ type: 'distance', base: 20, freeKm: 2, perKm: 5 }), 2000);                       // inside the free distance
        assert.equal(at({ type: 'distance', base: 20, freeKm: 1, perKm: 10 }, { distanceKm: 3 }), 4000);   // 2 km beyond the free one
        assert.equal(at({ type: 'distance', base: 20, freeKm: 1, perKm: 10 }, { distanceKm: null }), 2000); // distance unknown: the base only
    });

    test('the words, and what is accepted', () => {
        assert.equal(riderPay.describe({ type: 'none' }), 'Paid outside the app');
        assert.equal(riderPay.describe({ type: 'per_delivery', perDelivery: 30 }), '₹30 for each delivery');
        assert.equal(riderPay.describe({ type: 'salary', salary: 12000, salaryEvery: 'month' }), 'Salary ₹12,000 every month');
        assert.equal(riderPay.validatePlan({ type: 'per_delivery', perDelivery: 30, junk: 1 }).clean.junk, undefined);
        for (const bad of [{ type: 'weird' }, { type: 'per_delivery' }, { type: 'per_delivery', perDelivery: -5 }, { type: 'percent', percent: 150 }, { type: 'salary', salary: 5000 }, { type: 'distance', base: 0, freeKm: 1, perKm: 0 }]) {
            assert.equal(riderPay.validatePlan(bad).ok, false, JSON.stringify(bad));
        }
        assert.equal(riderPay.validatePlan(null, { allowSame: true }).clean, null);
        assert.equal(riderPay.validatePlan(null).ok, false);
    });

    test('the plan that applies: his own, else the shop\'s, else the old single number, else none', () => {
        const shop = { pay: { type: 'percent', percent: 5 }, payPerDelivery: 40 };
        assert.equal(riderPay.effectivePlan(shop, { pay: { type: 'salary', salary: 1000, salaryEvery: 'week' } }).type, 'salary');
        assert.equal(riderPay.effectivePlan(shop, {}).type, 'percent');
        assert.equal(riderPay.effectivePlan({ payPerDelivery: 40 }, null).perDelivery, 40);
        assert.equal(riderPay.effectivePlan({}, null).type, 'none');
    });
});

describe('the owner chooses a plan', () => {
    test('saved, read back, and a bad plan is refused with a clear reason', async () => {
        const ok = await setPlan({ type: 'distance', base: 20, freeKm: 2, perKm: 5 });
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
        const s = (await owner('get', '/settings')).body.riders;
        assert.deepEqual(s.pay, { type: 'distance', base: 20, freeKm: 2, perKm: 5 });
        assert.equal(s.cashLimit, 0);
        assert.equal(s.trackPayouts, false);
        const bad = await setPlan({ type: 'per_delivery', perDelivery: 0 });
        assert.equal(bad.status, 400);
        assert.match(JSON.stringify(bad.body), /for each delivery/);
    });

    test('an old shop with only "pay for each delivery" keeps working as that plan', async () => {
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.riders.payPerDelivery': 25 } });
        tenantRecognizer.invalidateTenant(w.tenant.slug);
        assert.deepEqual((await owner('get', '/settings')).body.riders.pay, { type: 'per_delivery', perDelivery: 25 });
        assert.equal(await deliver(await trip()), 2500);
    });
});

describe('what a delivery earns', () => {
    test('it follows the plan, and a plan change never touches an old delivery', async () => {
        await setPlan({ type: 'percent', percent: 10 });
        const first = await trip();
        assert.equal(await deliver(first), 2500);
        await setPlan({ type: 'per_delivery', perDelivery: 40 });
        assert.equal(await deliver(await trip()), 4000);
        assert.equal((await Order.findById(first._id).lean()).delivery.earnPaise, 2500);
    });

    test('one rider can have his own plan; "same as the shop" brings him back', async () => {
        await setPlan({ type: 'per_delivery', perDelivery: 30 });
        const put = await owner('put', `/riders/${w.rider.user._id}/pay`, { pay: { type: 'salary_plus', salary: 9000, salaryEvery: 'month', perDelivery: 5 } });
        assert.equal(put.status, 200, JSON.stringify(put.body));
        assert.equal(await deliver(await trip()), 500);
        const info = (await owner('get', `/riders/${w.rider.user._id}/pay`)).body;
        assert.equal(info.label, 'Salary ₹9,000 every month + ₹5 for each delivery');
        assert.equal(info.own.type, 'salary_plus');
        await owner('put', `/riders/${w.rider.user._id}/pay`, { pay: null });
        assert.equal(await deliver(await trip()), 3000);
        assert.equal((await owner('put', `/riders/${w.rider.user._id}/pay`, { pay: { type: 'nope' } })).status, 400);
        assert.match((await owner('get', '/riders')).body.items[0].payLabel, /30/);
    });

    test('paid outside the app: no earnings are kept at all', async () => {
        await setPlan({ type: 'none' });
        assert.equal(await deliver(await trip()), 0);
    });

    test('food collected but not delivered is paid only when the shop chose so', async () => {
        await setPlan({ type: 'per_delivery', perDelivery: 30 });
        const a = await trip({ delivery: stuck() });
        await orderStatus.change({ order: await Order.findById(a._id), status: 'undelivered', actor: { type: 'owner', id: w.owner.user._id, label: 'o' }, reasonCode: 'customer' });
        assert.equal((await Order.findById(a._id).lean()).delivery.earnPaise || 0, 0);
        await Rider.updateOne({ tenantId: w.tenant._id, userId: w.rider.user._id }, { $set: { activeOrderCount: 1 } });
        await setPlan({ type: 'per_delivery', perDelivery: 30 }, { payUndelivered: true });
        tenantRecognizer.invalidateTenant(w.tenant.slug);
        const b = await trip({ delivery: stuck() });
        await orderStatus.change({ order: await Order.findById(b._id), status: 'undelivered', actor: { type: 'owner', id: w.owner.user._id, label: 'o' }, reasonCode: 'customer' });
        assert.equal((await Order.findById(b._id).lean()).delivery.earnPaise, 3000);
    });

    test('the offer shows what it would pay; the rider sees nothing when pay is not tracked', async () => {
        await setPlan({ type: 'percent', percent: 10 });
        const o = await trip();
        assert.equal((await rider('get', `/orders/${o._id}`)).body.earnPaise, 2500);
        await setPlan({ type: 'none' });
        assert.equal((await rider('get', `/orders/${o._id}`)).body.earnPaise, 0);
    });
});

describe('the rider\'s Money page', () => {
    test('pay not tracked in the app: no pay section at all, only cash', async () => {
        await setPlan({ type: 'none' });
        const m = (await rider('get', '/money')).body;
        assert.equal(m.pay.hidden, true);
        assert.equal(m.cash.balancePaise, 0);
    });

    test('per delivery: today, this week, this month and in all', async () => {
        await setPlan({ type: 'per_delivery', perDelivery: 30 });
        await deliver(await trip());
        await Rider.updateOne({ tenantId: w.tenant._id, userId: w.rider.user._id }, { $set: { activeOrderCount: 1 } });
        await deliver(await trip());
        const m = (await rider('get', '/money')).body.pay;
        assert.equal(m.label, '₹30 for each delivery');
        assert.deepEqual([m.earned.todayPaise, m.earned.weekPaise, m.earned.monthPaise, m.earned.totalPaise], [6000, 6000, 6000, 6000]);
        assert.equal(m.tracked, false);
        assert.equal(m.pendingPaise, null);
        assert.equal((await rider('get', '/summary')).body.pay.type, 'per_delivery');
    });

    test('salary: shown as a salary, with no per-delivery earnings', async () => {
        await setPlan({ type: 'salary', salary: 12000, salaryEvery: 'month' });
        const m = (await rider('get', '/money')).body.pay;
        assert.deepEqual(m.salary, { amountPaise: 1200000, every: 'month' });
        assert.equal(m.earned, null);
    });

    test('cash he holds and what happened to it', async () => {
        const o = await trip({ payment: { method: 'cod' } });
        await deliver(o);
        const bal = (await rider('get', '/money')).body.cash;
        assert.equal(bal.balancePaise, 25000);
        assert.equal(bal.items[0].type, 'collect');
        assert.equal(bal.items[0].orderNo, o.orderNo);
        await owner('post', `/cod/riders/${w.rider.user._id}/handover`, { amountPaise: 10000 });
        const after = (await rider('get', '/money')).body.cash;
        assert.equal(after.balancePaise, 15000);
        assert.equal(after.items[0].type, 'handover');
    });
});

describe('recording payments to a rider (optional)', () => {
    const pay = (body) => owner('post', `/riders/${w.rider.user._id}/payments`, body);

    test('off by default; once on, what he is owed is counted from that moment, and payments reduce it', async () => {
        await setPlan({ type: 'per_delivery', perDelivery: 30 });
        await deliver(await trip());                                   // earned before tracking started: not counted
        assert.equal((await pay({ amountPaise: 5000 })).status, 409);
        await setPlan({ type: 'per_delivery', perDelivery: 30 }, { trackPayouts: true });
        tenantRecognizer.invalidateTenant(w.tenant.slug);
        assert.ok((await Tenant.findById(w.tenant._id).lean()).settings.riders.trackFrom);
        await Rider.updateOne({ tenantId: w.tenant._id, userId: w.rider.user._id }, { $set: { activeOrderCount: 1 } });
        await deliver(await trip());
        let m = (await rider('get', '/money')).body.pay;
        assert.equal(m.tracked, true);
        assert.equal(m.pendingPaise, 3000);
        const p = await pay({ amountPaise: 2000, note: 'half' });
        assert.equal(p.status, 201, JSON.stringify(p.body));
        m = (await rider('get', '/money')).body.pay;
        assert.deepEqual([m.paidPaise, m.pendingPaise, m.payments.length], [2000, 1000, 1]);

        // a salary payment or a bonus is a payment but does not reduce what he has earned
        await pay({ amountPaise: 50000, kind: 'bonus' });
        assert.equal((await rider('get', '/money')).body.pay.pendingPaise, 1000);

        // a wrong entry is cancelled with a reason, and stops counting
        assert.equal((await owner('delete', `/riders/${w.rider.user._id}/payments/${p.body.id}`, {})).status, 400);
        assert.equal((await owner('delete', `/riders/${w.rider.user._id}/payments/${p.body.id}`, { reason: 'typed twice' })).status, 200);
        assert.equal((await rider('get', '/money')).body.pay.pendingPaise, 3000);
    });

    test('the amount and kind are checked, and another shop\'s rider cannot be paid', async () => {
        await setPlan({ type: 'per_delivery', perDelivery: 30 }, { trackPayouts: true });
        tenantRecognizer.invalidateTenant(w.tenant.slug);
        for (const body of [{ amountPaise: 50 }, { amountPaise: 1.5 }, { amountPaise: 5000, kind: 'gift' }, { amountPaise: 5000, paidAt: 'tomorrow-ish' }]) {
            assert.equal((await pay(body)).status, 400, JSON.stringify(body));
        }
        const other = await f.makeWorld('pay-other');
        assert.equal((await owner('post', `/riders/${other.rider.user._id}/payments`, { amountPaise: 5000 })).status, 404);
        assert.equal(await RiderPayout.countDocuments({}), 0);
    });
});

describe('cash limit', () => {
    const cash = (amountPaise) => CodSettlement.create({ tenantId: w.tenant._id, riderId: w.rider.user._id, orderId: new mongoose.Types.ObjectId(), type: 'collect', amountPaise });
    const accepted = () => f.makeOrder(w.tenant, w.customer.user, { status: 'accepted', address: { line1: 'x', city: 'Kanpur', ...HOME } });

    test('a rider holding too much cash is not offered new orders', async () => {
        await Rider.updateOne({ tenantId: w.tenant._id, userId: w.rider.user._id }, { $set: { activeOrderCount: 0 } });
        await setPlan({ type: 'none' }, { cashLimit: 1000 });
        await cash(100000);
        assert.equal(await assignment.startBroadcast({ orderId: (await accepted())._id, tenantId: w.tenant._id }), null);
        await owner('post', `/cod/riders/${w.rider.user._id}/handover`, { amountPaise: 50000 });   // gives some back: under the limit
        const asked = await assignment.startBroadcast({ orderId: (await accepted())._id, tenantId: w.tenant._id });
        assert.equal(asked.delivery.offers.length, 1);
    });

    test('an offer made before he went over the limit cannot be accepted any more', async () => {
        await Rider.updateOne({ tenantId: w.tenant._id, userId: w.rider.user._id }, { $set: { activeOrderCount: 0 } });
        await setPlan({ type: 'none' }, { cashLimit: 1000 });
        const asked = await assignment.startBroadcast({ orderId: (await accepted())._id, tenantId: w.tenant._id });
        assert.ok(asked);
        await cash(120000);
        const r = await rider('post', `/orders/${asked._id}/accept`);
        assert.equal(r.status, 409);
        assert.match(r.body.error, /cash/i);
    });

    test('no limit means no check; the rider is told the limit', async () => {
        await Rider.updateOne({ tenantId: w.tenant._id, userId: w.rider.user._id }, { $set: { activeOrderCount: 0 } });
        await cash(5000000);
        assert.ok(await assignment.startBroadcast({ orderId: (await accepted())._id, tenantId: w.tenant._id }));
        await setPlan({ type: 'none' }, { cashLimit: 2000 });
        tenantRecognizer.invalidateTenant(w.tenant.slug);
        assert.equal((await rider('get', '/money')).body.cash.limitPaise, 200000);
        assert.equal((await rider('get', '/summary')).body.cash.limitPaise, 200000);
    });
});
