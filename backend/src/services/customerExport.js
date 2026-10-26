// The owner's customer sheet (Excel): one row per customer, with what he orders most and when. Five lists to choose from:
//   all · repeat (ordered 2+ times, most orders first) · valuable (most spent first) · recent (ordered in the last 30 days) · lapsed (30+ days quiet)
// Only delivered orders count as "orders"; cancelled ones are counted on their own.
const Order = require('../models/Order');
const User = require('../models/User');
const { buildSheet } = require('./xlsxExport');

const IST_MS = 5.5 * 3600 * 1000;
const DAY = 86400000;
const KINDS = {
    all: 'All customers', repeat: 'Most repeating customers', valuable: 'Most valuable customers', recent: 'Recent customers (last 30 days)', lapsed: 'Lapsed customers (30+ days quiet)',
};
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TYPE = { delivery: 'Delivery', pickup: 'Pickup', dine_in: 'Dine in' };
const PAY = { cod: 'Cash', upi: 'UPI', card: 'Card', wallet: 'Wallet', online: 'Online' };

const top = (m, n = 1) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const bump = (m, k, by = 1) => m.set(k, (m.get(k) || 0) + by);
// minutes after midnight (India time) as "8:30 PM"
const clock = (min) => {
    const m = Math.round(min) % 1440;
    const h = Math.floor(m / 60);
    return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const minOfDay = (d) => { const t = new Date(new Date(d).getTime() + IST_MS); return t.getUTCHours() * 60 + t.getUTCMinutes(); };
const meal = (min) => (min < 11 * 60 ? 'Breakfast time' : min < 16 * 60 ? 'Lunch time' : min < 19 * 60 ? 'Evening snacks' : min < 23 * 60 ? 'Dinner time' : 'Late night');
const avgOf = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

async function build({ tenantId, kind = 'all' }) {
    if (!KINDS[kind]) kind = 'all';
    const now = Date.now();
    const per = new Map();
    const cursor = Order.find({ tenantId, userId: { $exists: true, $ne: null } })
        .select('userId createdAt status orderType items.name items.quantity pricing.total payment.method deliveryRating.rating').lean().cursor();
    for await (const o of cursor) {
        const id = String(o.userId);
        let c = per.get(id);
        if (!c) { c = { id, orders: 0, cancelled: 0, spent: 0, first: null, last: null, last30: 0, types: new Map(), dishes: new Map(), dishTimes: new Map(), days: new Map(), pays: new Map(), mins: [], ratings: [] }; per.set(id, c); }
        if (o.status === 'cancelled' || o.status === 'undelivered') { c.cancelled += 1; continue; }
        if (o.status !== 'delivered') continue;
        const at = new Date(o.createdAt).getTime();
        c.orders += 1;
        c.spent += Number(o.pricing?.total) || 0;
        if (c.first === null || at < c.first) c.first = at;
        if (c.last === null || at > c.last) c.last = at;
        if (now - at <= 30 * DAY) c.last30 += 1;
        bump(c.types, o.orderType || 'delivery');
        bump(c.pays, o.payment?.method || 'cod');
        const min = minOfDay(at);
        c.mins.push(min);
        bump(c.days, new Date(at + IST_MS).getUTCDay());
        for (const l of o.items || []) {
            bump(c.dishes, l.name, l.quantity || 1);
            if (!c.dishTimes.has(l.name)) c.dishTimes.set(l.name, []);
            c.dishTimes.get(l.name).push(min);
        }
        if (o.deliveryRating?.rating) c.ratings.push(o.deliveryRating.rating);
    }
    let list = [...per.values()].filter((c) => c.orders > 0);
    const quietDays = (c) => Math.floor((now - c.last) / DAY);
    if (kind === 'repeat') list = list.filter((c) => c.orders >= 2).sort((a, b) => b.orders - a.orders || b.spent - a.spent);
    else if (kind === 'valuable') list.sort((a, b) => b.spent - a.spent);
    else if (kind === 'recent') list = list.filter((c) => quietDays(c) < 30).sort((a, b) => b.last - a.last);
    else if (kind === 'lapsed') list = list.filter((c) => quietDays(c) >= 30).sort((a, b) => b.spent - a.spent);
    else list.sort((a, b) => b.last - a.last);
    list = list.slice(0, 5000);

    const users = await User.find({ tenantId, _id: { $in: list.map((c) => c.id) } }).select('name phone email isBlocked').lean();
    const u = new Map(users.map((x) => [String(x._id), x]));

    const rows = list.map((c) => {
        const who = u.get(c.id) || {};
        const dishes = top(c.dishes, 3);
        const d1 = dishes[0];
        const dishAt = d1 ? avgOf(c.dishTimes.get(d1[0]) || []) : null;
        const usual = avgOf(c.mins);
        const type = top(c.types)[0];
        const pay = top(c.pays)[0];
        const day = top(c.days)[0];
        return {
            name: who.name || '', phone: who.phone || '', orders: c.orders, spent: Math.round(c.spent * 100) / 100, avg: Math.round((c.spent / c.orders) * 100) / 100,
            first: c.first ? new Date(c.first) : '', last: c.last ? new Date(c.last) : '', quiet: quietDays(c), last30: c.last30, cancelled: c.cancelled,
            dish1: d1 ? `${d1[0]} (${d1[1]})` : '', dishTime: dishAt != null ? clock(dishAt) : '',
            dish2: dishes[1] ? `${dishes[1][0]} (${dishes[1][1]})` : '', dish3: dishes[2] ? `${dishes[2][0]} (${dishes[2][1]})` : '',
            usualTime: usual != null ? `${clock(usual)} · ${meal(usual)}` : '', day: day ? WEEKDAY[day[0]] : '',
            type: type ? TYPE[type[0]] || type[0] : '', pay: pay ? PAY[pay[0]] || pay[0] : '',
            rating: c.ratings.length ? Math.round(avgOf(c.ratings) * 10) / 10 : '', status: who.isBlocked ? 'blocked' : (quietDays(c) >= 30 ? 'lapsed' : 'active'),
        };
    });
    const columns = [
        { header: 'Name', key: 'name' }, { header: 'Phone', key: 'phone', kind: 'center' },
        { header: 'Orders', key: 'orders', kind: 'int' }, { header: 'Total spent (Rs)', key: 'spent', kind: 'money' }, { header: 'Average order (Rs)', key: 'avg', kind: 'money' },
        { header: 'First order', key: 'first', kind: 'date' }, { header: 'Last order', key: 'last', kind: 'date' }, { header: 'Days since last order', key: 'quiet', kind: 'int' },
        { header: 'Orders in last 30 days', key: 'last30', kind: 'int' }, { header: 'Cancelled orders', key: 'cancelled', kind: 'int' },
        { header: 'Most ordered food (times)', key: 'dish1', kind: 'wide' }, { header: 'Usually orders it around', key: 'dishTime', kind: 'center' },
        { header: '2nd favourite', key: 'dish2', kind: 'wide' }, { header: '3rd favourite', key: 'dish3', kind: 'wide' },
        { header: 'Usual order time', key: 'usualTime' }, { header: 'Favourite day', key: 'day', kind: 'center' },
        { header: 'Usual order type', key: 'type', kind: 'center' }, { header: 'Usually pays by', key: 'pay', kind: 'center' },
        { header: 'Avg delivery rating given', key: 'rating', kind: 'center' }, { header: 'Status', key: 'status', kind: 'status' },
    ];
    return buildSheet({ title: KINDS[kind], columns, rows });
}

module.exports = { build, KINDS };
