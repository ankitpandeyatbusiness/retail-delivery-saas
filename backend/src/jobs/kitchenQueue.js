// An order the cook did not touch goes into his queue by itself after `kitchenQueueSec` seconds (the owner sets it on the Kitchen staff page; 60 by default).
// The ringing stops and the cook hears "Order 12 was added to your queue". The cook can also tap "Add to queue" himself (services/kitchenService.js).
const Tenant = require('../models/Tenant');
const Order = require('../models/Order');
const staffService = require('../services/staffService');
const kitchen = require('../services/kitchenService');
const { resolveConfig } = require('../services/tenantConfigService');

const EVERY_MS = 15 * 1000;

async function runKitchenQueue(now = new Date()) {
    const tenants = await Tenant.find({ 'settings.orders.staff.kitchenOn': true, status: { $ne: 'suspended' } }).lean();
    let moved = 0;
    for (const tenant of tenants) {
        try {
            const rules = staffService.rulesOf(tenant);
            const types = rules.kitchenSees || ['delivery', 'pickup', 'dine_in'];
            const sec = resolveConfig(tenant).orders.kitchenQueueSec || 60;
            const rows = await Order.find({ tenantId: tenant._id, orderType: { $in: types }, status: 'accepted', 'kitchen.queuedAt': { $exists: false } })
                .select('orderNo orderType status statusHistory createdAt scheduledFor kitchen').limit(100).lean();
            for (const o of rows) {
                const v = kitchen.viewOf(o, { lateMin: rules.lateMin || 20, now: now.getTime() });
                if (v.early) continue;   // a pickup for later is not started early anyway
                if (now.getTime() - new Date(v.acceptedAt).getTime() < sec * 1000) continue;
                const r = await kitchen.addToQueue({ tenant, orderId: o._id, staff: null, by: 'auto' }).catch(() => null);
                if (r && !r.already) moved += 1;
            }
        } catch (e) { console.error('Kitchen queue error:', e.message); }
    }
    return moved;
}

function startKitchenQueue() {
    setInterval(() => runKitchenQueue().catch((e) => console.error('Kitchen queue job error:', e.message)), EVERY_MS).unref?.();
}

module.exports = { runKitchenQueue, startKitchenQueue };
