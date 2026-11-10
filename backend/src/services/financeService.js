// Profit and loss of the PLATFORM (your business). Everything is prepaid, so nobody owes money: what came in is what was paid (services/platformSales.js).
// Money rules: invoices are stored in rupees, everything else in paise. This file answers in PAISE.
//   income  = plans and extra shops WITHOUT GST (GST is not yours) + the per-order fees taken from Partner wallets + SMS margin (what shops paid minus what the provider charged)
//             (a wallet top-up is prepaid money, not income until it is used as a fee)
//   costs   = expenses you typed in + alert SMS the platform paid itself
const platformSales = require('./platformSales');
const PartnerTransaction = require('../models/PartnerTransaction');
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

// Plain-words reasons: why it is a loss, or what is eating the profit
async function explain({ totals, list, from, to, unit = 'month' }) {
    const out = [];
    const add = (level, code, text) => out.push({ level, code, text });
    if (totals.costsPaise > totals.incomePaise) {
        add('bad', 'costs_above_income', `Costs (${rs(totals.costsPaise)}) are more than income (${rs(totals.incomePaise)}).`);
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
    const now = new Date();
    const [free, paused, suspended] = await Promise.all([
        Tenant.countDocuments({ status: 'active', 'plan.freeUntil': { $gt: now } }),
        Tenant.countDocuments({ 'plan.paused': true }),
        Tenant.countDocuments({ status: 'suspended' }),
    ]);
    if (free) add('info', 'free_period', `${free} shop(s) are still in a free period and do not pay yet.`);
    if (paused) add('warn', 'paused', `${paused} shop(s) are paused because their plan was not renewed, so they bring no income.`);
    if (suspended) add('info', 'suspended', `${suspended} shop(s) are suspended.`);
    if (totals.expensesPaise === 0) add('info', 'no_expenses', 'No expenses are entered, so the profit shown may be too high. Add hosting, SMS provider and other costs.');
    const worst = [...list].sort((a, b) => a.netPaise - b.netPaise)[0];
    if (worst && worst.netPaise < 0) add('info', 'worst_month', `The weakest ${unit} was ${worst.label || worst.month} (loss of ${rs(worst.netPaise)}).`);
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

    const [paid, fees, sms, platformSms, expenses] = await Promise.all([
        platformSales.paid({ from, to }),
        PartnerTransaction.find({ type: { $in: ['fee', 'reverse'] }, createdAt: { $gte: from, $lt: to } }).select('createdAt amountPaise').lean(),
        SmsLog.aggregate([
            { $match: { createdAt: { $gte: from, $lt: to }, status: 'sent', own: { $ne: true } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: '+05:30' } }, charged: { $sum: '$chargedPaise' }, cost: { $sum: '$costPaise' } } },
        ]),
        PlatformSmsCost.find({ at: { $gte: from, $lt: to } }).select('at costPaise').lean(),
        Expense.find({}).lean(),
    ]);

    // plans, extra shops and wallet top-ups: what was collected. Income is the plans' own price (no GST) plus the fees that were used out of the wallets.
    for (const i of paid.filter((x) => x.kind !== 'sms')) {
        const r = row(i.paidAt);
        r.billedPaise += toPaise(i.total);   // everything is prepaid: billed = collected
        r.collectedPaise += toPaise(i.total);
        if (i.kind === 'plan' || i.kind === 'branch') r.rentIncomePaise += toPaise(i.baseAmount);
        r.gstPaise += toPaise(i.gstAmount);
    }
    for (const f of fees) row(f.createdAt).rentIncomePaise -= f.amountPaise;   // fees are stored negative, a put-back positive
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

    const reasons = await explain({ totals, list, from, to });
    return { months: keys, rows: list, totals, verdict, expensesByCategory, reasons };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The same profit and loss by WEEK (Monday to Sunday), MONTH or FINANCIAL YEAR (1 April to 31 March), all in Indian time.
// Same rules as summary(): income = plan and extra-shop prices without GST + wallet fees used + SMS margin; costs = expenses you typed + alert SMS you paid.
// A monthly expense is spread evenly over the days of its month, so a week gets its share and a year gets all twelve.
const dayKey = (d) => new Date(new Date(d).getTime() + IST_MS).toISOString().slice(0, 10);
const weekStartKey = (d) => { const t = new Date(new Date(d).getTime() + IST_MS); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
const fyKey = (d) => { const [y, m] = istKey(d).split('-').map(Number); return String(m >= 4 ? y : y - 1); };
const keyOf = (d, period) => (period === 'week' ? weekStartKey(d) : period === 'year' ? fyKey(d) : istKey(d));
const addDaysKey = (key, n) => new Date(new Date(`${key}T12:00:00+05:30`).getTime() + n * DAY).toISOString().slice(0, 10);
const startOf = (key, period) => (period === 'week' ? new Date(`${key}T00:00:00+05:30`) : period === 'year' ? new Date(`${key}-04-01T00:00:00+05:30`) : monthStart(key));
const endOf = (key, period) => (period === 'week' ? new Date(startOf(key, period).getTime() + 7 * DAY) : period === 'year' ? new Date(`${Number(key) + 1}-04-01T00:00:00+05:30`) : monthStart(nextKey(key)));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const labelOf = (key, period) => {
    if (period === 'year') return `FY ${key}-${String((Number(key) + 1) % 100).padStart(2, '0')}`;
    if (period === 'week') { const [, m, d] = key.split('-').map(Number); return `${d} ${MON[m - 1]}`; }
    return key;
};
function bucketKeys(period, count, now) {
    if (period === 'month') return lastMonths(count, now);
    const out = [];
    let k = keyOf(now, period);
    for (let i = 0; i < count; i += 1) { out.unshift(k); k = period === 'week' ? addDaysKey(k, -7) : String(Number(k) - 1); }
    return out;
}

async function summaryBy({ period = 'month', count, now = new Date() } = {}) {
    if (!['week', 'month', 'year'].includes(period)) period = 'month';
    const n = Math.max(1, Math.min(period === 'week' ? 26 : period === 'month' ? 24 : 5, Number(count) || (period === 'week' ? 8 : period === 'month' ? 6 : 2)));
    const keys = bucketKeys(period, n, now);
    const from = startOf(keys[0], period);
    const to = endOf(keys[keys.length - 1], period);
    const rows = new Map(keys.map((k) => [k, {
        key: k, label: labelOf(k, period), from: startOf(k, period), to: endOf(k, period), billedPaise: 0, collectedPaise: 0, rentIncomePaise: 0, gstPaise: 0,
        smsChargedPaise: 0, smsCostPaise: 0, smsMarginPaise: 0, platformSmsCostPaise: 0, expensesPaise: 0,
    }]));
    const row = (d) => rows.get(keyOf(d, period));

    const [paid, fees, smsDays, platformSms, expenses] = await Promise.all([
        platformSales.paid({ from, to }),
        PartnerTransaction.find({ type: { $in: ['fee', 'reverse'] }, createdAt: { $gte: from, $lt: to } }).select('createdAt amountPaise').lean(),
        SmsLog.aggregate([
            { $match: { createdAt: { $gte: from, $lt: to }, status: 'sent', own: { $ne: true } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: '+05:30' } }, charged: { $sum: '$chargedPaise' }, cost: { $sum: '$costPaise' } } },
        ]),
        PlatformSmsCost.find({ at: { $gte: from, $lt: to } }).select('at costPaise').lean(),
        Expense.find({}).lean(),
    ]);
    for (const i of paid.filter((x) => x.kind !== 'sms')) {
        const r = row(i.paidAt);
        if (!r) continue;
        r.billedPaise += toPaise(i.total);
        r.collectedPaise += toPaise(i.total);
        if (i.kind === 'plan' || i.kind === 'branch') r.rentIncomePaise += toPaise(i.baseAmount);
        r.gstPaise += toPaise(i.gstAmount);
    }
    for (const x of fees) { const r = row(x.createdAt); if (r) r.rentIncomePaise -= x.amountPaise; }
    for (const d of smsDays) {
        const r = row(`${d._id}T12:00:00+05:30`);
        if (r) { r.smsChargedPaise += d.charged; r.smsCostPaise += d.cost; r.smsMarginPaise += d.charged - d.cost; }
    }
    for (const c of platformSms) { const r = row(c.at); if (r) r.platformSmsCostPaise += c.costPaise; }

    // expenses: a one-off lands where its date is; a monthly one is spread evenly over the days of each month it runs
    const byCategory = new Map();
    const put = (r, e, paise) => { r.expensesPaise += paise; byCategory.set(e.category, (byCategory.get(e.category) || 0) + paise); };
    const firstMonth = istKey(from); const lastMonth = [istKey(new Date(to.getTime() - 1)), istKey(now)].sort()[0];   // never the months that have not come yet
    for (const e of expenses) {
        if (!e.repeatMonthly) { const r = row(e.date); if (r) put(r, e, e.amountPaise); continue; }
        for (const k of expenseMonths(e, firstMonth, lastMonth)) {
            if (period === 'month') { const r = rows.get(k); if (r) put(r, e, e.amountPaise); continue; }
            if (period === 'year') { const r = row(`${k}-15T12:00:00+05:30`); if (r) put(r, e, e.amountPaise); continue; }
            const [y, m] = k.split('-').map(Number);
            const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
            const part = new Map();
            for (let d = 1; d <= days; d += 1) { const wk = weekStartKey(`${k}-${String(d).padStart(2, '0')}T12:00:00+05:30`); part.set(wk, (part.get(wk) || 0) + 1); }
            for (const [wk, nDays] of part) { const r = rows.get(wk); if (r) put(r, e, Math.round((e.amountPaise * nDays) / days)); }
        }
    }

    const list = [...rows.values()].map((r) => {
        const incomePaise = r.rentIncomePaise + r.smsMarginPaise;
        const costsPaise = r.expensesPaise + r.platformSmsCostPaise;
        return { ...r, incomePaise, costsPaise, netPaise: incomePaise - costsPaise };
    });
    const sum = (k) => list.reduce((a, r) => a + r[k], 0);
    const totals = {};
    for (const k of ['billedPaise', 'collectedPaise', 'rentIncomePaise', 'gstPaise', 'smsMarginPaise', 'platformSmsCostPaise', 'expensesPaise', 'incomePaise', 'costsPaise', 'netPaise']) totals[k] = sum(k);
    const verdict = totals.netPaise > 0 ? 'profit' : totals.netPaise < 0 ? 'loss' : 'break_even';
    const expensesByCategory = [...byCategory.entries()].map(([category, paise]) => ({ category, paise })).sort((a, b) => b.paise - a.paise);
    const reasons = await explain({ totals, list, from, to, unit: period });
    return { period, keys, labels: list.map((r) => r.label), rows: list, totals, verdict, expensesByCategory, reasons };
}

// This week, this month and this financial year (and the one before each), for the Money tab
async function periods({ now = new Date() } = {}) {
    const [w, m, y] = await Promise.all([summaryBy({ period: 'week', count: 2, now }), summaryBy({ period: 'month', count: 2, now }), summaryBy({ period: 'year', count: 2, now })]);
    const pick = (x) => ({ label: x.rows[1].label, netPaise: x.rows[1].netPaise, incomePaise: x.rows[1].incomePaise, costsPaise: x.rows[1].costsPaise, prevLabel: x.rows[0].label, prevNetPaise: x.rows[0].netPaise });
    return { week: pick(w), month: pick(m), year: pick(y) };
}

module.exports = { summary, summaryBy, periods, lastMonths, expenseMonths, istKey };
