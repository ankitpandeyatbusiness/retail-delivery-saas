// The shop's online money: what came in, what went back, what is still on its way.
// Mounted by shopRouter at /payments (owner, and the superadmin through the shop mount).
//   GET /report?from=2026-10-01&to=2026-10-31     (days in Indian time; default: the last 30 days)
//   GET /refunds?status=pending|processing|processed|failed&page=1
// All money is whole paise.
const express = require('express');
const OnlinePayment = require('../models/OnlinePayment');
const OnlineRefund = require('../models/OnlineRefund');
const Order = require('../models/Order');
const apiErrors = require('../middlewares/apiErrors');

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

    const [captured, refunded, open, failed] = await Promise.all([
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
    ]);
    const c = sum(captured, 'paise');
    const r = sum(refunded, 'paise');
    res.json({
        from, to,
        captured: c,                       // money that came in
        refunded: r,                       // money that went back to customers
        netPaise: c.paise - r.paise,       // what stayed with the shop in this period
        refundsOnTheWay: sum(open, 'paise'),   // asked for, not finished yet (any date)
        refundsFailed: failed,             // need a look by the platform
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

router.use(apiErrors);
module.exports = router;