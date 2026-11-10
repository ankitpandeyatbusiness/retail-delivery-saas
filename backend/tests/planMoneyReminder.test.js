require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const PlanPayment = require('../src/models/PlanPayment');
const PlatformDispute = require('../src/models/PlatformDispute');
const adminAlerts = require('../src/services/adminAlerts');
const reminder = require('../src/services/planMoneyReminder');

// Held plan payments and open bank disputes must not be forgotten: one alert a morning while any waits.
let w; let alerts; let n = 0;
const DAY = 86400000;

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld(`remind-${++n}`);
    alerts = [];
    mock.method(adminAlerts, 'alert', async (key, p) => { alerts.push({ key, ...p }); return null; });
});
afterEach(() => mock.restoreAll());

describe('the morning reminder', () => {
    test('nothing waits: no alert', async () => {
        assert.deepEqual(await reminder.remind(), { held: 0, disputes: 0, alerted: false });
        assert.equal(alerts.length, 0);
    });

    test('a held payment and an open dispute: one alert naming both, and how old', async () => {
        await PlanPayment.create({ tenantId: w.tenant._id, kind: 'new', to: 'pro', months: 1, status: 'held', paymentId: 'pay_r1', paidAt: new Date(Date.now() - 3 * DAY), payablePaise: 100000, quote: {} });
        await PlatformDispute.create({ tenantId: w.tenant._id, kind: 'wallet', sourceId: 'x', rzpDisputeId: 'disp_r1', status: 'action_required', amountPaise: 59000, respondBy: new Date(Date.now() + 2 * DAY) });
        const r = await reminder.remind();
        assert.deepEqual([r.held, r.disputes, r.alerted], [1, 1, true]);
        assert.equal(alerts.length, 1);
        assert.equal(alerts[0].key, 'admin_plan_money_waiting');
        assert.match(alerts[0].vars.summary, /1 held payment .*3 day\(s\) old/);
        assert.match(alerts[0].vars.summary, /1 open bank dispute \(reply by \d{4}-\d{2}-\d{2}\)/);
    });

    test('a finished dispute and an applied payment are not mentioned', async () => {
        await PlanPayment.create({ tenantId: w.tenant._id, kind: 'new', to: 'pro', months: 1, status: 'paid', paymentId: 'pay_r2', paidAt: new Date(), payablePaise: 100000, quote: {} });
        await PlatformDispute.create({ tenantId: w.tenant._id, kind: 'plan', sourceId: 'y', rzpDisputeId: 'disp_r2', status: 'won', amountPaise: 1000 });
        assert.equal((await reminder.remind()).alerted, false);
    });
});
