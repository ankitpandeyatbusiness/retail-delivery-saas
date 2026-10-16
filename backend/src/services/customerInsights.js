// Who are this shop's customers? A profile for each, worked out from his delivered orders (last 180 days):
// how often he orders, when he usually orders, what he likes, and a tag that says where he stands.
//
//   new       first order in the last 14 days
//   regular   2 or more orders and still coming
//   loyal     5 or more orders and still coming
//   vip       10 or more orders (kept as a flag; the tag shows slipping/lost first when he has gone quiet)
//   slipping  he has gone quiet for longer than his usual gap (the best people to remind)
//   lost      quiet for much longer (60+ days, or 4 times his usual gap)
// Everything is worked out when asked (a shop's orders are few); nothing is stored.
const mongoose = require('mongoose');
const Order = require('../models/Order');
const User = require('../models/User');
const DeviceToken = require('../models/DeviceToken');
const NudgeLog = require('../models/NudgeLog');

const DAY = 86400000;
const IST = 330 * 60000;
const WINDOW_DAYS = 180;
const TAGS = ['new', 'regular', 'loyal', 'vip', 'slipping', 'lost'];

const istHour = (d) => new Date(new Date(d).getTime() + IST).getUTCHours();
const istDay = (d) => new Date(new Date(d).getTime() + IST).getUTCDay();
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hourLabel = (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
// parts of the day, for "what he orders at lunch"
const slotOf = (h) => (h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 19 ? 'snacks' : 'dinner');
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const mode = (a) => { const m = new Map(); a.forEach((x) => m.set(x, (m.get(x) || 0) + 1)); let best = null; let n = 0; m.forEach((c, k) => { if (c > n) { best = k; n = c; } }); return best === null ? null : { value: best, count: n }; };
const top = (counts, n) => [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, qty]) => ({ name, quantity: qty }));

function tagFor({ orders, daysSince, gapDays }) {
    if (orders <= 1) return daysSince <= 14 ? 'new' : daysSince <= 60 ? 'slipping' : 'lost';
    const gap = Math.max(3, gapDays);
    if (daysSince > Math.max(60, gap * 4)) return 'lost';
    if (daysSince > Math.max(21, gap * 2.5)) return 'slipping';
    if (orders >= 10) return 'vip';
    if (orders >= 5) return 'loyal';
    return 'regular';
}

// profiles for every customer who has ordered. Returns Map(userId string -> profile)
async function build({ tenantId, now = new Date() }) {
    const since = new Date(now.getTime() - WINDOW_DAYS * DAY);
    const rows = await Order.find({ tenantId: new mongoose.Types.ObjectId(String(tenantId)), status: 'delivered', createdAt: { $gte: since } })
        .select('userId createdAt items.name items.quantity pricing.total').sort({ createdAt: 1 }).limit(50000).lean();

    const by = new Map();
    for (const o of rows) {
        const k = String(o.userId);
        if (!by.has(k)) by.set(k, []);
        by.get(k).push(o);
    }

    const out = new Map();
    for (const [uid, list] of by) {
        const times = list.map((o) => new Date(o.createdAt).getTime());
        const last = times[times.length - 1];
        const gaps = times.slice(1).map((t, i) => (t - times[i]) / DAY);
        const gapDays = gaps.length ? median(gaps) : 0;
        const daysSince = Math.floor((now.getTime() - last) / DAY);
        const hours = list.map((o) => istHour(o.createdAt));
        const days = list.map((o) => istDay(o.createdAt));
        const all = new Map();
        const slots = { breakfast: new Map(), lunch: new Map(), snacks: new Map(), dinner: new Map() };
        for (const o of list) {
            const slot = slots[slotOf(istHour(o.createdAt))];
            for (const it of o.items || []) {
                all.set(it.name, (all.get(it.name) || 0) + (it.quantity || 1));
                slot.set(it.name, (slot.get(it.name) || 0) + (it.quantity || 1));
            }
        }
        const hr = mode(hours);
        const dy = mode(days);
        const orders = list.length;
        const tag = tagFor({ orders, daysSince, gapDays });
        out.set(uid, {
            userId: uid,
            orders,
            spent: Math.round(list.reduce((s, o) => s + (o.pricing?.total || 0), 0)),
            firstOrderAt: new Date(times[0]),
            lastOrderAt: new Date(last),
            daysSince,
            gapDays: Math.round(gapDays * 10) / 10,
            tag,
            vip: orders >= 10,
            usualHour: hr ? hr.value : null,
            usualHourLabel: hr ? hourLabel(hr.value) : null,
            usualDay: dy && orders >= 3 && dy.count / orders >= 0.4 ? WEEKDAYS[dy.value] : null,
            favourites: top(all, 3),
            favouriteBySlot: Object.fromEntries(Object.entries(slots).map(([s, m]) => [s, top(m, 1)[0]?.name || null])),
        });
    }
    return out;
}

// the customers a shop can talk to, with names, ready for a list. tag = filter (or 'all').
async function list({ tenantId, tag, q, page = 1, limit = 20, now = new Date() }) {
    const profiles = await build({ tenantId, now });
    const ids = [...profiles.keys()];
    const users = await User.find({ _id: { $in: ids }, tenantId, role: 'customer' }).select('name phone isBlocked prefs').lean();
    const have = new Set((await DeviceToken.distinct('userId', { tenantId, userId: { $in: users.map((u) => u._id) } })).map(String));
    const weekAgo = new Date(now.getTime() - 7 * DAY);
    const recent = await NudgeLog.aggregate([
        { $match: { tenantId: new mongoose.Types.ObjectId(String(tenantId)), createdAt: { $gte: weekAgo } } },
        { $group: { _id: '$userId', n: { $sum: 1 }, last: { $max: '$createdAt' } } },
    ]);
    const nudged = new Map(recent.map((r) => [String(r._id), r]));

    const needle = typeof q === 'string' ? q.trim().toLowerCase() : '';
    let rows = users.map((u) => {
        const p = profiles.get(String(u._id));
        const reach = reachability(u, have.has(String(u._id)));
        return {
            ...p, id: String(u._id), name: u.name || '', phone: u.phone || '',
            reachable: reach.ok, reachNote: reach.note,
            nudgedThisWeek: nudged.get(String(u._id))?.n || 0, lastNudgeAt: nudged.get(String(u._id))?.last || null,
        };
    });
    const counts = Object.fromEntries(TAGS.map((t) => [t, rows.filter((r) => r.tag === t || (t === 'vip' && r.vip)).length]));
    if (tag && tag !== 'all') rows = rows.filter((r) => r.tag === tag || (tag === 'vip' && r.vip));
    if (needle) rows = rows.filter((r) => r.name.toLowerCase().includes(needle) || r.phone.includes(needle));
    // the people worth a message first: the ones nearest to being lost, then the best customers
    rows.sort((a, b) => b.spent - a.spent);
    const start = (page - 1) * limit;
    return { counts, total: rows.length, items: rows.slice(start, start + limit), page, hasMore: rows.length > start + limit };
}

// can this customer be reached by push or the in-app inbox? (He always gets the inbox row; push needs a phone that signed in.)
function reachability(user, hasDevice) {
    if (user.isBlocked) return { ok: false, note: 'This customer is blocked' };
    if (user.prefs?.promotions === false) return { ok: false, note: 'He turned off offers' };
    return { ok: true, note: hasDevice ? 'Will get a notification' : 'Will see it in the app (no notification phone yet)' };
}

async function one({ tenantId, userId, now = new Date() }) {
    const profiles = await build({ tenantId, now });
    const p = profiles.get(String(userId));
    const u = await User.findOne({ _id: userId, tenantId, role: 'customer' }).select('name phone isBlocked prefs').lean();
    if (!u) return null;
    const device = await DeviceToken.exists({ tenantId, userId });
    const logs = await NudgeLog.find({ tenantId, userId }).sort({ createdAt: -1 }).limit(10).select('kind by title createdAt').lean();
    const reach = reachability(u, !!device);
    return { ...(p || { userId: String(userId), orders: 0, tag: 'new', favourites: [], favouriteBySlot: {}, vip: false, spent: 0 }), id: String(u._id), name: u.name || '', phone: u.phone || '', reachable: reach.ok, reachNote: reach.note, nudges: logs };
}

module.exports = { build, list, one, reachability, slotOf, istHour, hourLabel, TAGS };
