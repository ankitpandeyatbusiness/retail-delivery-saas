// Orders the shop has not accepted yet.
//   3 and 6 minutes into the wait: the owner is reminded (live / push / SMS, decided by the notification center).
//        Each reminder is sent ONCE: it is stored on the order (Order.unacceptedReminders) with a filtered update.
//   10 minutes (ORDER_ACCEPT_TIMEOUT_MIN): the system cancels the order. Reason "not_accepted": full refund, no strike.
// A scheduled order starts waiting 20 minutes before its time, so the shop gets 10 minutes that end 10 minutes before the
// scheduled time. That is the same moment the old code cancelled it.

const Order = require('../models/Order');
const orderStatus = require('./orderStatusService');
const notify = require('./notificationService');

const MIN = 60000;
const TIMEOUT_MIN = Math.max(1, parseInt(process.env.ORDER_ACCEPT_TIMEOUT_MIN, 10) || 10);
const REMINDER_MINUTES = [3, 6].filter((m) => m < TIMEOUT_MIN);
const BATCH = 100;
let running = false;

// when the shop's waiting time started
function waitingSince(order) {
    const created = new Date(order.createdAt).getTime();
    if (!order.scheduledFor) return created;
    return Math.max(created, new Date(order.scheduledFor).getTime() - 2 * TIMEOUT_MIN * MIN);
}

/* ------------------------------ reminders ------------------------------ */
async function remindUnacceptedOrders(now = new Date()) {
    if (!REMINDER_MINUTES.length) return 0;
    const first = REMINDER_MINUTES[0];

    // a first filter in the database (it uses the "placed" index); the exact waiting time is worked out below
    const orders = await Order.find({
        status: 'placed',
        createdAt: { $lte: new Date(now.getTime() - first * MIN) },
        $or: [{ scheduledFor: null }, { scheduledFor: { $lte: new Date(now.getTime() + (2 * TIMEOUT_MIN - first) * MIN) } }],
    }).sort({ createdAt: 1 }).limit(BATCH)
        .select('_id tenantId orderNo createdAt scheduledFor unacceptedReminders').lean();

    let reminded = 0;
    for (const o of orders) {
        const waited = (now.getTime() - waitingSince(o)) / MIN;
        if (waited >= TIMEOUT_MIN) continue;   // too late for a reminder: the cancel step takes this order
        const sent = o.unacceptedReminders || [];
        const due = REMINDER_MINUTES.filter((m) => waited >= m && !sent.includes(m));
        if (!due.length) continue;

        // claim ALL due reminders in ONE step. If another server was faster, this one gets nothing.
        const claimed = await Order.updateOne(
            { _id: o._id, tenantId: o.tenantId, status: 'placed', unacceptedReminders: { $nin: due } },
            { $addToSet: { unacceptedReminders: { $each: due } } },
            { timestamps: false },
        );
        if (!claimed.modifiedCount) continue;

        reminded += 1;
        const minutes = Math.max(...due);   // overdue after a restart: only the latest message is sent
        notify.toOwner(o.tenantId, {
            type: 'order_unaccepted_reminder',
            vars: { orderNo: o.orderNo, minutes, left: TIMEOUT_MIN - minutes },
            data: { orderId: String(o._id), orderNo: o.orderNo, minutes },
        });
    }
    return reminded;
}

/* ------------------------------ auto cancel ------------------------------ */
async function cancelUnacceptedOrders(now = new Date()) {
    const cutoff = new Date(now.getTime() - TIMEOUT_MIN * MIN);
    const soon = new Date(now.getTime() + TIMEOUT_MIN * MIN);

    const stale = await Order.find({
        status: 'placed',
        createdAt: { $lte: cutoff },
        // normal orders, or scheduled orders whose time is almost here
        $or: [{ scheduledFor: null }, { scheduledFor: { $lte: soon } }],
    }).select('_id tenantId status orderType payment pricing statusHistory delivery couponId userId customer createdAt')
        .limit(BATCH).lean();

    let cancelled = 0;
    for (const o of stale) {
        try {
            await orderStatus.change({
                order: o,
                status: 'cancelled',
                actor: { type: 'system', label: `auto-cancel after ${TIMEOUT_MIN} min` },
                note: 'The shop did not respond in time',
                reasonCode: 'not_accepted',
            });
            cancelled += 1;
        } catch (e) {
            // 409 means the shop accepted it a moment ago, so skip it quietly
            if (e.status !== 409) console.error('Order timeout: could not cancel', String(o._id), e.message);
        }
    }
    return cancelled;
}

async function runOrderTimeout(now = new Date()) {
    const reminded = await remindUnacceptedOrders(now);
    const cancelled = await cancelUnacceptedOrders(now);
    return { reminded, cancelled };
}

// Starts a few seconds after the server boots, then every minute.
function startOrderTimeoutScheduler() {
    const run = async () => {
        if (running) return;
        running = true;
        try {
            const r = await runOrderTimeout();
            if (r.reminded || r.cancelled) console.log(`Order timeout: ${r.reminded} reminder(s), ${r.cancelled} auto-cancelled`);
        } catch (e) {
            console.error('Order timeout error:', e.message);
        } finally {
            running = false;
        }
    };
    setTimeout(run, 15 * 1000).unref?.();
    setInterval(run, 60 * 1000).unref?.();
}

module.exports = {
    startOrderTimeoutScheduler, cancelUnacceptedOrders, remindUnacceptedOrders, runOrderTimeout,
    REMINDER_MINUTES, TIMEOUT_MIN,
};