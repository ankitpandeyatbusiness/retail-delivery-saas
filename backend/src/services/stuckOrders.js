// Late-order watcher. Runs every 2 minutes.
//   not_started      accepted, but the shop has not started it
//   slow_prep        preparing for too long
//   no_rider         delivery order, no rider, waiting too long
//   on_the_way_long  out for delivery for too long
// The shop owner is told once per stage. The superadmin is told ONLY when the same order is still stuck long after that (ESCALATE_MIN), once per order and stage.
// Each alert is claimed with a filtered atomic update (Order.stuck), so two servers never send it twice.
const Order = require('../models/Order');
const notify = require('./notificationService');

const num = (name, def) => { const n = parseInt(process.env[name], 10); return Number.isFinite(n) && n > 0 ? n : def; };
const LIMIT = {
    not_started: num('STUCK_ACCEPTED_MIN', 20),
    slow_prep: num('STUCK_PREPARING_MIN', 45),
    no_rider: num('STUCK_NO_RIDER_MIN', 15),
    on_the_way_long: num('STUCK_ON_THE_WAY_MIN', 75),
};
// minutes after which the superadmin is told too (the owner had his chance first)
const ESCALATE_MIN = { not_started: num('ESC_ACCEPTED_MIN', 40), slow_prep: num('ESC_PREPARING_MIN', 90), no_rider: num('ESC_NO_RIDER_MIN', 30), on_the_way_long: num('ESC_ON_THE_WAY_MIN', 120), not_accepted: num('ESC_NOT_ACCEPTED_MIN', 10) };
const MIN = 60000;
const ACTIVE = ['accepted', 'preparing', 'ready', 'out_for_delivery'];
const LOOKBACK_MS = 8 * 86400000;   // scheduled orders can be made up to 7 days ahead

const HI = {
    not_started: (no, m) => `ऑर्डर ${no} को स्वीकार हुए ${m} मिनट हो गए, पर शुरू नहीं हुआ।`,
    slow_prep: (no, m) => `ऑर्डर ${no} को बनते हुए ${m} मिनट हो गए।`,
    no_rider: (no, m) => `ऑर्डर ${no} के लिए ${m} मिनट बाद भी कोई राइडर नहीं है। कृपया राइडर चुनिए।`,
    on_the_way_long: (no, m) => `ऑर्डर ${no} को रास्ते में ${m} मिनट हो गए।`,
};

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

// tell the superadmin once for this order and stage (a filtered atomic update claims it, so two servers never both send it)
async function escalate(o, st, now) {
    const r = await Order.updateOne({ _id: o._id, status: o.status, 'stuck.adminStage': { $ne: st.stage } }, { $set: { 'stuck.adminStage': st.stage, 'stuck.adminAt': now } });
    if (!r.modifiedCount) return false;
    require('./adminAlerts').alert('admin_order_stuck', { tenantId: o.tenantId, vars: { orderNo: o.orderNo, stage: st.stage, minutes: st.min }, data: { orderId: String(o._id), orderNo: o.orderNo, stage: st.stage } });
    return true;
}

// a new order the shop has not accepted for a long time (the owner is reminded by the unaccepted reminders, not by this watcher)
async function checkUnaccepted(now) {
    const orders = await Order.find({
        status: 'placed', createdAt: { $lte: new Date(now.getTime() - ESCALATE_MIN.not_accepted * MIN), $gte: new Date(now.getTime() - 2 * 86400000) },
        'stuck.adminStage': { $ne: 'not_accepted' },
        $or: [{ scheduledFor: null }, { scheduledFor: { $lte: now } }],
    }).sort({ _id: 1 }).limit(100).select('tenantId orderNo status createdAt payment scheduledFor stuck').lean();
    let n = 0;
    for (const o of orders) {
        if (o.payment?.method && o.payment.method !== 'cod' && o.payment.status !== 'paid') continue;   // an unpaid online order is not the shop's to accept
        if (await escalate(o, { stage: 'not_accepted', min: Math.floor((now.getTime() - new Date(o.createdAt).getTime()) / MIN) }, now)) n += 1;
    }
    return n;
}

const BATCH = 200;

// reads all active orders in batches (by _id), so no order is skipped when there are many
async function checkStuck(now = new Date()) {
    let alerts = 0;
    let lastId = null;
    for (; ;) {
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
    await checkUnaccepted(now).catch((e) => console.error('Unaccepted watch error:', e.message));
    return alerts;
}

async function checkBatch(orders, now) {
    let alerts = 0;
    for (const o of orders) {
        const st = stageOf(o, now);
        if (!st) continue;
        if (st.min >= ESCALATE_MIN[st.stage] && !(o.stuck?.adminStage === st.stage)) await escalate(o, st, now);
        if (o.stuck?.stage === st.stage) continue;   // the owner already knows about this stage

        const r = await Order.updateOne(
            { _id: o._id, status: o.status, 'stuck.stage': { $ne: st.stage } },
            { $set: { 'stuck.stage': st.stage, 'stuck.ownerAt': now } },   // dotted, so the superadmin's mark (adminStage) stays
        );
        if (!r.modifiedCount) continue;
        alerts += 1;
        notify.toOwner(o.tenantId, {
            type: 'order_late', title: TEXT[st.stage].title, body: TEXT[st.stage].line(o.orderNo, st.min),
            data: { orderId: String(o._id), orderNo: o.orderNo, stage: st.stage, speechHi: HI[st.stage](o.orderNo, st.min) },
        });
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