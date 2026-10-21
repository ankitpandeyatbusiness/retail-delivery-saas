// Shared tables: several separate bills ("parties" A, B, C...) on one table, for a small restaurant where strangers sit together.
// The owner switches it on (dineIn.sharedTables, off by default) and sets the most bills one table may have (dineIn.maxParties, 4 by default).
//
//   TableSession.party  1, 2, 3...   the number of the bill at this table (label A, B, C...). One open session per table AND party.
//   A guest who scans a table that somebody else is sitting at chooses:
//     separate   his own bill, at once (while the table has fewer bills than the limit)
//     with       he asks to join the person already seated: that person says yes or no in the app. No answer in 2 minutes: he is offered a
//                separate bill. (The waiter takes no part in it.)
//   A guest who already has a bill at the table keeps it. Nobody is ever on two bills of one table.
// With the switch OFF nothing here is used: a table has one bill, as before.
const TableSession = require('../models/TableSession');
const TableJoin = require('../models/TableJoin');
const User = require('../models/User');
const { DEFAULTS } = require('./tenantConfigService');

const OPEN = ['open', 'bill_asked'];
const LABELS = 'ABCDEFGH';
const JOIN_WAIT_MS = 2 * 60000;
const fail = (status, message, extra) => Object.assign(new Error(message), { status, ...(extra ? { extra } : {}) });   // extra is sent to the app with the message
const tell = (event, ctx) => Promise.resolve().then(() => require('../notifications/center').notify(event, ctx)).catch((e) => console.error('Notification error:', e.message));

const cfgOf = (tenant) => ({ ...DEFAULTS.orders.dineIn, ...(tenant?.settings?.orders?.dineIn || {}) });
const isShared = (tenant) => cfgOf(tenant).sharedTables === true;
const maxParties = (tenant) => Math.min(8, Math.max(2, Number(cfgOf(tenant).maxParties) || 4));
// switched off, a table still has ONE bill, but a stranger must be let in by the person already seated (he is never added silently)
const maxFor = (tenant) => (isShared(tenant) ? maxParties(tenant) : 1);
const labelOf = (party) => LABELS[(party || 1) - 1] || String(party || 1);

const firstName = (u) => String(u?.name || '').trim().split(/\s+/)[0] || null;

// the open bills at one table, with the first name of whoever opened each (never a phone number)
async function partiesAt(tenantId, table, { forUser } = {}) {
    const rows = await TableSession.find({ tenantId, table, status: { $in: OPEN }, kind: { $ne: 'pickup' } }).sort({ party: 1 }).lean();
    const first = await User.find({ _id: { $in: rows.map((r) => r.customers[0]).filter(Boolean) } }).select('name').lean();
    const nameOf = new Map(first.map((u) => [String(u._id), firstName(u)]));
    return rows.map((r) => ({
        sessionId: String(r._id), party: r.party || 1, label: r.label || labelOf(r.party || 1), who: nameOf.get(String(r.customers[0])) || null,
        guests: r.customers.length, status: r.status, mine: !!forUser && r.customers.some((c) => String(c) === String(forUser)),
    }));
}

// what the app needs when a table is scanned: is the table shared, who is there, what can this guest do
async function stateAt({ tenant, userId, table }) {
    const parties = await partiesAt(tenant._id, table, { forUser: userId });
    const mine = parties.find((p) => p.mine) || null;
    const max = maxFor(tenant);
    const pending = await TableJoin.findOne({ tenantId: tenant._id, table, userId, status: 'pending', expiresAt: { $gt: new Date() } }).lean();
    return {
        shared: isShared(tenant), table, max, parties, mine: mine ? { sessionId: mine.sessionId, label: mine.label } : null,
        occupied: parties.length > 0, canSeparate: parties.length < max, pending: pending ? { joinId: String(pending._id), expiresAt: pending.expiresAt, sessionId: String(pending.sessionId) } : null,
    };
}

// the next free bill number at this table (1, 2, 3...), or null when the table is full
async function nextParty(tenant, table) {
    const taken = new Set((await TableSession.find({ tenantId: tenant._id, table, status: { $in: OPEN }, kind: { $ne: 'pickup' } }).select('party').lean()).map((r) => r.party || 1));
    for (let p = 1; p <= maxFor(tenant); p += 1) if (!taken.has(p)) return p;
    return null;
}

async function openParty({ tenant, table, userId, now = new Date() }) {
    for (let tries = 0; tries < 4; tries += 1) {
        const party = await nextParty(tenant, table);
        if (!party) throw fail(409, `This table already has ${maxFor(tenant)} bill${maxFor(tenant) === 1 ? '' : 's'}. Please ask the waiter.`, { code: 'table_full' });
        try {
            return await TableSession.create({ tenantId: tenant._id, table, party, label: labelOf(party), customers: [userId], openedAt: now, lastOrderAt: now });
        } catch (e) {
            if (e.code !== 11000) throw e;   // somebody took that number a moment ago: try the next one
        }
    }
    throw fail(409, 'This table is busy. Please try again.', { code: 'table_busy' });
}

// the guest's choice: { choice: 'separate' | 'with', sessionId? }
async function enter({ tenant, userId, table, choice, sessionId }) {
    const mine = await TableSession.findOne({ tenantId: tenant._id, table, customers: userId, status: { $in: OPEN } });
    if (mine) return { ok: true, session: { sessionId: String(mine._id), label: mine.label || labelOf(mine.party) } };
    // a bill of his at ANOTHER table must be paid first (the same rule as ordering)
    const elsewhere = await TableSession.findOne({ tenantId: tenant._id, customers: userId, status: { $in: OPEN }, table: { $ne: table } }).select('table').lean();
    if (elsewhere) throw fail(409, `You still have an open bill at table ${elsewhere.table}. Please pay it before choosing another table.`, { code: 'bill_elsewhere' });

    if (choice === 'separate') {
        if (!isShared(tenant)) throw fail(400, 'This shop has one bill per table. Please ask to join the people already here.');
        const s = await openParty({ tenant, table, userId });
        return { ok: true, session: { sessionId: String(s._id), label: s.label } };
    }
    if (choice !== 'with') throw fail(400, 'Choose a separate bill, or to join the people already here');
    const target = await TableSession.findOne({ _id: sessionId, tenantId: tenant._id, table, status: { $in: OPEN }, kind: { $ne: 'pickup' } });
    if (!target) throw fail(404, 'That bill is no longer open. Choose again.', { code: 'gone' });
    const old = await TableJoin.findOne({ tenantId: tenant._id, table, userId, status: 'pending', expiresAt: { $gt: new Date() } });
    if (old) return { ok: true, pending: { joinId: String(old._id), expiresAt: old.expiresAt } };
    const j = await TableJoin.create({ tenantId: tenant._id, table, sessionId: target._id, userId, expiresAt: new Date(Date.now() + JOIN_WAIT_MS) });
    const me = await User.findById(userId).select('name').lean();
    for (const uid of target.customers) {
        tell('table_join_request', {
            tenantId: tenant._id, userId: uid, vars: { name: firstName(me) || 'Someone', table },
            data: { kind: 'table_join', joinId: String(j._id), table, sessionId: String(target._id) },
        });
    }
    return { ok: true, pending: { joinId: String(j._id), expiresAt: j.expiresAt } };
}

// the newcomer asks how it went (it turns to "expired" by itself after 2 minutes)
async function joinStatus({ tenant, userId, joinId }) {
    const j = await TableJoin.findOne({ _id: joinId, tenantId: tenant._id, userId });
    if (!j) throw fail(404, 'Not found');
    if (j.status === 'pending' && j.expiresAt.getTime() <= Date.now()) {
        await TableJoin.updateOne({ _id: j._id, status: 'pending' }, { $set: { status: 'expired' } });
        j.status = 'expired';
    }
    const out = { status: j.status };
    if (j.status === 'approved') {
        const s = await TableSession.findOne({ _id: j.sessionId, tenantId: tenant._id, customers: userId, status: { $in: OPEN } });
        if (s) out.session = { sessionId: String(s._id), label: s.label || labelOf(s.party) };
    }
    return out;
}

// the pending requests for the bills this guest belongs to (his app shows "Asha wants to join your table")
async function pendingFor({ tenant, userId }) {
    const sessions = await TableSession.find({ tenantId: tenant._id, customers: userId, status: { $in: OPEN } }).select('_id table').lean();
    if (!sessions.length) return [];
    const rows = await TableJoin.find({ tenantId: tenant._id, sessionId: { $in: sessions.map((s) => s._id) }, status: 'pending', expiresAt: { $gt: new Date() } }).sort({ createdAt: 1 }).lean();
    const people = await User.find({ _id: { $in: rows.map((r) => r.userId) } }).select('name').lean();
    const nameOf = new Map(people.map((u) => [String(u._id), firstName(u)]));
    return rows.map((r) => ({ joinId: String(r._id), table: r.table, who: nameOf.get(String(r.userId)) || null, expiresAt: r.expiresAt }));
}

// a member of the bill says yes or no
async function answerJoin({ tenant, userId, joinId, approve }) {
    if (typeof approve !== 'boolean') throw fail(400, 'Send approve: true or false');
    const j = await TableJoin.findOne({ _id: joinId, tenantId: tenant._id });
    if (!j) throw fail(404, 'Not found');
    const s = await TableSession.findOne({ _id: j.sessionId, tenantId: tenant._id, status: { $in: OPEN }, customers: userId });
    if (!s) throw fail(403, 'This is not your table');
    if (j.status !== 'pending' || j.expiresAt.getTime() <= Date.now()) throw fail(409, 'This request is already answered or has run out.');
    const claimed = await TableJoin.findOneAndUpdate({ _id: j._id, status: 'pending' }, { $set: { status: approve ? 'approved' : 'denied', answeredBy: userId, answeredAt: new Date() } }, { returnDocument: 'after' });
    if (!claimed) throw fail(409, 'This request is already answered.');
    if (approve) {
        // he cannot be on two bills of one table: if he took a bill of his own meanwhile, nothing is added
        const other = await TableSession.exists({ tenantId: tenant._id, table: s.table, customers: j.userId, status: { $in: OPEN }, _id: { $ne: s._id } });
        if (!other) await TableSession.updateOne({ _id: s._id }, { $addToSet: { customers: j.userId } });
    }
    tell('table_join_answer', { tenantId: tenant._id, userId: j.userId, vars: { approved: approve, table: s.table }, data: { kind: 'table_join', joinId: String(j._id), approved: approve, table: s.table } });
    return { ok: true, approved: approve };
}

// the other open bills at the same table (for the waiter's and the owner's bill screens): { sessionId, label, who }
async function siblingsOf(session) {
    const rows = await TableSession.find({ tenantId: session.tenantId, table: session.table, status: { $in: OPEN }, kind: { $ne: 'pickup' }, _id: { $ne: session._id } }).sort({ party: 1 }).lean();
    if (!rows.length) return [];
    const first = await User.find({ _id: { $in: rows.map((r) => r.customers[0]).filter(Boolean) } }).select('name').lean();
    const nameOf = new Map(first.map((u) => [String(u._id), firstName(u)]));
    return rows.map((r) => ({ sessionId: String(r._id), label: r.label || labelOf(r.party || 1), who: nameOf.get(String(r.customers[0])) || null }));
}

const DEAD = ['cancelled', 'undelivered'];
// One round was put on the wrong bill: move it to another bill of the SAME table. Money is not touched (an online-paid round stays paid).
async function moveOrder({ tenant, orderId, toSessionId }) {
    const Order = require('../models/Order');
    const o = await Order.findOne({ _id: orderId, tenantId: tenant._id, orderType: 'dine_in' });
    if (!o || !o.tableSessionId) throw fail(404, 'Order not found');
    if (DEAD.includes(o.status)) throw fail(409, 'This round is cancelled.');
    if (String(o.tableSessionId) === String(toSessionId)) throw fail(400, 'It is already on that bill.');
    const [from, to] = await Promise.all([
        TableSession.findOne({ _id: o.tableSessionId, tenantId: tenant._id, status: { $in: OPEN } }),
        TableSession.findOne({ _id: toSessionId, tenantId: tenant._id, status: { $in: OPEN }, kind: { $ne: 'pickup' } }),
    ]);
    if (!from || !to) throw fail(409, 'One of the bills is already closed.');
    if (from.table !== to.table) throw fail(400, 'A round can only move to another bill of the same table.');
    await Order.updateOne({ _id: o._id }, { $set: { tableSessionId: to._id, tableParty: to.label || labelOf(to.party || 1) } });
    await TableSession.updateOne({ _id: to._id }, { $set: { lastOrderAt: new Date(), status: 'open' }, $unset: { billAskedAt: 1 }, $addToSet: { customers: o.userId } });
    // the first bill may have nothing left: it closes by itself
    await require('./tableBill').closeEmpty(tenant._id, from._id).catch(() => { });
    realtimeTell(tenant, o, to);
    return { ok: true, to: { sessionId: String(to._id), label: to.label || labelOf(to.party || 1) } };
}

// Two bills turned out to be one group: everything of the first goes onto the second, the first closes. Nothing is paid or lost.
async function merge({ tenant, fromId, intoId }) {
    const Order = require('../models/Order');
    const TableRequest = require('../models/TableRequest');
    if (String(fromId) === String(intoId)) throw fail(400, 'Choose another bill.');
    const [from, into] = await Promise.all([
        TableSession.findOne({ _id: fromId, tenantId: tenant._id, status: { $in: OPEN }, kind: { $ne: 'pickup' } }),
        TableSession.findOne({ _id: intoId, tenantId: tenant._id, status: { $in: OPEN }, kind: { $ne: 'pickup' } }),
    ]);
    if (!from || !into) throw fail(409, 'One of the bills is already closed.');
    if (from.table !== into.table) throw fail(400, 'Only bills of the same table can be merged.');
    const label = into.label || labelOf(into.party || 1);
    await Order.updateMany({ tenantId: tenant._id, tableSessionId: from._id }, { $set: { tableSessionId: into._id, tableParty: label } });
    await TableRequest.updateMany({ tenantId: tenant._id, sessionId: from._id, status: 'open' }, { $set: { sessionId: into._id } });
    await TableJoin.updateMany({ tenantId: tenant._id, sessionId: from._id, status: 'pending' }, { $set: { status: 'expired' } });
    await TableSession.updateOne({ _id: into._id }, { $addToSet: { customers: { $each: from.customers } }, $set: { lastOrderAt: new Date(), status: 'open' }, $unset: { billAskedAt: 1 } });
    await TableSession.updateOne({ _id: from._id }, { $set: { status: 'closed', closedAt: new Date(), closedBy: 'owner', mergedInto: into._id } });
    for (const uid of from.customers) tell('table_join_answer', { tenantId: tenant._id, userId: uid, vars: { approved: true, table: from.table }, data: { kind: 'table_join', approved: true, table: from.table } });
    realtimeTell(tenant, { tableNo: from.table, _id: null }, into);
    return { ok: true, into: { sessionId: String(into._id), label } };
}

// the waiters' and the kitchen's screens load again
function realtimeTell(tenant, o, session) {
    try {
        require('./waiterAlerts').tell(tenant._id, { table: session.table, orderId: o._id ? String(o._id) : undefined });
        require('./kitchenAlerts').tell(tenant._id, { table: session.table, orderId: o._id ? String(o._id) : undefined });
    } catch (e) { /* the screens refresh by themselves */ }
}

module.exports = { siblingsOf, moveOrder, merge, isShared, maxParties, labelOf, partiesAt, stateAt, nextParty, openParty, enter, joinStatus, pendingFor, answerJoin, OPEN };
