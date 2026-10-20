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

const FIELDS = 'orderNo tableNo items note statusHistory tableSessionId createdAt';
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
    const [ready, cooking, board, requests] = await Promise.all([
        Order.find({ tenantId: tenant._id, orderType: 'dine_in', status: 'ready', ...HIDE_UNPAID }).select(FIELDS).sort({ createdAt: 1 }).limit(100).lean(),
        Order.find({ tenantId: tenant._id, orderType: 'dine_in', status: { $in: ['accepted', 'preparing'] }, ...HIDE_UNPAID }).select('tableNo').limit(200).lean(),
        tableBill.board(tenant),
        tableBill.requests(tenant),
    ]);
    const serve = ready.map((o) => {
        const at = readyAt(o);
        const waitedMin = Math.max(0, Math.floor((now - new Date(at).getTime()) / 60000));
        return {
            id: String(o._id), orderNo: o.orderNo, table: o.tableNo || '', sessionId: o.tableSessionId ? String(o.tableSessionId) : null,
            readyAt: at, waitedMin, late: waitedMin >= serveLateMin, note: o.note || '', items: (o.items || []).map(lineOf),
        };
    }).sort((a, b) => new Date(a.readyAt) - new Date(b.readyAt));

    const count = (arr, key) => arr.reduce((m, x) => m.set(x[key], (m.get(x[key]) || 0) + 1), new Map());
    const readyBy = count(serve, 'table');
    const cookBy = count(cooking.map((o) => ({ table: o.tableNo || '' })), 'table');
    const reqBy = count(requests, 'table');
    const tables = board.map((t) => ({ ...t, ready: readyBy.get(t.table) || 0, cooking: cookBy.get(t.table) || 0, requests: reqBy.get(t.table) || 0 }));
    const reqs = requests.map((r) => ({ ...r, waitedMin: Math.max(0, Math.floor((now - new Date(r.at).getTime()) / 60000)) }));
    return {
        serve, requests: reqs, tables,
        counts: { serve: serve.length, late: serve.filter((o) => o.late).length, requests: reqs.length, bills: reqs.filter((r) => r.type === 'bill').length },
        rules: { serveLateMin, canSettle: dine.waiterSettles !== false, tables: dine.tableCount },
        now: new Date(now),
    };
}

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
    return { ...b, canSettle: dineOf(tenant).waiterSettles !== false && ['open', 'bill_asked'].includes(s.status) };
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

module.exports = { overview, serve, doneRequest, bill, settle };
