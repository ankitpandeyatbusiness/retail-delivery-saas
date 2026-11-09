// The superadmin's morning push: yesterday's orders and sales against the day before, and what needs attention now.
// Sent once a day after 8:00 India time (a filtered atomic claim keeps two servers from sending it twice).
// He can switch it off in the notification rules (event admin_daily_summary).
const PlatformSettings = require('../models/PlatformSettings');
const { salesReport } = require('./reportService');
const { attention } = require('./orderAttention');

const HOUR = 8;
const IST_MS = 330 * 60000;
const DAY = 86400000;
const istDayKey = (ms) => new Date(ms + IST_MS).toISOString().slice(0, 10);
const istStart = (key) => new Date(new Date(`${key}T00:00:00.000+05:30`).getTime());

const pct = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

async function build(now = Date.now()) {
    const today = istDayKey(now);
    const yStart = istStart(istDayKey(now - DAY));
    const yEnd = new Date(istStart(today).getTime() - 1);
    const bStart = istStart(istDayKey(now - 2 * DAY));
    const bEnd = new Date(yStart.getTime() - 1);
    const [y, b, a, sales, money] = await Promise.all([
        salesReport({ from: yStart, to: yEnd, topLimit: 1 }),
        salesReport({ from: bStart, to: bEnd, topLimit: 1 }),
        attention({ now }),
        require('./platformSales').paid({ from: yStart, to: yEnd }),
        require('./moneyAttention').attention({ now }),
    ]);
    return {
        orders: y.totals.orders, sales: y.totals.revenue, beforeOrders: b.totals.orders, beforeSales: b.totals.revenue,
        change: pct(y.totals.revenue, b.totals.revenue), attention: a.counts.total || 0, refunds: a.refundsOpen || 0,
        collected: Math.round(sales.reduce((n, r) => n + r.total, 0)), overdue: 0, moneyBad: money.counts.bad,
    };
}

// returns true when it was sent
async function sendIfDue(now = Date.now()) {
    const ist = new Date(now + IST_MS);
    if (ist.getUTCHours() < HOUR) return false;
    const day = istDayKey(now);
    let claim;
    try {
        claim = await PlatformSettings.updateOne({ _id: 'main', 'dailyDigest.day': { $ne: day } }, { $set: { 'dailyDigest.day': day } }, { upsert: true });
    } catch (e) {
        if (e.code === 11000) return false;   // today's mark is already there: another run sent it
        throw e;
    }
    if (!claim.modifiedCount && !claim.upsertedCount) return false;
    const d = await build(now);
    if (!d.orders && !d.beforeOrders && !d.attention && !d.refunds && !d.collected && !d.overdue && !d.moneyBad) return false;   // a quiet platform: nothing to say
    await require('./adminAlerts').alert('admin_daily_summary', {
        vars: { orders: d.orders, sales: d.sales, change: d.change, attention: d.attention, refunds: d.refunds, beforeOrders: d.beforeOrders, collected: d.collected, overdue: d.overdue, moneyBad: d.moneyBad },
        data: { kind: 'digest' },
    });
    return true;
}

function startDailyDigestScheduler() {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try { if (await sendIfDue()) console.log('Daily summary sent'); } catch (e) { console.error('Daily summary error:', e.message); } finally { running = false; }
    };
    setTimeout(run, 2 * 60 * 1000).unref?.();
    setInterval(run, 10 * 60 * 1000).unref?.();
}

module.exports = { sendIfDue, startDailyDigestScheduler, build };
