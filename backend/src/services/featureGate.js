// The super admin's per-shop switches for the two add-on features: Services (with inquiries) and Table booking. Both are OFF until the super admin
// switches them on for a shop (settings.features.services / settings.features.tableBooking, the same "App features" screen as the other switches).
const { resolveConfig } = require('./tenantConfigService');
const { httpError } = require('../middlewares/apiErrors');

const NAMES = { services: 'Services and inquiries', tableBooking: 'Table booking' };

const isOn = (tenant, key) => !!resolveConfig(tenant).features?.[key];

// a middleware that lets the request through only when the shop has the feature
const gate = (key) => (req, res, next) => (isOn(req.tenant, key) ? next() : next(httpError(403, `${NAMES[key]} is not switched on for your shop. Ask us to switch it on.`)));

module.exports = { isOn, gate, NAMES };
