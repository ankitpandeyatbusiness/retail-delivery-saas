// The owner's History: every order of the shop, searched and filtered, with a summary, day totals and an Excel file of the same list.
//   filterOf(tenantId, query)   -> the Mongo filter for ?range=24h|week|month|custom (&from=YYYY-MM-DD&to=YYYY-MM-DD), &q=, &status=, &type=, &pay=
//   list(...)                   -> { items, hasMore, summary, byDay, page }
//   exportBuffer(...)           -> the Excel file (up to 5000 orders)
// Dates are India dates. Orders that are online and never paid are left out, like everywhere else (HIDE_UNPAID).
const Order = require('../models/Order');
const BulkOrder = require('../models/BulkOrder');
const Rider = require('../models/Rider');
const Complaint = require('../models/Complaint');
const { ACTIVE_STATUSES } = require('./orderflow');
const { HIDE_UNPAID } = require('./onlineOrder');
const { httpError } = require('../middlewares/apiErrors');

const IST_MIN = 330;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CANCELLED = ['cancelled', 'undelivered'];

// 2026-11-05 00:00 in India as a Date
const startOf = (ymd) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() - IST_MIN * 60000);
const endOf = (ymd) => new Date(startOf(ymd).getTime() + 86400000 - 1);

function rangeOf(query, now = Date.now()) {
    const r = String(query.range || '24h');
    if (r === 'week') return { from: new Date(now - 7 * 86400000), to: null, label: 'Last week' };
    if (r === 'month') return { from: new Date(now - 30 * 86400000), to: null, label: 'Last month' };
    if (r === 'custom') {
        const f = String(query.from || ''); const t = String(query.to || query.from || '');
        if (!DAY_RE.test(f) || !DAY_RE.test(t) || t < f) throw httpError(400, 'Pick the dates again');
        return { from: startOf(f), to: endOf(t), label: f === t ? f : `${f} to ${t}` };
    }
    return { from: new Date(now - 24 * 3600000), to: null, label: 'Last 24 hours' };
}

function filterOf(tenantId, query = {}, now = Date.now()) {
    const { from, to } = rangeOf(query, now);
    const filter = { tenantId, ...HIDE_UNPAID, createdAt: { $gte: from, ...(to ? { $lte: to } : {}) } };
    const and = [];

    const status = String(query.status || '');
    if (status === 'delivered') filter.status = 'delivered';
    else if (status === 'cancelled') filter.status = { $in: CANCELLED };
    else if (status === 'progress') filter.status = { $in: ACTIVE_STATUSES };

    if (['delivery', 'pickup', 'dine_in'].includes(String(query.type))) filter.orderType = query.type;
    // Normal = the orders customers placed; Bulk = bulk orders (each one is shown by its work ticket, with the bulk order's own code and total)
    if (String(query.kind) === 'bulk') filter.bulkId = { $exists: true };
    else if (String(query.kind) === 'normal') filter.bulkId = { $exists: false };

    const pay = String(query.pay || '');
    if (pay === 'cash') filter['payment.method'] = 'cod';
    else if (pay === 'online') filter['payment.method'] = { $ne: 'cod' };
    else if (pay === 'unpaid') { filter['payment.status'] = { $ne: 'paid' }; and.push({ status: { $nin: CANCELLED } }); }

    // anything he types: customer name, order number, a dish, the customer's phone, the address
    const q = String(query.q || '').trim().slice(0, 60);
    if (q) {
        const rx = new RegExp(esc(q), 'i');
        const digits = q.replace(/\D/g, '');
        const or = [{ bulkCode: rx }, { 'customer.name': rx }, { 'items.name': rx }, { 'address.line1': rx }, { 'address.line2': rx }, { 'address.landmark': rx }, { 'address.city': rx }, { 'address.label': rx }, { 'address.name': rx }, { tableNo: rx }];
        if (/^\d{1,9}$/.test(q)) or.push({ orderNo: Number(q) });
        if (digits.length >= 3) { const d = new RegExp(esc(digits)); or.push({ 'customer.phone': d }, { 'address.phone': d }); }
        and.push({ $or: or });
    }
    if (and.length) filter.$and = and;
    return filter;
}

// a bulk order is worth its bulk total (the ticket's own total is only the balance); its cash and online parts are in the bulk order, not here
const worth = { $ifNull: ['$bulkTotal', '$pricing.total'] };
const money = { $cond: [{ $in: ['$status', CANCELLED] }, 0, worth] };
const plain = { $eq: [{ $type: '$bulkId' }, 'missing'] };

// totals for everything the filter matches (not only the page on screen), and a total for every day
async function totals(filter) {
    const rows = await Order.aggregate([
        { $match: filter },
        {
            $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: '+05:30' } },
                orders: { $sum: 1 },
                sales: { $sum: money },
                cancelled: { $sum: { $cond: [{ $in: ['$status', CANCELLED] }, 1, 0] } },
                lost: { $sum: { $cond: [{ $in: ['$status', CANCELLED] }, worth, 0] } },
                cash: { $sum: { $cond: [{ $and: [plain, { $eq: ['$payment.method', 'cod'] }] }, money, 0] } },
                online: { $sum: { $cond: [{ $and: [plain, { $ne: ['$payment.method', 'cod'] }] }, money, 0] } },
            },
        },
        { $sort: { _id: -1 } },
    ]);
    const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
    const orders = sum('orders'); const cancelled = sum('cancelled'); const sales = sum('sales');
    const done = orders - cancelled;
    return {
        summary: { orders, sales, cancelled, lost: sum('lost'), cash: sum('cash'), online: sum('online'), average: done > 0 ? sales / done : 0 },
        byDay: Object.fromEntries(rows.map((r) => [r._id, { orders: r.orders, sales: r.sales }])),
    };
}

const dishLine = (items = [], max = 3) => {
    const parts = items.slice(0, max).map((i) => `${i.quantity} × ${i.name}`);
    return parts.join(', ') + (items.length > max ? `, +${items.length - max} more` : '');
};
const addressLine = (a) => (a ? [a.line1, a.line2, a.landmark, a.city, a.pincode].filter(Boolean).join(', ') : '');

// what the card of one order needs: slim, with the flags that tell the owner something went wrong
async function cards(orders, tenantId) {
    const phones = [...new Set(orders.map((o) => o.customer?.phone).filter(Boolean))];
    const riderIds = [...new Set(orders.map((o) => o.delivery?.riderId).filter(Boolean).map(String))];
    const [counts, riders, complaints] = await Promise.all([
        phones.length ? Order.aggregate([{ $match: { tenantId, 'customer.phone': { $in: phones }, ...HIDE_UNPAID } }, { $group: { _id: '$customer.phone', n: { $sum: 1 } } }]) : [],
        riderIds.length ? Rider.find({ tenantId, userId: { $in: riderIds } }).select('userId name').lean() : [],
        orders.length ? Complaint.find({ tenantId, orderId: { $in: orders.map((o) => o._id) } }).select('orderId').lean() : [],
    ]);
    const orderCount = new Map(counts.map((c) => [c._id, c.n]));
    const riderName = new Map(riders.map((r) => [String(r.userId), r.name]));
    const complained = new Set(complaints.map((c) => String(c.orderId)));
    return orders.map((o) => {
        const gone = !!o.customer?.deleted;
        const flags = [];
        if (o.status === 'cancelled') flags.push({ k: 'cancelled', by: o.cancel?.by || o.cancelledBy || null });
        if (o.status === 'undelivered') flags.push({ k: 'undelivered' });
        if (o.payment?.status === 'refunded') flags.push({ k: 'refunded' });
        if (o.delivery?.lateWarnedAt) flags.push({ k: 'late' });
        if (o.kitchen?.problem?.kind) flags.push({ k: 'kitchen' });
        if ((o.delivery?.problems || []).length) flags.push({ k: 'rider_problem' });
        if (complained.has(String(o._id))) flags.push({ k: 'complaint' });
        return {
            _id: String(o._id), orderNo: o.orderNo, createdAt: o.createdAt, status: o.status, orderType: o.orderType,
            customer: { name: gone ? 'Deleted customer' : o.customer?.name || '', phone: gone ? '' : o.customer?.phone || '' },
            orders: gone ? 0 : orderCount.get(o.customer?.phone) || 0,   // how many orders this customer has made here (the repeat tag)
            dishes: dishLine(o.items), itemCount: (o.items || []).reduce((s, i) => s + (i.quantity || 0), 0),
            total: (o.bulkId ? o.bulkTotal : undefined) ?? o.pricing?.total ?? 0, couponCode: o.pricing?.couponCode || null,
            payment: { method: o.payment?.method || null, status: o.payment?.status || null },
            table: o.tableNo || null, address: addressLine(o.address),
            rider: o.delivery?.riderId ? riderName.get(String(o.delivery.riderId)) || null : null,
            flags,
            bulk: o.bulkId ? { id: String(o.bulkId), code: o.bulkCode || null } : null,   // the card says Bulk and opens the bulk order
        };
    });
}

// A bulk request that never got paid (waiting for a quote, quote sent, declined, expired, cancelled before paying) has no work ticket, so it is not an order
// in the list above. It is shown here as a card of its own (it says Bulk, and opens the bulk order), in the places it fits the filter. It is not a sale:
// the totals do not count it.
const BULK_STATUSES = { all: ['requested', 'quoted', 'declined', 'expired', 'cancelled'], cancelled: ['declined', 'expired', 'cancelled'], progress: ['requested', 'quoted'] };
function bulkFilterOf(tenantId, query = {}, now = Date.now()) {
    if (String(query.kind) === 'normal') return null;
    if (String(query.pay || '') || String(query.type) === 'dine_in') return null;   // a request has no payment, and is never a table
    const status = String(query.status || '');
    if (status === 'delivered') return null;
    const { from, to } = rangeOf(query, now);
    const f = { tenantId, orderId: { $exists: false }, status: { $in: BULK_STATUSES[status] || BULK_STATUSES.all }, createdAt: { $gte: from, ...(to ? { $lte: to } : {}) } };
    if (['delivery', 'pickup'].includes(String(query.type))) f.fulfilment = query.type;
    const q = String(query.q || '').trim().slice(0, 60);
    if (q) {
        const rx = new RegExp(esc(q), 'i');
        const digits = q.replace(/\D/g, '');
        f.$or = [{ code: rx }, { 'contact.name': rx }, { 'contact.company': rx }, { 'lines.name': rx }, { 'address.line1': rx }, { 'address.line2': rx }, { 'address.landmark': rx }, { 'address.city': rx },
            ...(digits.length >= 3 ? [{ 'contact.phone': new RegExp(esc(digits)) }] : [])];
    }
    return f;
}
const bulkCard = (b) => {
    const q = b.quote?.pricing || b.pricing || {};
    return {
        _id: `bulk-${b._id}`, orderNo: null, createdAt: b.createdAt, status: b.status, orderType: b.fulfilment,
        customer: { name: b.contact?.name || '', phone: b.contact?.phone || '' }, orders: 0,
        dishes: dishLine(b.lines), itemCount: (b.lines || []).reduce((n, i) => n + (i.quantity || 0), 0),
        total: ['requested', 'quoted'].includes(b.status) ? (q.total || 0) : 0, couponCode: null,
        payment: { method: null, status: null }, table: null, address: addressLine(b.address), rider: null, flags: [],
        bulk: { id: String(b._id), code: b.code || null }, bulkRequest: true,   // not an order yet: the card shows where the request stands
    };
};

async function list({ tenantId, query, page = 1, limit = 20 }) {
    const filter = filterOf(tenantId, query);
    const bf = bulkFilterOf(tenantId, query);
    const take = page * limit + 1;
    const [rows, bulkRows, t] = await Promise.all([
        bf ? Order.find(filter).sort({ createdAt: -1 }).limit(take).lean() : Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit + 1).lean(),
        bf ? BulkOrder.find(bf).sort({ createdAt: -1 }).limit(take).lean() : [],
        page === 1 ? totals(filter) : null,   // the totals are for the whole filter: asked once, with the first page
    ]);
    if (!bf) {
        const hasMore = rows.length > limit;
        if (hasMore) rows.pop();
        return { items: await cards(rows, tenantId), hasMore, page, ...(t || {}), range: rangeOf(query).label };
    }
    // two sources (the orders and the unpaid bulk requests): merged by time, then the page is cut
    const merged = [...rows.map((o) => ({ at: o.createdAt, o })), ...bulkRows.map((b) => ({ at: b.createdAt, b }))].sort((x, y) => new Date(y.at) - new Date(x.at));
    const window = merged.slice((page - 1) * limit, page * limit);
    const orderCards = new Map((await cards(window.filter((x) => x.o).map((x) => x.o), tenantId)).map((c) => [c._id, c]));
    const items = window.map((x) => (x.o ? orderCards.get(String(x.o._id)) : bulkCard(x.b)));
    return { items, hasMore: merged.length > page * limit, page, ...(t || {}), range: rangeOf(query).label };
}

const MAX_EXPORT = 5000;
async function exportBuffer({ tenantId, query, shopName }) {
    const { buildSheet } = require('./xlsxExport');
    const filter = filterOf(tenantId, query);
    const bf = bulkFilterOf(tenantId, query);
    const orderRows = await Order.find(filter).sort({ createdAt: -1 }).limit(MAX_EXPORT).lean();
    const bulkRows = bf ? await BulkOrder.find(bf).sort({ createdAt: -1 }).limit(MAX_EXPORT).lean() : [];
    // each row is an order or an unpaid bulk request, newest first
    const rows = [...orderRows.map((o) => ({ ...o, _src: 'order' })), ...bulkRows.map((b) => ({ ...b, _src: 'bulk' }))].sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt)).slice(0, MAX_EXPORT);
    const riderIds = [...new Set(rows.map((o) => o.delivery?.riderId).filter(Boolean).map(String))];
    const riders = riderIds.length ? await Rider.find({ tenantId, userId: { $in: riderIds } }).select('userId name').lean() : [];
    const riderName = new Map(riders.map((r) => [String(r.userId), r.name]));
    const label = rangeOf(query).label;
    return buildSheet({
        title: `Order history · ${label}`,
        subtitle: `${shopName || 'Shop'} · ${rows.length} order${rows.length === 1 ? '' : 's'}${rows.length === MAX_EXPORT ? ` (the first ${MAX_EXPORT})` : ''}${query.q ? ` · search: ${String(query.q).slice(0, 40)}` : ''}`,
        total: true,
        columns: [
            { header: 'Order no', key: 'no', kind: 'int' },
            { header: 'Bulk order', key: 'bulk', kind: 'text' },
            { header: 'Date and time', key: 'at', kind: 'date' },
            { header: 'Customer', key: 'name', kind: 'text' },
            { header: 'Phone', key: 'phone', kind: 'text' },
            { header: 'Type', key: 'type', kind: 'status' },
            { header: 'Status', key: 'status', kind: 'status' },
            { header: 'Dishes', key: 'dishes', kind: 'wide' },
            { header: 'Address or table', key: 'where', kind: 'wide' },
            { header: 'Payment', key: 'pay', kind: 'text' },
            { header: 'Payment status', key: 'paystatus', kind: 'status' },
            { header: 'Subtotal', key: 'subtotal', kind: 'money' },
            { header: 'Delivery fee', key: 'fee', kind: 'money' },
            { header: 'Discount', key: 'discount', kind: 'money' },
            { header: 'Total', key: 'total', kind: 'money' },
            { header: 'Coupon', key: 'coupon', kind: 'text' },
            { header: 'Rider', key: 'rider', kind: 'text' },
            { header: 'Cancel reason', key: 'reason', kind: 'wide' },
        ],
        rows: rows.map((o) => (o._src === 'bulk' ? {
            // an unpaid bulk request: it has no order number, only its code
            no: '', bulk: o.code || '', at: o.createdAt, name: o.contact?.name || '', phone: o.contact?.phone || '', type: o.fulfilment, status: o.status,
            dishes: (o.lines || []).map((i) => `${i.quantity} × ${i.name}`).join(', '), where: addressLine(o.address), pay: '', paystatus: '',
            subtotal: o.quote?.pricing?.subtotal ?? o.pricing?.subtotal ?? 0, fee: o.quote?.pricing?.deliveryFee ?? o.pricing?.deliveryFee ?? 0, discount: o.quote?.pricing?.discount ?? o.pricing?.discount ?? 0,
            total: ['requested', 'quoted'].includes(o.status) ? (o.quote?.pricing?.total ?? o.pricing?.total ?? 0) : 0, coupon: '', rider: '', reason: o.cancelReason || o.declineReason || '',
        } : {
            bulk: o.bulkId ? (o.bulkCode || 'Bulk') : '',
            no: o.orderNo, at: o.createdAt, name: o.customer?.deleted ? 'Deleted customer' : o.customer?.name || '', phone: o.customer?.deleted ? '' : o.customer?.phone || '',
            type: o.orderType, status: o.status,
            dishes: (o.items || []).map((i) => `${i.quantity} × ${i.name}`).join(', '),
            where: o.orderType === 'dine_in' ? (o.tableNo ? `Table ${o.tableNo}` : '') : addressLine(o.address),
            pay: o.payment?.method === 'cod' ? 'Cash' : (o.payment?.method || '').toUpperCase(), paystatus: o.payment?.status || '',
            subtotal: o.pricing?.subtotal || 0, fee: o.pricing?.deliveryFee || 0, discount: o.pricing?.discount || 0, total: CANCELLED.includes(o.status) ? 0 : (o.bulkId ? o.bulkTotal : undefined) ?? o.pricing?.total ?? 0,
            coupon: o.pricing?.couponCode || '', rider: o.delivery?.riderId ? riderName.get(String(o.delivery.riderId)) || '' : '', reason: o.cancelReason || '',
        })),
    });
}

module.exports = { filterOf, rangeOf, list, exportBuffer, totals, MAX_EXPORT };
