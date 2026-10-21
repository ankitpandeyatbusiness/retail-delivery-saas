// The waiter's screen: dishes to serve, what the tables ask for, the tables and their bills.
//   overview()     everything the floor needs in one answer
//   serve()        "Served"   a ready dine in dish is at the table (ready -> delivered)
//   doneRequest()  a call (water, cutlery, clean the table, the waiter) is done
//   bill()/settle()  one table's bill, and the money taken (only when the shop allows a waiter to take it: dineIn.waiterSettles)
// A waiter never sees a customer's phone, and never cancels, refunds or forgives anything.
const Order = require('../models/Order');
const TableSession = require('../models/TableSession');
const orderStatus = require('./orderStatusService');
const tableBill = require('./tableBill');
const staffService = require('./staffService');
const { DEFAULTS } = require('./tenantConfigService');
const { HIDE_UNPAID } = require('./onlineOrder');
const { httpError } = require('../middlewares/apiErrors');

const FIELDS = 'orderNo tableNo tableParty customer.name items note statusHistory tableSessionId createdAt';
const dineOf = (tenant) => ({ ...DEFAULTS.orders.dineIn, ...(tenant?.settings?.orders?.dineIn || {}) });
const readyAt = (o) => {
    for (let i = (o.statusHistory || []).length - 1; i >= 0; i -= 1) if (o.statusHistory[i].status === 'ready') return o.statusHistory[i].at;
    return o.createdAt;
};
const ago = (d) => { const m = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000)); return m < 1 ? 'just now' : `${m} min ago`; };

const lineOf = (l) => ({ name: l.name, quantity: l.quantity, options: (l.selections || []).map((s) => s.name).filter(Boolean), measure: l.measure?.label || null, note: l.note || '' });

async function overview(tenant) {
    const serveLateMin = staffService.rulesOf(tenant).serveLateMin || 5;
    const dine = dineOf(tenant);
    const now = Date.now();
    const [ready, cooking, board, requests, servedRows] = await Promise.all([
        Order.find({ tenantId: tenant._id, orderType: 'dine_in', status: 'ready', ...HIDE_UNPAID }).select(FIELDS).sort({ createdAt: 1 }).limit(100).lean(),
        Order.find({ tenantId: tenant._id, orderType: 'dine_in', status: { $in: ['accepted', 'preparing'] }, ...HIDE_UNPAID }).select('tableNo').limit(200).lean(),
        tableBill.board(tenant),
        tableBill.requests(tenant),
        Order.find({ tenantId: tenant._id, orderType: 'dine_in', status: 'delivered', deliveredAt: { $gte: new Date(now - 5 * 60000) } }).select('orderNo tableNo items deliveredAt orderType status tableSessionId statusHistory').sort({ deliveredAt: -1 }).limit(20).lean(),
    ]);
    const orderUndo = require('./orderUndo');
    const served = servedRows.map((o) => ({ id: String(o._id), orderNo: o.orderNo, table: o.tableNo || '', servedAt: o.deliveredAt, items: (o.items || []).map(lineOf), undo: orderUndo.offer(o, 'staff', 'waiter') })).filter((o) => o.undo);
    const serve = ready.map((o) => {
        const at = readyAt(o);
        const waitedMin = Math.max(0, Math.floor((now - new Date(at).getTime()) / 60000));
        return {
            id: String(o._id), orderNo: o.orderNo, table: o.tableNo || '', party: o.tableParty || null, who: String(o.customer?.name || '').trim().split(/\s+/)[0] || null, sessionId: o.tableSessionId ? String(o.tableSessionId) : null,
            readyAt: at, waitedMin, late: waitedMin >= serveLateMin, note: o.note || '', items: (o.items || []).map(lineOf),
        };
    }).sort((a, b) => new Date(a.readyAt) - new Date(b.readyAt));

    const count = (arr, key) => arr.reduce((m, x) => m.set(x[key], (m.get(x[key]) || 0) + 1), new Map());
    const readyBy = count(serve, 'table');
    const cookBy = count(cooking.map((o) => ({ table: o.tableNo || '' })), 'table');
    const reqBy = count(requests, 'table');
    const first = (arr, key, at) => arr.reduce((m, x) => { const t = new Date(x[at]).getTime(); return !m.has(x[key]) || t < m.get(x[key]) ? m.set(x[key], t) : m; }, new Map());
    const readySince = first(serve, 'table', 'readyAt');       // the longest a dish of this table has been waiting to be carried
    const requestSince = first(requests, 'table', 'at');       // the longest a table has been calling
    const requestWhat = new Map();
    for (const r of [...requests].sort((a, b) => new Date(b.at) - new Date(a.at))) requestWhat.set(r.table, r.label);   // the oldest call's words win
    const tables = board.map((t) => ({
        ...t, ready: readyBy.get(t.table) || 0, cooking: cookBy.get(t.table) || 0, requests: reqBy.get(t.table) || 0,
        readySince: readySince.has(t.table) ? new Date(readySince.get(t.table)) : null,
        requestSince: requestSince.has(t.table) ? new Date(requestSince.get(t.table)) : null,
        requestWhat: requestWhat.get(t.table) || null,
    }));
    const reqs = requests.map((r) => ({ ...r, waitedMin: Math.max(0, Math.floor((now - new Date(r.at).getTime()) / 60000)) }));
    return {
        serve, served, requests: reqs, tables,
        counts: { serve: serve.length, late: serve.filter((o) => o.late).length, requests: reqs.length, bills: reqs.filter((r) => r.type === 'bill').length },
        rules: { serveLateMin, canSettle: dine.waiterSettles !== false, tables: dine.tableCount },
        now: new Date(now),
    };
}

// one guest's share (only when the owner lets waiters take money)
async function settleShare({ tenant, sessionId, userId, method, staff }) {
    if (dineOf(tenant).waiterSettles === false) throw httpError(403, 'In this shop the owner takes the money for bills.');
    try { return await require('./tableShares').settleShare({ tenantId: tenant._id, sessionId, userId, method, by: { type: 'staff', name: staff.name } }); } catch (e) { throw httpError(e.status || 400, e.message); }
}

// shared tables: one round to another bill of the table, or two bills into one
async function move({ tenant, orderId, toSessionId }) { try { return await require('./sharedTables').moveOrder({ tenant, orderId, toSessionId }); } catch (e) { throw httpError(e.status || 400, e.message); } }
async function mergeBills({ tenant, fromId, intoId }) { try { return await require('./sharedTables').merge({ tenant, fromId, intoId }); } catch (e) { throw httpError(e.status || 400, e.message); } }

async function serve({ tenant, orderId, staff }) {
    const o = await Order.findOne({ _id: orderId, tenantId: tenant._id, orderType: 'dine_in' });
    if (!o) throw httpError(404, 'Order not found');
    if (o.status === 'delivered') return { already: true, ago: o.deliveredAt ? ago(o.deliveredAt) : null };
    if (o.status === 'cancelled') throw httpError(409, 'This order was cancelled.');
    if (o.status !== 'ready') throw httpError(409, 'The kitchen has not finished this dish yet.');
    try {
        await orderStatus.change({ order: o, status: 'delivered', actor: { type: 'staff', role: 'waiter', id: staff.id, label: staff.name }, tenant });
    } catch (e) {
        // someone else (a second waiter, the owner, the automatic serve) was first
        const fresh = e.status === 409 ? await Order.findById(o._id) : null;
        if (fresh && fresh.status === 'delivered') return { already: true, ago: fresh.deliveredAt ? ago(fresh.deliveredAt) : null };
        throw e;
    }
    return { already: false };
}

async function doneRequest({ tenant, id, staff }) {
    try {
        return await tableBill.doneRequest({ tenantId: tenant._id, id, by: { type: 'staff', name: staff.name } });
    } catch (e) {
        if (e.status === 404) return { ok: true, already: true };   // another waiter was first: nothing is left to do
        throw e;
    }
}

async function bill({ tenant, sessionId }) {
    const s = await TableSession.findOne({ _id: sessionId, tenantId: tenant._id, kind: { $ne: 'pickup' } });
    if (!s) throw httpError(404, 'Bill not found');
    const b = await tableBill.billOf(s, { owner: false });
    return { ...b, canSettle: dineOf(tenant).waiterSettles !== false && ['open', 'bill_asked'].includes(s.status), siblings: await require('./sharedTables').siblingsOf(s) };
}

async function settle({ tenant, sessionId, method, staff }) {
    if (dineOf(tenant).waiterSettles === false) throw httpError(403, 'In this shop the owner takes the money for bills.');
    if (!['cash', 'upi'].includes(method)) throw httpError(400, 'Choose cash or UPI');
    const s = await TableSession.findOne({ _id: sessionId, tenantId: tenant._id, kind: { $ne: 'pickup' } }).select('_id').lean();
    if (!s) throw httpError(404, 'Bill not found');
    try {
        return await tableBill.settle({ tenantId: tenant._id, sessionId, method, by: { type: 'staff', name: staff.name } });
    } catch (e) { throw httpError(e.status || 400, e.message); }
}

// A QR the guest scans with any UPI app to pay the exact bill at the table. Today it is the shop's own UPI id (dineIn.upiId): the money goes straight to
// the shop, and the waiter taps "UPI received" after the guest shows the success screen. When the shop has Razorpay keys this is where an online QR will go.
async function payQr({ tenant, sessionId }) {
    const dine = dineOf(tenant);
    if (dine.waiterSettles === false) throw httpError(403, 'In this shop the owner takes the money for bills.');
    const s = await TableSession.findOne({ _id: sessionId, tenantId: tenant._id, kind: { $ne: 'pickup' } });
    if (!s) throw httpError(404, 'Bill not found');
    if (!['open', 'bill_asked'].includes(s.status)) throw httpError(409, 'This bill is already closed.');
    const b = await tableBill.billOf(s, { owner: false });
    const payable = Math.round((b.payable || 0) * 100) / 100;
    if (payable <= 0) throw httpError(409, 'There is nothing to pay.');
    if (!dine.upiId) return { available: false, reason: 'no_upi', payable };
    const name = String(tenant.name || 'Shop').replace(/[^\w .&-]/g, '').slice(0, 40);
    const upiString = `upi://pay?pa=${encodeURIComponent(dine.upiId)}&pn=${encodeURIComponent(name)}&am=${payable.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Table ${s.table} bill`)}`;
    const image = await require('qrcode').toDataURL(upiString, { margin: 1, width: 520, errorCorrectionLevel: 'M' });
    return { available: true, mode: 'upi', payable, upiId: dine.upiId, table: s.table, upiString, image };
}

module.exports = { overview, serve, doneRequest, bill, settle, payQr, move, mergeBills, settleShare };
