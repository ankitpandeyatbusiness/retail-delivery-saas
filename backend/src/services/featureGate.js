// The super admin's per-shop switches for the add-on features: Services (with inquiries), Table booking and Bulk orders. All are OFF until the super admin
// switches them on for a shop (settings.features.services / tableBooking / bulkOrders, the same "App features" screen as the other switches).
const { resolveConfig } = require('./tenantConfigService');
const { httpError } = require('../middlewares/apiErrors');

const NAMES = { services: 'Services and inquiries', tableBooking: 'Table booking', bulkOrders: 'Bulk orders' };

const isOn = (tenant, key) => !!resolveConfig(tenant).features?.[key];

// a middleware that lets the request through only when the shop has the feature
const gate = (key) => (req, res, next) => (isOn(req.tenant, key) ? next() : next(httpError(403, `${NAMES[key]} is not switched on for your shop. Ask us to switch it on.`)));

// The sentence a customer reads when the owner has PAUSED a service (Bulk orders, Tiffin, Party / venue booking, his own): it is still shown, but no new request is taken.
const UNAVAILABLE = 'Sorry, this service is temporarily unavailable.';

// ---- plans (config/plans.js). hasFeature is the ONE question both server and apps ask: "does this shop have this feature?"
// A shop with no plan yet (not migrated, phase 9) is not restricted. Otherwise: the plan includes it, or the supreme admin added it as an extra.
const plans = require('../config/plans');
function hasFeature(tenant, key) {
    const p = tenant?.plan;
    if (!p?.id) return true;
    if (plans.planIncludes(p.id, key)) return true;
    return !!p.extras?.some((e) => e.key === key);
}
const planGate = (key) => (req, res, next) => (hasFeature(req.tenant, key) ? next() : next(httpError(403, `${plans.FEATURES[key]?.label || key} is not in your plan. See Plan to upgrade.`)));

module.exports = { isOn, gate, hasFeature, planGate, NAMES, UNAVAILABLE };
