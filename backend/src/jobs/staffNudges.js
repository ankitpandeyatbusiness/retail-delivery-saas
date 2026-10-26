// Gentle nudges for the kitchen and the floor, once per order:
//   - an accepted order nobody has started for `staff.nudgeMin` minutes        -> the cooks
//   - an order still cooking `staff.lateMin` minutes after its start time       -> the cooks
//   - a dine in dish ready for `staff.serveLateMin` minutes and not served      -> the waiters
// Each nudge is claimed on the order first (kitchen.nudgedAt / lateNudgedAt / serveNudgedAt), so two servers or two runs never send it twice.
// nudgeMin 0 switches the kitchen nudges off. The screens already show the same orders in red; this is for a phone in a pocket.
const Tenant = require('../models/Tenant');
const Order = require('../models/Order');
const Staff = require('../models/Staff');
const staffService = require('../services/staffService');
const kitchen = require('../services/kitchenService');
const pushChannel = require('../notifications/channels/push');
const { brief } = require('../utils/orderBrief');
const { STAFF_CHANNEL } = require('../notifications/events');

const MIN = 60000;

async function people(tenantId, role) {
    return require('../services/staffDuty').peopleOnDuty(tenantId, role);   // only people on duty are nudged (nobody while the shop is closed)
}
async function ring(tenantId, role, { title, body, data, tag }) {
    const list = await people(tenantId, role);
    await Promise.all(list.map((p) => pushChannel.send({ tenantId, userId: p.userId, title, body, data, tag, channelId: STAFF_CHANNEL, sound: 'ting_tong' }).catch((e) => console.error('Nudge push error:', e.message))));
}
// true only for the one run that set the mark
const claim = async (id, field) => (await Order.updateOne({ _id: id, [`kitchen.${field}`]: { $exists: false } }, { $set: { [`kitchen.${field}`]: new Date() } })).modifiedCount === 1;

async function runShop(tenant, now) {
    const rules = staffService.rulesOf(tenant);
    let sent = 0;
    if (rules.kitchenOn === true) {
        const types = rules.kitchenSees || ['delivery', 'pickup', 'dine_in'];
        const lateMin = rules.lateMin || 20;
        const rows = await Order.find({ tenantId: tenant._id, orderType: { $in: types }, status: { $in: ['accepted', 'preparing'] } })
            .select('orderNo orderType status tableNo items scheduledFor createdAt statusHistory kitchen').limit(150).lean();
        for (const o of rows) {
            const v = kitchen.viewOf(o, { lateMin, now: now.getTime() });
            if (v.stage === 'ready' || v.early) continue;
            if (o.status === 'accepted' && rules.nudgeMin > 0 && v.waitedMin >= rules.nudgeMin && await claim(o._id, 'nudgedAt')) {
                await ring(tenant._id, 'kitchen', { title: `Order #${o.orderNo} is waiting`, body: `${brief(o, 2)} · ${v.waitedMin} min. Please start it.`, data: { type: 'kitchen_nudge', orderId: String(o._id), orderNo: o.orderNo }, tag: `nudge:${o._id}` });
                sent += 1;
            }
            if (o.status === 'preparing' && v.late && await claim(o._id, 'lateNudgedAt')) {
                await ring(tenant._id, 'kitchen', { title: `Order #${o.orderNo} is late`, body: `${brief(o, 2)} · ${v.waitedMin} min.`, data: { type: 'kitchen_late', orderId: String(o._id), orderNo: o.orderNo }, tag: `late:${o._id}` });
                sent += 1;
            }
        }
    }
    if (rules.waiterOn === true || rules.kitchenOn === true) {
        const serveLate = rules.serveLateMin || 3;
        const rows = await Order.find({ tenantId: tenant._id, orderType: 'dine_in', status: 'ready', updatedAt: { $lte: new Date(now.getTime() - serveLate * MIN) } })
            .select('orderNo tableNo items statusHistory createdAt kitchen').limit(100).lean();
        for (const o of rows) {
            const h = [...(o.statusHistory || [])].reverse().find((x) => x.status === 'ready');
            const since = h?.at || o.createdAt;
            if (now.getTime() - new Date(since).getTime() < serveLate * MIN) continue;
            if (await claim(o._id, 'serveNudgedAt')) {
                const minutes = Math.round((now.getTime() - new Date(since).getTime()) / MIN);
                require('../notifications/center').notify('table_ready_unserved', { tenantId: tenant._id, vars: { table: o.tableNo || '', minutes, brief: brief(o, 2) }, data: { kind: 'table', table: o.tableNo, orderId: String(o._id), orderNo: o.orderNo } });
                if (rules.waiterOn === true) require('../services/waiterAlerts').tell(tenant._id, { orderId: String(o._id), orderNo: o.orderNo, table: o.tableNo, alert: { kind: 'ready', table: o.tableNo, orderNo: o.orderNo } });
                if (rules.waiterOn === true) await ring(tenant._id, 'waiter', { title: `Table ${o.tableNo || ''}: waiting to be served`.replace(/:\s*:/, ':'), body: `${brief(o, 2)} · ready ${Math.round((now.getTime() - new Date(since).getTime()) / MIN)} min ago`, data: { type: 'waiter_serve', kind: 'ready', orderId: String(o._id), orderNo: o.orderNo, table: String(o.tableNo || ''), speech: `Table ${o.tableNo}, food is waiting to be served`, speechHi: `टेबल ${o.tableNo}, खाना परोसने के लिए रखा है` }, tag: `servenudge:${o._id}` });
                sent += 1;
            }
        }
    }
    return sent;
}

async function runStaffNudges(now = new Date()) {
    const tenants = await Tenant.find({ $or: [{ 'settings.orders.staff.kitchenOn': true }, { 'settings.orders.staff.waiterOn': true }], status: { $ne: 'suspended' } }).select('settings.orders status').lean();
    let sent = 0;
    for (const t of tenants) {
        try { sent += await runShop(t, now); } catch (e) { console.error('Staff nudge error:', e.message); }
    }
    return sent;
}

function startStaffNudges() {
    setInterval(() => runStaffNudges().catch((e) => console.error('Staff nudges error:', e.message)), MIN).unref?.();
}

module.exports = { runStaffNudges, startStaffNudges };
