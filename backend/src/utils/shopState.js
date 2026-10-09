const { isMaintenanceOn } = require('./maintenance');

// One answer to "why can't customers order from this shop?", built from the four separate switches.
// For the superadmin panel only: ownerBlockedReason is private and must never reach the customer app.
function shopState(tenant) {
    const reasons = [];

    if (tenant.status && tenant.status !== 'active') {
        reasons.push({ code: 'suspended', setBy: 'superadmin', label: 'Shop is suspended' });
    }
    if (isMaintenanceOn(tenant.maintenance)) {
        reasons.push({
            code: 'maintenance', setBy: 'superadmin', label: 'Shop is in maintenance',
            until: tenant.maintenance.until || null, note: tenant.maintenance.message || null,
        });
    }
    if (tenant.ownerBlocked) {
        reasons.push({
            code: 'owner_blocked', setBy: 'superadmin', label: 'Owner panel is blocked',
            note: tenant.ownerBlockedReason || null,
        });
    }
    if (tenant.settings?.orders?.acceptingOrders === false) {
        reasons.push({ code: 'owner_paused', setBy: 'owner', label: 'Owner paused taking orders' });
    }

    if (tenant.billing?.state === 'paused') {
        reasons.push({ code: 'billing_paused', setBy: 'platform', label: 'Paused: unpaid bill', note: null });
    }

    return { acceptingOrders: reasons.length === 0, reasons };
}

module.exports = { shopState };