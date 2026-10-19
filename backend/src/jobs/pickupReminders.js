// A pickup order that is READY and waiting:
//   30 minutes before the customer's time window ends  -> "Your food is waiting" (with his pickup code)
//   when the window ends                                -> "Your food is still waiting"
//   30 minutes after the window ended                   -> the OWNER is told that the customer has not come, the order goes under
//                                                          "Needs a look", and he can mark it "not collected" with one tap
// Each message is sent once: the order remembers it (Order.pickupNotified), claimed with a filtered update, so a second server or a restart
// never repeats it.
const Order = require('../models/Order');
const center = require('../notifications/center');
const { brief } = require('../utils/orderBrief');
const { NO_SHOW_WAIT_MS } = require('../services/orderflow');
const { HIDE_UNPAID } = require('../services/onlineOrder');

const MIN = 60000;
const clock = (d) => new Date(d).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });

async function claim(order, field, now) {
    const r = await Order.updateOne({ _id: order._id, status: 'ready', [`pickupNotified.${field}`]: { $exists: false } }, { $set: { [`pickupNotified.${field}`]: now } });
    return r.modifiedCount === 1;
}

async function runPickupReminders(now = new Date()) {
    const orders = await Order.find({
        orderType: 'pickup', status: 'ready', pickupUntil: { $ne: null }, ...HIDE_UNPAID,
        $or: [{ 'pickupNotified.noShowAt': { $exists: false } }, { 'pickupNotified.overAt': { $exists: false } }, { 'pickupNotified.waitingAt': { $exists: false } }],
    }).limit(200);
    let sent = 0;
    for (const o of orders) {
        try {
            const end = new Date(o.pickupUntil).getTime();
            const t = now.getTime();
            const code = (() => { try { return require('../services/deliveryPinService').pinFor(o); } catch (e) { return null; } })();
            const vars = { orderNo: o.orderNo, brief: brief(o), until: clock(end), pickupCode: code };
            const data = { orderId: String(o._id), orderNo: o.orderNo };
            if (t >= end - 30 * MIN && t < end && await claim(o, 'waitingAt', now)) {
                center.notify('pickup_waiting', { tenantId: o.tenantId, userId: o.userId, vars, data }); sent += 1;
            } else if (t >= end && t < end + NO_SHOW_WAIT_MS && await claim(o, 'overAt', now)) {
                center.notify('pickup_waiting', { tenantId: o.tenantId, userId: o.userId, vars: { ...vars, over: true }, data }); sent += 1;
            } else if (t >= end + NO_SHOW_WAIT_MS && await claim(o, 'noShowAt', now)) {
                require('../services/orderLook').byId(o.tenantId, o._id, 'pickup_no_show');
                center.notify('pickup_no_show', { tenantId: o.tenantId, vars, data }); sent += 1;
            }
        } catch (e) {
            console.error('Pickup reminder error:', e.message);
        }
    }
    return { sent };
}

function startPickupReminders() {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try { await runPickupReminders(); } catch (e) { console.error('Pickup reminders job error:', e.message); } finally { running = false; }
    };
    setTimeout(run, 45 * 1000).unref?.();
    setInterval(run, 2 * MIN).unref?.();
}

module.exports = { runPickupReminders, startPickupReminders };
