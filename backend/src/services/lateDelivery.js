// Late-delivery watcher. Runs every minute.
// The time allowed for a delivery starts when the rider COLLECTS the food (Order.delivery.dueAt = collected + time allowed).
//   LATE_WARN_MIN   (50) minutes past the due time: the rider (on screen + push) and the shop (push) are warned, once.
//   LATE_CANCEL_MIN (60) minutes past the due time: the system cancels the order. Reason "late_delivery": the customer gets a full
//                        refund (online orders), no strike, the coupon goes back. The shop, the rider and the customer are told
//                        by the normal cancel notifications (services/notificationService.js).
const Order = require('../models/Order');
const orderStatus = require('./orderStatusService');
const center = require('../notifications/center');

const num = (name, def) => { const n = parseInt(process.env[name], 10); return Number.isFinite(n) && n > 0 ? n : def; };
const CANCEL_MIN = num('LATE_CANCEL_MIN', 60);
const WARN_MIN = Math.min(num('LATE_WARN_MIN', 50), CANCEL_MIN - 1);
const MIN = 60000;
const BATCH = 50;
const ON_THE_WAY = { status: 'out_for_delivery', orderType: 'delivery', 'delivery.status': 'picked_up' };

async function check(now = new Date()) {
    let done = 0;
    const cancelAt = new Date(now.getTime() - CANCEL_MIN * MIN);
    const warnAt = new Date(now.getTime() - WARN_MIN * MIN);

    const toCancel = await Order.find({ ...ON_THE_WAY, 'delivery.dueAt': { $lte: cancelAt } }).limit(BATCH);
    for (const o of toCancel) {
        try {
            await orderStatus.change({ order: o, status: 'cancelled', actor: { type: 'system', label: 'auto-cancel: ' + CANCEL_MIN + ' min late' }, reasonCode: 'late_delivery' });
            done += 1;
        } catch (e) { console.error('Late delivery cancel error:', e.message); }
    }

    const toWarn = await Order.find({ ...ON_THE_WAY, 'delivery.dueAt': { $lte: warnAt, $gt: cancelAt }, 'delivery.lateWarnedAt': { $exists: false } })
        .select('tenantId orderNo delivery.riderId delivery.dueAt').limit(BATCH).lean();
    for (const o of toWarn) {
        try {
            const claim = await Order.updateOne({ _id: o._id, status: 'out_for_delivery', 'delivery.lateWarnedAt': { $exists: false } }, { $set: { 'delivery.lateWarnedAt': now } });
            if (!claim.modifiedCount) continue;   // another server already did it
            const late = Math.max(1, Math.floor((now.getTime() - new Date(o.delivery.dueAt).getTime()) / MIN));
            const vars = { orderNo: o.orderNo, late, left: Math.max(1, CANCEL_MIN - late) };
            const data = { orderId: String(o._id), orderNo: o.orderNo };
            center.notify('delivery_late_warning', { tenantId: o.tenantId, data, vars });
            if (o.delivery.riderId) center.notify('delivery_late_warning_rider', { tenantId: o.tenantId, userId: o.delivery.riderId, data, vars });
            done += 1;
        } catch (e) { console.error('Late delivery warning error:', e.message); }
    }
    return done;
}

function startLateDeliveryScheduler() {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            const n = await check();
            if (n) console.log('Late deliveries: ' + n + ' handled');
        } catch (e) {
            console.error('Late deliveries error:', e.message);
        } finally {
            running = false;
        }
    };
    setTimeout(run, 45 * 1000).unref?.();
    setInterval(run, MIN).unref?.();
}

module.exports = { check, startLateDeliveryScheduler };
