// A LIVE shop that has had no billable order for 14 days: the superadmin is told ONCE per quiet spell.
// Claimed with a filtered update (Tenant.billing.inactiveAlertedAt), so two servers never tell him twice.
const Tenant = require('../models/Tenant');
const Order = require('../models/Order');
const adminAlerts = require('../services/adminAlerts');

const DAY_MS = 86400000;
const QUIET_DAYS = 14;

async function runInactiveShops(now = new Date()) {
    const cutoff = new Date(now.getTime() - QUIET_DAYS * DAY_MS);
    const shops = await Tenant.find({
        'billing.isLive': true, status: { $ne: 'suspended' }, 'billing.goLiveAt': { $lte: cutoff },
    }).select('_id billing.goLiveAt').lean();

    let alerted = 0;
    for (const s of shops) {
        const last = await Order.findOne({ tenantId: s._id, 'billing.billable': true })
            .sort({ 'billing.at': -1 }).select('billing.at').lean();
        // the quiet spell starts at his last billable order, or at go-live if he never had one
        const ref = new Date(Math.max(new Date(s.billing.goLiveAt).getTime(), last?.billing?.at ? new Date(last.billing.at).getTime() : 0));
        if (ref > cutoff) continue;

        const claimed = await Tenant.updateOne(
            { _id: s._id, $or: [{ 'billing.inactiveAlertedAt': { $exists: false } }, { 'billing.inactiveAlertedAt': { $lt: ref } }] },
            { $set: { 'billing.inactiveAlertedAt': now } },
        );
        if (!claimed.modifiedCount) continue;
        alerted += 1;
        await adminAlerts.alert('admin_shop_inactive', { tenantId: s._id, vars: { days: QUIET_DAYS } });
    }
    return alerted;
}

function startInactiveShopsScheduler() {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            const n = await runInactiveShops();
            if (n) console.log(`Inactive shops: ${n} alert(s)`);
        } catch (e) {
            console.error('Inactive shops error:', e.message);
        } finally {
            running = false;
        }
    };
    setTimeout(run, 2 * 60 * 1000).unref?.();
    setInterval(run, 6 * 60 * 60 * 1000).unref?.();   // every 6 hours; the claim makes it once per quiet spell
}

module.exports = { runInactiveShops, startInactiveShopsScheduler };