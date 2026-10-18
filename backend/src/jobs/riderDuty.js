// Puts a rider OFF DUTY by himself when he forgot to. Runs every 5 minutes. A rider is switched off only when he has no order
// (an offer or a delivery) and one of these is true:
//   - the shop has been closed for 30 minutes (closing time, or a holiday). A shop the owner PAUSED by hand does not count:
//     the rider stays on duty, the owner will open again
//   - he has been on duty for too long (16 hours; RIDER_MAX_DUTY_HOURS changes it)
// He is told by a notification, and can start duty again with one tap.
const Rider = require('../models/Rider');
const Tenant = require('../models/Tenant');
const center = require('../notifications/center');
const { resolveConfig, openStatus } = require('../services/tenantConfigService');

const CLOSED_FOR_MS = 30 * 60 * 1000;
const MAX_DUTY_MS = (Number(process.env.RIDER_MAX_DUTY_HOURS) || 16) * 3600000;

const WHY = {
    shop_closed: 'The shop is closed, so you were put off duty. Start duty again when it opens.',
    long_duty: 'You were on duty for a very long time, so you were put off duty. Start duty again when you are ready.',
};

async function runRiderDuty(now = new Date()) {
    const idle = await Rider.find({ isOnline: true, isActive: true, activeOrderCount: 0 }).select('tenantId userId onlineSince').lean();
    if (!idle.length) return { off: 0 };
    const shops = new Map((await Tenant.find({ _id: { $in: [...new Set(idle.map((r) => String(r.tenantId)))] } }).lean()).map((t) => [String(t._id), t]));

    let off = 0;
    for (const r of idle) {
        const shop = shops.get(String(r.tenantId));
        if (!shop) continue;
        const cfg = resolveConfig(shop);
        const closedAt = (at) => {
            const s = openStatus(cfg.hours.weekly, cfg.orders.acceptingOrders, at, cfg.hours.closedDates);
            return !s.isOpen && s.reason !== 'paused';
        };
        let why = null;
        if (closedAt(now) && closedAt(new Date(now.getTime() - CLOSED_FOR_MS))) why = 'shop_closed';
        else if (r.onlineSince && now.getTime() - new Date(r.onlineSince).getTime() > MAX_DUTY_MS) why = 'long_duty';
        if (!why) continue;

        // one atomic step: only if he is still on duty with no order
        const done = await Rider.updateOne({ _id: r._id, isOnline: true, activeOrderCount: 0 }, { $set: { isOnline: false }, $unset: { onlineSince: 1 } });
        if (!done.modifiedCount) continue;
        off += 1;
        await center.notify('rider_off_duty', { tenantId: r.tenantId, userId: r.userId, title: 'You are off duty', body: WHY[why], data: { kind: 'off_duty', why } });
    }
    return { off };
}

function startRiderDutyScheduler() {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try { await runRiderDuty(); } catch (e) { console.error('Rider duty job error:', e.message); } finally { running = false; }
    };
    setTimeout(run, 60 * 1000).unref?.();
    setInterval(run, 5 * 60 * 1000).unref?.();
}

module.exports = { runRiderDuty, startRiderDutyScheduler };
