// The superadmin panel sends the WHOLE settings form on every save. The owner's "pause orders"
// switch lives inside those settings, so a save from the panel could silently reopen a paused shop.
// This copies the owner's current switch value into the new settings before they are saved.
module.exports = function keepOwnerPause(oldSettings, newSettings) {
    const current = oldSettings?.orders?.acceptingOrders;
    if (typeof current !== 'boolean') return newSettings;
    return { ...newSettings, orders: { ...(newSettings.orders || {}), acceptingOrders: current } };
};