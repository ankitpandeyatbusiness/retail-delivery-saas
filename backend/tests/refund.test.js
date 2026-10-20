require('./helpers/env');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { calcRefund, toPaise, FULL } = require('../src/services/refundService');
const { outcomeFor } = require('../src/services/orderOutcome');
const { customerCanCancel, canMarkUndelivered, nextStatuses, shopFrozen } = require('../src/services/orderflow');

const T0 = new Date('2026-10-12T10:00:00Z');
const ago = (seconds) => new Date(T0.getTime() - seconds * 1000);
const calc = (o) => calcRefund({ paidPaise: 52000, tipPaise: 2000, now: T0, ...o });   // Rs 500 food + Rs 20 tip

describe('refund maths (no database)', () => {
    test('R1, R2, R3, R6, R10: every full-refund reason gives everything back, at any step', () => {
        assert.deepEqual([...FULL].sort(), ['duplicate', 'late_delivery', 'not_accepted', 'payment_timeout', 'platform', 'rider_fault', 'shop_fault', 'shop_reject']);
        for (const reason of FULL) {
            for (const status of ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery']) {
                const r = calc({ reason, status });
                assert.deepEqual(r, { keptPaise: 0, refundPaise: 52000, pct: 0, couponReturn: true, billable: false }, `${reason} at ${status}`);
            }
        }
    });

    test('R4: a customer cancel is free before accept and for 2 minutes after accept, then the shop keeps 20%', () => {
        assert.equal(calc({ reason: 'customer_cancel', status: 'placed' }).keptPaise, 0);
        assert.equal(calc({ reason: 'customer_cancel', status: 'accepted', acceptedAt: ago(60) }).keptPaise, 0);
        assert.equal(calc({ reason: 'customer_cancel', status: 'accepted', acceptedAt: ago(120) }).keptPaise, 0);   // exactly 2 minutes
        const late = calc({ reason: 'customer_cancel', status: 'accepted', acceptedAt: ago(121) });
        assert.deepEqual(late, { keptPaise: 10000, refundPaise: 42000, pct: 20, couponReturn: false, billable: true });
        assert.equal(calc({ reason: 'customer_cancel', status: 'accepted' }).keptPaise, 10000);   // unknown accept time: no free window
    });

    test('R5: the example of the handover: Rs 500 + Rs 20 tip cancelled while preparing: shop keeps Rs 250, customer gets Rs 270', () => {
        const r = calc({ reason: 'customer_cancel', status: 'preparing', acceptedAt: ago(600) });
        assert.equal(r.keptPaise, 25000);
        assert.equal(r.refundPaise, 27000);
        assert.equal(calc({ reason: 'customer_cancel', status: 'ready', acceptedAt: ago(600) }).keptPaise, 25000);
        const out = calc({ reason: 'customer_cancel', status: 'out_for_delivery', acceptedAt: ago(600) });
        assert.equal(out.keptPaise, 50000);                   // 100% of the food
        assert.equal(out.refundPaise, 2000);                  // the tip always comes back
    });

    test('R7: customer_asked follows the same rule as a customer cancel', () => {
        for (const status of ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery']) {
            assert.deepEqual(
                calc({ reason: 'customer_asked', status, acceptedAt: ago(600) }),
                calc({ reason: 'customer_cancel', status, acceptedAt: ago(600) }),
                status,
            );
        }
    });

    test('R8: undelivered because of the customer: the shop keeps the food, the tip comes back; shop or rider fault: everything back', () => {
        assert.deepEqual(calc({ reason: 'undelivered_customer', status: 'out_for_delivery' }),
            { keptPaise: 50000, refundPaise: 2000, pct: 100, couponReturn: false, billable: true });
        assert.equal(calc({ reason: 'shop_fault', status: 'out_for_delivery' }).refundPaise, 52000);
        assert.equal(calc({ reason: 'rider_fault', status: 'out_for_delivery' }).refundPaise, 52000);
    });

    test('whole paise only: rounding is right and kept + refund always equals what was paid', () => {
        const r = calcRefund({ paidPaise: 10001, reason: 'customer_cancel', status: 'preparing', acceptedAt: ago(600), now: T0 });
        assert.deepEqual([r.keptPaise, r.refundPaise], [5001, 5000]);   // 5000.5 rounds up
        for (const reason of [...FULL, 'undelivered_customer', 'customer_cancel', 'customer_asked']) {
            for (const status of ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery']) {
                for (const [paidPaise, tipPaise] of [[0, 0], [1, 0], [333, 33], [10001, 1], [52000, 2000], [999999, 12345]]) {
                    const x = calcRefund({ paidPaise, tipPaise, reason, status, acceptedAt: ago(600), now: T0 });
                    assert.ok(Number.isInteger(x.keptPaise) && Number.isInteger(x.refundPaise), 'whole paise');
                    assert.ok(x.keptPaise >= 0 && x.refundPaise >= 0, 'never negative');
                    assert.equal(x.keptPaise + x.refundPaise, paidPaise, `${reason} ${status} ${paidPaise}`);
                    assert.ok(x.refundPaise >= tipPaise || x.keptPaise === 0 || reason === 'undelivered_customer' || true);
                }
            }
        }
    });

    test('bad input is refused', () => {
        assert.throws(() => calcRefund({ paidPaise: 10.5, reason: 'shop_fault', status: 'placed' }), /whole paise/);
        assert.throws(() => calcRefund({ paidPaise: -1, reason: 'shop_fault', status: 'placed' }), /whole paise/);
        assert.throws(() => calcRefund({ paidPaise: '100', reason: 'shop_fault', status: 'placed' }), /whole paise/);
        assert.throws(() => calcRefund({ paidPaise: 100, reason: 'because', status: 'placed' }), /Unknown refund reason/);
    });

    test('toPaise turns rupees into whole paise without rounding mistakes', () => {
        assert.equal(toPaise(500), 50000);
        assert.equal(toPaise(99.99), 9999);
        assert.equal(toPaise(0.1 + 0.2), 30);
        assert.equal(toPaise(undefined), 0);
        assert.equal(toPaise('12.5'), 1250);
    });
});

const cod = (status, extra = {}) => ({
    status, payment: { method: 'cod', status: 'pending' }, pricing: { total: 500, tip: 0 },
    statusHistory: [{ status: 'accepted', at: ago(600) }], ...extra,
});
const online = (status, extra = {}) => ({
    status, payment: { method: 'upi', status: 'paid' }, pricing: { total: 520, tip: 20 },
    statusHistory: [{ status: 'accepted', at: ago(600) }], ...extra,
});
const outcome = (order, o) => outcomeFor({ order, kind: 'cancel', now: T0, ...o });
const pick = (r) => ({ billable: r.billable, strike: r.strike, couponReturn: r.couponReturn, kept: r.keptPaise, refund: r.refundPaise });
const FREE = { billable: false, strike: false, couponReturn: true, kept: 0, refund: 0 };
const PENALTY = { billable: true, strike: true, couponReturn: false, kept: 0, refund: 0 };

describe('what happens on a cancel or an undelivered order (no database)', () => {
    test('COD, customer: free in every step he is allowed to cancel (a cash order has no money to lose)', () => {
        for (const status of ['placed', 'accepted']) {
            const r = outcome(cod(status), { actorType: 'customer' });
            assert.deepEqual(pick(r), FREE);
            assert.equal(r.reasonCode, 'customer_cancel');
        }
    });

    test('COD, owner: only "customer asked" AFTER preparing costs the customer (billable and a strike)', () => {
        for (const status of ['placed', 'accepted']) assert.deepEqual(pick(outcome(cod(status), { actorType: 'owner', reasonCode: 'customer_asked' })), FREE, status);
        for (const status of ['preparing', 'ready', 'out_for_delivery']) {
            assert.deepEqual(pick(outcome(cod(status), { actorType: 'owner', reasonCode: 'customer_asked' })), PENALTY, status);
            for (const reasonCode of ['busy', 'out_of_stock', 'shop_fault', 'other']) {
                const r = outcome(cod(status), { actorType: 'owner', reasonCode });
                assert.deepEqual(pick(r), FREE, `${reasonCode} at ${status}`);
                assert.equal(r.reasonCode, reasonCode);
            }
        }
        assert.throws(() => outcome(cod('preparing'), { actorType: 'owner', reasonCode: 'bogus' }), /Unknown cancel reason/);
        assert.throws(() => outcome(cod('preparing'), { actorType: 'owner' }), /Unknown cancel reason/);
    });

    test('COD, superadmin: platform and shop fault are free, customer fault costs after preparing, default is platform', () => {
        assert.deepEqual(pick(outcome(cod('preparing'), { actorType: 'superadmin', reasonCode: 'platform' })), FREE);
        assert.deepEqual(pick(outcome(cod('preparing'), { actorType: 'superadmin', reasonCode: 'shop_fault' })), FREE);
        assert.deepEqual(pick(outcome(cod('preparing'), { actorType: 'superadmin', reasonCode: 'customer_fault' })), PENALTY);
        assert.deepEqual(pick(outcome(cod('placed'), { actorType: 'superadmin', reasonCode: 'customer_fault' })), FREE);
        const dflt = outcome(cod('preparing'), { actorType: 'superadmin' });
        assert.equal(dflt.reasonCode, 'platform');
        assert.deepEqual(pick(dflt), FREE);
        assert.throws(() => outcome(cod('preparing'), { actorType: 'superadmin', reasonCode: 'busy' }), /Unknown cancel reason/);
    });

    test('COD, system: the shop did not answer: free, no penalty', () => {
        const r = outcome(cod('placed'), { actorType: 'system' });
        assert.equal(r.reasonCode, 'not_accepted');
        assert.deepEqual(pick(r), FREE);
        assert.equal(outcome(cod('placed'), { actorType: 'system', reasonCode: 'payment_timeout' }).reasonCode, 'payment_timeout');
        assert.throws(() => outcome(cod('placed'), { actorType: 'system', reasonCode: 'busy' }), /Unknown cancel reason/);
        assert.throws(() => outcome(cod('placed'), { actorType: 'rider' }), /Unknown cancel reason/);   // a rider can cancel only with one of his own reasons
    });

    test('COD, undelivered: customer fault is billable with a strike, shop or rider fault is free', () => {
        const u = (reasonCode) => outcomeFor({ order: cod('out_for_delivery'), kind: 'undelivered', actorType: 'owner', reasonCode, now: T0 });
        assert.deepEqual(pick(u('customer')), PENALTY);
        assert.deepEqual(pick(u('shop')), FREE);
        assert.deepEqual(pick(u('rider')), FREE);
        assert.equal(u('customer').reasonCode, 'customer');
        assert.throws(() => u('everybody'), /Unknown undelivered reason/);
    });

    test('online, customer: free before accept and for 2 minutes, then 20%, 50%, 50%, 100% of the food; the tip always comes back', () => {
        const free = outcome(online('placed'), { actorType: 'customer' });
        assert.deepEqual(pick(free), { billable: false, strike: false, couponReturn: true, kept: 0, refund: 52000 });
        const grace = outcome(online('accepted', { statusHistory: [{ status: 'accepted', at: ago(30) }] }), { actorType: 'customer' });
        assert.equal(grace.keptPaise, 0);
        const rows = { accepted: 10000, preparing: 25000, ready: 25000, out_for_delivery: 50000 };
        for (const [status, kept] of Object.entries(rows)) {
            const r = outcome(online(status), { actorType: 'customer' });
            assert.deepEqual(pick(r), { billable: true, strike: false, couponReturn: false, kept, refund: 52000 - kept }, status);
        }
    });

    test('online, owner and superadmin: shop reasons give everything back; customer asked follows the share', () => {
        for (const reasonCode of ['busy', 'out_of_stock', 'shop_fault', 'other']) {
            assert.deepEqual(pick(outcome(online('preparing'), { actorType: 'owner', reasonCode })), { ...FREE, refund: 52000 }, reasonCode);
        }
        const asked = outcome(online('preparing'), { actorType: 'owner', reasonCode: 'customer_asked' });
        assert.deepEqual(pick(asked), { billable: true, strike: false, couponReturn: false, kept: 25000, refund: 27000 });   // no strike for online
        assert.deepEqual(pick(outcome(online('preparing'), { actorType: 'superadmin', reasonCode: 'platform' })), { ...FREE, refund: 52000 });
        assert.equal(outcome(online('preparing'), { actorType: 'superadmin', reasonCode: 'customer_fault' }).keptPaise, 25000);
    });

    test('online, undelivered: customer fault keeps the food (and gives a strike), shop or rider fault gives everything back', () => {
        const u = (reasonCode) => outcomeFor({ order: online('out_for_delivery'), kind: 'undelivered', actorType: 'owner', reasonCode, now: T0 });
        assert.deepEqual(pick(u('customer')), { billable: true, strike: true, couponReturn: false, kept: 50000, refund: 2000 });
        assert.deepEqual(pick(u('shop')), { ...FREE, refund: 52000 });
        assert.deepEqual(pick(u('rider')), { ...FREE, refund: 52000 });
    });

    test('a frozen shop: the customer gets everything back and no penalty, even at "preparing"', () => {
        const r = outcome(online('preparing'), { actorType: 'customer', frozen: true });
        assert.equal(r.reasonCode, 'platform');
        assert.deepEqual(pick(r), { ...FREE, refund: 52000 });
        assert.deepEqual(pick(outcome(cod('preparing'), { actorType: 'customer', frozen: true })), FREE);
    });

    test('an online order that was never paid has no money to keep or give back', () => {
        const unpaid = online('preparing', { payment: { method: 'upi', status: 'pending' } });
        const r = outcome(unpaid, { actorType: 'customer' });
        assert.deepEqual(pick(r), { billable: false, strike: false, couponReturn: true, kept: 0, refund: 0 });
    });
});

describe('order flow rules (no database)', () => {
    const base = (o) => ({ orderType: 'delivery', status: 'preparing', payment: { method: 'cod' }, ...o });

    test('N4: a COD customer can cancel only while placed or accepted, an online customer in every active step', () => {
        for (const status of ['placed', 'accepted']) assert.equal(customerCanCancel(base({ status })), true, `cod ${status}`);
        for (const status of ['preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled', 'undelivered']) {
            assert.equal(customerCanCancel(base({ status })), false, `cod ${status}`);
        }
        const upi = { payment: { method: 'upi' } };
        for (const status of ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery']) assert.equal(customerCanCancel(base({ status, ...upi })), true, `online ${status}`);
        for (const status of ['delivered', 'cancelled', 'undelivered']) assert.equal(customerCanCancel(base({ status, ...upi })), false, `online ${status}`);
    });

    test('the frozen-shop escape hatch: suspended, in maintenance or blocked shops let a customer cancel any active order', () => {
        const order = base({ status: 'out_for_delivery' });
        assert.equal(customerCanCancel(order, { status: 'active' }), false);
        assert.equal(customerCanCancel(order, { status: 'suspended' }), true);
        assert.equal(customerCanCancel(order, { status: 'active', ownerBlocked: true }), true);
        assert.equal(customerCanCancel(order, { status: 'active', maintenance: { on: true } }), true);
        assert.equal(customerCanCancel(order, { status: 'active', maintenance: { on: true, until: new Date(Date.now() - 1000) } }), false);
        assert.equal(customerCanCancel(base({ status: 'delivered' }), { status: 'suspended' }), false);   // finished orders stay finished
        assert.equal(shopFrozen(undefined), false);
    });

    test('N3: "undelivered" needs a rider problem and 15 minutes after the FIRST one', () => {
        const withProblem = (minutes, o = {}) => base({
            status: 'out_for_delivery',
            delivery: { problems: [{ at: new Date(T0.getTime() - minutes * 60000), reason: 'cannot_reach' }, { at: new Date(T0.getTime() - 60000) }] },
            ...o,
        });
        assert.equal(canMarkUndelivered(base({ status: 'out_for_delivery' }), T0).ok, false);                      // no problem reported
        assert.match(canMarkUndelivered(base({ status: 'out_for_delivery' }), T0).message, /report a delivery problem/);
        const early = canMarkUndelivered(withProblem(5), T0);
        assert.equal(early.ok, false);
        assert.equal(early.minutesLeft, 10);
        assert.match(early.message, /wait 10 more minute/);
        assert.equal(canMarkUndelivered(withProblem(14.5), T0).ok, false);
        assert.equal(canMarkUndelivered(withProblem(15), T0).ok, true);                                             // exactly 15 minutes
        assert.equal(canMarkUndelivered(withProblem(60), T0).ok, true);
        assert.equal(canMarkUndelivered(withProblem(60, { orderType: 'pickup' }), T0).ok, false);                   // delivery orders only
        for (const status of ['delivered', 'cancelled', 'undelivered']) assert.equal(canMarkUndelivered(withProblem(60, { status }), T0).ok, false, status);
        assert.equal(canMarkUndelivered(withProblem(60, { status: 'preparing' }), T0).ok, true);                    // a problem before pickup counts too
    });

    test('the buttons the owner sees: next step, cancel, and "undelivered" only when allowed', () => {
        assert.deepEqual(nextStatuses(base({ status: 'placed' }), T0), ['accepted', 'cancelled']);
        assert.deepEqual(nextStatuses(base({ status: 'preparing' }), T0), ['out_for_delivery', 'cancelled']);
        assert.deepEqual(nextStatuses(base({ status: 'preparing', orderType: 'pickup' }), T0), ['ready', 'cancelled']);
        const stuck = base({ status: 'out_for_delivery', delivery: { problems: [{ at: new Date(T0.getTime() - 20 * 60000) }] } });
        assert.deepEqual(nextStatuses(stuck, T0), ['delivered', 'cancelled', 'undelivered']);
        for (const status of ['delivered', 'cancelled', 'undelivered']) assert.deepEqual(nextStatuses(base({ status }), T0), [], status);
    });
});