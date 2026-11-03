// Platform health: one answer to "is the platform running fine, or do I have to worry?" for the supreme admin and the other superadmins.
// Every card carries a level: 'good' (green), 'warn' (amber, look when you can) or 'bad' (red, act now), and a plain line saying why.
// Everything is read from what the platform already records; nothing is written. A number that is not recorded is not shown (see `notTracked`).
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const Order = require('../models/Order');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const SmsLog = require('../models/SmsLog');
const SupportTicket = require('../models/SupportTicket');
const PaymentWebhookEvent = require('../models/PaymentWebhookEvent');
const AppVersionSeen = require('../models/AppVersionSeen');
const PlatformSettings = require('../models/PlatformSettings');
const googleBudget = require('./googleBudget');
const rentSummary = require('./rentSummary');
const backups = require('./backupService');

const DAY = 86400000;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const rank = { good: 0, warn: 1, bad: 2 };
const worst = (...levels) => levels.reduce((a, b) => (rank[b] > rank[a] ? b : a), 'good');

// thresholds in one place (the supreme admin may want to tune them later)
const T = {
    googleWarn: 60, googleBad: 90,           // % of the monthly allowance used
    collectedWarn: 80,                        // % of this month's bills paid
    ordersWarnDrop: 20, ordersBadDrop: 40,    // % fall of the last 7 days against the 7 before
    backupStaleDays: 1,
    quietDays: 14,
    supportWarnHours: 24, supportBadHours: 72,
    unacceptedMin: 10,
    webhookWarn: 1, webhookBad: 3,
    freeEndingDays: 7,
};

const istStartOfDay = (d) => { const x = new Date(d.getTime() + 330 * 60000); x.setUTCHours(0, 0, 0, 0); return new Date(x.getTime() - 330 * 60000); };
const istMonthStart = (d, plus = 0) => { const x = new Date(d.getTime() + 330 * 60000); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + plus, 1) - 330 * 60000); };
const semver = (v) => String(v).split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
const cmpVer = (a, b) => { const x = semver(a); const y = semver(b); for (let i = 0; i < 3; i += 1) { if (x[i] !== y[i]) return x[i] - y[i]; } return 0; };

/* --------------------------------- shops --------------------------------- */
async function shopsCard(now) {
    const tenants = await Tenant.find({}).select('_id createdAt billing subscription.gstPercent brandId status').lean();
    const count = { total: tenants.length, notLive: 0, free: 0, paying: 0, grace: 0, paused: 0 };
    for (const t of tenants) {
        if (!t.billing?.isLive) { count.notLive += 1; continue; }
        const s = t.billing?.state || 'free';
        count[s] = (count[s] || 0) + 1;
    }
    let freeEnding = 0;
    const rents = await rentSummary.forShops(tenants.filter((t) => t.billing?.isLive && (t.billing?.state || 'free') === 'free'), now);
    for (const r of rents.values()) {
        const ends = r?.free?.endsAt ? new Date(r.free.endsAt) : null;
        if (ends && ends.getTime() - now.getTime() <= T.freeEndingDays * DAY && ends.getTime() >= now.getTime()) freeEnding += 1;
    }
    const level = count.paused > 0 ? 'warn' : 'good';
    const note = count.paused > 0 ? `${count.paused} shop${count.paused === 1 ? ' is' : 's are'} paused for unpaid rent` : 'No shop is paused';
    return { level, note, ...count, freeEnding, paid: count.paying + count.grace + count.paused };
}

/* ----------------------------------- rent ----------------------------------- */
async function rentCard(now) {
    const from = istMonthStart(now); const to = istMonthStart(now, 1);
    const [monthRows, overdue] = await Promise.all([
        SubscriptionInvoice.aggregate([
            { $match: { kind: 'monthly', issueDate: { $gte: from, $lt: to }, status: { $in: ['paid', 'pending'] } } },
            { $group: { _id: '$status', n: { $sum: 1 }, total: { $sum: '$total' } } },
        ]),
        SubscriptionInvoice.aggregate([
            { $match: { status: 'pending', dueDate: { $lt: now } } },
            { $group: { _id: null, n: { $sum: 1 }, total: { $sum: '$total' }, shops: { $addToSet: '$tenantId' } } },
        ]),
    ]);
    const by = Object.fromEntries(monthRows.map((r) => [r._id, r]));
    const paid = by.paid || { n: 0, total: 0 }; const pending = by.pending || { n: 0, total: 0 };
    const billed = paid.n + pending.n;
    const pct = billed ? Math.round((paid.n / billed) * 100) : null;
    const od = overdue[0] || { n: 0, total: 0, shops: [] };
    let level = 'good';
    if (od.n > 0) level = (od.n >= 3 || (billed >= 4 && od.n / billed >= 0.25)) ? 'bad' : 'warn';
    else if (pct !== null && pct < T.collectedWarn && billed > 0) level = 'warn';
    const note = od.n > 0 ? `${od.n} bill${od.n === 1 ? ' is' : 's are'} overdue (${Math.round(od.total).toLocaleString('en-IN')} rupees)` : billed ? `${paid.n} of ${billed} bills paid this month` : 'No bills this month yet';
    return {
        level, note, billed, paidShops: paid.n, collected: round2(paid.total), unpaidShops: pending.n, toCollect: round2(pending.total), percentPaid: pct,
        overdueBills: od.n, overdueShops: od.shops.length, overdueAmount: round2(od.total),
    };
}

/* ------------------------------------ SMS ------------------------------------ */
async function smsCard(now) {
    const since7 = new Date(now.getTime() - 7 * DAY); const since24 = new Date(now.getTime() - DAY); const since10 = new Date(now.getTime() - 10 * 60000);
    const [sent, failed7, failed24, failed10] = await Promise.all([
        SmsLog.aggregate([{ $match: { status: { $in: ['sent', 'mock'] }, createdAt: { $gte: since7 } } }, { $group: { _id: null, sms: { $sum: 1 }, revenuePaise: { $sum: '$chargedPaise' }, costPaise: { $sum: '$costPaise' } } }]),
        SmsLog.countDocuments({ status: 'failed', createdAt: { $gte: since7 } }),
        SmsLog.countDocuments({ status: 'failed', createdAt: { $gte: since24 } }),
        SmsLog.countDocuments({ status: 'failed', createdAt: { $gte: since10 } }),
    ]);
    const s = sent[0] || { sms: 0, revenuePaise: 0, costPaise: 0 };
    const profitPaise = s.revenuePaise - s.costPaise;
    const failing = failed10 >= 3;
    const failRate = s.sms + failed7 ? failed7 / (s.sms + failed7) : 0;
    let level = 'good'; let note = `${s.sms.toLocaleString('en-IN')} SMS sent in 7 days`;
    if (failing) { level = 'bad'; note = `The SMS provider is failing: ${failed10} failed in the last 10 minutes. Logins and alerts may not arrive`; }
    else if (profitPaise < 0) { level = 'bad'; note = 'SMS is costing more than it earns'; }
    else if (failRate > 0.05) { level = 'warn'; note = `${Math.round(failRate * 100)}% of SMS failed in 7 days`; }
    return {
        level, note, days: 7, sent: s.sms, failed7, failed24h: failed24, failedLast10Min: failed10, failing,
        revenue: round2(s.revenuePaise / 100), cost: round2(s.costPaise / 100), profit: round2(profitPaise / 100),
        costPerSms: s.sms ? round2(s.costPaise / 100 / s.sms) : null, chargedPerSms: s.sms ? round2(s.revenuePaise / 100 / s.sms) : null,
    };
}

/* ----------------------------------- orders ----------------------------------- */
async function ordersCard(now) {
    const today = istStartOfDay(now); const d7 = new Date(now.getTime() - 7 * DAY); const d14 = new Date(now.getTime() - 14 * DAY);
    const lm = istMonthStart(now, -1); const tm = istMonthStart(now);
    const live = { status: { $ne: 'cancelled' } };
    const [todayN, last7, prev7, lastMonth, cancelled7, unaccepted] = await Promise.all([
        Order.countDocuments({ ...live, createdAt: { $gte: today } }),
        Order.countDocuments({ ...live, createdAt: { $gte: d7 } }),
        Order.countDocuments({ ...live, createdAt: { $gte: d14, $lt: d7 } }),
        Order.countDocuments({ ...live, createdAt: { $gte: lm, $lt: tm } }),
        Order.countDocuments({ status: 'cancelled', createdAt: { $gte: d7 } }),
        Order.countDocuments({ status: 'placed', createdAt: { $gte: new Date(now.getTime() - DAY), $lt: new Date(now.getTime() - T.unacceptedMin * 60000) } }),
    ]);
    const change = prev7 > 0 ? Math.round(((last7 - prev7) / prev7) * 100) : null;
    let level = 'good'; let note = change === null ? 'Not enough history to compare yet' : `${change >= 0 ? 'Up' : 'Down'} ${Math.abs(change)}% on the 7 days before`;
    if (change !== null && change <= -T.ordersBadDrop) level = 'bad';
    else if (change !== null && change <= -T.ordersWarnDrop) level = 'warn';
    const cancelRate = last7 + cancelled7 ? Math.round((cancelled7 / (last7 + cancelled7)) * 100) : 0;
    if (cancelRate >= 15 && level === 'good') { level = 'warn'; note = `${cancelRate}% of orders were cancelled in 7 days`; }
    return { level, note, today: todayN, last7, prev7, lastMonth, changePercent: change, cancelled7, cancelRatePercent: cancelRate, waitingUnaccepted: unaccepted };
}

/* ------------------------------ Google API calls ------------------------------ */
async function googleCard(now) {
    const usage = await googleBudget.usage(now);
    const apis = Object.entries(usage).map(([key, u]) => {
        const pct = u.cap > 0 ? Math.round((u.used / u.cap) * 100) : (u.used > 0 ? 100 : 0);
        const level = u.cap > 0 && pct >= T.googleBad ? 'bad' : u.cap > 0 && pct >= T.googleWarn ? 'warn' : 'good';
        return { key, label: u.label, used: u.used, cap: u.cap, percent: pct, level, off: !(u.cap > 0) };
    });
    const level = worst('good', ...apis.map((a) => a.level));
    const top = [...apis].sort((a, b) => b.percent - a.percent)[0];
    const note = !top || top.percent === 0 ? 'No paid Google calls this month' : `Highest: ${top.label} at ${top.percent}% of the monthly allowance`;
    return { level, note, apis, notMetered: ['Geocoding', 'Maps in the apps'] };
}

/* -------------------------------- system and payments -------------------------------- */
async function systemCard(now) {
    const t0 = Date.now(); let dbOk = true;
    try { await mongoose.connection.db.admin().ping(); } catch { dbOk = false; }
    const pingMs = Date.now() - t0;
    let backup = { ageDays: null, stale: true };
    try {
        const list = await backups.listBackups();
        const newest = list.daily?.[0] || null;
        const ageDays = newest ? Math.floor((now.getTime() - new Date(`${newest}T00:00:00+05:30`).getTime()) / DAY) : null;
        backup = { newest, ageDays, stale: ageDays === null || ageDays > T.backupStaleDays };
    } catch { /* no backup folder yet */ }
    const prod = process.env.NODE_ENV === 'production';
    const testModes = [['SMS', 'SMS_MOCK'], ['Payments', 'PAYMENTS_MOCK'], ['Email', 'EMAIL_MOCK'], ['File storage', 'STORAGE_MOCK']].filter(([, k]) => process.env[k] === 'true').map(([n]) => n);
    const pushOn = !!process.env.FCM_SERVICE_ACCOUNT_B64;
    const p = await PlatformSettings.findById('main').select('payments.keyId payments.keySecretEnc').lean();
    const razorpayKeys = !!(p?.payments?.keyId || process.env.RAZORPAY_KEY_ID);
    const problems = [];
    let level = 'good';
    if (!dbOk) { level = 'bad'; problems.push('The database is not answering'); }
    if (backup.stale) { level = worst(level, prod ? 'bad' : 'warn'); problems.push(backup.ageDays === null ? 'No backup yet' : `The last backup is ${backup.ageDays} days old`); }
    if (prod && testModes.length) { level = 'bad'; problems.push(`Test mode is on in production: ${testModes.join(', ')}`); }
    if (prod && !pushOn) { level = worst(level, 'bad'); problems.push('Push alerts are not set up'); }
    if (prod && !razorpayKeys) { level = 'bad'; problems.push('Razorpay keys are missing: rent cannot be collected'); }
    if (dbOk && pingMs > 500) { level = worst(level, 'warn'); problems.push(`The database is slow (${pingMs} ms)`); }
    return { level, note: problems[0] || 'Server, database and backup are fine', problems, database: { ok: dbOk, pingMs }, backup, uptimeHours: Math.round(process.uptime() / 3600), testModes, pushConfigured: pushOn, razorpayKeys };
}

async function paymentsCard(now) {
    const failed = await PaymentWebhookEvent.countDocuments({ status: 'failed', createdAt: { $gte: new Date(now.getTime() - DAY) } });
    const level = failed >= T.webhookBad ? 'bad' : failed >= T.webhookWarn ? 'warn' : 'good';
    return { level, note: failed ? `${failed} payment notice${failed === 1 ? '' : 's'} could not be processed in 24 hours. Some money may not be marked paid` : 'All payment notices were processed', failedWebhooks24h: failed };
}

/* --------------------------------- people and shops at risk --------------------------------- */
async function supportCard(now) {
    const open = await SupportTicket.find({ status: 'open' }).select('lastMessageAt').sort({ lastMessageAt: 1 }).lean();
    const oldestHours = open.length && open[0].lastMessageAt ? Math.round((now.getTime() - new Date(open[0].lastMessageAt).getTime()) / 3600000) : 0;
    const level = !open.length ? 'good' : oldestHours >= T.supportBadHours ? 'bad' : oldestHours >= T.supportWarnHours ? 'warn' : 'good';
    return { level, note: open.length ? `${open.length} waiting, the oldest for ${oldestHours} hours` : 'No one is waiting for a reply', open: open.length, oldestHours };
}

async function quietCard(now) {
    const live = await Tenant.find({ 'billing.isLive': true, status: { $ne: 'suspended' } }).select('_id name').lean();
    if (!live.length) return { level: 'good', note: 'No live shops yet', quiet: 0, live: 0, shops: [] };
    const since = new Date(now.getTime() - T.quietDays * DAY);
    const active = await Order.distinct('tenantId', { tenantId: { $in: live.map((t) => t._id) }, createdAt: { $gte: since } });
    const on = new Set(active.map(String));
    const quiet = live.filter((t) => !on.has(String(t._id)));
    const level = !quiet.length ? 'good' : quiet.length >= Math.ceil(live.length / 4) ? 'bad' : 'warn';
    return { level, note: quiet.length ? `${quiet.length} live shop${quiet.length === 1 ? ' has' : 's have'} had no order for ${T.quietDays} days` : 'Every live shop had orders recently', quiet: quiet.length, live: live.length, shops: quiet.slice(0, 8).map((t) => ({ id: String(t._id), name: t.name })) };
}

async function versionsCard(now) {
    const rows = await AppVersionSeen.find({ lastSeenAt: { $gte: new Date(now.getTime() - 7 * DAY) } }).select('tenantId version').lean();
    if (!rows.length) return { level: 'good', note: 'No app version data yet', latest: null, onLatest: 0, onOlder: 0 };
    const newest = rows.reduce((a, r) => (cmpVer(r.version, a) > 0 ? r.version : a), rows[0].version);
    const byShop = new Map();
    for (const r of rows) { const k = String(r.tenantId); if (!byShop.has(k) || cmpVer(r.version, byShop.get(k)) > 0) byShop.set(k, r.version); }
    const older = [...byShop.values()].filter((v) => cmpVer(v, newest) < 0).length;
    const level = older > byShop.size / 2 ? 'warn' : 'good';
    return { level, note: older ? `${older} of ${byShop.size} shops are not on the newest app version (${newest})` : `Every shop is on the newest app version (${newest})`, latest: newest, onLatest: byShop.size - older, onOlder: older };
}

/* ------------------------------------- the whole ------------------------------------- */
async function build(now = new Date()) {
    const [shops, rent, sms, orders, google, system, payments, support, quiet, versions] = await Promise.all([
        shopsCard(now), rentCard(now), smsCard(now), ordersCard(now), googleCard(now), systemCard(now), paymentsCard(now), supportCard(now), quietCard(now), versionsCard(now),
    ]);
    const cards = { system, payments, sms, rent, orders, google, shops, support, quiet, versions };
    const level = worst('good', ...Object.values(cards).map((c) => c.level));
    const headline = level === 'good' ? 'All fine'
        : Object.entries(cards).filter(([, c]) => c.level === level).map(([, c]) => c.note)[0];
    const needsYou = Object.entries(cards).filter(([, c]) => c.level !== 'good').map(([key, c]) => ({ key, level: c.level, note: c.note }))
        .sort((a, b) => rank[b.level] - rank[a.level]);
    return {
        at: now, overall: { level, text: level === 'good' ? 'All fine' : level === 'warn' ? 'Look when you can' : 'Act now', headline }, needsYou, ...cards,
        notTracked: ['Failed push notifications (only whether push is set up)', 'Orders with no rider (shop owners are told; you are not)', 'Geocoding and in-app map calls (Google does not let us count them)'],
    };
}

module.exports = { build, T, worst };
