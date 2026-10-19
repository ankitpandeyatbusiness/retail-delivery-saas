// Auto accept: a new order is accepted by itself while the owner is busy.
//
// The owner's choice is saved on the shop: settings.orders.autoAccept = { on, from, to, repeat, day }
//   on      true = auto accept, false / missing = the owner accepts every order by hand (the default)
//   from/to "HH:MM" India time. Both missing = the whole time the shop is open. Past midnight is fine (22:00 to 02:00).
//   repeat  'today' = only the India day in `day` (the day he switched it on); 'daily' = every day
//   day     "YYYY-MM-DD", the India day it was switched on (used by 'today')
// Orders only arrive while the shop is open, so "all day" means the shop's own opening times, and a holiday or a closed day simply
// brings no orders. Nothing has to run in the background: it is worked out at the moment an order arrives.
const Order = require('../models/Order');
const Tenant = require('../models/Tenant');
const orderStatus = require('./orderStatusService');

const IST_MS = 330 * 60000;
const toMin = (t) => { const [h, m] = String(t).split(':'); return Number(h) * 60 + Number(m); };
const validTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || ''));

function istNow(now = new Date()) {
    const ist = new Date(now.getTime() + IST_MS);
    return { date: ist.toISOString().slice(0, 10), mins: ist.getUTCHours() * 60 + ist.getUTCMinutes() };
}

// does auto accept apply to an order that arrives at `now`?
function applies(tenant, now = new Date()) {
    const a = tenant?.settings?.orders?.autoAccept;
    if (!a || !a.on) return false;
    const { date, mins } = istNow(now);
    if (a.repeat !== 'daily' && a.day !== date) return false;   // "today" ended with the day
    if (validTime(a.from) && validTime(a.to)) {
        const f = toMin(a.from);
        const t = toMin(a.to);
        return t > f ? mins >= f && mins < t : mins >= f || mins < t;
    }
    return true;
}

// what the owner's screens show
function describe(tenant, now = new Date()) {
    const a = tenant?.settings?.orders?.autoAccept || {};
    const { date } = istNow(now);
    const expired = !!a.on && a.repeat !== 'daily' && a.day !== date;
    return {
        on: !!a.on && !expired, from: a.from || null, to: a.to || null, repeat: a.repeat === 'daily' ? 'daily' : 'today',
        active: applies(tenant, now),   // right now an order would be accepted by itself
    };
}

// validate the owner's choice and return what to save
function clean(body, now = new Date()) {
    const b = body || {};
    if (typeof b.on !== 'boolean') throw Object.assign(new Error('Send on: true or false'), { status: 400 });
    if (!b.on) return { on: false };
    const out = { on: true, repeat: b.repeat === 'daily' ? 'daily' : 'today', day: istNow(now).date };
    const hasFrom = b.from !== undefined && b.from !== null && b.from !== '';
    const hasTo = b.to !== undefined && b.to !== null && b.to !== '';
    if (hasFrom !== hasTo) throw Object.assign(new Error('Give both the start and the end time, or neither'), { status: 400 });
    if (hasFrom) {
        if (!validTime(b.from) || !validTime(b.to)) throw Object.assign(new Error('Times must look like 13:30'), { status: 400 });
        if (b.from === b.to) throw Object.assign(new Error('The start and the end time must differ'), { status: 400 });
        out.from = b.from;
        out.to = b.to;
    }
    return out;
}

// An order has just reached the shop (cash order placed, or online order paid). Tells the owner, and accepts it when the owner
// asked for that. Never throws: a problem here must not break the order.
async function afterPlaced(order) {
    const notify = require('./notificationService');
    let auto = false;
    try {
        const tenant = await Tenant.findById(order.tenantId).select('settings.orders').lean();
        auto = applies(tenant);
    } catch (e) { /* manual */ }
    notify.orderPlaced(order, { autoAccepted: auto });   // the Soundbox rings as usual, with "auto accepted" on it
    if (!auto) return false;
    try {
        const fresh = await Order.findOne({ _id: order._id, tenantId: order.tenantId });
        if (!fresh || fresh.status !== 'placed') return false;
        await orderStatus.change({ order: fresh, status: 'accepted', actor: { type: 'system', label: 'auto accept' }, note: 'Accepted automatically' });
        return true;
    } catch (e) {
        console.error('Auto accept error:', e.message);   // stays "placed": the owner accepts it by hand, the usual reminders run
        return false;
    }
}

module.exports = { applies, describe, clean, afterPlaced };
