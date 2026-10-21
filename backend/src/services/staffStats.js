// What a cook or a waiter has done, counted from the orders: for the owner's Kitchen staff / Waiters pages, and for the person's own "My work" tab.
//   cook    "made": orders he marked Ready (with the dishes in them) and the minutes between Start cooking and Ready
//   waiter  "served": orders he marked Served and the minutes a ready dish waited before he carried it
// Days are India days. "today" starts at India midnight; "week" is the last 7 days including today. No money is ever counted here.
const Order = require('../models/Order');
const Staff = require('../models/Staff');
const User = require('../models/User');
const staffService = require('./staffService');
const staffLeave = require('./staffLeave');
const staffDuty = require('./staffDuty');

const IST_MS = 330 * 60000;
const DAY_MS = 86400000;
const dayStart = (now = Date.now()) => new Date(Math.floor((now + IST_MS) / DAY_MS) * DAY_MS - IST_MS);
const avg = (list) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null);
const dishes = (o) => (o.items || []).reduce((n, l) => n + (Number(l.quantity) || 0), 0);
const blank = () => ({ today: { orders: 0, dishes: 0 }, week: { orders: 0, dishes: 0 }, avgMin: null, tables: 0 });

// { userId -> stats } for cooks
async function cooks(tenantId, ids, now) {
    const todayAt = dayStart(now).getTime();
    const weekAt = todayAt - 6 * DAY_MS;
    const rows = await Order.find({ tenantId, 'kitchen.readyBy': { $in: ids }, 'kitchen.readyAt': { $gte: new Date(weekAt) } }).select('kitchen items').limit(5000).lean();
    const out = new Map(ids.map((id) => [String(id), blank()]));
    const mins = new Map(ids.map((id) => [String(id), []]));
    for (const o of rows) {
        const id = String(o.kitchen.readyBy);
        const s = out.get(id);
        if (!s) continue;
        const d = dishes(o);
        s.week.orders += 1; s.week.dishes += d;
        if (new Date(o.kitchen.readyAt).getTime() >= todayAt) { s.today.orders += 1; s.today.dishes += d; }
        if (o.kitchen.startedAt) {
            const m = (new Date(o.kitchen.readyAt) - new Date(o.kitchen.startedAt)) / 60000;
            if (m >= 0 && m < 240) mins.get(id).push(m);
        }
    }
    for (const [id, s] of out) s.avgMin = avg(mins.get(id));
    return out;
}

// { userId -> stats } for waiters
async function waiters(tenantId, ids, now) {
    const todayAt = dayStart(now).getTime();
    const weekAt = todayAt - 6 * DAY_MS;
    const rows = await Order.find({ tenantId, orderType: 'dine_in', deliveredAt: { $gte: new Date(weekAt) }, statusHistory: { $elemMatch: { status: 'delivered', by: { $in: ids } } } })
        .select('statusHistory items tableNo deliveredAt').limit(5000).lean();
    const out = new Map(ids.map((id) => [String(id), blank()]));
    const mins = new Map(ids.map((id) => [String(id), []]));
    const tables = new Map(ids.map((id) => [String(id), new Set()]));
    for (const o of rows) {
        const served = [...o.statusHistory].reverse().find((h) => h.status === 'delivered' && h.by);
        const id = served && String(served.by);
        const s = id && out.get(id);
        if (!s) continue;
        const d = dishes(o);
        s.week.orders += 1; s.week.dishes += d;
        const at = new Date(served.at || o.deliveredAt).getTime();
        if (at >= todayAt) { s.today.orders += 1; s.today.dishes += d; if (o.tableNo) tables.get(id).add(String(o.tableNo)); }
        const ready = [...o.statusHistory].reverse().find((h) => h.status === 'ready');
        if (ready?.at) { const m = (at - new Date(ready.at).getTime()) / 60000; if (m >= 0 && m < 240) mins.get(id).push(m); }
    }
    for (const [id, s] of out) { s.avgMin = avg(mins.get(id)); s.tables = tables.get(id).size; }
    return out;
}

// stats for a list of staff of ONE job
const forRole = (tenantId, role, ids, now = Date.now()) => (role === 'kitchen' ? cooks(tenantId, ids, now) : waiters(tenantId, ids, now));

// the dishes a cook started and has not marked ready yet
async function working(tenantId, userId) {
    const rows = await Order.find({ tenantId, 'kitchen.startedBy': userId, status: 'preparing', 'kitchen.readyAt': { $exists: false } })
        .select('orderNo orderType tableNo tableParty kitchen.startedAt items').sort({ 'kitchen.startedAt': 1 }).limit(10).lean();
    return rows.map((o) => ({ id: String(o._id), orderNo: o.orderNo, orderType: o.orderType, table: o.tableNo || null, party: o.tableParty || null, since: o.kitchen.startedAt, dishes: dishes(o) }));
}

// everything about one person (the owner's detail page, and the person's own "My work" tab)
async function detail({ tenant, userId, now = Date.now() }) {
    const row = await Staff.findOne({ tenantId: tenant._id, userId }).lean();
    if (!row) return null;
    const [user, listed, leaves] = await Promise.all([
        User.findById(userId).select('phone').lean(),
        staffService.list(tenant),
        staffLeave.mine(tenant._id, userId),
    ]);
    const person = listed.items.find((p) => p.userId === String(userId)) || null;
    const stats = (await forRole(tenant._id, row.role, [userId], now)).get(String(userId)) || blank();
    const { closed, winding } = await staffDuty.closedFor(tenant, row.role);
    const duty = staffDuty.viewOf(row, new Date(now), closed, winding);
    return {
        person: person ? { ...person, phone: user?.phone || person.phone } : null,
        stats,
        working: row.role === 'kitchen' ? await working(tenant._id, userId) : [],
        leaves,
        holidays: duty.holidays,
        duty: { status: duty.status, onDuty: duty.onDuty, online: duty.online, mode: duty.mode },
    };
}

module.exports = { forRole, detail, dayStart };
