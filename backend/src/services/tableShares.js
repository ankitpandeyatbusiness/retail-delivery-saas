// One person's share of a table bill (shared tables, and any table where friends order separately). Everything a person ordered is already his own
// (Order.userId), so his share is exact: the total of his own unpaid rounds.
//   askLeave       the guest taps "Pay my share and leave": the waiter and the owner see a request on the table
//   settleShare    the waiter or the owner took his money (cash or UPI): his rounds are paid, he leaves the bill, the others are told what remains
//   walkoutShare   he left without paying: ONLY his share becomes an unpaid bill he owes (same reminders and block as a whole table); the others keep theirs
// The bill closes by itself when nothing is left to pay and nothing is in the kitchen. A share cannot be taken while one of his dishes is still being made.
const Order = require('../models/Order');
const TableSession = require('../models/TableSession');
const TableRequest = require('../models/TableRequest');
const User = require('../models/User');
const { HIDE_UNPAID } = require('./onlineOrder');

const OPEN = ['open', 'bill_asked'];
const DEAD = ['cancelled', 'undelivered'];
const ACTIVE = ['placed', 'accepted', 'preparing', 'ready'];
const fail = (status, message, extra) => Object.assign(new Error(message), { status, ...(extra ? { extra } : {}) });
const tell = (event, ctx) => Promise.resolve().then(() => require('../notifications/center').notify(event, ctx)).catch((e) => console.error('Notification error:', e.message));
const first = (n) => String(n || '').trim().split(/\s+/)[0] || null;
const paise = (rupees) => Math.round((rupees || 0) * 100);

// his rounds on this bill: all, still in the kitchen, and not paid yet
async function mine(session, userId) {
    const orders = await Order.find({ tenantId: session.tenantId, tableSessionId: session._id, userId, status: { $nin: DEAD }, ...HIDE_UNPAID });
    return { orders, busy: orders.some((o) => ACTIVE.includes(o.status)), unpaid: orders.filter((o) => o.payment?.status !== 'paid') };
}
async function openSession(tenantId, sessionId, userId) {
    const s = await TableSession.findOne({ _id: sessionId, tenantId, status: { $in: OPEN }, kind: { $ne: 'pickup' } });
    if (!s) throw fail(404, 'This bill is already closed');
    if (!s.customers.some((c) => String(c) === String(userId))) throw fail(404, 'This guest is not on this bill');
    return s;
}

// what is still to pay on a bill after somebody left: closes it when nothing is
async function afterLeave(session, tenantId, now) {
    const rest = await Order.find({ tenantId, tableSessionId: session._id, status: { $nin: DEAD }, ...HIDE_UNPAID }).select('status payment.status').lean();
    const due = rest.some((o) => o.payment?.status !== 'paid');
    const busy = rest.some((o) => ACTIVE.includes(o.status));
    if (!due && !busy) {
        await TableSession.updateOne({ _id: session._id, status: { $in: OPEN } }, { $set: { status: 'closed', closedAt: now, closedBy: 'owner' } });
        require('./tableBillPdf').notifyReady(session);
        return { closed: true };
    }
    return { closed: false };
}

async function remaining(tenantId, sessionId) {
    const o = await Order.find({ tenantId, tableSessionId: sessionId, status: { $nin: DEAD }, 'payment.status': { $ne: 'paid' }, ...HIDE_UNPAID }).select('pricing.total').lean();
    return Math.round(o.reduce((n, x) => n + (x.pricing?.total || 0), 0));
}

// the guest asks to pay his share and leave: a request for the waiter and the owner
async function askLeave({ tenant, userId }) {
    const s = await TableSession.findOne({ tenantId: tenant._id, customers: userId, status: { $in: OPEN }, kind: { $ne: 'pickup' } });
    if (!s) throw fail(404, 'You have no open bill');
    const { orders, busy, unpaid } = await mine(s, userId);
    if (!orders.length) throw fail(409, 'You have not ordered anything yet.');
    if (!unpaid.length) throw fail(409, 'Your share is already paid.');
    const open = await TableRequest.findOne({ tenantId: tenant._id, sessionId: s._id, userId, kind: 'share', status: 'open' }).lean();
    if (open) return { ok: true, already: true, amount: Math.round(unpaid.reduce((n, o) => n + (o.pricing?.total || 0), 0)), busy };
    const amount = Math.round(unpaid.reduce((n, o) => n + (o.pricing?.total || 0), 0));
    const me = await User.findById(userId).select('name').lean();
    await TableRequest.create({ tenantId: tenant._id, sessionId: s._id, table: s.table, userId, kind: 'share', text: `₹${amount}` });
    tell('table_share_ask', { tenantId: tenant._id, vars: { name: first(me?.name) || 'A guest', table: s.table, label: s.label || '', amount }, data: { kind: 'table', sessionId: String(s._id), table: s.table, userId: String(userId) } });
    require('./waiterAlerts').request(tenant._id, { table: s.table, label: 'Wants to pay and leave', text: `${first(me?.name) || ''} ₹${amount}`.trim(), party: s.label });
    return { ok: true, amount, busy };
}

// the money for one person was taken
async function settleShare({ tenantId, sessionId, userId, method, by }) {
    if (!['cash', 'upi'].includes(method)) throw fail(400, 'Choose cash or UPI');
    const s = await openSession(tenantId, sessionId, userId);
    const { busy, unpaid } = await mine(s, userId);
    if (busy) throw fail(409, 'Some of his dishes are still in the kitchen. Serve or cancel them first.');
    const now = new Date();
    const paidPaise = paise(unpaid.reduce((n, o) => n + (o.pricing?.total || 0), 0));
    if (unpaid.length) await Order.updateMany({ _id: { $in: unpaid.map((o) => o._id) } }, { $set: { 'payment.status': 'paid', 'payment.paidAt': now, 'payment.settledAt': now, 'payment.settledVia': method, 'payment.paidBy': userId } });
    const loyalty = require('./loyaltyService');
    for (const o of unpaid) loyalty.onDelivered({ ...o.toObject(), payment: { ...(o.payment?.toObject ? o.payment.toObject() : o.payment), status: 'paid' }, deliveredAt: now }).catch((e) => console.error('Points error:', e.message));
    return finishLeave({ s, tenantId, userId, paidPaise, via: method, by: by?.type === 'staff' ? 'staff' : 'owner', byName: by?.name, now });
}

// his rounds are paid (by the waiter, or online by himself): he leaves the bill, the others are told what remains
async function finishLeave({ s, tenantId, userId, paidPaise, via, by, byName, now }) {
    await TableSession.updateOne({ _id: s._id }, { $pull: { customers: userId }, $inc: { paidPaise }, $push: { left: { userId, at: now, paidPaise, via, by } } });
    await TableRequest.updateMany({ tenantId, sessionId: s._id, userId, kind: 'share', status: 'open' }, { $set: { status: 'done', doneAt: now, doneBy: by === 'online' ? 'auto' : by, ...(byName ? { doneByName: byName } : {}) } });
    const end = await afterLeave(s, tenantId, now);
    if (end.closed) tell('table_closed_owner', { tenantId, vars: { table: s.table, label: s.label || '' }, data: { kind: 'table', sessionId: String(s._id), table: s.table } });
    const me = await User.findById(userId).select('name').lean();
    const left = end.closed ? 0 : await remaining(tenantId, s._id);
    tell('table_paid', { tenantId, userId, vars: { table: s.table, total: paidPaise / 100 }, data: { kind: 'table_paid', sessionId: String(s._id) } });
    for (const uid of s.customers.filter((c) => String(c) !== String(userId))) {
        tell('table_share_paid', { tenantId, userId: uid, vars: { name: first(me?.name) || 'Your friend', amount: Math.round(paidPaise / 100), left, table: s.table }, data: { kind: 'table', sessionId: String(s._id) } });
    }
    return { ok: true, paidPaise, closed: end.closed, left };
}

// he left without paying: only his share becomes a bill he owes
async function walkoutShare({ tenantId, sessionId, userId }) {
    const s = await openSession(tenantId, sessionId, userId);
    const { busy, unpaid } = await mine(s, userId);
    if (busy) throw fail(409, 'Some of his dishes are still in the kitchen. Serve or cancel them first.');
    const owed = paise(unpaid.reduce((n, o) => n + (o.pricing?.total || 0), 0));
    if (owed <= 0) throw fail(409, 'He has nothing to pay.');
    const now = new Date();
    // his unpaid rounds move to a bill of their own (closed, owed): reminders, the block on new orders and paying it later all work as for a whole table
    const debt = await TableSession.create({
        tenantId, table: `${s.table}${s.label ? ` · ${s.label}` : ''}`, kind: 'table', status: 'closed', customers: [userId], openedAt: s.openedAt, closedAt: now, closedBy: 'owner',
        walkout: true, owedPaise: owed, label: s.label,
    });
    await Order.updateMany({ _id: { $in: unpaid.map((o) => o._id) } }, { $set: { tableSessionId: debt._id } });
    await TableSession.updateOne({ _id: s._id }, { $pull: { customers: userId }, $push: { left: { userId, at: now, paidPaise: 0, via: 'walkout', by: 'owner' } } });
    await TableRequest.updateMany({ tenantId, sessionId: s._id, userId, kind: 'share', status: 'open' }, { $set: { status: 'done', doneAt: now, doneBy: 'owner' } });
    await require('./customerRisk').addStrike(unpaid[unpaid.length - 1]).catch((e) => console.error('Strike error:', e.message));
    const end = await afterLeave(s, tenantId, now);
    const me = await User.findById(userId).select('name').lean();
    const left = end.closed ? 0 : await remaining(tenantId, s._id);
    tell('table_walkout', { tenantId, userId, vars: { table: debt.table, amount: Math.round(owed / 100) }, data: { kind: 'table_owed', sessionId: String(debt._id) } });
    for (const uid of s.customers.filter((c) => String(c) !== String(userId))) {
        tell('table_share_left', { tenantId, userId: uid, vars: { name: first(me?.name) || 'Your friend', left, table: s.table }, data: { kind: 'table', sessionId: String(s._id) } });
    }
    return { ok: true, owedPaise: owed, closed: end.closed, left };
}

module.exports = { askLeave, settleShare, walkoutShare, finishLeave, mine };
