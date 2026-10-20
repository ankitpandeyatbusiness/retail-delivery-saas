// The superadmin panel sends the WHOLE settings form on every save. The owner's "pause orders"
// switch (and his timed pause, "pause for 30 minutes") live inside those settings, so a save from the panel could
// silently reopen a paused shop. This copies the owner's current values into the new settings before they are saved.
module.exports = function keepOwnerPause(oldSettings, newSettings) {
    const old = oldSettings?.orders || {};
    const keep = {};
    if (typeof old.acceptingOrders === 'boolean') keep.acceptingOrders = old.acceptingOrders;
    if (old.pausedUntil) keep.pausedUntil = old.pausedUntil;
    if (old.busy) keep.busy = old.busy;   // busy mode is the owner's too
    const out = Object.keys(keep).length ? { ...newSettings, orders: { ...(newSettings.orders || {}), ...keep } } : { ...newSettings };
    // the owner's Rewards numbers (settings.loyalty) and the day he started tracking rider payouts are not part of the panel's form
    if (oldSettings?.loyalty) out.loyalty = oldSettings.loyalty;
    if (oldSettings?.riders?.trackFrom) out.riders = { ...(out.riders || {}), trackFrom: oldSettings.riders.trackFrom };
    return out;
};
