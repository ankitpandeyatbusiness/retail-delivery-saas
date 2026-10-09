// Cancels orders that the shop never accepted, so customers are never left waiting forever.

const Order = require('../models/Order');
const orderStatus = require('./orderStatusService');

const TIMEOUT_MIN = Math.max(1, parseInt(process.env.ORDER_ACCEPT_TIMEOUT_MIN, 10) || 10);
const BATCH = 100;
let running = false;

async function cancelUnacceptedOrders(now = new Date()) {
    const cutoff = new Date(now.getTime() - TIMEOUT_MIN * 60000);
    const soon = new Date(now.getTime() + TIMEOUT_MIN * 60000);

    const stale = await Order.find({
        status: 'placed',
        createdAt: { $lte: cutoff },
        // normal orders, or scheduled orders whose time is almost here
        $or: [{ scheduledFor: null }, { scheduledFor: { $lte: soon } }],
    }).select('_id tenantId status').limit(BATCH).lean();

    let cancelled = 0;
    for (const o of stale) {
        try {
            await orderStatus.change({
                order: o,
                status: 'cancelled',
                actor: { type: 'system', label: `auto-cancel after ${TIMEOUT_MIN} min` },
                note: 'The shop did not respond in time',
            });
            cancelled += 1;
        } catch (e) {
            // 409 means the shop accepted it a moment ago, so skip it quietly
            if (e.status !== 409) console.error('Order timeout: could not cancel', String(o._id), e.message);
        }
    }
    return cancelled;
}

// Starts a few seconds after the server boots, then every minute.
function startOrderTimeoutScheduler() {
    const run = async () => {
        if (running) return;
        running = true;
        try {
            const n = await cancelUnacceptedOrders();
            if (n) console.log(`Order timeout: auto-cancelled ${n} order(s)`);
        } catch (e) {
            console.error('Order timeout error:', e.message);
        } finally {
            running = false;
        }
    };
    setTimeout(run, 15 * 1000).unref?.();
    setInterval(run, 60 * 1000).unref?.();
}

module.exports = { startOrderTimeoutScheduler, cancelUnacceptedOrders };