// The table bill: a visit at a table is ONE bill, however many times people order. Each order is a "round" that goes to the kitchen at once
// (Order.tableSessionId), and nobody pays until they are done: they ask for the bill, and the owner settles it at the counter.
// Rounds that were paid online when they were ordered stay paid; only what is not paid is on the bill.
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Tenant = require('../models/Tenant');
const TableSession = require('../models/TableSession');
const { brief } = require('../utils/orderBrief');
const User = require('../models/User');
const Media = require('../models/Media');
const TableRequest = require('../models/TableRequest');
const TableFeedback = require('../models/TableFeedback');
const { DEFAULTS } = require('./tenantConfigService');
const { HIDE_UNPAID } = require('./onlineOrder');   // an online round whose payment has not come in is not on the bill yet

// who these people are, with their profile photo
async function peopleOf(tenantId, ids) {
    const [users, media] = await Promise.all([
        User.find({ _id: { $in: ids } }).select('name phone').lean(),
        Media.find({ tenantId, kind: 'customer', refId: { $in: ids.map(String) } }).select('refId url').lean(),
    ]);
    const photo = new Map(media.map((m) => [String(m.refId), m.url]));
    return new Map(users.map((u) => [String(u._id), { id: String(u._id), name: u.name || null, phone: u.phone || null, photo: photo.get(String(u._id)) || null }]));
}

// the timings and counts the super admin sets for this shop (orders.limits)
const limitsFor = async (tenantId) => ({ ...DEFAULTS.orders.limits, ...((await Tenant.findById(tenantId).select('settings.orders.limits').lean())?.settings?.orders?.limits || {}) });
const cfgOf = (tenant) => ({ ...DEFAULTS.orders.dineIn, ...(tenant?.settings?.orders?.dineIn || {}) });

const ACTIVE = ['placed', 'accepted', 'preparing', 'ready'];   // still in the kitchen or on its way to the table
const DEAD = ['cancelled', 'undelivered'];
const fail = (status, message, extra) => Object.assign(new Error(message), { status, ...(extra ? { extra } : {}) });
const tell = (event, ctx) => Promise.resolve().then(() => require('../notifications/center').notify(event, ctx)).catch((e) => console.error('Notification error:', e.message));

// An order is being placed at a table: he keeps the bill he is on, or opens one. A guest who finds the table taken must first ask the people there
// (or, when the shop allows several bills per table, take his own): see services/sharedTables.js
async function joinOrOpen({ tenantId, table, userId, now = new Date() }) {
    const tenantDoc = await Tenant.findById(tenantId).select('settings.orders.dineIn').lean();
    const mine = await TableSession.findOneAndUpdate({ tenantId, table, customers: userId, status: { $in: ['open', 'bill_asked'] } }, { $set: { status: 'open', lastOrderAt: now }, $unset: { billAskedAt: 1 } }, { returnDocument: 'after' });
    if (mine) return mine;
    if (await TableSession.exists({ tenantId, table, status: { $in: ['open', 'bill_asked'] }, kind: { $ne: 'pickup' } })) throw fail(409, 'Someone is already at this table. Choose your own bill, or join them.', { code: 'choose_party' });
    return require('./sharedTables').openParty({ tenant: tenantDoc && { _id: tenantId, ...tenantDoc }, table, userId, now });
}

// the bill of one visit
// when each step of an order happened (from its history)
function timesOf(o) {
    const at = (st) => { const h = [...(o.statusHistory || [])].reverse().find((x) => x.status === st); return h?.at || null; };
    return { placed: o.createdAt, accepted: at('accepted'), ready: at('ready'), served: o.deliveredAt || at('delivered') };
}

// owner = true adds who ordered each round (the customer's own app never gets another person's number)
async function billOf(session, { owner = false } = {}) {
    const orders = await Order.find({ tenantId: session.tenantId, tableSessionId: session._id, ...HIDE_UNPAID }).sort({ createdAt: 1 }).lean();
    const lite = (await Tenant.findById(session.tenantId).select('settings.orders.dineIn.cancelGraceMin settings.orders.staff settings.orders.prepTimeMin status maintenance ownerBlocked').lean()) || {};
    const asks = require('./customerAsks');
    const mine = require('./orderflow');
    const q = owner ? new Map() : await require('./queueInfo').forOrders(lite, orders.filter((o) => ['accepted', 'preparing', 'ready'].includes(o.status)));
    const rounds = orders.filter((o) => !DEAD.includes(o.status)).map((o) => ({
        id: String(o._id), orderNo: o.orderNo, status: o.status, at: o.createdAt, total: o.pricing?.total || 0, paid: o.payment?.status === 'paid',
        canCancel: mine.customerCanCancel(o, lite), canAsk: asks.canAskCancel(o, lite), asked: !!o.cancelRequest?.at,   // the guest may cancel it himself / ask the shop / has asked
        items: (o.items || []).map((l) => ({ name: l.name, image: l.image || null, isVeg: l.isVeg ?? null, quantity: l.quantity, total: l.lineTotal, addons: (l.selections || []).map((x) => x.name).filter(Boolean), note: l.note || null })), summary: brief(o, 3),
        note: o.note || null, times: timesOf(o), queue: q.get(String(o._id)) || null,
        ...(owner ? { customer: { name: o.customer?.name || null, phone: o.customer?.phone || null } } : {}),
    }));
    const total = rounds.reduce((n, r) => n + r.total, 0);
    const due = rounds.filter((r) => !r.paid).reduce((n, r) => n + r.total, 0);
    const people = owner ? await peopleOf(session.tenantId, session.customers) : null;
    const tip = Math.round((session.tipPaise || 0)) / 100;
    const byPerson = new Map();
    for (const o of orders.filter((x) => !DEAD.includes(x.status))) {
        const k = String(o.userId);
        const cur = byPerson.get(k) || { userId: k, name: o.customer?.name || null, total: 0, due: 0 };
        cur.total += o.pricing?.total || 0;
        if (o.payment?.status !== 'paid') cur.due += o.pricing?.total || 0;
        byPerson.set(k, cur);
    }
    return {
        tip, payable: Math.round((due + tip) * 100) / 100,
        shares: [...byPerson.values()].map((x) => ({ ...x, total: Math.round(x.total * 100) / 100, due: Math.round(x.due * 100) / 100 })),   // for "split the bill": who ordered how much

        ...(owner ? { guests: session.customers.map((c) => people.get(String(c))).filter(Boolean) } : {}),
        id: String(session._id), table: session.table, party: session.party || 1, label: session.label || null, status: session.status, openedAt: session.openedAt, billAskedAt: session.billAskedAt || null, closedAt: session.closedAt || null,
        rounds, total: Math.round(total * 100) / 100, due: Math.round(due * 100) / 100, kitchenBusy: rounds.some((r) => ACTIVE.includes(r.status)),
        paidVia: session.paidVia || null, nudgeAt: session.lastNudgeAt || null,   // when he last pressed "please hurry"
    };
}

// the open visit this customer belongs to (null if none)
async function openFor(tenantId, userId) {
    return TableSession.findOne({ tenantId, customers: userId, status: { $in: ['open', 'bill_asked'] } }).sort({ lastOrderAt: -1 });
}

// "Ask for the bill": the owner is told. Asking again changes nothing.
async function askForBill({ tenantId, userId }) {
    const s = await openFor(tenantId, userId);
    if (!s) throw fail(404, 'You have no open bill');
    const claimed = await TableSession.findOneAndUpdate({ _id: s._id, status: 'open' }, { $set: { status: 'bill_asked', billAskedAt: new Date() } }, { returnDocument: 'after' });
    const bill = await billOf(claimed || s);
    if (claimed) require('./waiterAlerts').request(tenantId, { table: s.table, label: 'Wants the bill', bill: true });
    if (claimed) tell('table_bill_asked', { tenantId, vars: { table: s.table, due: bill.due, total: bill.total }, data: { kind: 'table', sessionId: String(s._id), table: s.table } });
    return bill;
}

// The owner took the money (cash, or UPI at the counter). Everything unpaid on the bill is paid and the visit is over.
async function settle({ tenantId, sessionId, method, by }) {
    const s = await TableSession.findOne({ _id: sessionId, tenantId, status: { $in: ['open', 'bill_asked'] } });
    if (!s) throw fail(404, 'This bill is already closed');
    const orders = await Order.find({ tenantId, tableSessionId: s._id, status: { $nin: DEAD }, ...HIDE_UNPAID });
    if (orders.some((o) => ACTIVE.includes(o.status))) throw fail(409, 'Some dishes are still in the kitchen. Serve or cancel them first.');
    const now = new Date();
    const unpaid = orders.filter((o) => o.payment?.status !== 'paid');
    const paidPaise = Math.round(unpaid.reduce((n, o) => n + (o.pricing?.total || 0), 0) * 100);
    if (unpaid.length) {
        await Order.updateMany({ _id: { $in: unpaid.map((o) => o._id) } }, { $set: { 'payment.status': 'paid', 'payment.paidAt': now, 'payment.settledAt': now, 'payment.settledVia': method } });
    }
    const closed = await TableSession.findOneAndUpdate({ _id: s._id, status: { $in: ['open', 'bill_asked'] } }, { $set: { status: 'closed', closedAt: now, closedBy: by?.type === 'staff' ? 'staff' : 'owner', ...(by?.type === 'staff' ? { closedByName: by.name } : {}), paidVia: method, paidPaise } }, { returnDocument: 'after' });
    if (!closed) throw fail(409, 'This bill was just closed');
    // the points of the rounds that were on the tab start waiting now (they were held back until the money was in)
    const loyalty = require('./loyaltyService');
    for (const o of unpaid) loyalty.onDelivered({ ...o.toObject(), payment: { ...(o.payment?.toObject ? o.payment.toObject() : o.payment), status: 'paid' }, deliveredAt: now }).catch((e) => console.error('Points error:', e.message));
    // a friend's first meal is paid: the one who referred him is thanked with points
    for (const uid of s.customers) {
        const first = orders.find((o) => String(o.userId) === String(uid)) || orders[0];
        require('./referral').onVisitPaid({ tenantId, userId: uid, orderId: first?._id, orderNo: first?.orderNo }).catch((e) => console.error('Referral error:', e.message));
    }
    const bill = await billOf(closed);
    for (const uid of s.customers) tell('table_paid', { tenantId, userId: uid, vars: { table: s.table, total: bill.total }, data: { kind: 'table_paid', sessionId: String(s._id) } });
    // a waiter took the money: the owner hears which table, how much and who (when the owner took it himself he knows)
    if (by?.type === 'staff') tell('table_paid_owner', { tenantId, vars: { table: s.table, total: bill.total, paid: paidPaise / 100, via: method === 'upi' ? 'UPI' : 'cash', by: by.name || 'a waiter' }, data: { kind: 'table_paid_owner', sessionId: String(s._id), table: s.table } });
    return bill;
}

// What the rules need to know when an order is placed at a table: what that table already owes, whether he is a trusted customer
// (enough earlier visits paid), and whether he left an earlier bill unpaid.
async function placementInfo({ tenant, userId, table }) {
    const cfg = cfgOf(tenant);
    let choose = null;
    let s = await TableSession.findOne({ tenantId: tenant._id, table, status: { $in: ['open', 'bill_asked'] }, customers: userId });
    if (!s) {
        // nobody of his is at this table; if others are, he must choose (separate bill, or join them) before he can order
        const others = await require('./sharedTables').partiesAt(tenant._id, table, { forUser: userId });
        if (others.length) choose = { parties: others, canSeparate: others.length < (cfg.sharedTables === true ? require('./sharedTables').maxParties(tenant) : 1) };
    }
    const [elsewhere, bill, visits, owes] = await Promise.all([
        TableSession.findOne({ tenantId: tenant._id, customers: userId, status: { $in: ['open', 'bill_asked'] }, table: { $ne: table } }).select('table').lean(),
        s ? billOf(s) : Promise.resolve({ due: 0 }),
        TableSession.countDocuments({ tenantId: tenant._id, customers: userId, status: 'closed', walkout: { $ne: true }, paidPaise: { $gt: 0 } }),
        TableSession.exists({ tenantId: tenant._id, customers: userId, walkout: true, owedClearedAt: { $exists: false }, owedPaise: { $gt: 0 } }),
    ]);
    return { due: bill.due, trusted: visits >= cfg.trustedAfter, visits, owes: !!owes, elsewhere: elsewhere?.table || null, choose };
}

// The customer left without paying. The table is closed, the amount stays owed (nothing is thrown away), he gets a polite message, a strike
// is written down, and until he pays he cannot start a new tab at this shop.
async function walkout({ tenantId, sessionId }) {
    const s = await TableSession.findOne({ _id: sessionId, tenantId, status: { $in: ['open', 'bill_asked'] } });
    if (!s) throw fail(404, 'This bill is already closed');
    const orders = await Order.find({ tenantId, tableSessionId: s._id, status: { $nin: DEAD } }).sort({ createdAt: 1 });
    if (orders.some((o) => ACTIVE.includes(o.status))) throw fail(409, 'Some dishes are still in the kitchen. Serve or cancel them first.');
    const unpaid = orders.filter((o) => o.payment?.status !== 'paid');
    const owed = Math.round(unpaid.reduce((n, o) => n + (o.pricing?.total || 0), 0) * 100);
    const now = new Date();
    const closed = await TableSession.findOneAndUpdate(
        { _id: s._id, status: { $in: ['open', 'bill_asked'] } },
        { $set: { status: 'closed', closedAt: now, closedBy: 'owner', walkout: owed > 0, owedPaise: owed } },
        { returnDocument: 'after' },
    );
    if (!closed) throw fail(409, 'This bill was just closed');
    if (owed > 0) {
        const last = unpaid[unpaid.length - 1];
        await require('./customerRisk').addStrike(last).catch((e) => console.error('Strike error:', e.message));
        for (const uid of s.customers) tell('table_walkout', { tenantId, userId: uid, vars: { table: s.table, amount: Math.round(owed / 100) }, data: { kind: 'table_owed', sessionId: String(s._id) } });
    }
    return { ok: true, owedPaise: owed };
}

// "Please bring it fast": the customer reminds the kitchen. Only while something of his is still waiting, and not again for 10 minutes.
async function nudge({ tenantId, userId }) {
    const s = await openFor(tenantId, userId);
    if (!s) throw fail(404, 'You have no open table');
    const lim = await limitsFor(tenantId);
    const waiting = await Order.find({ tenantId, tableSessionId: s._id, status: { $in: ACTIVE } }).sort({ createdAt: 1 }).lean();
    if (!waiting.length) throw fail(409, 'Nothing is waiting in the kitchen');
    const minutes = Math.floor((Date.now() - new Date(waiting[0].createdAt).getTime()) / 60000);
    if (minutes < lim.nudgeFirstMin) throw fail(409, 'Your order was just placed. Please give the kitchen a few minutes.');
    const claimed = await TableSession.findOneAndUpdate(
        { _id: s._id, $or: [{ lastNudgeAt: { $exists: false } }, { lastNudgeAt: { $lte: new Date(Date.now() - lim.nudgeEveryMin * 60000) } }] },
        { $set: { lastNudgeAt: new Date() } },
    );
    if (!claimed) throw fail(429, 'The kitchen already knows. Please wait a few minutes before asking again.');
    tell('table_nudge', { tenantId, vars: { table: s.table, minutes, what: brief(waiting[0], 3) }, data: { kind: 'table', sessionId: String(s._id), table: s.table } });
    require('./kitchenAlerts').hurry(tenantId, { table: s.table, minutes, what: brief(waiting[0], 3) });
    return { ok: true };
}

// the walked-out bills the shop is still owed, with who owes them
async function debts(tenantId) {
    const rows = await TableSession.find({ tenantId, walkout: true, owedClearedAt: { $exists: false }, owedPaise: { $gt: 0 } }).sort({ closedAt: -1 }).limit(100).lean();
    const who = await peopleOf(tenantId, rows.flatMap((r) => r.customers));
    return rows.map((r) => ({
        id: String(r._id), table: r.table, amount: r.owedPaise / 100, at: r.closedAt, claim: !!r.claimAt, remindedAt: r.lastRemindAt || null,
        customers: r.customers.map((c) => who.get(String(c)) || { id: String(c), name: null, phone: null, photo: null }),
    }));
}
// the customer paid what he owed (at the counter, later)
async function clearDebt({ tenantId, sessionId, method, message }) {
    const s = await TableSession.findOneAndUpdate(
        { _id: sessionId, tenantId, walkout: true, owedClearedAt: { $exists: false } },
        { $set: { owedClearedAt: new Date(), owedVia: method } }, { returnDocument: 'after' },
    );
    if (!s) throw fail(404, 'This bill is not owed any more');
    await Order.updateMany({ tenantId, tableSessionId: s._id, status: { $nin: DEAD }, 'payment.status': { $ne: 'paid' } }, { $set: { 'payment.status': 'paid', 'payment.paidAt': new Date(), 'payment.settledVia': method } });
    const claimed = !!s.claimAt;
    await TableSession.updateOne({ _id: s._id }, { $unset: { claimAt: 1, claimReply: 1 } });
    for (const uid of s.customers) tell('owed_cleared', { tenantId, userId: uid, vars: { table: s.table, amount: s.owedPaise / 100, claimed, message: message || '' }, data: { kind: 'table_paid', sessionId: String(s._id) } });
    return { ok: true };
}
// what a customer still owes at this shop (null if nothing)
async function owedBy(tenantId, userId) {
    const rows = await TableSession.find({ tenantId, customers: userId, walkout: true, owedClearedAt: { $exists: false }, owedPaise: { $gt: 0 } }).lean();
    if (!rows.length) return null;
    // the whole bill of each visit: what was ordered, when, and what is owed
    const visits = await Promise.all(rows.map(async (r) => { const b = await billOf(r); return { table: r.table, leftAt: r.closedAt, owed: r.owedPaise / 100, total: b.total, rounds: b.rounds }; }));
    const t = await Tenant.findById(tenantId).select('phone').lean();
    const no = rows.map((r) => r.claimReply).filter((x) => x && x.ok === false).sort((a, b) => new Date(b.at) - new Date(a.at))[0] || null;
    return {
        amount: rows.reduce((n, r) => n + r.owedPaise, 0) / 100, table: rows[0].table, at: rows[0].closedAt,
        claim: rows.some((r) => r.claimAt),                       // he says he paid; the shop has not answered yet
        reply: no ? { message: no.message || null, at: no.at } : null,   // the shop said "not paid"
        visits,
        phone: t?.phone || null,
        canPay: await require('./owedPayment').available(tenantId),   // the shop has working online payment: the popup shows a big Pay button
    };
}

// "I already paid": the owner is told at once and must answer. Not again for 5 minutes after a "no" (call the shop instead).
// remember a table QR scan (for the QR report). Never throws, never slows the guest down.
async function recordScan({ tenantId, table, key, source }) {
    try {
        const TableScan = require('../models/TableScan');
        const k = String(key || '').slice(0, 60);
        const gap = (await limitsFor(tenantId)).scanGapMin;
        if (gap > 0 && k && await TableScan.exists({ tenantId, table, key: k, createdAt: { $gte: new Date(Date.now() - gap * 60000) } })) return;
        await TableScan.create({ tenantId, table, key: k || undefined, source: source === 'link' ? 'link' : 'app' });
    } catch (e) { /* the report just misses one */ }
}

async function claimPaid({ tenantId, userId }) {
    const rows = await TableSession.find({ tenantId, customers: userId, walkout: true, owedClearedAt: { $exists: false }, owedPaise: { $gt: 0 } });
    if (!rows.length) throw fail(404, 'You have nothing to pay');
    if (rows.every((r) => r.claimAt)) return { ok: true, already: true };
    const lastNo = rows.map((r) => r.claimReply?.at).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0];
    if (lastNo && Date.now() - new Date(lastNo).getTime() < (await limitsFor(tenantId)).claimRetryMin * 60000) throw fail(429, 'The shop just checked. Please call the shop to sort it out.');
    const ids = rows.filter((r) => !r.claimAt).map((r) => r._id);
    await TableSession.updateMany({ _id: { $in: ids } }, { $set: { claimAt: new Date(), claimBy: userId }, $unset: { claimReply: 1 } });
    const u = await User.findById(userId).select('name').lean();
    tell('table_paid_claim', { tenantId, vars: { name: u?.name || null, amount: rows.reduce((n, r) => n + r.owedPaise, 0) / 100, table: rows[0].table }, data: { kind: 'owed_claim', sessionIds: ids.map(String) } });
    return { ok: true };
}

// what the owner sees in the popup: every claim waiting for his answer, with the whole bill
async function pendingClaims(tenantId) {
    const rows = await TableSession.find({ tenantId, walkout: true, owedClearedAt: { $exists: false }, claimAt: { $exists: true } }).sort({ claimAt: 1 }).limit(20);
    const who = await peopleOf(tenantId, rows.flatMap((r) => r.customers));
    return Promise.all(rows.map(async (s) => {
        const bill = await billOf(s, { owner: true });
        return {
            id: String(s._id), table: s.table, amount: s.owedPaise / 100, leftAt: s.closedAt, claimedAt: s.claimAt, rounds: bill.rounds, openedAt: s.openedAt,
            customers: s.customers.map((c) => who.get(String(c)) || { id: String(c), name: null, phone: null, photo: null }),
        };
    }));
}
// the owner answers: yes (cleared, the customer is apologised to) or no (the customer gets the owner's message and keeps being asked to pay)
async function answerClaim({ tenantId, sessionId, ok, message }) {
    const msg = String(message || '').trim().slice(0, 200);
    const s = await TableSession.findOne({ _id: sessionId, tenantId, walkout: true, owedClearedAt: { $exists: false }, claimAt: { $exists: true } });
    if (!s) throw fail(404, 'This request is already answered');
    if (ok) { await clearDebt({ tenantId, sessionId, method: 'claimed', message: msg }); return { ok: true }; }
    await TableSession.updateOne({ _id: s._id }, { $set: { claimReply: { ok: false, message: msg || undefined, at: new Date() } }, $unset: { claimAt: 1 } });
    for (const uid of s.customers) tell('owed_claim_rejected', { tenantId, userId: uid, vars: { table: s.table, amount: s.owedPaise / 100, message: msg }, data: { kind: 'table_owed', sessionId: String(s._id) } });
    return { ok: true };
}

// every table of the shop with what is happening there (the owner's board)
async function board(tenant) {
    const count = tenant.settings?.orders?.dineIn?.tableCount || 10;
    const sessions = await TableSession.find({ tenantId: tenant._id, status: { $in: ['open', 'bill_asked'] }, kind: { $ne: 'pickup' } }).sort({ party: 1 }).lean();
    const byTable = new Map(sessions.map((s) => [s.table, s]));   // the first bill of each table (a table with several bills adds them as `parties`)
    const sums = await Order.aggregate([
        { $match: { tenantId: tenant._id, tableSessionId: { $in: sessions.map((s) => s._id) }, status: { $nin: DEAD }, ...HIDE_UNPAID } },
        { $group: { _id: '$tableSessionId', total: { $sum: '$pricing.total' }, rounds: { $sum: 1 }, due: { $sum: { $cond: [{ $eq: ['$payment.status', 'paid'] }, 0, '$pricing.total'] } },
            waitFrom: { $min: { $cond: [{ $in: ['$status', ACTIVE] }, '$createdAt', null] } } } },   // the oldest dish still waiting
    ]);
    const sumOf = new Map(sums.map((x) => [String(x._id), x]));
    const people = await User.find({ _id: { $in: sessions.flatMap((s) => s.customers.slice(0, 1)) } }).select('name').lean();
    const nameOf = new Map(people.map((u) => [String(u._id), u.name]));
    const row = (table) => {
        const s = byTable.get(table);
        if (!s) return { table, state: 'free' };
        const x = sumOf.get(String(s._id)) || { total: 0, rounds: 0, due: 0 };
        return { table, state: s.status === 'bill_asked' ? 'bill_asked' : 'eating', sessionId: String(s._id), total: x.total, due: x.due, rounds: x.rounds, since: s.openedAt, waitingSince: x.waitFrom || null, nudgedAt: s.lastNudgeAt || null, billAskedAt: s.billAskedAt || null, check: !!s.checkNotifiedAt && s.status === 'open', who: nameOf.get(String(s.customers[0])) || null };
    };
    const rows = Array.from({ length: count }, (_, i) => row(String(i + 1)));
    for (const s of sessions) if (!/^\d+$/.test(s.table) || Number(s.table) > count || Number(s.table) < 1) rows.push(row(s.table));   // never hide an open bill
    // shared tables: every bill of a table, each with its own state, money, timers and the first name of who sits there
    const bySession = (s) => { const x = sumOf.get(String(s._id)) || { total: 0, rounds: 0, due: 0 }; return { sessionId: String(s._id), party: s.party || 1, label: s.label || String.fromCharCode(64 + (s.party || 1)), state: s.status === 'bill_asked' ? 'bill_asked' : 'eating', who: nameOf.get(String(s.customers[0])) || null, guests: s.customers.length, total: x.total, due: x.due, rounds: x.rounds, since: s.openedAt, waitingSince: x.waitFrom || null, billAskedAt: s.billAskedAt || null, nudgedAt: s.lastNudgeAt || null, check: !!s.checkNotifiedAt && s.status === 'open' }; };
    const groups = new Map();
    for (const s of sessions) groups.set(s.table, [...(groups.get(s.table) || []), s]);
    for (const r of rows) {
        const g = groups.get(r.table) || [];
        if (g.length > 1) {
            const parts = g.map(bySession);
            r.parties = parts;
            r.state = parts.some((p) => p.state === 'bill_asked') ? 'bill_asked' : 'eating';
            r.total = parts.reduce((m, p) => m + p.total, 0); r.due = parts.reduce((m, p) => m + p.due, 0); r.rounds = parts.reduce((m, p) => m + p.rounds, 0);
            const waits = parts.map((p) => p.waitingSince).filter(Boolean).map((d) => new Date(d).getTime());
            r.waitingSince = waits.length ? new Date(Math.min(...waits)) : null;
            r.check = parts.some((p) => p.check);
        }
    }
    // guests who owe something and cannot be reached, or have their location off (services/guestWatch.js): a badge on the card, no sound
    const gw = require('./guestWatch');
    if (gw.cfgOf(tenant).guestWatch !== false) {
        const now = new Date();
        const minutes = gw.minutesOf(tenant);
        const flagged = new Map(sessions.map((s) => [String(s._id), gw.watchOf(s, now, minutes)]).filter(([, w]) => w.length));
        if (flagged.size) {
            const names = new Map((await User.find({ _id: { $in: [...flagged.values()].flat().map((w) => w.userId) } }).select('name').lean()).map((u) => [String(u._id), String(u.name || '').trim().split(/\s+/)[0] || null]));
            const named = (list) => list.map((w) => ({ userId: w.userId, name: names.get(w.userId) || null, state: w.state, since: w.since }));
            for (const r of rows) {
                const g = groups.get(r.table) || [];
                const all = [];
                for (const s of g) { const w = named(flagged.get(String(s._id)) || []); all.push(...w); const p = (r.parties || []).find((x) => x.sessionId === String(s._id)); if (p) p.watch = w; }
                if (all.length) r.watch = all;
            }
        }
    }
    return rows;
}

// A visit whose every round was cancelled has nothing left to pay or serve: it is closed, so the customer is not "still at the table"
// (that would block his other orders and his choice of table for hours). minAgeMs guards a visit that has only just been opened.
async function closeEmpty(tenantId, sessionId, minAgeMs = 0) {
    if (!sessionId) return false;
    const live = await Order.exists({ tenantId, tableSessionId: sessionId, status: { $nin: DEAD } });   // an unpaid online round counts: its payment may still arrive
    if (live) return false;
    const cut = new Date(Date.now() - minAgeMs);
    const r = await TableSession.updateOne({ _id: sessionId, tenantId, status: { $in: ['open', 'bill_asked'] }, lastOrderAt: { $lte: cut } }, { $set: { status: 'closed', closedAt: new Date(), closedBy: 'auto' } });
    return r.modifiedCount > 0;
}

// every few minutes: a visit nobody orders from any more, with nothing left to pay, is closed. (A visit with money still owed is NOT closed:
// that is for the owner to settle, or to mark as left unpaid.)
async function closeIdle(now = new Date()) {
    const open = await TableSession.find({ status: { $in: ['open', 'bill_asked'] } }).limit(200);
    let n = 0;
    for (const s of open) {
        if (await closeEmpty(s.tenantId, s._id, 10 * 60000)) { n += 1; continue; }   // every round cancelled: over
        const t = await Tenant.findById(s.tenantId).select('settings.orders.dineIn').lean();
        const cfg = cfgOf(t);
        // finished eating, nobody asked for the bill: the owner is told once to look at the table (the walk-out alarm)
        if (s.status === 'open' && !s.checkNotifiedAt) {
            const kitchen = await Order.exists({ tenantId: s.tenantId, tableSessionId: s._id, status: { $in: ACTIVE } });
            const lastServed = await Order.findOne({ tenantId: s.tenantId, tableSessionId: s._id, status: 'delivered' }).sort({ deliveredAt: -1 }).select('deliveredAt').lean();
            if (!kitchen && lastServed?.deliveredAt && now.getTime() - new Date(lastServed.deliveredAt).getTime() >= cfg.checkMinutes * 60000) {
                const claimed = await TableSession.findOneAndUpdate({ _id: s._id, status: 'open', checkNotifiedAt: { $exists: false } }, { $set: { checkNotifiedAt: now } });
                if (claimed) {
                    const b = await billOf(s);
                    if (b.due > 0) tell('table_check', { tenantId: s.tenantId, vars: { table: s.table, due: b.due, minutes: cfg.checkMinutes }, data: { kind: 'table', sessionId: String(s._id), table: s.table } });
                }
            }
        }
        const hours = cfg.autoCloseHours || 6;
        if (now.getTime() - new Date(s.lastOrderAt).getTime() < hours * 3600000) continue;
        const bill = await billOf(s);
        if (bill.due > 0 || bill.kitchenBusy) continue;
        const done = await TableSession.updateOne({ _id: s._id, status: { $in: ['open', 'bill_asked'] } }, { $set: { status: 'closed', closedAt: now, closedBy: 'auto' } });
        if (done.modifiedCount) n += 1;
    }
    return n;
}

// How full the shop is: when enough tables are taken, new customers are told the food may take longer (and their estimate grows).
async function busyInfo(tenant) {
    const cfg = cfgOf(tenant);
    if (!cfg.enabled || !cfg.busyAuto) return { busy: false, extraMin: 0 };
    const occupied = await TableSession.countDocuments({ tenantId: tenant._id, status: { $in: ['open', 'bill_asked'] } });
    const busy = occupied * 100 >= Math.max(1, cfg.tableCount) * cfg.busyPercent;
    return { busy, extraMin: busy ? cfg.busyExtraMin : 0, occupied, tables: cfg.tableCount };
}
// what the app shows before ordering: is it busy, and how long it usually takes
async function estimate(tenant) {
    const cfg = cfgOf(tenant);
    const b = await busyInfo(tenant).catch(() => ({ busy: false, extraMin: 0 }));
    const wait = cfg.waitMin > 0 ? cfg.waitMin : (cfg.autoReady ? cfg.readyMin : 0);
    return { busy: b.busy, extraMin: b.extraMin, waitMin: wait > 0 ? wait + b.extraMin : null };
}
// the estimate a dine in order gets: the owner's average (when dishes are marked ready by themselves), plus the busy time
async function etaFor(tenant, base) {
    const cfg = cfgOf(tenant);
    const b = await busyInfo(tenant).catch(() => ({ extraMin: 0 }));
    const wait = cfg.waitMin > 0 ? cfg.waitMin : (cfg.autoReady ? cfg.readyMin : 0);   // the owner's average, else the automation's
    return Math.max(base || 0, wait) + b.extraMin;
}

// Dishes that have been cooking for the owner's average time are marked ready by themselves (only for owners who switched it on;
// the owner can still press the buttons himself, and whatever he does first wins).
async function autoReady(now = new Date()) {
    const Tn = await Tenant.find({ $or: [{ 'settings.orders.dineIn.autoReady': true }, { 'settings.orders.dineIn.autoServe': true }] }).select('settings.orders.dineIn').lean();
    const orderStatus = require('./orderStatusService');
    let n = 0;
    for (const t of Tn) {
        const cfg = cfgOf(t);
        if (cfg.autoServe) {   // ready for a while: served (the owner may have forgotten to press it)
            const sCut = new Date(now.getTime() - cfg.serveMin * 60000);
            const ready = await Order.find({ tenantId: t._id, orderType: 'dine_in', status: 'ready', createdAt: { $lte: sCut } }).limit(50);
            for (const o of ready) {
                const r = [...(o.statusHistory || [])].reverse().find((x) => x.status === 'ready');
                if (!r || new Date(r.at).getTime() > sCut.getTime()) continue;
                try { await orderStatus.change({ order: o, status: 'delivered', actor: { type: 'system', label: 'auto serve' }, note: 'Marked served automatically' }); } catch (e) { /* the owner got there first */ }
            }
        }
        if (!cfg.autoReady) continue;
        const cutoff = new Date(now.getTime() - cfg.readyMin * 60000);
        const rows = await Order.find({ tenantId: t._id, orderType: 'dine_in', status: { $in: ['accepted', 'preparing'] }, createdAt: { $lte: cutoff } }).limit(50);
        for (const o of rows) {
            const acc = [...(o.statusHistory || [])].reverse().find((x) => x.status === 'accepted');
            if (!acc || new Date(acc.at).getTime() > cutoff.getTime()) continue;
            try {
                const actor = { type: 'system', label: 'auto ready' };
                if (o.status === 'accepted') await orderStatus.change({ order: o, status: 'preparing', actor, note: 'Preparing (automatic)' });
                const fresh = await Order.findOne({ _id: o._id, tenantId: t._id });
                if (fresh && fresh.status === 'preparing') { await orderStatus.change({ order: fresh, status: 'ready', actor, note: 'Marked ready automatically' }); n += 1; }
            } catch (e) { /* the owner got there first, or it was cancelled: leave it */ }
        }
    }
    return n;
}

function startTableBillJob() {
    setInterval(() => clearOldRequests().catch((e) => console.error('Requests clean-up error:', e.message)), 10 * 60 * 1000).unref?.();
    setInterval(() => dailyOwed().catch((e) => console.error('Daily reminder error:', e.message)), 10 * 60 * 1000).unref?.();
    setInterval(() => autoReady().catch((e) => console.error('Auto ready error:', e.message)), 60 * 1000).unref?.();
    setInterval(() => require('./guestWatch').scan().catch((e) => console.error('Guest watch error:', e.message)), 60 * 1000).unref?.();   // a guest who owes cannot be reached: the owner is told, quietly
    const run = () => closeIdle().catch((e) => console.error('Table job error:', e.message));
    setTimeout(run, 60 * 1000).unref?.();
    setInterval(run, 3 * 60 * 1000).unref?.();
}

// The owner reminds a customer about a bill he left unpaid (push and inbox). Not again to the same bill for 30 minutes.
async function remind({ tenantId, sessionId, auto }) {
    const gapMin = (await limitsFor(tenantId)).remindGapMin;
    const cut = new Date(Date.now() - gapMin * 60000);
    const s = await TableSession.findOneAndUpdate(
        { _id: sessionId, tenantId, walkout: true, owedClearedAt: { $exists: false }, owedPaise: { $gt: 0 }, $or: [{ lastRemindAt: { $exists: false } }, { lastRemindAt: { $lte: cut } }] },
        { $set: { lastRemindAt: new Date() }, ...(auto ? { $inc: { autoRemindCount: 1 } } : {}) },
    );
    if (!s) {
        const cur = await TableSession.findOne({ _id: sessionId, tenantId, walkout: true, owedClearedAt: { $exists: false } }).select('lastRemindAt').lean();
        if (!cur) throw fail(404, 'This bill is not owed any more');
        const ago = Math.max(1, Math.round((Date.now() - new Date(cur.lastRemindAt).getTime()) / 60000));
        throw fail(429, `Already reminded ${ago} min ago. You can remind again in ${Math.max(1, gapMin - ago)} min.`);
    }
    for (const uid of s.customers) tell('owed_reminder', { tenantId, userId: uid, vars: { table: s.table, amount: s.owedPaise / 100 }, data: { kind: 'owed', sessionId: String(s._id) } });
    return { ok: true };
}
// one tap: remind everybody who owes (the ones reminded in the last 30 minutes are skipped)
async function remindAll(tenantId) {
    const rows = await TableSession.find({ tenantId, walkout: true, owedClearedAt: { $exists: false }, owedPaise: { $gt: 0 } }).select('_id').limit(300).lean();
    let sent = 0;
    for (const r of rows) { try { await remind({ tenantId, sessionId: r._id }); sent += 1; } catch (e) { /* reminded a moment ago */ } }
    return { ok: true, total: rows.length, sent, skipped: rows.length - sent };
}
// the owner's daily reminder: at his chosen hour (India time) everybody who owes is reminded once
async function dailyOwed(now = new Date()) {
    const hour = new Date(now.getTime() + 330 * 60000).getUTCHours();
    const Tn = await Tenant.find({ 'settings.orders.dineIn.owedDaily': true }).select('settings.orders.dineIn').lean();
    let n = 0;
    for (const t of Tn) {
        const cfg = cfgOf(t);
        if (cfg.owedHour !== hour) continue;
        const rows = await TableSession.find({
            tenantId: t._id, walkout: true, owedClearedAt: { $exists: false }, owedPaise: { $gt: 0 },
            $or: [{ lastRemindAt: { $exists: false } }, { lastRemindAt: { $lte: new Date(now.getTime() - 20 * 3600000) } }],
        }).select('_id autoRemindCount').limit(300).lean();
        for (const r of rows) {
            if ((r.autoRemindCount || 0) >= cfg.owedMax) continue;   // enough: the owner can still remind by hand
            try { await remind({ tenantId: t._id, sessionId: r._id, auto: true }); n += 1; } catch (e) { /* skip */ }
        }
    }
    return n;
}

// The owner writes the bill off (the customer can order again). The orders stay as they were; the visit is marked forgiven.
async function forgive({ tenantId, sessionId }) {
    const s = await TableSession.findOneAndUpdate(
        { _id: sessionId, tenantId, walkout: true, owedClearedAt: { $exists: false } },
        { $set: { owedClearedAt: new Date(), owedVia: 'forgiven', forgiven: true }, $unset: { claimAt: 1, claimReply: 1 } },
        { returnDocument: 'after' },
    );
    if (!s) throw fail(404, 'This bill is not owed any more');
    for (const uid of s.customers) tell('owed_cleared', { tenantId, userId: uid, vars: { table: s.table, amount: s.owedPaise / 100, forgiven: true }, data: { kind: 'table_paid', sessionId: String(s._id) } });
    return { ok: true };
}

// ---- calls, tip, requests, feedback ----
const CALL_LABELS = { share: 'Wants to pay and leave', waiter: 'Call the waiter', water: 'Water please', cutlery: 'Spoon, plate or tissue', clean: 'Clean the table', other: 'Needs help' };

// A guest asks for something at his table. Not twice for the same thing within 2 minutes, except "Call the waiter": always open, no limit,
// and only the waiters hear it (the owner is told only when the shop has no waiters on the app).
async function callWaiter({ tenant, userId, kind, text, table }) {
    const cfg = cfgOf(tenant);
    const plainCall = kind === 'waiter';
    if (!cfg.callOn && !plainCall) throw fail(400, 'This shop has not switched on calling the waiter');
    if (!CALL_LABELS[kind]) throw fail(400, 'Choose what you need');
    const s = await openFor(tenant._id, userId);
    const t = s ? s.table : String(table || '').trim();
    if (!/^\d{1,3}$/.test(t) || Number(t) < 1 || Number(t) > cfg.tableCount) throw fail(400, 'Choose your table first');
    const callGap = plainCall ? 0 : (await limitsFor(tenant._id)).callGapMin;
    const recent = callGap > 0 ? await TableRequest.findOne({ tenantId: tenant._id, table: t, kind, status: 'open', createdAt: { $gte: new Date(Date.now() - callGap * 60000) } }).lean() : null;
    if (recent) throw fail(429, 'The staff already know. Please wait a moment.');
    const note = String(text || '').trim().slice(0, 120);
    // calling again while the first call is still open rings the waiters again, without piling up a second row
    const open = plainCall ? await TableRequest.findOne({ tenantId: tenant._id, table: t, kind, status: 'open' }).lean() : null;
    const r = open || await TableRequest.create({ tenantId: tenant._id, sessionId: s?._id, table: t, userId, kind, text: note || undefined });
    const waiterApp = require('./staffService').rulesOf(tenant).waiterOn === true;
    if (!plainCall || !waiterApp) tell('table_call', { tenantId: tenant._id, vars: { table: t, label: CALL_LABELS[kind], text: note }, data: { kind: 'table_call', table: t, requestId: String(r._id), what: kind } });
    require('./waiterAlerts').request(tenant._id, { table: t, label: CALL_LABELS[kind], text: note });
    return { ok: true };
}
// what is waiting for the staff: open calls and tables asking for the bill, oldest first
async function requests(tenant) {
    const [calls, bills] = await Promise.all([
        TableRequest.find({ tenantId: tenant._id, status: 'open' }).sort({ createdAt: 1 }).limit(60).lean(),
        TableSession.find({ tenantId: tenant._id, status: 'bill_asked' }).select('table billAskedAt label party').lean(),
    ]);
    const sess = await TableSession.find({ _id: { $in: calls.map((c) => c.sessionId).filter(Boolean) } }).select('label').lean();
    const letter = new Map(sess.map((x) => [String(x._id), x.label || null]));
    const out = [
        ...calls.map((c) => ({ id: String(c._id), type: 'call', kind: c.kind, label: CALL_LABELS[c.kind], text: c.text || null, table: c.table, userId: c.userId ? String(c.userId) : null, party: letter.get(String(c.sessionId)) || null, at: c.createdAt, sessionId: c.sessionId ? String(c.sessionId) : null })),
        ...bills.map((b) => ({ id: 'b' + b._id, type: 'bill', kind: 'bill', label: 'Wants the bill', table: b.table, party: b.label || null, at: b.billAskedAt, sessionId: String(b._id) })),
    ];
    return out.sort((a, b) => new Date(a.at) - new Date(b.at));
}
async function doneRequest({ tenantId, id, by }) {
    const r = await TableRequest.findOneAndUpdate({ _id: id, tenantId, status: 'open' }, { $set: { status: 'done', doneAt: new Date(), doneBy: by?.type === 'staff' ? 'staff' : 'owner', ...(by?.type === 'staff' ? { doneByName: by.name } : {}) } });
    if (!r) throw fail(404, 'Already done');
    return { ok: true };
}
// requests nobody closed for a while (the shop's callClearHours, 2 by default) are closed by themselves
async function clearOldRequests(now = new Date()) {
    const old = await TableRequest.find({ status: 'open', createdAt: { $lte: new Date(now.getTime() - 3600000) } }).select('tenantId createdAt').limit(500).lean();
    const hours = new Map();
    const ids = [];
    for (const q of old) {
        const k = String(q.tenantId);
        if (!hours.has(k)) hours.set(k, (await limitsFor(q.tenantId)).callClearHours);
        if (now.getTime() - new Date(q.createdAt).getTime() >= hours.get(k) * 3600000) ids.push(q._id);
    }
    if (!ids.length) return 0;
    const r = await TableRequest.updateMany({ _id: { $in: ids }, status: 'open' }, { $set: { status: 'done', doneAt: now, doneBy: 'auto' } });
    return r.modifiedCount || 0;
}

// The tip for the waiter: the guest taps an amount; it is added to what he pays at the counter. 0 takes it off.
async function setTip({ tenant, userId, amount }) {
    const cfg = cfgOf(tenant);
    if (!cfg.tipOn) throw fail(400, 'This shop does not take tips');
    if (!Number.isInteger(amount) || amount < 0 || amount > 2000) throw fail(400, 'Choose a tip from 0 to 2000 rupees');
    const s = await openFor(tenant._id, userId);
    if (!s) throw fail(404, 'You have no open bill');
    await TableSession.updateOne({ _id: s._id }, { $set: { tipPaise: amount * 100 } });
    return billOf(await TableSession.findById(s._id));
}

// Private feedback after the meal. Only the owner reads it.
const FB_TAGS = ['Food', 'Service', 'Waiting time', 'Cleanliness', 'Price', 'Other'];
async function feedbackDue(tenant, userId) {
    if (!cfgOf(tenant).feedbackOn) return null;
    const s = await TableSession.findOne({ tenantId: tenant._id, customers: userId, status: 'closed', walkout: { $ne: true }, closedAt: { $gte: new Date(Date.now() - 6 * 3600000) } }).sort({ closedAt: -1 }).lean();
    if (!s) return null;
    if (await TableFeedback.exists({ sessionId: s._id, userId })) return null;
    const last = await Order.findOne({ tenantId: tenant._id, tableSessionId: s._id, status: 'delivered' }).sort({ createdAt: -1 }).select('_id').lean();
    return { sessionId: String(s._id), table: s.table, orderId: last ? String(last._id) : null };
}
async function submitFeedback({ tenant, userId, sessionId, stars, tags, comment }) {
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw fail(400, 'Choose 1 to 5 stars');
    const s = await TableSession.findOne({ _id: sessionId, tenantId: tenant._id, customers: userId, status: 'closed', walkout: { $ne: true } }).lean();
    if (!s) throw fail(404, 'This visit was not found');
    const t = (Array.isArray(tags) ? tags : []).filter((x) => FB_TAGS.includes(x)).slice(0, 6);
    const text = String(comment || '').trim().slice(0, 300);
    try { await TableFeedback.create({ tenantId: tenant._id, sessionId: s._id, userId, table: s.table, stars, tags: t, comment: text || undefined }); } catch (e) {
        if (e.code === 11000) return { ok: true };   // already sent
        throw e;
    }
    if (stars <= 3) tell('table_feedback_low', { tenantId: tenant._id, vars: { table: s.table, stars, comment: text }, data: { kind: 'table_feedback', table: s.table } });
    return { ok: true };
}
async function feedbackList(tenantId) {
    const [rows, agg] = await Promise.all([
        TableFeedback.find({ tenantId }).sort({ createdAt: -1 }).limit(50).lean(),
        TableFeedback.aggregate([{ $match: { tenantId, createdAt: { $gte: new Date(Date.now() - 30 * 86400000) } } }, { $group: { _id: null, avg: { $avg: '$stars' }, n: { $sum: 1 } } }]),
    ]);
    const users = await User.find({ _id: { $in: rows.map((r) => r.userId) } }).select('name').lean();
    const who = new Map(users.map((u) => [String(u._id), u.name]));
    return {
        avg: agg[0] ? Math.round(agg[0].avg * 10) / 10 : null, count: agg[0]?.n || 0,
        items: rows.map((r) => ({ id: String(r._id), table: r.table, stars: r.stars, tags: r.tags, comment: r.comment || null, name: who.get(String(r.userId)) || null, at: r.createdAt, seen: !!r.seenAt })),
    };
}
async function feedbackSeen(tenantId) {
    await TableFeedback.updateMany({ tenantId, seenAt: { $exists: false } }, { $set: { seenAt: new Date() } });
    return { ok: true };
}

module.exports = { closeEmpty, recordScan, callWaiter, requests, doneRequest, clearOldRequests, setTip, feedbackDue, submitFeedback, feedbackList, feedbackSeen, estimate, forgive, remind, remindAll, dailyOwed, claimPaid, pendingClaims, answerClaim, nudge, busyInfo, etaFor, autoReady, ACTIVE, placementInfo, walkout, debts, clearDebt, owedBy, joinOrOpen, billOf, openFor, askForBill, settle, board, closeIdle, startTableBillJob };
