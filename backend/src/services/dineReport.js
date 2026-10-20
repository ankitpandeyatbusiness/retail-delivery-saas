// The Dine in report: how the tables are doing. One call, for the last 7 / 30 / 90 days.
//   summary      visits, sales, average bill, how long guests stay, how long food takes, tips
//   hours/days   when it is busy (India time)
//   topDishes    what is ordered at the tables
//   offers       what the welcome / regular / happy hour / friend offers cost
//   tables       QR performance: scans, visits and sales per table (a table whose QR is never scanned needs a look)
//   guests       how many came back
//   unpaid       walk-outs: what was left, what came back, what was forgiven, what is still owed, repeat offenders
//   referrals    friends brought in and the points given
const Order = require('../models/Order');
const TableSession = require('../models/TableSession');
const TableScan = require('../models/TableScan');
const TableFeedback = require('../models/TableFeedback');
const Referral = require('../models/Referral');
const User = require('../models/User');
const { DEFAULTS } = require('./tenantConfigService');

const IST = 330 * 60000;
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

async function build({ tenant, days }) {
    const span = [7, 30, 90].includes(days) ? days : 30;
    const tenantId = tenant._id;
    const since = new Date(Date.now() - span * 86400000);
    const cfg = { ...DEFAULTS.orders.dineIn, ...(tenant.settings?.orders?.dineIn || {}) };

    const [orders, sessions, scans, owedNow, fb, refs] = await Promise.all([
        Order.find({ tenantId, orderType: 'dine_in', createdAt: { $gte: since }, status: { $nin: ['cancelled', 'undelivered'] } }).select('tableNo createdAt deliveredAt status pricing items').limit(20000).lean(),
        TableSession.find({ tenantId, openedAt: { $gte: since } }).select('table status openedAt closedAt customers walkout owedPaise owedClearedAt owedVia paidPaise tipPaise').limit(20000).lean(),
        TableScan.aggregate([{ $match: { tenantId, createdAt: { $gte: since } } }, { $group: { _id: '$table', scans: { $sum: 1 } } }]),
        TableSession.aggregate([{ $match: { tenantId, walkout: true, owedClearedAt: { $exists: false }, owedPaise: { $gt: 0 } } }, { $group: { _id: null, paise: { $sum: '$owedPaise' }, n: { $sum: 1 } } }]),
        TableFeedback.aggregate([{ $match: { tenantId, createdAt: { $gte: since } } }, { $group: { _id: null, avg: { $avg: '$stars' }, n: { $sum: 1 } } }]),
        Referral.find({ tenantId, createdAt: { $gte: since } }).select('status points').lean(),
    ]);

    // ---- orders ----
    const hours = Array(24).fill(0);
    const weekdays = Array(7).fill(0);
    const dishes = new Map();
    const offers = new Map();
    const perTable = new Map();
    const waits = [];
    let sales = 0;
    for (const o of orders) {
        const total = o.pricing?.total || 0;
        sales += total;
        const ist = new Date(new Date(o.createdAt).getTime() + IST);
        hours[ist.getUTCHours()] += 1;
        weekdays[ist.getUTCDay()] += 1;
        for (const l of o.items || []) dishes.set(l.name, (dishes.get(l.name) || 0) + (l.quantity || 0));
        if (o.pricing?.offerKind && o.pricing.offerDiscount > 0) {
            const x = offers.get(o.pricing.offerKind) || { kind: o.pricing.offerKind, orders: 0, saved: 0 };
            x.orders += 1; x.saved += o.pricing.offerDiscount; offers.set(o.pricing.offerKind, x);
        }
        const t = perTable.get(String(o.tableNo)) || { orders: 0, sales: 0 };
        t.orders += 1; t.sales += total; perTable.set(String(o.tableNo), t);
        if (o.status === 'delivered' && o.deliveredAt) waits.push((new Date(o.deliveredAt) - new Date(o.createdAt)) / 60000);
    }

    // ---- visits ----
    const done = sessions.filter((s) => s.status === 'closed' && !s.walkout);
    const stays = done.filter((s) => s.closedAt).map((s) => (new Date(s.closedAt) - new Date(s.openedAt)) / 60000).filter((m) => m > 0 && m < 600);
    const visitsAt = new Map();
    const guestVisits = new Map();
    for (const s of sessions) {
        visitsAt.set(s.table, (visitsAt.get(s.table) || 0) + 1);
        for (const c of s.customers || []) guestVisits.set(String(c), (guestVisits.get(String(c)) || 0) + 1);
    }
    const scanOf = new Map(scans.map((x) => [x._id, x.scans]));
    const tables = Array.from({ length: cfg.tableCount }, (_, i) => {
        const table = String(i + 1);
        const t = perTable.get(table) || { orders: 0, sales: 0 };
        const sc = scanOf.get(table) || 0;
        const vis = visitsAt.get(table) || 0;
        return { table, scans: sc, visits: vis, orders: t.orders, sales: r2(t.sales), conv: sc ? Math.min(100, Math.round((vis / sc) * 100)) : null };
    });

    // ---- unpaid ----
    const walk = sessions.filter((s) => s.walkout);
    const owedOf = (s) => (s.owedPaise || 0) / 100;
    const back = walk.filter((s) => s.owedClearedAt && s.owedVia !== 'forgiven');
    const forgiven = walk.filter((s) => s.owedVia === 'forgiven');
    const byGuest = new Map();
    for (const s of walk) for (const c of s.customers || []) {
        const x = byGuest.get(String(c)) || { id: String(c), times: 0, amount: 0 };
        x.times += 1; x.amount += owedOf(s); byGuest.set(String(c), x);
    }
    const repeat = [...byGuest.values()].filter((x) => x.times >= 2).sort((a, b) => b.amount - a.amount).slice(0, 8);
    const names = repeat.length ? new Map((await User.find({ _id: { $in: repeat.map((x) => x.id) } }).select('name phone').lean()).map((u) => [String(u._id), u])) : new Map();

    return {
        days: span,
        summary: {
            orders: orders.length, sales: r2(sales), avgOrder: orders.length ? r2(sales / orders.length) : 0,
            visits: done.length, avgBill: done.length ? r2(mean(done.map((s) => (s.paidPaise || 0) / 100))) : 0,
            avgStayMin: Math.round(mean(stays)), avgWaitMin: Math.round(mean(waits)),
            tips: r2(done.reduce((n, s) => n + (s.tipPaise || 0), 0) / 100),
        },
        hours, weekdays,
        topDishes: [...dishes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, qty]) => ({ name, qty })),
        offers: [...offers.values()].map((x) => ({ ...x, saved: r2(x.saved) })),
        tables,
        guests: { total: guestVisits.size, repeat: [...guestVisits.values()].filter((n) => n >= 2).length },
        unpaid: {
            walkouts: walk.length, left: r2(walk.reduce((n, s) => n + owedOf(s), 0)),
            recovered: r2(back.reduce((n, s) => n + owedOf(s), 0)), forgiven: r2(forgiven.reduce((n, s) => n + owedOf(s), 0)),
            owedNow: r2((owedNow[0]?.paise || 0) / 100), owedNowCount: owedNow[0]?.n || 0,
            repeat: repeat.map((x) => ({ name: names.get(x.id)?.name || null, phone: names.get(x.id)?.phone || null, times: x.times, amount: r2(x.amount) })),
        },
        feedback: fb[0] ? { avg: r1(fb[0].avg), count: fb[0].n } : { avg: null, count: 0 },
        referrals: { joined: refs.length, rewarded: refs.filter((x) => x.status === 'rewarded').length, points: refs.reduce((n, x) => n + (x.points || 0), 0) },
    };
}

module.exports = { build };
