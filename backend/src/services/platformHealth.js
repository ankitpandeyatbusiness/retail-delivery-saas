// Platform health: one answer to "is the platform running fine, or do I have to worry?" for the supreme admin and the other superadmins.
// Every card carries a level: 'good' (green), 'warn' (amber, look when you can) or 'bad' (red, act now), and a plain line saying why.
// Where shops are the reason, the card carries `list`: the shops themselves, [{ id, name, detail }], worst first (up to 8, `listTotal` says how many).
// Everything is read from what the platform already records; nothing is written. A number that is not recorded is not shown (see `notTracked`).
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const Order = require('../models/Order');
const PlanPayment = require('../models/PlanPayment');
const platformSales = require('./platformSales');
const planService = require('./planService');
const SmsLog = require('../models/SmsLog');
const SmsWallet = require('../models/SmsWallet');
const SupportTicket = require('../models/SupportTicket');
const PaymentWebhookEvent = require('../models/PaymentWebhookEvent');
const AppVersionSeen = require('../models/AppVersionSeen');
const PlatformSettings = require('../models/PlatformSettings');
const googleBudget = require('./googleBudget');
const backups = require('./backupService');

const DAY = 86400000;
const MIN = 60000;
const MAXLIST = 8;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const rank = { good: 0, warn: 1, bad: 2 };
const worst = (...levels) => levels.reduce((a, b) => (rank[b] > rank[a] ? b : a), 'good');
const rs = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const dayWord = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

// thresholds in one place (the supreme admin may want to tune them later)
const T = {
    googleWarn: 60, googleBad: 90,           // % of the monthly allowance used
    collectedWarn: 80,                        // % of this month's bills paid
    ordersWarnDrop: 20, ordersBadDrop: 40,    // % fall of the last 7 days against the 7 before
    shopDropMin: 10, shopDropTo: 0.6,         // a shop is "down" when it had 10 or more orders in the 7 days before and now has 60% of them or fewer
    cancelMin: 8, cancelRate: 0.25,           // a shop with 8 or more orders a week and a quarter cancelled
    backupStaleDays: 1,
    quietDays: 14,
    supportWarnHours: 24, supportBadHours: 72,
    unacceptedMin: 10,
    webhookWarn: 1, webhookBad: 3,
    freeEndingDays: 7,
    smsLowPaise: 5000,                        // a wallet at or under this is "low" (the shop's own setting wins)
};

const istStartOfDay = (d) => { const x = new Date(d.getTime() + 330 * MIN); x.setUTCHours(0, 0, 0, 0); return new Date(x.getTime() - 330 * MIN); };
const istMonthStart = (d, plus = 0) => { const x = new Date(d.getTime() + 330 * MIN); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + plus, 1) - 330 * MIN); };
const semver = (v) => String(v).split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
const cmpVer = (a, b) => { const x = semver(a); const y = semver(b); for (let i = 0; i < 3; i += 1) { if (x[i] !== y[i]) return x[i] - y[i]; } return 0; };

// a shop's name as people know it: a branch also shows its city
const nameMap = async (ids) => {
    const rows = await Tenant.find({ _id: { $in: ids } }).select('name branchCity brandId').lean();
    return new Map(rows.map((t) => [String(t._id), t.brandId && t.branchCity ? `${t.name} (${t.branchCity})` : t.name]));
};
const item = (names, id, detail) => ({ id: String(id), name: names.get(String(id)) || 'A shop', detail });
const listOf = (items) => ({ list: items.slice(0, MAXLIST), listTotal: items.length });

/* --------------------------------- shops --------------------------------- */
// where every shop stands on its plan: free period, paid, in the grace days after the end, paused, or still without a plan
async function shopsCard(now) {
    const tenants = await Tenant.find({}).select('_id name branchCity createdAt plan billing brandId status').lean();
    const count = { total: tenants.length, notLive: 0, free: 0, paying: 0, grace: 0, paused: 0, noPlan: 0 };
    const paused = []; const grace = []; const ending = [];
    const nm = (t) => (t.brandId && t.branchCity ? `${t.name} (${t.branchCity})` : t.name);
    for (const t of tenants) {
        if (!t.billing?.isLive) { count.notLive += 1; continue; }
        const v = planService.viewOf(t, now);
        if (v.status === 'none') { count.noPlan += 1; continue; }
        if (t.plan?.paused) { count.paused += 1; paused.push({ id: String(t._id), name: nm(t), detail: 'Paused: the plan was not renewed' }); continue; }
        if (v.status === 'ended') { count.grace += 1; grace.push({ id: String(t._id), name: nm(t), detail: 'The plan ended, in the grace days' }); continue; }
        if (v.status === 'free') count.free += 1; else count.paying += 1;
        const ends = v.endsAt ? new Date(v.endsAt) : null;
        if (ends && ends.getTime() - now.getTime() <= T.freeEndingDays * DAY && ends.getTime() >= now.getTime()) ending.push({ id: String(t._id), name: nm(t), detail: `${v.status === 'free' ? 'Free period' : 'Plan'} ends ${dayWord(ends)}` });
    }
    const level = paused.length > 0 ? 'warn' : 'good';
    const note = paused.length > 0 ? `${paused.length} shop${paused.length === 1 ? ' is' : 's are'} paused because the plan was not renewed` : 'No shop is paused';
    return { level, note, ...count, freeEnding: ending.length, paid: count.paying + count.grace + count.paused, ...listOf([...paused, ...grace, ...ending]) };
}

/* ----------------------------------- plans and money in ----------------------------------- */
// everything is prepaid: what was paid this month, and payments that were taken but are held for the supreme admin to look at
async function rentCard(now) {
    const from = istMonthStart(now); const to = istMonthStart(now, 1);
    const [rows, held] = await Promise.all([
        platformSales.paid({ from, to }),
        PlanPayment.find({ status: 'held' }).sort({ createdAt: 1 }).limit(MAXLIST).select('tenantId payablePaise createdAt heldWhy').lean(),
    ]);
    const names = await nameMap(held.map((r) => r.tenantId));
    const plan = rows.filter((r) => r.kind === 'plan' || r.kind === 'branch');
    const collected = round2(rows.reduce((n, r) => n + r.total, 0));
    const level = held.length ? 'warn' : 'good';
    const note = held.length ? `${held.length} plan payment${held.length === 1 ? ' is' : 's are'} held for you to look at` : plan.length ? `${plan.length} plan payment${plan.length === 1 ? '' : 's'} this month` : 'No plan payments this month yet';
    return {
        level, note, billed: plan.length, paidShops: new Set(plan.map((r) => String(r.tenantId))).size, collected, held: held.length,
        unpaidShops: 0, toCollect: 0, percentPaid: null, overdueBills: 0, overdueShops: 0, overdueAmount: 0,
        ...listOf(held.map((r) => item(names, r.tenantId, `${rs(r.payablePaise / 100)} held: ${r.heldWhy || 'the plan changed while paying'}`))), listKind: 'held',
    };
}

/* ------------------------------------ SMS ------------------------------------ */
async function smsCard(now) {
    const since7 = new Date(now.getTime() - 7 * DAY); const since24 = new Date(now.getTime() - DAY); const since10 = new Date(now.getTime() - 10 * MIN);
    const [sent, failed7, failed24, failed10, wallets, live] = await Promise.all([
        SmsLog.aggregate([{ $match: { status: { $in: ['sent', 'mock'] }, createdAt: { $gte: since7 } } }, { $group: { _id: null, sms: { $sum: 1 }, revenuePaise: { $sum: '$chargedPaise' }, costPaise: { $sum: '$costPaise' } } }]),
        SmsLog.countDocuments({ status: 'failed', createdAt: { $gte: since7 } }),
        SmsLog.countDocuments({ status: 'failed', createdAt: { $gte: since24 } }),
        SmsLog.countDocuments({ status: 'failed', createdAt: { $gte: since10 } }),
        SmsWallet.find({}).select('tenantId balancePaise lowBalancePaise blockAtZero').lean(),
        Tenant.find({ 'billing.isLive': true }).select('_id').lean(),
    ]);
    const liveIds = new Set(live.map((t) => String(t._id)));
    const flagged = wallets.filter((w) => liveIds.has(String(w.tenantId)) && w.balancePaise <= (w.lowBalancePaise ?? T.smsLowPaise));
    const names = await nameMap(flagged.map((w) => w.tenantId));
    const empty = flagged.filter((w) => w.balancePaise <= 0 && w.blockAtZero !== false);
    const walletItems = flagged.sort((a, b) => a.balancePaise - b.balancePaise).map((w) => item(names, w.tenantId, w.balancePaise <= 0 && w.blockAtZero !== false ? 'SMS balance is empty: login codes for this shop are blocked' : `Only ${rs(w.balancePaise / 100)} of SMS balance left`));
    const s = sent[0] || { sms: 0, revenuePaise: 0, costPaise: 0 };
    const profitPaise = s.revenuePaise - s.costPaise;
    const failing = failed10 >= 3;
    const failRate = s.sms + failed7 ? failed7 / (s.sms + failed7) : 0;
    let level = 'good'; let note = `${s.sms.toLocaleString('en-IN')} SMS sent in 7 days`;
    if (failing) { level = 'bad'; note = `The SMS provider is failing: ${failed10} failed in the last 10 minutes. Logins and alerts may not arrive`; }
    else if (empty.length) { level = 'bad'; note = `${empty.length} shop${empty.length === 1 ? ' has' : 's have'} an empty SMS balance: their customers cannot get login codes`; }
    else if (profitPaise < 0) { level = 'bad'; note = 'SMS is costing more than it earns'; }
    else if (failRate > 0.05) { level = 'warn'; note = `${Math.round(failRate * 100)}% of SMS failed in 7 days`; }
    else if (flagged.length) { level = 'warn'; note = `${flagged.length} shop${flagged.length === 1 ? ' is' : 's are'} low on SMS balance`; }
    return {
        level, note, days: 7, sent: s.sms, failed7, failed24h: failed24, failedLast10Min: failed10, failing, emptyWallets: empty.length, lowWallets: flagged.length,
        revenue: round2(s.revenuePaise / 100), cost: round2(s.costPaise / 100), profit: round2(profitPaise / 100),
        costPerSms: s.sms ? round2(s.costPaise / 100 / s.sms) : null, chargedPerSms: s.sms ? round2(s.revenuePaise / 100 / s.sms) : null,
        ...listOf(walletItems),
    };
}

/* ----------------------------------- orders ----------------------------------- */
async function ordersCard(now) {
    const today = istStartOfDay(now); const d7 = new Date(now.getTime() - 7 * DAY); const d14 = new Date(now.getTime() - 14 * DAY);
    const lm = istMonthStart(now, -1); const tm = istMonthStart(now);
    const live = { status: { $ne: 'cancelled' } };
    const is = (cond) => ({ $sum: { $cond: [cond, 1, 0] } });
    // this month so far, against the same number of days of last month (so the first week of a month is not compared with a whole month)
    const sameEnd = new Date(Math.min(lm.getTime() + (now.getTime() - tm.getTime()), tm.getTime()));
    const [todayN, last7, prev7, lastMonth, cancelled7, per, waiting, thisMonth, lastMonthSame] = await Promise.all([
        Order.countDocuments({ ...live, createdAt: { $gte: today } }),
        Order.countDocuments({ ...live, createdAt: { $gte: d7 } }),
        Order.countDocuments({ ...live, createdAt: { $gte: d14, $lt: d7 } }),
        Order.countDocuments({ ...live, createdAt: { $gte: lm, $lt: tm } }),
        Order.countDocuments({ status: 'cancelled', createdAt: { $gte: d7 } }),
        // every shop: orders in the last 7 days, in the 7 before, and cancelled in the last 7
        Order.aggregate([
            { $match: { createdAt: { $gte: d14 } } },
            { $group: {
                _id: '$tenantId',
                last7: is({ $and: [{ $ne: ['$status', 'cancelled'] }, { $gte: ['$createdAt', d7] }] }),
                prev7: is({ $and: [{ $ne: ['$status', 'cancelled'] }, { $lt: ['$createdAt', d7] }] }),
                cancelled7: is({ $and: [{ $eq: ['$status', 'cancelled'] }, { $gte: ['$createdAt', d7] }] }),
            } },
        ]),
        Order.aggregate([
            { $match: { status: 'placed', createdAt: { $gte: new Date(now.getTime() - DAY), $lt: new Date(now.getTime() - T.unacceptedMin * MIN) } } },
            { $group: { _id: '$tenantId', n: { $sum: 1 }, oldest: { $min: '$createdAt' } } },
        ]),
        Order.countDocuments({ ...live, createdAt: { $gte: tm } }),
        Order.countDocuments({ ...live, createdAt: { $gte: lm, $lt: sameEnd } }),
    ]);
    const monthChange = lastMonthSame > 0 ? Math.round(((thisMonth - lastMonthSame) / lastMonthSame) * 100) : null;
    const dropped = per.filter((r) => r.prev7 >= T.shopDropMin && r.last7 <= r.prev7 * T.shopDropTo).sort((a, b) => (b.prev7 - b.last7) - (a.prev7 - a.last7));
    const cancelHigh = per.filter((r) => r.last7 + r.cancelled7 >= T.cancelMin && r.cancelled7 / (r.last7 + r.cancelled7) >= T.cancelRate).sort((a, b) => b.cancelled7 - a.cancelled7);
    const names = await nameMap([...dropped, ...cancelHigh, ...waiting].map((r) => r._id));
    const items = [
        ...waiting.sort((a, b) => b.n - a.n).map((r) => item(names, r._id, `${r.n} order${r.n === 1 ? '' : 's'} waiting ${Math.round((now.getTime() - new Date(r.oldest).getTime()) / MIN)} min, not accepted`)),
        ...dropped.map((r) => item(names, r._id, `Orders fell from ${r.prev7} to ${r.last7} in a week (${Math.round(((r.last7 - r.prev7) / r.prev7) * 100)}%)`)),
        ...cancelHigh.map((r) => item(names, r._id, `${Math.round((r.cancelled7 / (r.last7 + r.cancelled7)) * 100)}% cancelled (${r.cancelled7} of ${r.last7 + r.cancelled7} orders)`)),
    ];
    const change = prev7 > 0 ? Math.round(((last7 - prev7) / prev7) * 100) : null;
    let level = 'good'; let note = change === null ? 'Not enough history to compare yet' : `${change >= 0 ? 'Up' : 'Down'} ${Math.abs(change)}% on the 7 days before`;
    if (change !== null && change <= -T.ordersBadDrop) level = 'bad';
    else if (change !== null && change <= -T.ordersWarnDrop) level = 'warn';
    const cancelRate = last7 + cancelled7 ? Math.round((cancelled7 / (last7 + cancelled7)) * 100) : 0;
    if (level === 'good') {
        if (waiting.length) { level = 'warn'; note = `${waiting.length} shop${waiting.length === 1 ? ' has' : 's have'} orders waiting over ${T.unacceptedMin} minutes`; }
        else if (dropped.length) { level = 'warn'; note = `${dropped.length} shop${dropped.length === 1 ? '' : 's'} lost many orders this week`; }
        else if (cancelHigh.length) { level = 'warn'; note = `${cancelHigh.length} shop${cancelHigh.length === 1 ? ' has' : 's have'} many cancelled orders`; }
        else if (cancelRate >= 15) { level = 'warn'; note = `${cancelRate}% of orders were cancelled in 7 days`; }
    }
    return {
        level, note, today: todayN, last7, prev7, lastMonth, thisMonth, lastMonthSameDays: lastMonthSame, monthChangePercent: monthChange, changePercent: change, cancelled7, cancelRatePercent: cancelRate,
        waitingUnaccepted: waiting.reduce((a, r) => a + r.n, 0), droppedShops: dropped.length, cancelShops: cancelHigh.length, ...listOf(items),
    };
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
    const open = await SupportTicket.find({ status: 'open' }).select('tenantId lastMessageAt').sort({ lastMessageAt: 1 }).lean();
    const hours = (x) => Math.round((now.getTime() - new Date(x.lastMessageAt).getTime()) / 3600000);
    const oldestHours = open.length && open[0].lastMessageAt ? hours(open[0]) : 0;
    const level = !open.length ? 'good' : oldestHours >= T.supportBadHours ? 'bad' : oldestHours >= T.supportWarnHours ? 'warn' : 'good';
    const names = await nameMap(open.slice(0, MAXLIST).map((x) => x.tenantId));
    return {
        level, note: open.length ? `${open.length} waiting, the oldest for ${oldestHours} hours` : 'No one is waiting for a reply', open: open.length, oldestHours,
        ...listOf(open.map((x) => item(names, x.tenantId, `Waiting ${hours(x)} hour${hours(x) === 1 ? '' : 's'} for a reply`))),
    };
}

async function quietCard(now) {
    const live = await Tenant.find({ 'billing.isLive': true, status: { $ne: 'suspended' } }).select('_id name branchCity brandId createdAt billing.goLiveAt').lean();
    if (!live.length) return { level: 'good', note: 'No live shops yet', quiet: 0, live: 0, shops: [], list: [], listTotal: 0 };
    const last = await Order.aggregate([{ $match: { tenantId: { $in: live.map((t) => t._id) } } }, { $group: { _id: '$tenantId', at: { $max: '$createdAt' } } }]);
    const lastAt = new Map(last.map((r) => [String(r._id), r.at]));
    const quiet = [];
    for (const t of live) {
        const at = lastAt.get(String(t._id));
        const since = at || t.billing?.goLiveAt || t.createdAt;
        const days = Math.floor((now.getTime() - new Date(since).getTime()) / DAY);
        if (days < T.quietDays) continue;
        const name = t.brandId && t.branchCity ? `${t.name} (${t.branchCity})` : t.name;
        quiet.push({ id: String(t._id), name, days, detail: at ? `No order for ${days} days` : `No order at all since it went live ${days} days ago` });
    }
    quiet.sort((a, b) => b.days - a.days);
    const level = !quiet.length ? 'good' : quiet.length >= Math.ceil(live.length / 4) ? 'bad' : 'warn';
    return {
        level, note: quiet.length ? `${quiet.length} live shop${quiet.length === 1 ? ' has' : 's have'} had no order for ${T.quietDays} days` : 'Every live shop had orders recently', quiet: quiet.length, live: live.length,
        shops: quiet.slice(0, MAXLIST).map(({ id, name }) => ({ id, name })), ...listOf(quiet.map(({ id, name, detail }) => ({ id, name, detail }))),
    };
}

async function versionsCard(now) {
    const rows = await AppVersionSeen.find({ lastSeenAt: { $gte: new Date(now.getTime() - 7 * DAY) } }).select('tenantId version').lean();
    if (!rows.length) return { level: 'good', note: 'No app version data yet', latest: null, onLatest: 0, onOlder: 0, list: [], listTotal: 0 };
    const newest = rows.reduce((a, r) => (cmpVer(r.version, a) > 0 ? r.version : a), rows[0].version);
    const byShop = new Map();
    for (const r of rows) { const k = String(r.tenantId); if (!byShop.has(k) || cmpVer(r.version, byShop.get(k)) > 0) byShop.set(k, r.version); }
    const olderIds = [...byShop.entries()].filter(([, v]) => cmpVer(v, newest) < 0);
    const names = await nameMap(olderIds.map(([k]) => k));
    const level = olderIds.length > byShop.size / 2 ? 'warn' : 'good';
    return {
        level, note: olderIds.length ? `${olderIds.length} of ${byShop.size} shops are not on the newest app version (${newest})` : `Every shop is on the newest app version (${newest})`,
        latest: newest, onLatest: byShop.size - olderIds.length, onOlder: olderIds.length, ...listOf(olderIds.map(([k, v]) => item(names, k, `Running ${v}, the newest is ${newest}`))),
    };
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
    // "needs you": every card that is not green, worst first, with the shops behind it
    const needsYou = Object.entries(cards).filter(([, c]) => c.level !== 'good')
        .map(([key, c]) => ({ key, level: c.level, note: c.note, list: (c.list || []).slice(0, 5), listTotal: c.listTotal || 0 }))
        .sort((a, b) => rank[b.level] - rank[a.level]);
    return {
        at: now, overall: { level, text: level === 'good' ? 'All fine' : level === 'warn' ? 'Look when you can' : 'Act now', headline }, needsYou, ...cards,
        notTracked: ['Failed push notifications (only whether push is set up)', 'Orders with no rider (shop owners are told; you are not)', 'Geocoding and in-app map calls (Google does not let us count them)'],
    };
}

module.exports = { build, T, worst };
