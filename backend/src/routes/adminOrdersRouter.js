// Superadmin view of ORDERS across all shops, invoices and sales reports.
// Mounted inside adminRouter (after requireSuperAdmin), so these URLs are:
//
//   GET /api/admin/orders                 all shops (filters below)
//   GET /api/admin/orders/:id
//   GET /api/admin/orders/:id/invoice     PDF download (?view=1 opens it in the browser)
//   GET /api/admin/reports/sales          all shops, or one with ?tenantId=...

const express = require('express');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Tenant = require('../models/Tenant');
const { streamInvoice } = require('../services/invoiceService');
const { salesReport, parseRange } = require('../services/reportService');
const { wrap, httpError } = require('../middlewares/apiErrors');
const orderStatus = require('../services/orderStatusService');

const router = express.Router();
const STATUSES = Order.schema.path('status').enumValues;
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

// adds the shop's name and short name to each order so the panel can show where it came from
async function withShop(orders) {
    const ids = [...new Set(orders.map((o) => String(o.tenantId)))];
    const shops = await Tenant.find({ _id: { $in: ids } }).select('name slug').lean();
    const byId = new Map(shops.map((s) => [String(s._id), s]));
    return orders.map((o) => ({
        ...o.toJSON(),
        undo: require('../services/orderUndo').offer(o, 'superadmin'),
        shopName: byId.get(String(o.tenantId))?.name || 'Unknown shop',
        shopSlug: byId.get(String(o.tenantId))?.slug || null,
    }));
}

/*
  ?tenantId=...             only one shop
  ?status=active            orders still in progress, or ?status=placed,delivered
  ?q=1042                   order number, or a 10-digit customer phone
  ?from=2026-10-01&to=2026-10-31
  ?page=1&limit=20
*/
router.get('/orders', wrap(async (req, res) => {
    const page = clamp(parseInt(req.query.page, 10) || 1, 1, 1000);
    const limit = clamp(parseInt(req.query.limit, 10) || 20, 1, 50);
    const filter = {};

    if (req.query.tenantId !== undefined) {
        if (!isId(req.query.tenantId)) throw httpError(400, 'Invalid tenantId');
        filter.tenantId = req.query.tenantId;
    }

    if (req.query.status === 'active') {
        filter.status = { $in: ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery'] };
    } else if (typeof req.query.status === 'string' && req.query.status) {
        const list = req.query.status.split(',').filter((s) => STATUSES.includes(s));
        if (!list.length) throw httpError(400, 'Unknown status');
        filter.status = { $in: list };
    }

    // ?type=delivery | pickup | dine_in | bulk (a bulk order's work ticket)
    if (req.query.type === 'bulk') filter.bulkId = { $exists: true, $ne: null };
    else if (['delivery', 'pickup', 'dine_in'].includes(req.query.type)) filter.orderType = req.query.type;

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    // every word must fit: status, type, payment, day, number, reference, phone, amount, or text (shop, customer, dish, address, rider ...)
    const search = q ? await require('../services/orderSearch').filter(q) : null;
    if (search) Object.assign(filter, search);

    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) throw httpError(400, 'Invalid date');
    if (from || to) filter.createdAt = { ...(from && { $gte: from }), ...(to && { $lte: to }) };

    const items = await Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit + 1);
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    res.json({ items: await withShop(items), page, hasMore });
}));

// orders in trouble (not accepted, no rider, too slow, money not settled) and what every shop has running now
router.get('/orders/attention', wrap(async (req, res) => {
    const tenantId = isId(req.query.tenantId) ? req.query.tenantId : undefined;
    res.json(await require('../services/orderAttention').attention({ tenantId }));
}));
// how each shop performed over the last days (default 30): shop cancels, prepare and delivery time, complaints; weak shops first, with the reason
router.get('/orders/quality', wrap(async (req, res) => { res.json(await require('../services/shopQuality').report({ days: clamp(parseInt(req.query.days, 10) || 30, 1, 365) })); }));
// the limits behind this tab: when an order is stuck, when you are alerted, when a shop needs a talk (changing them: supreme admin)
router.get('/orders/watch-settings', wrap(async (req, res) => {
    const w = require('../services/orderWatchSettings');
    res.json({ values: await w.get(), defaults: w.defaults(), ranges: w.SPEC });
}));
router.put('/orders/watch-settings', require('../middlewares/supremeAdmin').requireSupreme, wrap(async (req, res) => {
    req.auditBefore = await require('../services/orderWatchSettings').get();
    res.json({ values: await require('../services/orderWatchSettings').set(req.body) });
}));
// customers who cancel or are not there again and again (?days=30&min=3). View only.
router.get('/orders/repeat-cancellers', wrap(async (req, res) => {
    res.json(await require('../services/repeatCancellers').report({ days: clamp(parseInt(req.query.days, 10) || 30, 1, 365), min: clamp(parseInt(req.query.min, 10) || 3, 2, 50) }));
}));
router.get('/orders/live', wrap(async (req, res) => { res.json(await require('../services/orderAttention').live()); }));

// money going back to customers: open = not finished yet (pending, processing, failed), done = processed
router.get('/refunds', wrap(async (req, res) => {
    const OnlineRefund = require('../models/OnlineRefund');
    const done = req.query.status === 'done';
    const rows = await OnlineRefund.find(done ? { status: 'processed' } : { status: { $in: ['pending', 'processing', 'failed'] } }).sort({ createdAt: -1 }).limit(100).lean();
    const orders = await Order.find({ _id: { $in: rows.map((r) => r.orderId) } }).select('orderNo ref tenantId customer').lean();
    const byOrder = new Map(orders.map((o) => [String(o._id), o]));
    const names = new Map((await Tenant.find({ _id: { $in: rows.map((r) => r.tenantId) } }).select('name').lean()).map((s) => [String(s._id), s.name]));
    const open = await OnlineRefund.aggregate([{ $match: { status: { $in: ['pending', 'processing', 'failed'] } } }, { $group: { _id: '$status', n: { $sum: 1 }, sum: { $sum: '$amountPaise' } } }]);
    const marks = await require('../services/handledMarks').mapFor('refund_failed');
    res.json({
        open: Object.fromEntries(open.map((g) => [g._id, { count: g.n, paise: g.sum }])),
        items: rows.map((r) => {
            const o = byOrder.get(String(r.orderId));
            return {
                mark: marks.get(String(r._id)) || null, id: String(r._id), orderId: String(r.orderId), orderNo: o?.orderNo, ref: o?.ref || '', shopName: names.get(String(r.tenantId)) || 'Unknown shop', customer: o?.customer?.name || '', status: r.status, amountPaise: r.amountPaise, reason: r.reason || '', attempts: r.attempts || 0, lastError: r.lastError || '', createdAt: r.createdAt, processedAt: r.processedAt || null };
        }),
    });
}));
// a refund that failed (the shop's Razorpay balance was short, or Razorpay refused) is sent again with the same key, so the customer can never get it twice
router.post('/refunds/:id/retry', wrap(async (req, res) => {
    const OnlineRefund = require('../models/OnlineRefund');
    const r = isId(req.params.id) ? await OnlineRefund.findById(req.params.id) : null;
    if (!r) throw httpError(404, 'Refund not found');
    if (r.status !== 'failed') throw httpError(409, 'Only a failed refund can be sent again');
    await OnlineRefund.updateOne({ _id: r._id, status: 'failed' }, { $set: { status: 'pending', attempts: 0 }, $unset: { lockedUntil: 1, lastError: 1 } });
    await require('../services/refundIssuer').send(r._id);
    const now = await OnlineRefund.findById(r._id).lean();
    res.json({ status: now.status, lastError: now.lastError || '' });
}));

router.get('/orders/:id', wrap(async (req, res) => {
    const order = isId(req.params.id) ? await Order.findById(req.params.id) : null;
    if (!order) throw httpError(404, 'Order not found');
    const one = (await withShop([order]))[0];
    one.complaint = await require('../services/complaintService').adminForOrder(order._id);   // opens from the order page
    res.json(one);
}));

router.get('/orders/:id/invoice', wrap(async (req, res) => {
    const order = isId(req.params.id) ? await Order.findById(req.params.id) : null;
    if (!order) throw httpError(404, 'Order not found');
    if (order.status !== 'delivered') throw httpError(409, 'The invoice is only available after delivery');
    const tenant = await Tenant.findById(order.tenantId).select('name address phone').lean();
    streamInvoice(res, order, tenant, { inline: req.query.view === '1' });
}));

// ?from=2026-10-01&to=2026-10-31&groupBy=day|month&tenantId=optional
router.get('/reports/sales', wrap(async (req, res) => {
    const { from, to } = parseRange(req.query);
    let tenantId;
    if (req.query.tenantId !== undefined) {
        if (!isId(req.query.tenantId)) throw httpError(400, 'Invalid tenantId');
        tenantId = req.query.tenantId;
    }
    res.json(await salesReport({ tenantId, from, to, groupBy: req.query.groupBy }));
}));


// money that did not become a sale (cancelled, not delivered, refunded) by who caused it. Same ?from=&to=&tenantId= as the sales report.
router.get('/reports/lost', wrap(async (req, res) => {
    const { from, to } = parseRange(req.query);
    let tenantId;
    if (req.query.tenantId !== undefined) {
        if (!isId(req.query.tenantId)) throw httpError(400, 'Invalid tenantId');
        tenantId = req.query.tenantId;
    }
    res.json(await require('../services/lostSales').report({ tenantId, from, to }));
}));

// when people order (by hour and weekday), how (delivery, pickup, dine-in), new against returning customers, cash still with riders
router.get('/reports/patterns', wrap(async (req, res) => {
    const { from, to } = parseRange(req.query);
    let tenantId;
    if (req.query.tenantId !== undefined) {
        if (!isId(req.query.tenantId)) throw httpError(400, 'Invalid tenantId');
        tenantId = req.query.tenantId;
    }
    res.json(await require('../services/salesPatterns').report({ tenantId, from, to }));
}));

// the whole sales report as one Excel file with a sheet each: summary, by day, by shop, best items, sales lost, how people order
router.get('/reports/sales/export', wrap(async (req, res) => {
    const { from, to } = parseRange(req.query);
    let tenantId;
    if (req.query.tenantId !== undefined) {
        if (!isId(req.query.tenantId)) throw httpError(400, 'Invalid tenantId');
        tenantId = req.query.tenantId;
    }
    const { buildWorkbook, XLSX_TYPE } = require('../services/xlsxExport');
    const [r, lost, pat] = await Promise.all([
        salesReport({ tenantId, from, to, groupBy: 'day', topLimit: 50 }),
        require('../services/lostSales').report({ tenantId, from, to }),
        require('../services/salesPatterns').report({ tenantId, from, to }),
    ]);
    const day = (d) => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
    const rs = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    const pct = (c) => (c === null || c === undefined ? 'n/a' : (c > 0 ? '+' : '') + c + '%');
    const prev = r.previous;
    const period = day(from) + ' to ' + day(to);
    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const buf = await buildWorkbook([
        {
            title: 'Summary', subtitle: period,
            columns: [{ header: 'Measure', key: 'what' }, { header: 'This period', key: 'now', kind: 'center' }, { header: 'Period before', key: 'before', kind: 'center' }, { header: 'Change', key: 'change', kind: 'center' }],
            rows: [
                { what: 'Sales (delivered orders)', now: rs(r.totals.revenue), before: rs(prev.totals.revenue), change: pct(prev.change.revenue) },
                { what: 'Orders delivered', now: r.totals.orders, before: prev.totals.orders, change: pct(prev.change.orders) },
                { what: 'Average order', now: rs(r.totals.averageOrderValue), before: rs(prev.totals.averageOrderValue), change: pct(prev.change.averageOrderValue) },
                { what: 'Not delivered', now: r.undelivered, before: '', change: '' },
                { what: 'Cancelled or not delivered', now: lost.lost.count + ' orders, ' + rs(lost.lost.value), before: '', change: lost.lost.sharePct + '% of all orders' },
                { what: 'Refunded to customers', now: rs(lost.refunds.paise / 100), before: '', change: '' },
                { what: 'Customers who ordered', now: pat.customers.total, before: '', change: pat.customers.new + ' new, ' + pat.customers.returning + ' coming back' },
                { what: 'Cash still with riders', now: rs(pat.cash.paise / 100), before: '', change: pat.cash.riders + ' riders' },
            ],
        },
        {
            title: 'By day',
            columns: [{ header: 'Day', key: 'day' }, { header: 'Orders', key: 'orders', kind: 'int' }, { header: 'Sales (₹)', key: 'revenue', kind: 'money' }],
            rows: r.series.map((x) => ({ day: x.period, orders: x.orders, revenue: x.revenue })), total: true,
        },
        ...(tenantId ? [] : [{
            title: 'By shop',
            columns: [{ header: 'Shop', key: 'shop' }, { header: 'Orders', key: 'orders', kind: 'int' }, { header: 'Sales (₹)', key: 'revenue', kind: 'money' }, { header: 'Before (₹)', key: 'before', kind: 'money' }, { header: 'Change', key: 'change', kind: 'center' }, { header: 'Trend', key: 'trend', kind: 'status' }],
            rows: r.shops.map((x) => ({ shop: x.name, orders: x.orders, revenue: x.revenue, before: x.previousRevenue, change: pct(x.changePct), trend: x.trend === 'same' ? '' : x.trend })),
        }]),
        {
            title: 'Best items',
            columns: [{ header: 'Item', key: 'name', kind: 'wide' }, { header: 'Sold', key: 'quantity', kind: 'int' }, { header: 'Sales (₹)', key: 'revenue', kind: 'money' }],
            rows: r.topItems.map((x) => ({ name: x.name, quantity: x.quantity, revenue: x.revenue })),
        },
        {
            title: 'Sales lost',
            columns: [{ header: 'Reason', key: 'why', kind: 'wide' }, { header: 'Orders', key: 'count', kind: 'int' }, { header: 'Value (₹)', key: 'value', kind: 'money' }],
            rows: lost.byWho.map((x) => ({ why: x.key.replace(/^nohome_/, 'Not delivered, fault: ').replace(/_/g, ' '), count: x.count, value: x.value })), total: true,
        },
        {
            title: 'By hour',
            columns: [{ header: 'Hour (India time)', key: 'hour', kind: 'center' }, { header: 'Orders', key: 'orders', kind: 'int' }, { header: 'Sales (₹)', key: 'revenue', kind: 'money' }],
            rows: pat.hours.map((x) => ({ hour: String(x.hour).padStart(2, '0') + ':00', orders: x.orders, revenue: x.revenue })),
        },
        {
            title: 'By weekday',
            columns: [{ header: 'Weekday', key: 'day' }, { header: 'Orders', key: 'orders', kind: 'int' }, { header: 'Sales (₹)', key: 'revenue', kind: 'money' }],
            rows: pat.days.map((x) => ({ day: DAYS[x.day - 1], orders: x.orders, revenue: x.revenue })),
        },
    ]);
    res.set('Content-Type', XLSX_TYPE);
    res.set('Content-Disposition', 'attachment; filename="sales-report.xlsx"');
    res.send(buf);
}));

// the platform's OWN money this month: plans, extra shops and fees collected, SMS margin, costs, net
router.get('/reports/income', wrap(async (req, res) => {
    const fin = require('../services/financeService');
    const sum = await fin.summary({ months: 1 });
    const t = sum.totals;
    res.json({
        month: sum.months[0],
        billedPaise: t.billedPaise, collectedPaise: t.collectedPaise, rentIncomePaise: t.rentIncomePaise, smsMarginPaise: t.smsMarginPaise,
        costsPaise: t.costsPaise, netPaise: t.netPaise, verdict: sum.verdict,
        owedPaise: 0, overduePaise: 0, overdueShops: 0,
    });
}));

router.patch('/orders/:id/status', wrap(async (req, res) => {
    const order = isId(req.params.id) ? await Order.findById(req.params.id) : null;
    if (!order) throw httpError(404, 'Order not found');

    const updated = await orderStatus.change({
        order,
        status: req.body?.status,
        actor: { type: 'superadmin', id: req.admin._id, label: req.admin.email },
        note: req.body?.note,
        reasonCode: req.body?.reasonCode,
    });
    res.json((await withShop([updated]))[0]);
}));

// undo the last step of an order (24 hours)
router.post('/orders/:id/undo', wrap(async (req, res) => {
    const order = isId(req.params.id) ? await Order.findById(req.params.id) : null;
    if (!order) throw httpError(404, 'Order not found');
    const r = await require('../services/orderUndo').undo({ order, actor: { type: 'superadmin', id: req.admin._id, label: req.admin.email } });
    res.json({ ok: true, undone: r.undone, order: (await withShop([r.order]))[0] });
}));

module.exports = router;