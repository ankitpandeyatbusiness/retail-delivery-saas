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
    return { called, asked };
}

function startBulkCookAlerts() {
    setInterval(() => runBulkCookAlerts().catch((e) => console.error('Bulk cook alert job error:', e.message)), EVERY_MS).unref?.();
}

module.exports = { runBulkCookAlerts, startBulkCookAlerts };
