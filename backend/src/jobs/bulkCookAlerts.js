// Bulk orders and the kitchen, on the clock (every minute):
//   1. 24 hours before the day a paid bulk order is wanted, the cooks get the loud alert (sound + push) and it moves to the top of "To make".
//   2. A bulk delivery that was packed early is offered to riders 4 hours before its time (or the owner is told to choose one).
const Order = require('../models/Order');
const { LEAD_MS, RIDER_LEAD_MS, alertDue, } = require('../services/bulkKitchen');

const EVERY_MS = 60 * 1000;

async function runBulkCookAlerts(now = new Date()) {
    let called = 0; let asked = 0;
    const due = await Order.find({ bulkId: { $exists: true }, status: 'accepted', 'kitchen.dueAlertAt': { $exists: false }, scheduledFor: { $lte: new Date(now.getTime() + LEAD_MS) } }).limit(100).lean();
    for (const t of due) { try { if (await alertDue(t)) called += 1; } catch (e) { console.error('Bulk cook alert error:', e.message); } }
    const early = await Order.find({
        bulkId: { $exists: true }, orderType: 'delivery', status: 'preparing', 'kitchen.readyAt': { $exists: true }, 'kitchen.riderAskedAt': { $exists: false },
        'delivery.riderId': { $exists: false }, scheduledFor: { $lte: new Date(now.getTime() + RIDER_LEAD_MS) },
    }).limit(100).lean();
    for (const t of early) { try { await require('../services/bulkKitchen').ticketReady(t); asked += 1; } catch (e) { console.error('Bulk rider ask error:', e.message); } }
    // 3. A bulk delivery packed 15 minutes ago that no rider has taken: the owner is told loudly, and again every 15 minutes until somebody has it.
    //    (The Ready box on his Home screen blinks for it too.)
    let warned = 0;
    const WAIT_MS = 15 * 60 * 1000;
    const stuck = await Order.find({
        bulkId: { $exists: true }, orderType: 'delivery', status: { $in: ['preparing', 'ready'] }, 'kitchen.readyAt': { $lte: new Date(now.getTime() - WAIT_MS) },
        'delivery.riderId': { $exists: false },
        $or: [{ 'kitchen.bulkNoRiderAt': { $exists: false } }, { 'kitchen.bulkNoRiderAt': { $lte: new Date(now.getTime() - WAIT_MS) } }],
    }).select('tenantId orderNo bulkCode note kitchen.bulkNoRiderAt').limit(50).lean();
    for (const t of stuck) {
        try {
            // one job at a time wins the order (a second server instance or a slow run must not warn twice)
            const won = await Order.updateOne({ _id: t._id, 'kitchen.bulkNoRiderAt': t.kitchen?.bulkNoRiderAt ? t.kitchen.bulkNoRiderAt : { $exists: false } }, { $set: { 'kitchen.bulkNoRiderAt': now } });
            if (!won.modifiedCount) continue;
            const code = t.bulkCode || String(t.note || '').match(/^Bulk order\s+([^\s.]+)/i)?.[1] || String(t.orderNo);
            require('../notifications/center').notify('bulk_no_rider', {
                tenantId: t.tenantId, vars: { code },
                data: { kind: 'bulk', orderId: String(t._id), speech: `Bulk order ${code} is packed but no rider has taken it. Please choose a free rider.`, speechHi: `बल्क ऑर्डर ${code} पैक हो गया है, पर किसी राइडर ने नहीं लिया। कृपया कोई खाली राइडर चुनें।` },
            });
            warned += 1;
        } catch (e) { console.error('Bulk no-rider alert error:', e.message); }
    }
    return { called, asked, warned };
}

function startBulkCookAlerts() {
    setInterval(() => runBulkCookAlerts().catch((e) => console.error('Bulk cook alert job error:', e.message)), EVERY_MS).unref?.();
}

module.exports = { runBulkCookAlerts, startBulkCookAlerts };
