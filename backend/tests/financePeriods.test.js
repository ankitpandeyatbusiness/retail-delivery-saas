require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const Expense = require('../src/models/Expense');
const PartnerTransaction = require('../src/models/PartnerTransaction');
const { paidPlan } = require('./helpers/planPay');
const finance = require('../src/services/financeService');

// Profit and loss by week, month and financial year (Indian time).
let w; let admin; let n = 0;
const NOW = new Date('2026-11-10T12:00:00+05:30');   // a Tuesday
const at = (iso) => new Date(`${iso}T12:00:00+05:30`);
const get = (p) => request(app).get(`/api/admin${p}`).set({ Authorization: `Bearer ${admin.token}` });

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); w = await f.makeWorld(`fin-${++n}`); admin = await f.makeSuperAdmin(); });

describe('by week', () => {
    test('weeks run Monday to Sunday: a payment lands in its own week, the labels are the Mondays', async () => {
        await paidPlan(w.tenant._id, { baseRs: 1000, paidAt: at('2026-11-10') });   // this week (Mon 9 Nov)
        await paidPlan(w.tenant._id, { baseRs: 2000, paidAt: at('2026-11-08') });   // Sunday: the week before (Mon 2 Nov)
        await paidPlan(w.tenant._id, { baseRs: 500, paidAt: at('2026-11-02') });    // Monday 2 Nov: the same earlier week
        const r = await finance.summaryBy({ period: 'week', count: 3, now: NOW });
        assert.deepEqual(r.keys, ['2026-10-26', '2026-11-02', '2026-11-09']);
        assert.deepEqual(r.labels, ['26 Oct', '2 Nov', '9 Nov']);
        assert.deepEqual(r.rows.map((x) => x.incomePaise), [0, 250000, 100000]);   // GST is not income
        assert.equal(r.totals.incomePaise, 350000);
    });

    test('a monthly expense is spread over the days: the weeks add up to the days that passed, a one-off lands in its week', async () => {
        await Expense.create({ date: at('2026-11-01'), category: 'hosting', amountPaise: 300000, repeatMonthly: true });   // 30 days in November
        await Expense.create({ date: at('2026-11-11'), category: 'tools', amountPaise: 70000 });                            // Wed in the week of 9 Nov
        const r = await finance.summaryBy({ period: 'week', count: 6, now: new Date('2026-11-29T12:00:00+05:30') });   // the weeks end on Sunday 29 Nov
        const sum = r.rows.reduce((a, x) => a + x.expensesPaise, 0);
        assert.ok(Math.abs(sum - (70000 + 300000 * 29 / 30)) <= 5, `29 days of hosting plus the one-off (${sum})`);
        const wk = r.rows.find((x) => x.key === '2026-11-09');
        assert.ok(wk.expensesPaise >= 70000 + 300000 / 30 * 6, 'the week with the one-off holds it plus about 7 days of hosting');
    });
});

describe('by financial year', () => {
    test('1 April starts a new year: 31 March is the old one', async () => {
        await paidPlan(w.tenant._id, { baseRs: 1000, paidAt: at('2026-03-31') });
        await paidPlan(w.tenant._id, { baseRs: 4000, paidAt: at('2026-04-01') });
        await paidPlan(w.tenant._id, { baseRs: 500, paidAt: at('2025-04-01') });
        const r = await finance.summaryBy({ period: 'year', count: 3, now: NOW });
        assert.deepEqual(r.labels, ['FY 2024-25', 'FY 2025-26', 'FY 2026-27']);
        assert.deepEqual(r.rows.map((x) => x.incomePaise), [0, 150000, 400000]);
    });

    test('a monthly expense counts all its months in the year (April to the current month)', async () => {
        await Expense.create({ date: at('2026-04-05'), category: 'hosting', amountPaise: 100000, repeatMonthly: true });
        const r = await finance.summaryBy({ period: 'year', count: 1, now: NOW });
        assert.equal(r.rows[0].expensesPaise, 100000 * 8);   // April to November
        assert.equal(r.rows[0].netPaise, -800000);
    });
});

describe('by month: the same numbers as before', () => {
    test('every month matches summary()', async () => {
        await paidPlan(w.tenant._id, { baseRs: 1000, paidAt: at('2026-11-03') });
        await paidPlan(w.tenant._id, { baseRs: 3000, paidAt: at('2026-10-20') });
        await Expense.create({ date: at('2026-10-02'), category: 'tools', amountPaise: 40000 });
        await PartnerTransaction.create({ tenantId: w.tenant._id, type: 'fee', amountPaise: -900, balanceAfter: 0, orderNo: 1, createdAt: at('2026-11-05') });
        const a = await finance.summary({ months: 3, now: NOW });
        const b = await finance.summaryBy({ period: 'month', count: 3, now: NOW });
        assert.deepEqual(b.rows.map((x) => [x.key, x.incomePaise, x.costsPaise, x.netPaise]), a.rows.map((x) => [x.month, x.incomePaise, x.costsPaise, x.netPaise]));
        assert.equal(b.totals.netPaise, a.totals.netPaise);
    });
});

describe('the endpoints', () => {
    test('summary by period, and this week / month / year with the one before', async () => {
        await paidPlan(w.tenant._id, { baseRs: 1000, paidAt: new Date() });
        const wk = (await get('/finance/summary?period=week&count=4')).body;
        assert.equal(wk.period, 'week');
        assert.equal(wk.rows.length, 4);
        const old = (await get('/finance/summary?months=3')).body;
        assert.equal(old.rows.length, 3);   // the old call still works
        const p = (await get('/finance/periods')).body;
        assert.ok(p.week.label && p.month.label && p.year.label.startsWith('FY '));
        assert.equal(typeof p.month.netPaise, 'number');
        assert.equal(p.month.netPaise >= 100000, true);
    });
});
