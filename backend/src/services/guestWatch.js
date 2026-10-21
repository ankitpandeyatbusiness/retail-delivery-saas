// Quietly tell the owner when a guest who still owes something at an open table cannot be reached: his phone has not been heard from for a while, or his
// location is switched off. No sound, no push, no Soundbox: a note in the notification list and a small badge on the table's card, once per episode.
//   The customer's app, while it is open on his bill, says "I'm here, location on/off" about once a minute (POST /dinein/presence).
//   TableSession.presence[userId] = { at, loc, locAt }      TableSession.watch[userId] = the state the owner was last told about
// What we can and cannot know: a phone that is off, a closed app and no internet all look the same ("not reachable"), and the location state is only
// known while the app is open. A guest whose app never reported (an older app) is never flagged.
// Settings (owner): dineIn.guestWatch (on by default) and dineIn.unreachableMin (10 by default).
const TableSession = require('../models/TableSession');
const Tenant = require('../models/Tenant');
const Order = require('../models/Order');
const User = require('../models/User');
const { DEFAULTS } = require('./tenantConfigService');

const OPEN = ['open', 'bill_asked'];
const DEAD = ['cancelled', 'undelivered'];
const tell = (event, ctx) => Promise.resolve().then(() => require('../notifications/center').notify(event, ctx)).catch((e) => console.error('Notification error:', e.message));

const cfgOf = (tenant) => ({ ...DEFAULTS.orders.dineIn, ...(tenant?.settings?.orders?.dineIn || {}) });
const minutesOf = (tenant) => Math.min(60, Math.max(3, Number(cfgOf(tenant).unreachableMin) || 10));

// the guest's app says where he stands (only while he is on an open bill)
async function report({ tenantId, userId, loc }) {
    const s = await TableSession.findOne({ tenantId, customers: userId, status: { $in: OPEN }, kind: { $ne: 'pickup' } }).select('presence').lean();
    if (!s) return { ok: true, open: false };
    const now = new Date();
    const l = ['on', 'off', 'unknown'].includes(loc) ? loc : 'unknown';
    const prev = s.presence?.[String(userId)];
    await TableSession.updateOne({ _id: s._id }, { $set: { [`presence.${userId}`]: { at: now, loc: l, locAt: prev?.loc === l && prev?.locAt ? prev.locAt : now } } });
    return { ok: true, open: true };
}

// 'unreachable' | 'location_off' | null for one guest of one bill
function stateOf(session, userId, now, minutes) {
    const p = session.presence?.[String(userId)];
    if (!p?.at) return null;   // his app never reported: nothing to say
    if (now.getTime() - new Date(p.at).getTime() > minutes * 60000) return { state: 'unreachable', since: p.at };
    if (p.loc === 'off') return { state: 'location_off', since: p.locAt || p.at };
    return null;
}

// for the boards: the guests of a bill that need an eye on them
function watchOf(session, now, minutes) {
    return (session.customers || []).map((c) => ({ userId: String(c), ...(stateOf(session, c, now, minutes) || {}) })).filter((x) => x.state);
}

// every minute
async function scan(now = new Date()) {
    const sessions = await TableSession.find({ status: { $in: OPEN }, kind: { $ne: 'pickup' }, presence: { $exists: true } }).limit(400).lean();
    if (!sessions.length) return 0;
    const tenants = new Map((await Tenant.find({ _id: { $in: [...new Set(sessions.map((s) => String(s.tenantId)))] } }).select('settings.orders.dineIn').lean()).map((t) => [String(t._id), t]));
    // who still owes something on these bills
    const owing = await Order.aggregate([
        { $match: { tableSessionId: { $in: sessions.map((s) => s._id) }, status: { $nin: DEAD }, 'payment.status': { $ne: 'paid' } } },
        { $group: { _id: { s: '$tableSessionId', u: '$userId' }, amount: { $sum: '$pricing.total' } } },
    ]);
    const owes = new Map(owing.map((x) => [`${x._id.s}:${x._id.u}`, Math.round(x.amount)]));
    let sent = 0;
    for (const s of sessions) {
        const t = tenants.get(String(s.tenantId));
        if (cfgOf(t).guestWatch === false) continue;
        const minutes = minutesOf(t);
        for (const uid of s.customers) {
            const amount = owes.get(`${s._id}:${uid}`);
            const st = amount ? stateOf(s, uid, now, minutes) : null;
            const was = s.watch?.[String(uid)] || null;
            if (st && was !== st.state) {
                await TableSession.updateOne({ _id: s._id }, { $set: { [`watch.${uid}`]: st.state } });
                const me = await User.findById(uid).select('name').lean();
                tell('table_guest_alert', { tenantId: s.tenantId, vars: { name: String(me?.name || '').trim().split(/\s+/)[0] || 'A guest', table: s.table, label: s.label || '', state: st.state, amount }, data: { kind: 'table', sessionId: String(s._id), table: s.table, userId: String(uid) } });
                sent += 1;
            } else if (!st && was) {
                await TableSession.updateOne({ _id: s._id }, { $unset: { [`watch.${uid}`]: 1 } });   // he is back: the next episode tells the owner again
            }
        }
    }
    return sent;
}

module.exports = { report, scan, stateOf, watchOf, minutesOf, cfgOf };
