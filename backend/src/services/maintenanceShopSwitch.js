// The shop's own "taking orders" switch follows maintenance:
//   maintenance on and the shop has nothing running  ->  the switch is slid OFF by itself (and remembered: settings.orders.maintenancePaused)
//   maintenance over (planned end, switched off by hand, "until" time passed)  ->  the switch is slid back ON by itself, only for a shop we turned off.
//     The opening hours then rule as always: a shop inside its hours is open at once, a shop outside them opens at its next opening time.
// Cooks, waiters and riders follow the shop being open or closed by themselves (rider duty is re-checked right away).
// Run every 30 seconds (maintenancePlans.tick) and right after the superadmin switches maintenance on or off.
const Tenant = require('../models/Tenant');
const state = require('./maintenanceState');

async function flip(t, accepting, extra = {}) {
    const set = { 'settings.orders.acceptingOrders': accepting, ...(accepting ? {} : { 'settings.orders.maintenancePaused': true }) };
    const unset = { 'settings.orders.pausedUntil': '', ...(accepting ? { 'settings.orders.maintenancePaused': '' } : {}) };
    await Tenant.updateOne({ _id: t._id }, { $set: { ...set, ...extra }, $unset: unset });
    try {
        require('../middlewares/tenantRecognizer').invalidateTenant(t.slug);
        const rt = require('./realtime');
        rt.toShop(t._id, 'menu:changed', {});
        rt.toKitchen(t._id, 'kitchen:update', { shop: true });
        rt.toWaiter(t._id, 'waiter:update', { shop: true });
    } catch (e) { /* the apps also refresh on their own */ }
    if (!accepting) {
        const fresh = await Tenant.findById(t._id).lean();
        if (fresh) require('../jobs/riderDuty').runRiderDuty(new Date(), { tenantId: fresh._id }).catch((e) => console.error('Rider duty error:', e.message));
    }
}

async function sweep(now = new Date()) {
    let changed = 0;
    try {
        const pm = await state.platformMaintenance();
        const platformOn = !!pm && pm.on === true && (!pm.until || new Date(pm.until) > now);
        const q = platformOn ? { status: 'active' } : { $or: [{ 'maintenance.on': true }, { 'settings.orders.maintenancePaused': true }] };
        const shops = await Tenant.find(q).select('_id slug status maintenance settings.orders').lean();
        for (const t of shops) {
            try {
                const st = await state.stateOf(t, now);
                const orders = t.settings?.orders || {};
                if (st.on) {
                    // nothing left running (or the safety limit passed): the switch goes off. A shop already off by its owner is left alone.
                    if (!st.running || st.offline) {
                        if (orders.acceptingOrders !== false) { await flip(t, false); changed++; }
                    }
                } else if (orders.maintenancePaused) {
                    await flip(t, true); changed++;   // maintenance is over: back on; the hours decide whether it is open right now
                }
            } catch (e) { console.error('Maintenance switch error:', e.message); }
        }
    } catch (e) { console.error('Maintenance sweep error:', e.message); }
    return changed;
}

module.exports = { sweep };
