// Late-order watcher. Runs every 2 minutes.
//   not_started      accepted, but the shop has not started it
//   slow_prep        preparing for too long
//   no_rider         delivery order, no rider, waiting too long
//   on_the_way_long  out for delivery for too long
// The owner is told once per stage. If nothing changes, the superadmin is told once more.
// Each alert is claimed with a filtered atomic update (Order.stuck), so two servers never send it twice.
const Order = require('../models/Order');
const Tenant = require('../models/Tenant');
const notify = require('./notificationService');

const num = (name, def) => { const n = parseInt(process.env[name], 10); return Number.isFinite(n) && n > 0 ? n : def; };
const LIMIT = {
    not_started: num('STUCK_ACCEPTED_MIN', 20),
    slow_prep: num('STUCK_PREPARING_MIN', 45),
    no_rider: num('STUCK_NO_RIDER_MIN', 15),
    on_the_way_long: num('STUCK_ON_THE_WAY_MIN', 75),
};
const ESCALATE_MIN = num('STUCK_ESCALATE_MIN', 15);
const MIN = 60000;
const ACTIVE = ['accepted', 'preparing', 'ready', 'out_for_delivery'];
const LOOKBACK_MS = 8 * 86400000;   // scheduled orders can be made up to 7 days ahead

const TEXT = {
    not_started: { title: 'Order is waiting', line: (no, m) => `Order #${no} was accepted ${m} min ago but not started.` },
    slow_prep: { title: 'Order is taking long', line: (no, m) => `Order #${no} has been preparing for ${m} min.` },
    no_rider: { title: 'Order needs a rider', line: (no, m) => `Order #${no} still has no rider after ${m} min. Please assign one.` },
    on_the_way_long: { title: 'Delivery is taking long', line: (no, m) => `Order #${no} has been on the way for ${m} min.` },
};

// Which late stage (if any) an order is in right now. Scheduled orders count from their scheduled time.
function stageOf(o, now) {
    const last = o.statusHistory?.length ? o.statusHistory[o.statusHistory.length - 1].at : o.createdAt;
    const sinceMs = Math.max(new Date(last).getTime(), o.scheduledFor ? new Date(o.scheduledFor).getTime() : 0);
    if (sinceMs > now.getTime()) return null;
    const min = Math.floor((now.getTime() - sinceMs) / MIN);

    const noRider = o.orderType === 'delivery' && !o.delivery?.riderId;
    if (noRider && ['preparing', 'ready'].includes(o.status) && min >= LIMIT.no_rider) return { stage: 'no_rider', min };
    if (o.status === 'accepted' && min >= LIMIT.not_started) return { stage: 'not_started', min };
    if (o.status === 'preparing' && min >= LIMIT.slow_prep) return { stage: 'slow_prep', min };
    if (o.status === 'out_for_delivery' && min >= LIMIT.on_the_way_long) return { stage: 'on_the_way_long', min };
    return null;
}

async function escalate(o, st, now) {
    const t = await Tenant.findById(o.tenantId).select('name').lean();
    const told = Math.round((now.getTime() - new Date(o.stuck.ownerAt).getTime()) / MIN);
    notify.send({
        tenantId: o.tenantId, role: 'superadmin', type: 'order_escalated',
        title: `Late order at ${t?.name || 'a shop'}`,
        body: `${TEXT[st.stage].line(o.orderNo, st.min)} The owner was told ${told} min ago.`,
        data: { orderId: String(o._id), orderNo: o.orderNo, stage: st.stage },
    });
}

const BATCH = 200;

// reads all active orders in batches (by _id), so no order is skipped when there are many
async function checkStuck(now = new Date()) {
    let alerts = 0;
    let lastId = null;
    for (;;) {
        const orders = await Order.find({
            status: { $in: ACTIVE },
            createdAt: { $gte: new Date(now.getTime() - LOOKBACK_MS) },
            ...(lastId && { _id: { $gt: lastId } }),
        }).sort({ _id: 1 }).limit(BATCH)
            .select('tenantId orderNo orderType status createdAt scheduledFor delivery.riderId statusHistory stuck').lean();
        if (!orders.length) break;
        lastId = orders[orders.length - 1]._id;
        alerts += await checkBatch(orders, now);
        if (orders.length < BATCH) break;
    }
    return alerts;
}

async function checkBatch(orders, now) {
    let alerts = 0;
    for (const o of orders) {
        const st = stageOf(o, now);
        if (!st) continue;

        if (o.stuck?.stage !== st.stage) {
            const r = await Order.updateOne(
                { _id: o._id, status: o.status, 'stuck.stage': { $ne: st.stage } },
                { $set: { stuck: { stage: st.stage, ownerAt: now } } },
            );
            if (!r.modifiedCount) continue;
            alerts += 1;
            notify.toOwner(o.tenantId, {
                type: 'order_late', title: TEXT[st.stage].title, body: TEXT[st.stage].line(o.orderNo, st.min),
                data: { orderId: String(o._id), orderNo: o.orderNo, stage: st.stage },
            });
        } else if (o.stuck.ownerAt && !o.stuck.adminAt && now.getTime() - new Date(o.stuck.ownerAt).getTime() >= ESCALATE_MIN * MIN) {
            const r = await Order.updateOne(
                { _id: o._id, status: o.status, 'stuck.stage': st.stage, 'stuck.adminAt': null },
                { $set: { 'stuck.adminAt': now } },
            );
            if (r.modifiedCount) {
                alerts += 1;
                await escalate(o, st, now);
            }
        }
    }
    return alerts;
}

function startStuckOrdersScheduler() {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            const n = await checkStuck();
            if (n) console.log(`Late orders: ${n} alert(s) sent`);
        } catch (e) {
            console.error('Late orders error:', e.message);
        } finally {
            running = false;
        }
    };
    setTimeout(run, 60 * 1000).unref?.();
    setInterval(run, 2 * 60 * 1000).unref?.();
}

module.exports = { checkStuck, startStuckOrdersScheduler };