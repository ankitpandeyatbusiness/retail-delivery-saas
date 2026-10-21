// The shop's one list of every rupee that came in or went out, online AND offline, with who, what, how and exactly when. Built live from the records that
// already hold the money, so it can never disagree with them (there is no second copy).
//   in   online payments · cash and UPI paid to a rider at the door · cash and UPI paid at pickup · table bills settled at the counter (cash or UPI) ·
//        guests paying their own share · an earlier unpaid bill cleared
//   out  refunds (online, and the ones you gave in cash) · lost chargebacks · SMS top-ups · your monthly bill
// Amounts are whole paise. Days are India days. A tip is not the shop's sale, so it is shown on its row and not counted.
const mongoose = require('mongoose');
const OnlinePayment = require('../models/OnlinePayment');
const OnlineRefund = require('../models/OnlineRefund');
const PaymentDispute = require('../models/PaymentDispute');
const OwedPayment = require('../models/OwedPayment');
const SmsTransaction = require('../models/SmsTransaction');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const TableSession = require('../models/TableSession');
const Complaint = require('../models/Complaint');
const Order = require('../models/Order');
const Rider = require('../models/Rider');
const User = require('../models/User');

const IST_MS = 330 * 60000;
const PER_SOURCE = 2000;   // a source never loads more than this for one search: narrow the dates instead
const bad = (status, message) => Object.assign(new Error(message), { status });

const LABELS = {
    online: 'Online payment',
    cash_delivery: 'Paid to the rider at the door',
    cash_pickup: 'Paid at pickup',
    table_bill: 'Table bill paid at the counter',
    table_share: 'Guest paid their share',
    earlier_bill: 'Earlier unpaid bill cleared',
    table_online: 'Unpaid table bill paid online',
    refund_online: 'Refund to customer',
    refund_cash: 'Refund you gave',
    dispute_lost: 'Chargeback lost',
    sms_topup: 'SMS top-up',
    rent: 'Your monthly bill',
};
const CATEGORIES = Object.keys(LABELS);
const IN = new Set(['online', 'cash_delivery', 'cash_pickup', 'table_bill', 'table_share', 'earlier_bill', 'table_online']);
// how the money moved: online (Razorpay) | cash | upi (paid by UPI or QR to a person) | other
const HOWS = ['online', 'cash', 'upi'];
const HOW_LABEL = { online: 'Online', cash: 'Cash', upi: 'UPI to you' };

const day = (v, endOfDay) => {
    const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
    if (!m) throw bad(400, 'Dates must look like 2026-10-31');
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) throw bad(400, 'Invalid date');
    return new Date(Date.UTC(y, mo - 1, d) - IST_MS + (endOfDay ? 86400000 - 1 : 0));
};

// a query string into a safe filter (400 for anything strange)
function parseQuery(q = {}) {
    const f = {};
    if (q.month !== undefined) {   // a whole month: 2026-10
        const m = /^(\d{4})-(\d{2})$/.exec(String(q.month));
        if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw bad(400, 'month must look like 2026-10');
        const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
        f.from = day(`${m[1]}-${m[2]}-01`, false);
        f.to = day(`${m[1]}-${m[2]}-${String(last).padStart(2, '0')}`, true);
    }
    if (q.date !== undefined) { f.from = day(q.date, false); f.to = day(q.date, true); }   // one day
    if (q.from !== undefined) f.from = day(q.from, false);
    if (q.to !== undefined) f.to = day(q.to, true);
    if (f.from && f.to && f.from > f.to) throw bad(400, 'The "from" date must not be after the "to" date');
    if (q.category !== undefined) {
        if (!CATEGORIES.includes(q.category)) throw bad(400, `category must be one of: ${CATEGORIES.join(', ')}`);
        f.category = q.category;
    }
    if (q.direction !== undefined) {
        if (!['in', 'out'].includes(q.direction)) throw bad(400, 'direction must be in or out');
        f.direction = q.direction;
    }
    if (q.how !== undefined) {
        if (!HOWS.includes(q.how)) throw bad(400, `how must be one of: ${HOWS.join(', ')}`);
        f.how = q.how;
    }
    if (q.q !== undefined && String(q.q).trim()) {
        const n = Number(String(q.q).replace(/^#/, '').trim());
        if (!Number.isInteger(n) || n < 1) throw bad(400, 'Search by an order number, like 1042');
        f.orderNo = n;
    }
    const page = Number.parseInt(q.page, 10);
    const limit = Number.parseInt(q.limit, 10);
    f.page = Number.isInteger(page) && page > 0 ? Math.min(page, 100000) : 1;
    f.limit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 25;
    return f;
}

const rangeOf = (f) => { const r = {}; if (f.from) r.$gte = f.from; if (f.to) r.$lte = f.to; return Object.keys(r).length ? r : null; };
const withRange = (field, r) => (r ? { [field]: r } : {});
const ids = (rows, key) => [...new Set(rows.map((r) => r[key]).filter(Boolean).map(String))];
const upiWord = (v) => (String(v || '').toLowerCase() === 'upi' ? 'upi' : String(v || '').toLowerCase() === 'cash' ? 'cash' : 'cash');

// ---- the sources: each returns rows { key, at, category, amountPaise, how, ref, orderId, by, note, status?, meta }
async function fromOnlinePayments(tenantId, r) {
    const rows = await OnlinePayment.find({ tenantId, status: { $in: ['captured', 'mismatch'] }, capturedPaise: { $gt: 0 }, ...withRange('capturedAt', r) }).sort({ capturedAt: -1 }).limit(PER_SOURCE).lean();
    return rows.map((x) => ({ key: `op${x._id}`, at: x.capturedAt, category: 'online', amountPaise: x.capturedPaise, how: 'online', ref: x.rzpPaymentId || null, orderId: x.orderId, by: 'Razorpay', meta: { method: x.method || null, mode: x.mode, refundedPaise: x.refundedPaise || 0 } }));
}
async function fromRefunds(tenantId, r) {
    const rows = await OnlineRefund.find({ tenantId, status: 'processed', ...withRange('processedAt', r) }).sort({ processedAt: -1 }).limit(PER_SOURCE).lean();
    return rows.map((x) => ({ key: `rf${x._id}`, at: x.processedAt, category: 'refund_online', amountPaise: x.amountPaise, how: 'online', ref: x.rzpRefundId || null, orderId: x.orderId, by: 'Razorpay', meta: { reason: x.reason, paymentRef: x.rzpPaymentId } }));
}
async function fromDisputes(tenantId, r) {
    const rows = await PaymentDispute.find({ tenantId, status: 'lost', ...withRange('updatedAt', r) }).sort({ updatedAt: -1 }).limit(PER_SOURCE).lean();
    return rows.map((x) => ({ key: `pd${x._id}`, at: x.updatedAt, category: 'dispute_lost', amountPaise: x.amountPaise, how: 'online', ref: x.rzpDisputeId || null, orderId: x.orderId, by: 'Razorpay', meta: { reasonCode: x.reasonCode, paymentRef: x.rzpPaymentId } }));
}
async function fromSms(tenantId, r) {
    const rows = await SmsTransaction.find({ tenantId, type: 'topup', amountPaise: { $gt: 0 }, ...withRange('createdAt', r) }).sort({ createdAt: -1 }).limit(PER_SOURCE).lean();
    return rows.map((x) => ({ key: `sm${x._id}`, at: x.createdAt, category: 'sms_topup', amountPaise: x.amountPaise, how: 'online', ref: x.paymentId || null, orderId: null, by: x.actor?.label || 'You', note: x.note || '' }));
}
async function fromRent(tenantId, r) {
    const rows = await SubscriptionInvoice.find({ tenantId, status: { $in: ['paid', 'pending'] }, ...(r ? { $or: [{ status: 'paid', paidAt: r }, { status: 'pending', issueDate: r }] } : {}) }).sort({ issueDate: -1 }).limit(PER_SOURCE).lean();
    return rows.map((x) => ({
        key: `iv${x._id}`, at: x.paidAt || x.issueDate, category: 'rent', amountPaise: Math.round((x.total || 0) * 100), how: x.paymentMode === 'cash' ? 'cash' : 'online', ref: x.invoiceNo || null, orderId: null,
        status: x.status === 'paid' ? 'done' : 'pending', by: 'You', note: x.description || '', meta: { period: x.period, kind: x.kind, paymentMode: x.paymentMode, paymentRef: x.paymentRef, dueDate: x.dueDate },
    }));
}
// cash on delivery and pickup: paid to a person, not online. A dine in round is part of its table bill (below), so it is not listed twice.
async function fromCashOrders(tenantId, r) {
    const rows = await Order.find({
        tenantId, 'payment.method': 'cod', 'payment.status': 'paid', orderType: { $in: ['delivery', 'pickup'] },
        ...(r ? { $or: [{ 'payment.paidAt': r }, { 'payment.paidAt': { $exists: false }, deliveredAt: r }] } : {}),
    }).select('orderNo orderType payment pricing deliveredAt delivery.riderId customer').sort({ deliveredAt: -1 }).limit(PER_SOURCE).lean();
    const riders = await Rider.find({ tenantId, userId: { $in: ids(rows.map((o) => ({ r: o.delivery?.riderId })), 'r') } }).select('userId name').lean();
    const rName = new Map(riders.map((x) => [String(x.userId), x.name || 'Rider']));
    return rows.map((o) => {
        const delivery = o.orderType === 'delivery';
        const door = !!o.payment.paidAtDoor;
        return {
            key: `co${o._id}`, at: o.payment.paidAt || o.deliveredAt, category: delivery ? 'cash_delivery' : 'cash_pickup', amountPaise: Math.round((o.pricing?.total || 0) * 100),
            how: door ? 'upi' : 'cash', ref: null, orderId: o._id,
            by: delivery ? (rName.get(String(o.delivery?.riderId)) ? `Rider ${rName.get(String(o.delivery.riderId))}` : 'Rider') : 'You, at the counter',
            meta: { tipPaise: Math.round((o.pricing?.tip || 0) * 100), qrAtDoor: door },
        };
    });
}
// a table bill settled at the counter, and a guest paying his own share
async function fromTables(tenantId, r) {
    const sessions = await TableSession.find({ tenantId, kind: 'table', status: 'closed', walkout: { $ne: true }, paidPaise: { $gt: 0 }, ...withRange('closedAt', r) }).sort({ closedAt: -1 }).limit(PER_SOURCE).lean();
    const withShares = await TableSession.find({ tenantId, kind: 'table', 'left.paidPaise': { $gt: 0 }, ...withRange('left.at', r) }).sort({ updatedAt: -1 }).limit(PER_SOURCE).lean();
    const out = sessions.map((s) => ({
        key: `ts${s._id}`, at: s.closedAt, category: 'table_bill', amountPaise: s.paidPaise, how: upiWord(s.paidVia), ref: null, orderId: null,
        by: s.closedBy === 'staff' ? `Waiter ${s.closedByName || ''}`.trim() : s.closedBy === 'auto' ? 'Closed by itself' : 'You',
        meta: { table: s.table, party: s.label || null, tipPaise: s.tipPaise || 0, sessionId: String(s._id) },
    }));
    const people = new Set();
    for (const s of withShares) for (const l of s.left || []) if (l.paidPaise > 0 && l.userId) people.add(String(l.userId));
    const names = new Map((await User.find({ _id: { $in: [...people] } }).select('name').lean()).map((u) => [String(u._id), u.name || '']));
    for (const s of withShares) {
        for (const l of s.left || []) {
            if (!(l.paidPaise > 0) || (r && (!l.at || l.at < (r.$gte || 0) || l.at > (r.$lte || Infinity)))) continue;
            out.push({
                key: `tl${s._id}${l.userId}`, at: l.at, category: 'table_share', amountPaise: l.paidPaise, how: upiWord(l.via), ref: null, orderId: null,
                by: l.by ? `${l.by}` : 'You', person: names.get(String(l.userId)) || null, meta: { table: s.table, party: s.label || null, sessionId: String(s._id) },
            });
        }
    }
    return out;
}
// a bill left unpaid earlier and cleared later: online (the guest paid) or at the counter (you wrote it as paid)
async function fromEarlierBills(tenantId, r) {
    const online = await OwedPayment.find({ tenantId, status: 'captured', ...withRange('capturedAt', r) }).sort({ capturedAt: -1 }).limit(PER_SOURCE).lean();
    const cleared = await TableSession.find({ tenantId, walkout: true, owedPaise: { $gt: 0 }, forgiven: { $ne: true }, owedClearedAt: { $exists: true, ...(r || {}) }, owedVia: { $in: ['cash', 'upi'] } }).sort({ owedClearedAt: -1 }).limit(PER_SOURCE).lean();
    return [
        ...online.map((x) => ({ key: `ow${x._id}`, at: x.capturedAt, category: 'table_online', amountPaise: x.amountPaise, how: 'online', ref: x.rzpPaymentId || null, orderId: null, by: 'Razorpay', personId: x.userId })),
        ...cleared.map((s) => ({ key: `oc${s._id}`, at: s.owedClearedAt, category: 'earlier_bill', amountPaise: s.owedPaise, how: upiWord(s.owedVia), ref: null, orderId: null, by: 'You', meta: { table: s.table } })),
    ];
}
// a refund you decided on a complaint and gave in cash (or noted for a cash order): money that left your pocket, not the bank
async function fromCashRefunds(tenantId, r) {
    const rows = await Complaint.find({ tenantId, refundStatus: 'noted', refundPaise: { $gt: 0 }, ...withRange('decidedAt', r) }).sort({ decidedAt: -1 }).limit(PER_SOURCE).lean();
    return rows.map((c) => ({ key: `cr${c._id}`, at: c.decidedAt, category: 'refund_cash', amountPaise: c.refundPaise, how: 'cash', ref: null, orderId: c.orderId, by: 'You', note: c.ownerReply || '', personId: c.userId }));
}

async function list({ tenantId, filter }) {
    const f = filter;
    const r = rangeOf(f);
    const want = (...cats) => !f.category || cats.includes(f.category);
    const jobs = [];
    if (want('online') && f.direction !== 'out') jobs.push(fromOnlinePayments(tenantId, r));
    if (want('refund_online') && f.direction !== 'in') jobs.push(fromRefunds(tenantId, r));
    if (want('dispute_lost') && f.direction !== 'in') jobs.push(fromDisputes(tenantId, r));
    if (want('sms_topup') && f.direction !== 'in') jobs.push(fromSms(tenantId, r));
    if (want('rent') && f.direction !== 'in') jobs.push(fromRent(tenantId, r));
    if (want('cash_delivery', 'cash_pickup') && f.direction !== 'out') jobs.push(fromCashOrders(tenantId, r));
    if (want('table_bill', 'table_share') && f.direction !== 'out') jobs.push(fromTables(tenantId, r));
    if (want('earlier_bill', 'table_online') && f.direction !== 'out') jobs.push(fromEarlierBills(tenantId, r));
    if (want('refund_cash') && f.direction !== 'in') jobs.push(fromCashRefunds(tenantId, r));
    let rows = (await Promise.all(jobs)).flat().filter((x) => x.at && (!f.category || x.category === f.category) && (!f.how || x.how === f.how));
    const truncated = rows.length >= PER_SOURCE;

    // the order each row belongs to (number, kind, table, the customer)
    const orders = await Order.find({ _id: { $in: ids(rows, 'orderId') }, tenantId }).select('orderNo orderType tableNo tableParty customer.name customer.phone').lean();
    const oBy = new Map(orders.map((o) => [String(o._id), o]));
    if (f.orderNo) rows = rows.filter((x) => x.orderId && oBy.get(String(x.orderId))?.orderNo === f.orderNo);
    rows.sort((a, b) => new Date(b.at) - new Date(a.at) || String(b.key).localeCompare(String(a.key)));

    const totals = { inPaise: 0, outPaise: 0, pending: { count: 0, paise: 0 }, byCategory: new Map(), byHow: new Map() };
    for (const x of rows) {
        const dir = IN.has(x.category) ? 'in' : 'out';
        if (x.status === 'pending') { totals.pending.count += 1; totals.pending.paise += x.amountPaise; continue; }
        if (dir === 'in') totals.inPaise += x.amountPaise; else totals.outPaise += x.amountPaise;
        const c = totals.byCategory.get(x.category) || { category: x.category, label: LABELS[x.category], direction: dir, count: 0, paise: 0 };
        c.count += 1; c.paise += x.amountPaise; totals.byCategory.set(x.category, c);
        if (dir === 'in') { const h = totals.byHow.get(x.how) || { how: x.how, label: HOW_LABEL[x.how] || x.how, count: 0, paise: 0 }; h.count += 1; h.paise += x.amountPaise; totals.byHow.set(x.how, h); }
    }

    const total = rows.length;
    const pageRows = rows.slice((f.page - 1) * f.limit, f.page * f.limit);
    const personIds = [...new Set(pageRows.map((x) => x.personId).filter(Boolean).map(String))];
    const people = personIds.length ? new Map((await User.find({ _id: { $in: personIds } }).select('name phone').lean()).map((u) => [String(u._id), u])) : new Map();

    return {
        items: pageRows.map((x) => {
            const o = x.orderId ? oBy.get(String(x.orderId)) : null;
            const p = x.personId ? people.get(String(x.personId)) : null;
            return {
                id: x.key, at: x.at, category: x.category, label: LABELS[x.category], direction: IN.has(x.category) ? 'in' : 'out',
                amountPaise: x.amountPaise, status: x.status || 'done', how: x.how, howLabel: HOW_LABEL[x.how] || null, ref: x.ref || null,
                orderId: x.orderId || null, orderNo: o?.orderNo ?? null, orderType: o?.orderType || null, table: o?.tableNo || x.meta?.table || null, party: o?.tableParty || x.meta?.party || null,
                customer: o?.customer?.name || x.person || p?.name || null, phone: o?.customer?.phone || p?.phone || null,
                by: x.by || null, note: x.note || '', meta: x.meta || {},
            };
        }),
        page: f.page, limit: f.limit, total, truncated,
        totals: {
            inPaise: totals.inPaise, outPaise: totals.outPaise, netPaise: totals.inPaise - totals.outPaise, pending: totals.pending,
            byCategory: [...totals.byCategory.values()].sort((a, b) => b.paise - a.paise), byHow: [...totals.byHow.values()].sort((a, b) => b.paise - a.paise),
        },
    };
}

// spreadsheet-safe text: a cell must never start like a formula
const cell = (v) => {
    let s = v === undefined || v === null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
};
function toCsv(items) {
    const head = ['Date and time (IST)', 'Type', 'In or out', 'Amount (Rs)', 'How', 'Status', 'Order no', 'Table', 'Customer', 'Phone', 'Taken or sent by', 'Reference', 'Note'];
    const lines = [head.map(cell).join(',')];
    for (const i of items) {
        const ist = i.at ? new Date(new Date(i.at).getTime() + IST_MS).toISOString().replace('T', ' ').slice(0, 19) : '';
        lines.push([ist, i.label, i.direction === 'in' ? 'In' : 'Out', (i.amountPaise / 100).toFixed(2), i.howLabel || '', i.status === 'pending' ? 'Pending' : 'Done', i.orderNo ?? '', i.table ? `${i.table}${i.party ? ` ${i.party}` : ''}` : '', i.customer || '', i.phone || '', i.by || '', i.ref || '', i.note || ''].map(cell).join(','));
    }
    return `${lines.join('\r\n')}\r\n`;
}

module.exports = { list, parseQuery, toCsv, LABELS, CATEGORIES, HOWS };
