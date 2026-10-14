// Profit and loss of the PLATFORM (your business), and who owes you money.
// Money rules: invoices are stored in rupees, everything else in paise. This file answers in PAISE.
//   income  = rent collected WITHOUT GST (GST is not yours) + SMS margin (what shops paid minus what the provider charged)
//   costs   = expenses you typed in + alert SMS the platform paid itself
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const SmsLog = require('../models/SmsLog');
const PlatformSmsCost = require('../models/PlatformSmsCost');
const Expense = require('../models/Expense');
const Tenant = require('../models/Tenant');

const IST_MS = 5.5 * 3600 * 1000;
const DAY = 86400000;
const toPaise = (rupees) => Math.round(Number(rupees || 0) * 100);
const istKey = (d) => new Date(new Date(d).getTime() + IST_MS).toISOString().slice(0, 7);
const monthStart = (key) => new Date(`${key}-01T00:00:00+05:30`);
const rs = (p) => `Rs ${Math.round(Math.abs(p) / 100).toLocaleString('en-IN')}`;

function lastMonths(count, now = new Date()) {
    let [y, m] = istKey(now).split('-').map(Number);
    const out = [];
    for (let i = 0; i < count; i += 1) {
        out.unshift(`${y}-${String(m).padStart(2, '0')}`);
        m -= 1;
        if (m === 0) { m = 12; y -= 1; }
    }
    return out;
}
const nextKey = (key) => {
    const [y, m] = key.split('-').map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

// the month keys (inside firstKey..lastKey) in which an expense counts
function expenseMonths(e, firstKey, lastKey) {
    const startKey = istKey(e.date);
    if (!e.repeatMonthly) return startKey >= firstKey && startKey <= lastKey ? [startKey] : [];
    const endKey = e.endsOn ? istKey(e.endsOn) : lastKey;
    const out = [];
    for (let k = startKey; k <= endKey && k <= lastKey; k = nextKey(k)) if (k >= firstKey) out.push(k);
    return out;
}

// Who owes money, how late, and who pays on time or late.
async function receivables({ now = new Date() } = {}) {
    const [pending, paid] = await Promise.all([
        SubscriptionInvoice.find({ status: 'pending' }).select('tenantId total baseAmount dueDate').lean(),
        SubscriptionInvoice.find({ status: 'paid' }).select('tenantId dueDate paidAt').lean(),
    ]);
    const ids = [...new Set([...pending, ...paid].map((i) => String(i.tenantId)))];
    const tenants = await Tenant.find({ _id: { $in: ids } }).select('name slug phone status billing.state').lean();
    const tmap = new Map(tenants.map((t) => [String(t._id), t]));
    const buckets = { notDue: 0, d1_7: 0, d8_30: 0, d31_60: 0, d60plus: 0 };
    const bucketOf = (days) => (days <= 0 ? 'notDue' : days <= 7 ? 'd1_7' : days <= 30 ? 'd8_30' : days <= 60 ? 'd31_60' : 'd60plus');
    const shops = new Map();
    const shop = (id) => {
        if (!shops.has(id)) {
            const t = tmap.get(id) || {};
            shops.set(id, {
                tenantId: id, name: t.name || 'Deleted shop', slug: t.slug, billingState: t.billing?.state || 'free',
                unpaidPaise: 0, overduePaise: 0, invoices: 0, overdueInvoices: 0, oldestDueAt: null, daysOverdue: 0,
                paidCount: 0, avgDaysLate: 0, onTimeRate: null, lastPaidAt: null, behaviour: 'new',
            });
        }
        return shops.get(id);
    };
    let pendingPaise = 0;
    let overduePaise = 0;
    let overdueBasePaise = 0;
    for (const i of pending) {
        const p = toPaise(i.total);
        const days = Math.floor((now - new Date(i.dueDate)) / DAY);
        const s = shop(String(i.tenantId));
        s.unpaidPaise += p;
        s.invoices += 1;
        pendingPaise += p;
        buckets[bucketOf(days)] += p;
        if (days > 0) {
            overduePaise += p;
            overdueBasePaise += toPaise(i.baseAmount);
            s.overduePaise += p;
            s.overdueInvoices += 1;
            s.daysOverdue = Math.max(s.daysOverdue, days);
        }
        if (!s.oldestDueAt || new Date(i.dueDate) < new Date(s.oldestDueAt)) s.oldestDueAt = i.dueDate;
    }
    const lateSum = new Map();
    const onTime = new Map();
    for (const i of paid) {
        if (!i.paidAt || !i.dueDate) continue;
        const id = String(i.tenantId);
        const s = shop(id);
        s.paidCount += 1;
        const late = Math.max(0, Math.floor((new Date(i.paidAt) - new Date(i.dueDate)) / DAY));
        lateSum.set(id, (lateSum.get(id) || 0) + late);
        if (late === 0) onTime.set(id, (onTime.get(id) || 0) + 1);
        if (!s.lastPaidAt || new Date(i.paidAt) > new Date(s.lastPaidAt)) s.lastPaidAt = i.paidAt;
    }
    for (const [id, s] of shops) {
        if (s.paidCount) {
            s.avgDaysLate = Math.round((lateSum.get(id) / s.paidCount) * 10) / 10;
            s.onTimeRate = Math.round(((onTime.get(id) || 0) / s.paidCount) * 100);
        }
        // not_paying: nothing ever paid, or waiting over 30 days, or paused. late_now: overdue a short while.
        if (s.overduePaise > 0) s.behaviour = (s.paidCount === 0 || s.daysOverdue > 30 || s.billingState === 'paused') ? 'not_paying' : 'late_now';
        else if (s.paidCount && s.avgDaysLate > 0) s.behaviour = 'paying_late';
        else if (s.paidCount) s.behaviour = 'on_time';
    }
    const all = [...shops.values()];
    const owing = all.filter((s) => s.unpaidPaise > 0).sort((a, b) => b.overduePaise - a.overduePaise || b.unpaidPaise - a.unpaidPaise);
    return {
        totals: {
            pendingPaise,
            overduePaise,
            overdueBasePaise,
            overdueShops: owing.filter((s) => s.overduePaise > 0).length,
            owingShops: owing.length,
            neverPaid: owing.filter((s) => s.paidCount === 0).length,
            buckets: Object.entries(buckets).map(([key, paise]) => ({ key, paise })),
        },
        shops: owing,
        behaviour: all.filter((s) => s.paidCount > 0).sort((a, b) => b.avgDaysLate - a.avgDaysLate),
    };
}

// Plain-words reasons: why it is a loss, or what is eating the profit
async function explain({ totals, list, rec, from, to }) {
    const out = [];
    const add = (level, code, text) => out.push({ level, code, text });
    if (totals.costsPaise > totals.incomePaise) {
        add('bad', 'costs_above_income', `Costs (${rs(totals.costsPaise)}) are more than income (${rs(totals.incomePaise)}).`);
    }
    if (rec.totals.overduePaise > 0) {
        const would = totals.netPaise + rec.totals.overdueBasePaise;
        add('bad', 'unpaid_rent', `${rs(rec.totals.overduePaise)} of rent is overdue from ${rec.totals.overdueShops} shop(s). If it was paid you would be at ${would >= 0 ? 'a profit' : 'a loss'} of about ${rs(would)}.`);
    }
    if (rec.totals.pendingPaise > rec.totals.overduePaise) {
        add('info', 'not_due_yet', `${rs(rec.totals.pendingPaise - rec.totals.overduePaise)} is billed but not due yet.`);
    }
    if (totals.platformSmsCostPaise > 0) {
        add('warn', 'platform_sms', `You paid ${rs(totals.platformSmsCostPaise)} for alert SMS because shop wallets were empty.`);
    }
    if (totals.smsMarginPaise < 0) {
        add('bad', 'sms_negative', `SMS is losing money: you paid the provider ${rs(totals.smsMarginPaise)} more than shops paid you. Check the SMS prices.`);
    }
    const losing = await SmsLog.aggregate([
        { $match: { createdAt: { $gte: from, $lt: to }, status: 'sent', own: { $ne: true } } },
        { $group: { _id: '$tenantId', charged: { $sum: '$chargedPaise' }, cost: { $sum: '$costPaise' } } },
        { $match: { $expr: { $lt: ['$charged', '$cost'] } } },
    ]);
    if (losing.length) add('warn', 'sms_negative_shops', `${losing.length} shop(s) cost you more in SMS than they pay.`);
    const [free, paused, suspended] = await Promise.all([
        Tenant.countDocuments({ status: 'active', 'billing.state': 'free' }),
        Tenant.countDocuments({ 'billing.state': 'paused' }),
        Tenant.countDocuments({ status: 'suspended' }),
    ]);
    if (free) add('info', 'free_period', `${free} shop(s) are still in the free period and do not pay yet.`);
    if (paused) add('warn', 'paused', `${paused} shop(s) are paused for non-payment, so they bring no income.`);
    if (suspended) add('info', 'suspended', `${suspended} shop(s) are suspended.`);
    if (totals.expensesPaise === 0) add('info', 'no_expenses', 'No expenses are entered, so the profit shown may be too high. Add hosting, SMS provider and other costs.');
    const worst = [...list].sort((a, b) => a.netPaise - b.netPaise)[0];
    if (worst && worst.netPaise < 0) add('info', 'worst_month', `The weakest month was ${worst.month} (loss of ${rs(worst.netPaise)}).`);
    if (!out.length) add('good', 'healthy', 'Nothing is hurting your profit right now.');
    return out;
}

async function summary({ months = 6, now = new Date() } = {}) {
    const keys = lastMonths(months, now);
    const from = monthStart(keys[0]);
    const to = monthStart(nextKey(keys[keys.length - 1]));
    const rows = new Map(keys.map((k) => [k, {
        month: k, billedPaise: 0, collectedPaise: 0, rentIncomePaise: 0, gstPaise: 0,
        smsChargedPaise: 0, smsCostPaise: 0, smsMarginPaise: 0, platformSmsCostPaise: 0, expensesPaise: 0,
    }]));
    const row = (d) => rows.get(istKey(d));

    const [billed, paid, sms, platformSms, expenses] = await Promise.all([
        SubscriptionInvoice.find({ status: { $ne: 'void' }, issueDate: { $gte: from, $lt: to } }).select('issueDate total').lean(),
        SubscriptionInvoice.find({ status: 'paid', paidAt: { $gte: from, $lt: to } }).select('paidAt total baseAmount gstAmount').lean(),
        SmsLog.aggregate([
            { $match: { createdAt: { $gte: from, $lt: to }, status: 'sent', own: { $ne: true } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: '+05:30' } }, charged: { $sum: '$chargedPaise' }, cost: { $sum: '$costPaise' } } },
        ]),
        PlatformSmsCost.find({ at: { $gte: from, $lt: to } }).select('at costPaise').lean(),
        Expense.find({}).lean(),
    ]);

    for (const i of billed) row(i.issueDate).billedPaise += toPaise(i.total);
    for (const i of paid) {
        const r = row(i.paidAt);
        r.collectedPaise += toPaise(i.total);
        r.rentIncomePaise += toPaise(i.baseAmount);
        r.gstPaise += toPaise(i.gstAmount);
    }
    for (const s of sms) {
        const r = rows.get(s._id);
        if (r) {
            r.smsChargedPaise = s.charged;
            r.smsCostPaise = s.cost;
            r.smsMarginPaise = s.charged - s.cost;
        }
    }
    for (const c of platformSms) row(c.at).platformSmsCostPaise += c.costPaise;
    const byCategory = new Map();
    for (const e of expenses) {
        for (const k of expenseMonths(e, keys[0], keys[keys.length - 1])) {
            rows.get(k).expensesPaise += e.amountPaise;
            byCategory.set(e.category, (byCategory.get(e.category) || 0) + e.amountPaise);
        }
    }

    const list = [...rows.values()].map((r) => {
        const incomePaise = r.rentIncomePaise + r.smsMarginPaise;
        const costsPaise = r.expensesPaise + r.platformSmsCostPaise;
        return { ...r, incomePaise, costsPaise, netPaise: incomePaise - costsPaise };
    });
    const sum = (f) => list.reduce((a, r) => a + r[f], 0);
    const totals = {};
    for (const f of ['billedPaise', 'collectedPaise', 'rentIncomePaise', 'gstPaise', 'smsMarginPaise', 'platformSmsCostPaise', 'expensesPaise', 'incomePaise', 'costsPaise', 'netPaise']) totals[f] = sum(f);
    const verdict = totals.netPaise > 0 ? 'profit' : totals.netPaise < 0 ? 'loss' : 'break_even';
    const expensesByCategory = [...byCategory.entries()].map(([category, paise]) => ({ category, paise })).sort((a, b) => b.paise - a.paise);

    const rec = await receivables({ now });
    const reasons = await explain({ totals, list, rec, from, to });
    return { months: keys, rows: list, totals, verdict, expensesByCategory, reasons, receivables: rec.totals };
}

module.exports = { summary, receivables, lastMonths, expenseMonths, istKey };
