// The owner's History: every order of the shop, searched and filtered, with a summary, day totals and an Excel file of the same list.
//   filterOf(tenantId, query)   -> the Mongo filter for ?range=24h|week|month|custom (&from=YYYY-MM-DD&to=YYYY-MM-DD), &q=, &status=, &type=, &pay=
//   list(...)                   -> { items, hasMore, summary, byDay, page }
//   exportBuffer(...)           -> the Excel file (up to 5000 orders)
// Dates are India dates. Orders that are online and never paid are left out, like everywhere else (HIDE_UNPAID).
const Order = require('../models/Order');
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

    const pay = String(query.pay || '');
    if (pay === 'cash') filter['payment.method'] = 'cod';
    else if (pay === 'online') filter['payment.method'] = { $ne: 'cod' };
    else if (pay === 'unpaid') { filter['payment.status'] = { $ne: 'paid' }; and.push({ status: { $nin: CANCELLED } }); }

    // anything he types: customer name, order number, a dish, the customer's phone, the address
    const q = String(query.q || '').trim().slice(0, 60);
    if (q) {
        const rx = new RegExp(esc(q), 'i');
        const digits = q.replace(/\D/g, '');
        const or = [{ 'customer.name': rx }, { 'items.name': rx }, { 'address.line1': rx }, { 'address.line2': rx }, { 'address.landmark': rx }, { 'address.city': rx }, { 'address.label': rx }, { 'address.name': rx }, { tableNo: rx }];
        if (/^\d{1,9}$/.test(q)) or.push({ orderNo: Number(q) });
        if (digits.length >= 3) { const d = new RegExp(esc(digits)); or.push({ 'customer.phone': d }, { 'address.phone': d }); }
        and.push({ $or: or });
    }
    if (and.length) filter.$and = and;
    return filter;
}

const money = { $cond: [{ $in: ['$status', CANCELLED] }, 0, '$pricing.total'] };

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
                lost: { $sum: { $cond: [{ $in: ['$status', CANCELLED] }, '$pricing.total', 0] } },
                cash: { $sum: { $cond: [{ $eq: ['$payment.method', 'cod'] }, money, 0] } },
                online: { $sum: { $cond: [{ $ne: ['$payment.method', 'cod'] }, money, 0] } },
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
            total: o.pricing?.total || 0, couponCode: o.pricing?.couponCode || null,
            payment: { method: o.payment?.method || null, status: o.payment?.status || null },
            table: o.tableNo || null, address: addressLine(o.address),
            rider: o.delivery?.riderId ? riderName.get(String(o.delivery.riderId)) || null : null,
            flags,
        };
    });
}

async function list({ tenantId, query, page = 1, limit = 20 }) {
    const filter = filterOf(tenantId, query);
    const [rows, t] = await Promise.all([
        Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit + 1).lean(),
        page === 1 ? totals(filter) : null,   // the totals are for the whole filter: asked once, with the first page
    ]);
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    return { items: await cards(rows, tenantId), hasMore, page, ...(t || {}), range: rangeOf(query).label };
}

const MAX_EXPORT = 5000;
async function exportBuffer({ tenantId, query, shopName }) {
    const { buildSheet } = require('./xlsxExport');
    const filter = filterOf(tenantId, query);
    const rows = await Order.find(filter).sort({ createdAt: -1 }).limit(MAX_EXPORT).lean();
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
        rows: rows.map((o) => ({
            no: o.orderNo, at: o.createdAt, name: o.customer?.deleted ? 'Deleted customer' : o.customer?.name || '', phone: o.customer?.deleted ? '' : o.customer?.phone || '',
            type: o.orderType, status: o.status,
            dishes: (o.items || []).map((i) => `${i.quantity} × ${i.name}`).join(', '),
            where: o.orderType === 'dine_in' ? (o.tableNo ? `Table ${o.tableNo}` : '') : addressLine(o.address),
            pay: o.payment?.method === 'cod' ? 'Cash' : (o.payment?.method || '').toUpperCase(), paystatus: o.payment?.status || '',
            subtotal: o.pricing?.subtotal || 0, fee: o.pricing?.deliveryFee || 0, discount: o.pricing?.discount || 0, total: CANCELLED.includes(o.status) ? 0 : o.pricing?.total || 0,
            coupon: o.pricing?.couponCode || '', rider: o.delivery?.riderId ? riderName.get(String(o.delivery.riderId)) || '' : '', reason: o.cancelReason || '',
        })),
    });
}

module.exports = { filterOf, rangeOf, list, exportBuffer, totals, MAX_EXPORT };
