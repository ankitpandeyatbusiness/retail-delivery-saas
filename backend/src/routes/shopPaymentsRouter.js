// The shop's online money: what came in, what went back, what is still on its way.
// Mounted by shopRouter at /payments (owner, and the superadmin through the shop mount).
//   GET /report?from=2026-10-01&to=2026-10-31     (days in Indian time; default: the last 30 days)
//   GET /refunds?status=pending|processing|processed|failed&page=1
//   GET /disputes                                  chargebacks of this shop
//   GET /transactions?from&to&category&status&page  every money movement of this shop: received, refunds, SMS top-ups, monthly bills
//        add &format=xlsx to download the same list (at most 5000 rows) as an Excel file (coloured headings, widths that fit)
//   GET /summary?year=2026                         the year month by month: money in, money out, kept, still to pay
// All money is whole paise.
const express = require('express');
const OnlinePayment = require('../models/OnlinePayment');
const OnlineRefund = require('../models/OnlineRefund');
const PaymentDispute = require('../models/PaymentDispute');
const Order = require('../models/Order');
const apiErrors = require('../middlewares/apiErrors');
const ledger = require('../services/moneyLedger');

const { wrap, httpError } = apiErrors;
const router = express.Router();
const IST_MS = 330 * 60000;
const STATUSES = OnlineRefund.schema.path('status').enumValues;

const day = (v, endOfDay) => {
    const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
    if (!m) throw httpError(400, 'Dates must look like 2026-10-31');
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) throw httpError(400, 'Invalid date');
    return new Date(Date.UTC(y, mo - 1, d) - IST_MS + (endOfDay ? 86400000 - 1 : 0));
};
const sum = (rows, field) => ({ count: rows[0]?.n || 0, paise: rows[0]?.[field] || 0 });

router.get('/report', wrap(async (req, res) => {
    const to = req.query.to !== undefined ? day(req.query.to, true) : new Date();
    const from = req.query.from !== undefined ? day(req.query.from, false) : new Date(to.getTime() - 30 * 86400000);
    if (from > to) throw httpError(400, 'The "from" date must not be after the "to" date');
    const tenantId = req.tenant._id;

    const [captured, refunded, open, failed, lost, disputesOpen] = await Promise.all([
        OnlinePayment.aggregate([
            { $match: { tenantId, status: 'captured', capturedAt: { $gte: from, $lte: to } } },
            { $group: { _id: null, n: { $sum: 1 }, paise: { $sum: '$capturedPaise' } } },
        ]),
        OnlineRefund.aggregate([
            { $match: { tenantId, status: 'processed', processedAt: { $gte: from, $lte: to } } },
            { $group: { _id: null, n: { $sum: 1 }, paise: { $sum: '$amountPaise' } } },
        ]),
        OnlineRefund.aggregate([
            { $match: { tenantId, status: { $in: ['pending', 'processing'] } } },
            { $group: { _id: null, n: { $sum: 1 }, paise: { $sum: '$amountPaise' } } },
        ]),
        OnlineRefund.countDocuments({ tenantId, status: 'failed', createdAt: { $gte: from, $lte: to } }),
        PaymentDispute.aggregate([   // money the bank took back
            { $match: { tenantId, status: 'lost', updatedAt: { $gte: from, $lte: to } } },
            { $group: { _id: null, n: { $sum: 1 }, paise: { $sum: '$amountPaise' } } },
        ]),
        PaymentDispute.countDocuments({ tenantId, status: { $in: ['created', 'under_review', 'action_required'] } }),
    ]);
    const c = sum(captured, 'paise');
    const r = sum(refunded, 'paise');
    const l = sum(lost, 'paise');
    res.json({
        from, to,
        captured: c,                       // money that came in
        refunded: r,                       // money that went back to customers
        disputesLost: l,                   // chargebacks the shop lost in this period
        netPaise: c.paise - r.paise - l.paise,   // what stayed with the shop in this period
        refundsOnTheWay: sum(open, 'paise'),   // asked for, not finished yet (any date)
        refundsFailed: failed,             // need a look by the platform
        disputesOpen,                      // chargebacks waiting for an answer (any date)
    });
}));

router.get('/refunds', wrap(async (req, res) => {
    const filter = { tenantId: req.tenant._id };
    if (req.query.status !== undefined) {
        if (!STATUSES.includes(req.query.status)) throw httpError(400, 'Unknown status');
        filter.status = req.query.status;
    }
    const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 1000);
    const rows = await OnlineRefund.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 30).limit(31).lean();
    const hasMore = rows.length > 30;
    if (hasMore) rows.pop();
    const orders = await Order.find({ _id: { $in: rows.map((x) => x.orderId) }, tenantId: req.tenant._id }).select('orderNo').lean();
    const no = new Map(orders.map((o) => [String(o._id), o.orderNo]));
    res.json({
        items: rows.map((x) => ({
            id: x._id, orderId: x.orderId, orderNo: no.get(String(x.orderId)) ?? null, amountPaise: x.amountPaise,
            reason: x.reason, status: x.status, createdAt: x.createdAt, processedAt: x.processedAt || null,
        })),
        page, hasMore,
    });
}));

router.get('/disputes', wrap(async (req, res) => {
    const rows = await PaymentDispute.find({ tenantId: req.tenant._id }).sort({ createdAt: -1 }).limit(100)
        .select('-notes -history').lean();
    const orders = await Order.find({ _id: { $in: rows.map((d) => d.orderId) }, tenantId: req.tenant._id }).select('orderNo').lean();
    const no = new Map(orders.map((o) => [String(o._id), o.orderNo]));
    res.json({
        items: rows.map((d) => ({
            id: d._id, orderId: d.orderId, orderNo: no.get(String(d.orderId)) ?? null, amountPaise: d.amountPaise, status: d.status,
            reasonCode: d.reasonCode || null, phase: d.phase || null, respondBy: d.respondBy || null, createdAt: d.createdAt,
        })),
    });
}));

const EXPORT_MAX = 5000;
const FILE_FORMATS = ['xlsx', 'csv'];   // an older app still asks for csv: it gets the Excel file too (there is no CSV any more)
router.get('/transactions', wrap(async (req, res) => {
    const filter = ledger.parseQuery(req.query, { view: 'shop' });
    const tenantId = req.tenant._id;
    if (!FILE_FORMATS.includes(req.query.format)) return res.json(await ledger.list({ view: 'shop', tenantId, filter }));
    // the download walks the pages, so one request never loads everything at once
    const first = await ledger.list({ view: 'shop', tenantId, filter: { ...filter, page: 1, limit: 100 } });
    let items = first.items;
    for (let p = 2; items.length < Math.min(first.total, EXPORT_MAX); p += 1) {
        const next = await ledger.list({ view: 'shop', tenantId, filter: { ...filter, page: p, limit: 100 } });
        if (!next.items.length) break;
        items = items.concat(next.items);
    }
    const { buildSheet, XLSX_TYPE } = require('../services/xlsxExport');
    const rows = items.slice(0, EXPORT_MAX).map((i) => {
        const m = i.meta || {};
        return {
            at: i.at, type: i.label, dir: i.direction === 'in' ? 'in' : 'out', amount: (i.amountPaise || 0) / 100, status: i.status === 'pending' ? 'pending' : 'done',
            orderNo: i.orderNo ?? '', ref: i.ref ?? '', details: [m.period && `period ${m.period}`, m.paymentMode, m.paymentRef, m.reason, m.method, m.note].filter(Boolean).join(' / '),
        };
    });
    const columns = [
        { header: 'Date and time (India)', key: 'at', kind: 'date' },
        { header: 'Type', key: 'type' },
        { header: 'In or out', key: 'dir', kind: 'status' },
        { header: 'Amount (Rs)', key: 'amount', kind: 'money' },
        { header: 'Status', key: 'status', kind: 'status' },
        { header: 'Order no', key: 'orderNo', kind: 'center' },
        { header: 'Reference', key: 'ref' },
        { header: 'Details', key: 'details', kind: 'wide' },
    ];
    res.set('Content-Type', XLSX_TYPE);
    res.set('Content-Disposition', 'attachment; filename="transactions.xlsx"');
    res.send(await buildSheet({ title: 'Transactions', columns, rows }));
}));

// Every rupee in and out, online AND offline, with who, what, how and when (services/shopMoney.js): the Transactions tab.
//   ?from=&to=  a range · ?date= one day · ?month=2026-10 · ?category= · ?direction=in|out · ?how=online|cash|upi · ?q=1042 (an order number) · ?page= · ?format=xlsx
router.get('/all', wrap(async (req, res) => {
    const shopMoney = require('../services/shopMoney');
    const filter = shopMoney.parseQuery(req.query);
    if (!FILE_FORMATS.includes(req.query.format)) return res.json(await shopMoney.list({ tenantId: req.tenant._id, filter }));
    const all = await shopMoney.list({ tenantId: req.tenant._id, filter: { ...filter, page: 1, limit: 100000 } });
    {
        // a proper Excel file: coloured headings, widths that fit, money as numbers (services/xlsxExport.js)
        const { buildSheet, XLSX_TYPE } = require('../services/xlsxExport');
        const rows = all.items.slice(0, EXPORT_MAX).map((i) => ({
            at: i.at, type: i.label, dir: i.direction === 'in' ? 'in' : 'out', amount: (i.amountPaise || 0) / 100, how: i.howLabel || '', status: i.status === 'pending' ? 'pending' : 'done',
            orderNo: i.orderNo ?? '', table: i.table ? `${i.table}${i.party ? ` ${i.party}` : ''}` : '', customer: i.customer || '', phone: i.phone || '', by: i.by || '', ref: i.ref || '', note: i.note || '',
        }));
        const columns = [
            { header: 'Date and time (India)', key: 'at', kind: 'date' },
            { header: 'Type', key: 'type' },
            { header: 'In or out', key: 'dir', kind: 'status' },
            { header: 'Amount (Rs)', key: 'amount', kind: 'money' },
            { header: 'How', key: 'how', kind: 'center' },
            { header: 'Status', key: 'status', kind: 'status' },
            { header: 'Order no', key: 'orderNo', kind: 'center' },
            { header: 'Table', key: 'table', kind: 'center' },
            { header: 'Customer', key: 'customer' },
            { header: 'Phone', key: 'phone', kind: 'center' },
            { header: 'Received or sent by', key: 'by' },
            { header: 'Reference', key: 'ref' },
            { header: 'Note', key: 'note', kind: 'wide' },
        ];
        res.set('Content-Type', XLSX_TYPE);
        res.set('Content-Disposition', 'attachment; filename="transactions.xlsx"');
        return res.send(await buildSheet({ title: 'Transactions', columns, rows }));
    }
}));

// A year month by month (India time). The list of years runs from the year the shop joined to this year.
router.get('/summary', wrap(async (req, res) => {
    const nowYear = new Date(Date.now() + IST_MS).getUTCFullYear();
    const firstYear = Math.min(nowYear, new Date(req.tenant.createdAt || Date.now()).getUTCFullYear());
    const year = req.query.year === undefined ? nowYear : Number(req.query.year);
    if (!Number.isInteger(year) || year < 2000 || year > nowYear) throw httpError(400, 'year must be a year from 2000 to this year');
    const pad = (n) => String(n).padStart(2, '0');
    const months = await Promise.all(Array.from({ length: 12 }, async (_, i) => {
        const m = i + 1;
        const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
        const filter = { from: day(`${year}-${pad(m)}-01`, false), to: day(`${year}-${pad(m)}-${pad(last)}`, true), page: 1, limit: 1 };
        const r = await ledger.list({ view: 'shop', tenantId: req.tenant._id, filter });
        return { month: `${year}-${pad(m)}`, inPaise: r.totals.inPaise, outPaise: r.totals.outPaise, netPaise: r.totals.netPaise, pendingPaise: r.totals.pending.paise, count: r.total };
    }));
    res.json({
        year,
        years: Array.from({ length: nowYear - firstYear + 1 }, (_, i) => nowYear - i),
        months,
        totals: {
            inPaise: months.reduce((a, m) => a + m.inPaise, 0), outPaise: months.reduce((a, m) => a + m.outPaise, 0),
            netPaise: months.reduce((a, m) => a + m.netPaise, 0), count: months.reduce((a, m) => a + m.count, 0),
        },
    });
}));

router.use(apiErrors);
module.exports = router;