// Cancels orders that the shop never accepted, so customers are never left waiting forever.

const Order = require('../models/Order');
const Coupon = require('../models/Coupon');

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
    }).select('_id couponId').limit(BATCH).lean();

    let cancelled = 0;
    for (const o of stale) {
        const note = `Auto-cancelled: the shop did not accept within ${TIMEOUT_MIN} minutes`;
        // the status filter means: if the shop accepted a moment ago, this does nothing
        const updated = await Order.findOneAndUpdate(
            { _id: o._id, status: 'placed' },
            {
                $set: { status: 'cancelled', cancelledBy: 'system', cancelReason: 'The shop did not respond in time' },
                $push: { statusHistory: { status: 'cancelled', note } },
            },
            { new: true },
        );
        if (!updated) continue;
        cancelled += 1;
        if (updated.couponId) {
            await Coupon.updateOne({ _id: updated.couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
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